import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { type AccessPolicy, SCOPE_ANY, SCOPE_OWN } from '../../common/auth/principal.js';
import { paginated, resolvePagination } from '../../common/dto/pagination.dto.js';
import { AppException } from '../../common/errors/app-error.js';
import { MailService } from '../../common/mail/mail.service.js';
import { REFERENCE_SCOPES } from '../../common/references/reference.scopes.js';
import { Prisma, type Invoice } from '../../generated/prisma/client.js';
import {
  ActivityType,
  InvoiceStatus,
  InvoiceType,
  NotificationType,
  PaymentStatus,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { CounterService, resolveStamp, stampReference } from '../counters/counter.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { canInvoiceQuote } from '../quotes/quote-state.js';
import { type BillingContact, clientPortalUserIds, primaryContactEmail } from './audience.js';
import { clientPerimeter } from './billing-access.js';
import {
  DEFAULT_PAYMENT_TERM_DAYS,
  type CreateInvoiceFromQuoteDto,
  type ListInvoicesQueryDto,
} from './dto/invoice.dto.js';
import { lockInvoice } from './invoice-lock.js';
import {
  canCancelInvoice,
  canEditInvoice,
  canSendInvoice,
  paidAtFor,
  statusAfterPayment,
} from './invoice-state.js';
import { buildLineRows, computeTotals, storedLineEntries, zero } from './money.js';
import type { RequestMetadata } from './request-meta.js';

/**
 * FACTURES.
 *
 * UNE FACTURE NE SE SAISIT PAS, ELLE SE GENERE. Le seul chemin de creation est
 * `createFromQuote`, qui part d'un devis ACCEPTE et en COPIE les lignes. Il n'y
 * a donc aucun endroit ou un montant fourni par un client pourrait entrer dans
 * une facture : ni le total, ni une ligne, ni un taux ne viennent d'un DTO de
 * facture. Le taux de TVA lui-meme est celui du devis facture.
 *
 * LE SOLDE NE SE STOCKE PAS, IL SE CALCULE. `Invoice.amountPaid` est un CUMUL
 * tenu a jour, et `statusAfterPayment` en derive le statut. Une facture n'est
 * jamais « marquee payee » : elle l'est parce que la somme de ses paiements
 * atteint son total, et elle cesse de l'etre si cette somme redescend.
 *
 * UN SEUL ECRIVAIN POUR `amountPaid`, `status` ET `paidAt` :
 * `recomputePaymentState`. Le module paiements l'appelle dans SA transaction,
 * apres avoir insere le paiement ; aucun autre code n'ecrit ces trois colonnes.
 * Deux ecrivains divergeraient : l'un oublierait `paidAt`, l'autre calculerait
 * le statut a partir d'une somme partielle.
 */

/**
 * Ce qu'une facture renvoie : ses lignes, son client, et ses paiements.
 *
 * Les paiements sont joints parce que la question qui suit toujours la lecture
 * d'une facture est « ou en est le reglement ? », et que la reponse est dans la
 * liste de ses encaissements — `amountPaid` n'en donne que le total.
 */
const INVOICE_INCLUDE = {
  items: { orderBy: { position: 'asc' } },
  client: { select: { id: true, reference: true, companyName: true } },
  payments: {
    where: { deletedAt: null },
    orderBy: { paidAt: 'desc' },
    select: {
      id: true,
      reference: true,
      amount: true,
      currency: true,
      method: true,
      status: true,
      paidAt: true,
      deletedAt: true,
    },
  },
} satisfies Prisma.InvoiceInclude;

type InvoiceWithItems = Prisma.InvoiceGetPayload<{ include: typeof INVOICE_INCLUDE }>;

/** Trace d'audit d'une facture : jamais ses lignes, jamais ses paiements. */
function invoiceSnapshot(invoice: Invoice): Record<string, unknown> {
  return {
    reference: invoice.reference,
    status: invoice.status,
    clientId: invoice.clientId,
    quoteId: invoice.quoteId,
    currency: invoice.currency,
    total: invoice.total.toFixed(2),
    amountPaid: invoice.amountPaid.toFixed(2),
  };
}

/** Ajoute des jours a une date, sans passer par les millisecondes en dur. */
function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CounterService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /**
   * GENERE la facture d'un devis accepte, en copiant ses lignes.
   *
   * POURQUOI UN DEVIS ACCEPTE, ET RIEN D'AUTRE. Facturer une proposition
   * commerciale produirait un document qui est juridiquement un devis et
   * comptablement une facture : le client recevrait une demande de paiement pour
   * un travail qu'il n'a pas commande. La regle est dans `canInvoiceQuote`, pas
   * ici — et elle est lue au meme endroit que les autres transitions du devis.
   *
   * LES MONTANTS SONT RECALCULES, PUIS CONFRONTES AU DEVIS. Les lignes sont
   * copiees telles quelles (aucun montant n'est ressaisi), et le noyau
   * d'arithmetique en redonne les totaux. Si ce recalcul ne retombe pas
   * exactement sur le total du devis accepte, la facture N'EST PAS EMISE : cela
   * ne peut arriver que si une ligne du devis a ete modifiee hors de l'API, et
   * dans ce cas le document facture ne serait plus celui que le client a
   * accepte. Un refus vaut mieux qu'une facture fausse.
   *
   * LA TRANSACTION COUVRE : la relecture du devis (statut + lignes), la
   * reservation du numero, l'ecriture de la facture et de ses lignes, et
   * l'activite. Un echec apres la reservation du numero annule tout, numero
   * compris.
   */
  async createFromQuote(
    quoteId: string,
    dto: CreateInvoiceFromQuoteDto,
    policy: AccessPolicy,
    meta: RequestMetadata,
  ): Promise<InvoiceWithItems> {
    const actorId = policy.userId;
    // Un porteur CLIENT ne voit que les devis de son dossier : le filtre est
    // pose dans la lecture du devis, donc un devis d'un autre client est
    // invisible, et la facture ne peut pas naitre.
    const ownClientId = clientPerimeter(policy, 'invoice', 'write');

    const { invoice: created, createdNow } = await this.prisma.$transaction(async (tx) => {
      // Sérialise la conversion d'un même devis. Sans verrou sur le devis, deux
      // requêtes simultanées pourraient toutes deux ne trouver aucune facture,
      // puis réserver deux numéros et créer deux pièces.
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "quotes" WHERE "id" = ${quoteId} FOR UPDATE`);

      const quote = await tx.quote.findFirst({
        where: { id: quoteId, deletedAt: null, ...(ownClientId ? { clientId: ownClientId } : {}) },
        include: { items: { orderBy: { position: 'asc' } } },
      });

      if (!quote) {
        throw AppException.notFound('QUOTE_NOT_FOUND', "Ce devis n'existe pas.");
      }

      if (!canInvoiceQuote(quote.status)) {
        throw AppException.conflict(
          'QUOTE_NOT_INVOICEABLE',
          "Une facture ne peut etre generee que sur un devis accepte. Ce devis n'est pas dans cet etat.",
        );
      }

      if (!quote.clientId) {
        // Un devis accepte porte toujours un client — c'est l'acceptation qui le
        // lui donne. Cette ligne couvre une donnee anterieure a cette regle.
        throw AppException.unprocessable(
          'QUOTE_TARGET_INVALID',
          "Ce devis n'est rattache a aucun dossier client : il n'y a personne a facturer.",
        );
      }

      // L'action est idempotente : le double clic ou la répétition d'une requête
      // après un délai réseau restitue la facture déjà créée plutôt que d'en
      // numéroter une seconde pour le même devis.
      const existingInvoice = await tx.invoice.findFirst({
        where: { quoteId: quote.id, type: InvoiceType.STANDARD, deletedAt: null },
        include: INVOICE_INCLUDE,
      });
      if (existingInvoice) return { invoice: existingInvoice, createdNow: false };

      const entries = storedLineEntries(quote.items);
      const totals = computeTotals(entries, quote.taxRate);

      if (!totals.total.equals(quote.total)) {
        // 422 et non 409 : la requete est bien formee, c'est l'ETAT de la piece
        // qui interdit l'emission. Les deux totaux sont renvoyes dans `details`
        // parce que cet ecart ne peut venir que d'une ecriture hors API sur les
        // lignes du devis : sans les deux chiffres, l'incident est un mystere.
        throw AppException.unprocessable(
          'QUOTE_LINES_INCONSISTENT',
          'Le devis ne correspond plus a ses propres lignes : la facture ne serait pas conforme a ce que le client a accepte.',
          {
            quoteTotal: quote.total.toFixed(2),
            computedTotal: totals.total.toFixed(2),
            currency: quote.currency,
          },
        );
      }

      const issueDate = dto.issueDate ? new Date(dto.issueDate) : new Date();
      const dueDate = dto.dueDate
        ? new Date(dto.dueDate)
        : addDays(issueDate, DEFAULT_PAYMENT_TERM_DAYS);

      if (dueDate.getTime() < issueDate.getTime()) {
        throw AppException.badRequest(
          'INVOICE_DUE_DATE_BEFORE_ISSUE',
          "L'echeance ne peut pas preceder la date d'emission.",
        );
      }

      const stamp = resolveStamp({ scope: REFERENCE_SCOPES.INVOICE });
      const sequence = await this.counters.next(stamp, tx);

      // Le projet ne du devis accepte, s'il existe : c'est lui qui porte
      // l'avancement, et la facture s'y rattache pour que le suivi financier du
      // projet additionne ses factures. Cette lecture ne DECIDE rien — elle
      // derive un lien.
      const project = await tx.project.findFirst({
        where: { quoteId: quote.id, deletedAt: null },
        select: { id: true },
      });

      const invoice = await tx.invoice.create({
        data: {
          reference: stampReference(stamp, sequence),
          sequence,
          year: stamp.year,
          clientId: quote.clientId,
          projectId: project?.id ?? null,
          quoteId: quote.id,
          type: InvoiceType.STANDARD,
          // Brouillon : la facture n'existe pour le client qu'a l'envoi. La
          // garder brouillon un instant permet de verifier la piece avant qu'elle
          // ne parte.
          status: InvoiceStatus.DRAFT,
          subject: dto.subject ?? quote.subject,
          notes: dto.notes ?? quote.notes,
          terms: dto.terms ?? quote.terms,
          issueDate,
          dueDate,
          currency: quote.currency,
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          taxRate: totals.taxRate,
          taxAmount: totals.taxAmount,
          total: totals.total,
          createdById: actorId,
          items: { create: buildLineRows(entries, totals, totals.taxRate) },
        },
        include: INVOICE_INCLUDE,
      });

      await this.activity.record(
        {
          type: ActivityType.STATUS_CHANGE,
          message: `Facture ${invoice.reference} etablie depuis le devis ${quote.reference}.`,
          projectId: project?.id ?? null,
          clientId: quote.clientId,
          actorId,
          metadata: {
            reference: invoice.reference,
            quoteReference: quote.reference,
            total: invoice.total.toFixed(2),
            status: invoice.status,
          },
          // Un brouillon n'est pas visible du client : personne ne l'a recu.
          isClientVisible: false,
        },
        tx,
      );

      return { invoice, createdNow: true };
    });

    if (createdNow) {
      await this.audit.record({
        actorId,
        action: 'INVOICE_CREATED_FROM_QUOTE',
        entityType: 'Invoice',
        entityId: created.id,
        after: { ...invoiceSnapshot(created), quoteId },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    }

    return created;
  }

  /**
   * Liste des factures.
   *
   * `query.clientId` n'est applique QU'AU porteur interne : pour un compte de
   * l'espace client, le perimetre vient du compte et s'ajoute en `AND` (voir
   * `billing-access.ts`). Un client qui demanderait le dossier d'un autre
   * obtiendrait la liste de ses propres factures, jamais celles de l'autre.
   */
  async list(query: ListInvoicesQueryDto, policy: AccessPolicy) {
    // Aucun droit de lecture (ex. visiteur sans commande) : page vide, pas 403.
    if (!policy.widestScope('invoice', 'read', [SCOPE_ANY, SCOPE_OWN])) {
      return paginated([], 0, resolvePagination(query));
    }
    const ownClientId = clientPerimeter(policy, 'invoice', 'read');
    const search = query.search?.trim();

    const where: Prisma.InvoiceWhereInput = {
      deletedAt: null,
      // Un client ne voit jamais un brouillon : il n'a pas encore été émis.
      ...(ownClientId ? { clientId: ownClientId, NOT: { status: 'DRAFT' } } : {}),
      ...(!ownClientId && query.clientId ? { clientId: query.clientId } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.quoteId ? { quoteId: query.quoteId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.currency ? { currency: query.currency.toUpperCase() } : {}),
      ...(search
        ? {
            OR: [
              { reference: { contains: search, mode: 'insensitive' } },
              { subject: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const pagination = resolvePagination(query);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        include: INVOICE_INCLUDE,
        // L'echeance en premier : la question posee a une liste de factures est
        // « lesquelles sont en retard », et une echeance depassee se lit a l'oeil
        // dans une colonne triee.
        orderBy: [{ dueDate: 'asc' }, { reference: 'desc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return paginated(items, total, pagination);
  }

  /** Une facture, ou 404 — jamais 403 : une ligne invisible n'existe pas. */
  async getOne(invoiceId: string, policy: AccessPolicy): Promise<InvoiceWithItems> {
    const ownClientId = clientPerimeter(policy, 'invoice', 'read');

    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        deletedAt: null,
        ...(ownClientId ? { clientId: ownClientId, NOT: { status: 'DRAFT' } } : {}),
      },
      include: INVOICE_INCLUDE,
    });

    if (!invoice) {
      throw AppException.notFound('INVOICE_NOT_FOUND', "Cette facture n'existe pas.");
    }

    return invoice;
  }

  /**
   * Envoie la facture au client : c'est l'envoi qui la fait exister pour lui.
   *
   * Avant, elle est un brouillon que personne n'a recu ; apres, elle porte une
   * date d'echeance qui court et un droit au paiement. Une facture deja envoyee
   * ne se renvoie pas : le renvoi redaterait un document que le client a
   * peut-etre deja recu, et deux dates d'envoi pour une meme piece brouillent
   * toute relance.
   *
   * L'ENVOI PORTE SUR TROIS CANAUX, ET ILS N'ONT PAS LE MEME STATUT :
   *
   *   1. le STATUT de la piece (`SENT`, `sentAt`) et l'ACTIVITE du dossier sont
   *      ecrits dans une seule transaction — c'est la verite de l'operation ;
   *   2. la NOTIFICATION in-app est ecrite dans cette meme transaction, pour les
   *      porteurs de l'espace client, qui voient la piece dans l'application ;
   *   3. le COURRIEL part APRES le commit, et son echec est journalise, jamais
   *      propage. C'est la partie qui atteint un client qui n'a pas encore de
   *      compte — et c'est aussi celle qui depend d'un tiers (le relais SMTP).
   *      Faire echouer l'envoi d'une facture parce que le relais est en panne
   *      reviendrait a perdre un etat metier correct a cause d'un effet
   *      secondaire : la facture resterait un brouillon, et l'agence croirait
   *      ne pas l'avoir envoyee alors que le client, lui, l'aurait recue.
   */
  async send(
    invoiceId: string,
    policy: AccessPolicy,
    meta: RequestMetadata,
  ): Promise<InvoiceWithItems> {
    const actorId = policy.userId;
    const ownClientId = clientPerimeter(policy, 'invoice', 'write');

    const sent = await this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: {
          id: invoiceId,
          deletedAt: null,
          ...(ownClientId ? { clientId: ownClientId } : {}),
        },
        select: {
          id: true,
          reference: true,
          status: true,
          clientId: true,
          total: true,
          currency: true,
          dueDate: true,
        },
      });

      if (!invoice) {
        throw AppException.notFound('INVOICE_NOT_FOUND', "Cette facture n'existe pas.");
      }

      if (!canSendInvoice(invoice.status)) {
        throw AppException.conflict(
          'INVOICE_NOT_SENDABLE',
          'Cette facture a deja ete envoyee. Un renvoi redaterait une piece que le client a peut-etre deja recue.',
        );
      }

      const updated = await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: InvoiceStatus.SENT, sentAt: new Date() },
        include: INVOICE_INCLUDE,
      });

      await this.activity.record(
        {
          type: ActivityType.STATUS_CHANGE,
          message: `Facture ${invoice.reference} envoyee au client.`,
          clientId: invoice.clientId,
          actorId,
          metadata: {
            reference: invoice.reference,
            status: InvoiceStatus.SENT,
            total: invoice.total.toFixed(2),
          },
          isClientVisible: true,
        },
        tx,
      );

      for (const userId of await clientPortalUserIds(invoice.clientId, tx)) {
        await this.notifications.notify(
          userId,
          {
            type: NotificationType.INVOICE_ISSUED,
            title: `Facture ${invoice.reference}`,
            body: `Une facture de ${invoice.total.toFixed(2)} ${invoice.currency} vous a ete adressee.`,
            link: `/factures/${invoice.id}`,
            entityType: 'Invoice',
            entityId: invoice.id,
          },
          tx,
        );
      }

      // L'adresse est lue DANS la transaction, avec le reste : c'est l'etat qui
      // a produit l'envoi. Elle peut etre nulle (dossier sans contact
      // joignable) — ce n'est pas une erreur, c'est un dossier ou le courriel
      // n'est pas un canal disponible, et la piece est enregistree quand meme.
      return { invoice: updated, recipient: await primaryContactEmail(invoice.clientId, tx) };
    });

    await this.audit.record({
      actorId,
      action: 'INVOICE_SENT',
      entityType: 'Invoice',
      entityId: sent.invoice.id,
      after: invoiceSnapshot(sent.invoice),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    await this.deliverInvoice(sent.invoice, sent.recipient);

    return sent.invoice;
  }

  /**
   * Le courriel de la facture — effet de l'envoi, jamais condition de sa
   * reussite.
   *
   * `auth.service.ts` fait deja ce choix pour le mot de passe oublie : le
   * `MailService` annonce dans ses journaux l'absence de SMTP et laisse
   * l'operation aboutir. La difference ici est le sens de l'echec. Sur un mot de
   * passe oublie, un relais en panne fait remonter une erreur parce que
   * l'utilisateur attend un lien et doit pouvoir recommencer. Sur une facture,
   * l'etat metier est DEJA ecrit et le client a peut-etre recu la piece : faire
   * echouer la requete pousserait l'agence a reessayer un envoi que le systeme
   * refuse desormais (« cette facture a deja ete envoyee »), donc a croire que
   * rien ne s'est passe alors que tout s'est passe sauf le courriel. On
   * journalise, on continue, et la trace reste dans l'activite du dossier.
   */
  private async deliverInvoice(
    invoice: InvoiceWithItems,
    recipient: BillingContact | null,
  ): Promise<void> {
    if (!recipient) {
      this.logger.warn(
        `Facture ${invoice.reference} envoyee sans courriel : le dossier ${invoice.clientId} n'a aucun contact joignable.`,
      );
      return;
    }

    try {
      await this.mail.sendInvoice({
        to: recipient.email,
        firstName: recipient.firstName,
        reference: invoice.reference,
        total: invoice.total.toFixed(2),
        currency: invoice.currency,
        dueDate: invoice.dueDate,
        // Meme chemin que la notification in-app : le courriel et la
        // notification doivent mener au meme ecran.
        path: `/factures/${invoice.id}`,
      });
    } catch (error) {
      this.logger.error(
        `Facture ${invoice.reference} envoyee, mais le courriel a ${recipient.email} n'a pas pu partir : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * ANNULE une facture, tant qu'aucun mouvement d'argent n'existe.
   *
   * Des qu'un paiement est encaisse, l'annulation n'est plus une correction mais
   * une disparition : l'argent est entre, et faire disparaitre la piece qui
   * l'explique laisserait un encaissement orphelin dans la comptabilite.
   *
   * LA CORRECTION COMPTABLE APPROPRIEE N'EXISTE PAS DANS CETTE API, ET LE MESSAGE
   * LE DIT. Un avoir (`InvoiceType.CREDIT_NOTE`) est bien declare dans le schema
   * Prisma, mais AUCUN chemin de code n'en ecrit : le type n'apparait que dans
   * deux commentaires. Annoncer « corrigez par un avoir » revenait donc a indiquer
   * a l'appelant un geste que l'API refuse — un remede imaginaire est pire qu'une
   * absence de remede, parce qu'il fait perdre du temps a qui le suit.
   *
   * Le message nomme donc ce qui est reellement faisable : annuler d'abord les
   * encaissements (`DELETE /payments/{id}`, suppression logique, solde et statut
   * recalcules par `recomputePaymentState`), puis annuler la facture — `DRAFT`,
   * `SENT` et `OVERDUE` sont annulables, voir `canCancelInvoice`.
   *
   * ET IL FAUT LES RETIRER TOUS. C'est le piege de ce message : retirer un seul
   * encaissement sur deux laisse la facture en `PARTIALLY_PAID`
   * (`statusAfterPayment`), un etat que `canCancelInvoice` REFUSE — l'appelant qui
   * suivrait la consigne a moitie retomberait sur la meme erreur, en croyant avoir
   * applique le remede. Le texte dit donc explicitement qu'un encaissement restant
   * suffit a tout bloquer.
   *
   * Quant a l'avoir, il est nomme comme la LIMITE, plus comme un remede : une
   * facture deja remise au client dont le montant doit changer n'a aucune
   * correction disponible ici, ce qui est consigne dans `docs/API.md`, section
   * « Ecarts connus et limites assumees ».
   */
  async cancel(
    invoiceId: string,
    policy: AccessPolicy,
    meta: RequestMetadata,
  ): Promise<InvoiceWithItems> {
    const actorId = policy.userId;
    const ownClientId = clientPerimeter(policy, 'invoice', 'write');

    const cancelled = await this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: {
          id: invoiceId,
          deletedAt: null,
          ...(ownClientId ? { clientId: ownClientId } : {}),
        },
        select: { id: true, reference: true, status: true, clientId: true },
      });

      if (!invoice) {
        throw AppException.notFound('INVOICE_NOT_FOUND', "Cette facture n'existe pas.");
      }

      if (!canCancelInvoice(invoice.status)) {
        // DEUX SITUATIONS DIFFERENTES ARRIVENT ICI, et elles n'appellent pas la
        // meme reponse : une facture deja annulee (le geste est simplement repete)
        // et une facture qui a depasse le stade de l'annulation parce que de
        // l'argent a bouge (`PAID`, `PARTIALLY_PAID`) ou a ete rendu (`REFUNDED`,
        // un statut qu'aucun chemin de code n'ecrit aujourd'hui — il est couvert
        // ici au cas ou l'ecriture arriverait un jour). Les confondre dans un
        // seul texte oblige a en ecrire un qui ne dit rien de vrai ni a l'une ni
        // a l'autre : dire « elle porte un encaissement » d'une piece remboursee
        // serait faux.
        throw AppException.conflict(
          'INVOICE_NOT_CANCELLABLE',
          invoice.status === InvoiceStatus.CANCELLED
            ? 'Cette facture est deja annulee.'
            : "Cette facture a depasse le stade ou l'annulation est ouverte : seules " +
                "les factures DRAFT, SENT et OVERDUE s'annulent. Si son statut vient " +
                "d'un encaissement saisi par erreur, supprimez TOUS les paiements " +
                "rattaches (DELETE /payments/{id}) : l'annulation est une suppression " +
                'logique, et le solde comme le statut de la facture se recalculent. ' +
                'La facture revient alors en SENT et redevient annulable. Il suffit ' +
                "qu'un seul encaissement reste pour qu'elle soit PARTIALLY_PAID, et " +
                "l'annulation echouera de nouveau. Une facture deja remise au client " +
                'dont le montant doit changer se corrige par un avoir, que cette API ' +
                'ne sait pas encore emettre.',
        );
      }

      const updated = await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: InvoiceStatus.CANCELLED, cancelledAt: new Date() },
        include: INVOICE_INCLUDE,
      });

      await this.activity.record(
        {
          type: ActivityType.STATUS_CHANGE,
          message: `Facture ${invoice.reference} annulee.`,
          clientId: invoice.clientId,
          actorId,
          metadata: { reference: invoice.reference, status: InvoiceStatus.CANCELLED },
          // Annuler un brouillon ne regarde pas le client : il ne l'a jamais vue.
          isClientVisible: invoice.status !== InvoiceStatus.DRAFT,
        },
        tx,
      );

      return updated;
    });

    await this.audit.record({
      actorId,
      action: 'INVOICE_CANCELLED',
      entityType: 'Invoice',
      entityId: cancelled.id,
      after: invoiceSnapshot(cancelled),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return cancelled;
  }

  /**
   * Supprime (logiquement) un BROUILLON.
   *
   * Meme regle que pour les devis : une piece partie ne s'efface pas. La
   * difference est qu'une facture, elle, peut etre annulee — l'annulation laisse
   * le document lisible avec son statut, la suppression le retire des listes.
   */
  async remove(
    invoiceId: string,
    policy: AccessPolicy,
    meta: RequestMetadata,
  ): Promise<{ deleted: true }> {
    const actorId = policy.userId;
    const ownClientId = clientPerimeter(policy, 'invoice', 'delete');

    const before = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, deletedAt: null, ...(ownClientId ? { clientId: ownClientId } : {}) },
      select: { id: true, status: true, reference: true },
    });

    if (!before) {
      throw AppException.notFound('INVOICE_NOT_FOUND', "Cette facture n'existe pas.");
    }

    if (!canEditInvoice(before.status)) {
      throw AppException.conflict(
        'INVOICE_NOT_DELETABLE',
        "Seul un brouillon peut etre supprime. Une facture envoyee s'annule, pour garder sa trace.",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.invoice.update({ where: { id: invoiceId }, data: { deletedAt: new Date() } });

      await this.activity.record(
        {
          type: ActivityType.SYSTEM,
          message: `Facture ${before.reference} supprimee.`,
          clientId: null,
          actorId,
          metadata: { reference: before.reference },
        },
        tx,
      );
    });

    await this.audit.record({
      actorId,
      action: 'INVOICE_DELETED',
      entityType: 'Invoice',
      entityId: before.id,
      before: { reference: before.reference, status: before.status },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { deleted: true };
  }

  /**
   * LE SEUL ECRIVAIN DE `amountPaid`, `status` ET `paidAt`.
   *
   * Appelee par le module paiements DANS la transaction qui vient d'inserer le
   * paiement, et apres avoir pris le verrou de la facture (`lockInvoice`). Trois
   * raisons de la garder ici plutot que dans le service des paiements :
   *
   *  1. ces trois colonnes appartiennent a la facture, pas au paiement ;
   *  2. le module paiements n'a pas a connaitre la machine a etats des factures ;
   *  3. un second ecrivain, meme « juste pour un remboursement », ferait diverger
   *     le statut du solde — c'est exactement ce que la derivation empeche.
   *
   * `tx` EST OBLIGATOIRE, et ce n'est pas une commodite : sans la transaction de
   * l'appelant, la somme lue ici ne verrait pas le paiement qui vient d'etre
   * insere, et le statut serait calcule sur une liste incomplete.
   *
   * La reecriture est IDEMPOTENTE : rejouer la fonction sur une facture dont
   * rien n'a change repose les memes valeurs. `paidAtFor` preserve la date du
   * premier encaissement complet (`previousPaidAt ?? now`), donc un second appel
   * ne redate pas un paiement deja solde.
   */
  async recomputePaymentState(
    invoiceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<{ status: InvoiceStatus; amountPaid: Prisma.Decimal }> {
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { id: true, status: true, total: true, amountPaid: true, paidAt: true },
    });

    // Seuls les paiements REUSSIS comptent. Un paiement en attente n'est pas de
    // l'argent recu, et un paiement rembourse ne l'est plus.
    const aggregate = await tx.payment.aggregate({
      where: {
        invoiceId,
        status: PaymentStatus.SUCCEEDED,
        deletedAt: null,
      },
      _sum: { amount: true },
    });

    const paid = aggregate._sum.amount ?? zero();
    const status = statusAfterPayment(invoice.status, paid, invoice.total);
    const paidAt = paidAtFor(status, invoice.paidAt, new Date());

    await tx.invoice.update({
      where: { id: invoiceId },
      data: { amountPaid: paid, status, paidAt },
    });

    return { status, amountPaid: paid };
  }

  /**
   * Lecture d'une facture POUR ENREGISTRER UN PAIEMENT, verrou comprise.
   *
   * Le verrou est pris AVANT la lecture du solde : c'est lui qui rend le
   * controle de depassement fiable quand deux encaissements arrivent en meme
   * temps (voir `invoice-lock.ts`). Le perimetre est celui que l'appelant a
   * calcule — le module paiements filtre avec `clientId`, et cette fonction ne
   * decide pas des droits : elle les applique.
   *
   * Renvoie `null` quand la facture n'existe pas DANS LE PERIMETRE, pour que
   * l'appelant reponde 404 — un 403 confirmerait l'existence de la ligne.
   */
  async lockForPayment(
    tx: Prisma.TransactionClient,
    invoiceId: string,
    ownClientId: string | null,
  ): Promise<Invoice | null> {
    const locked = await lockInvoice(tx, invoiceId);

    if (!locked) {
      return null;
    }

    return tx.invoice.findFirst({
      where: { id: invoiceId, deletedAt: null, ...(ownClientId ? { clientId: ownClientId } : {}) },
    });
  }
}
