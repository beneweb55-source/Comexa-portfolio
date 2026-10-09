import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { type AccessPolicy, SCOPE_ANY, SCOPE_OWN } from '../../common/auth/principal.js';
import { paginated, resolvePagination } from '../../common/dto/pagination.dto.js';
import { AppException } from '../../common/errors/app-error.js';
import { MailService } from '../../common/mail/mail.service.js';
import { REFERENCE_SCOPES } from '../../common/references/reference.scopes.js';
import type { Prisma, Quote } from '../../generated/prisma/client.js';
import {
  ActivityType,
  LeadStatus,
  NotificationType,
  ProjectStatus,
  QuoteStatus,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { CounterService, resolveStamp, stampReference } from '../counters/counter.service.js';
import {
  type BillingContact,
  clientPortalUserIds,
  primaryContactEmail,
} from '../invoices/audience.js';
import {
  acceptancePerimeter,
  assertRequestedClientAllowed,
  clientPerimeter,
} from '../invoices/billing-access.js';
import {
  buildLineRows,
  computeTotals,
  storedLineEntries,
  toLineEntries,
} from '../invoices/money.js';
import type { RequestMetadata } from '../invoices/request-meta.js';
import { isUniqueViolationOn } from '../invoices/unique-violation.js';
import { NotificationService } from '../notifications/notification.service.js';
import type {
  CreateQuoteDto,
  ListQuotesQueryDto,
  QuoteAcceptanceResult,
  RefuseQuoteDto,
  UpdateQuoteDto,
} from './dto/quote.dto.js';
import {
  canDeleteQuote,
  canEditQuote,
  canSendQuote,
  quoteDecisionBlocker,
  quoteDecisionMessage,
} from './quote-state.js';

/**
 * DEVIS — creation, envoi, decision, et la naissance d'un projet.
 *
 * DEUX REGLES GOUVERNENT TOUT CE FICHIER :
 *
 *  1. AUCUN MONTANT NE VIENT DU CLIENT. Les totaux sont calcules ici, a partir
 *     des lignes, par `money.ts`. Ce service ne lit jamais un `total` de DTO :
 *     aucun DTO n'en porte, et `forbidNonWhitelisted` fait echouer une requete
 *     qui en enverrait un. Le seul montant qu'un client fournit legitimement est
 *     celui d'un PAIEMENT, et c'est le module paiements qui le traite.
 *
 *  2. LE PERIMETRE EST DANS LE `where`. Un porteur CLIENT ne lit, ne modifie et
 *     n'accepte que les devis de son dossier, et le filtre est pose sur la
 *     requete Prisma — jamais dans un `if` apres lecture. C'est une exigence
 *     explicite du client : « un client ne doit jamais pouvoir modifier l'ID d'un
 *     autre client dans une requete pour acceder a ses donnees ». L'identifiant
 *     du client vient de `policy.clientId`, donc du COMPTE authentifie ; un
 *     `clientId` present dans l'URL ou le corps de la requete est ecrase par
 *     celui du compte ou refuse, jamais suivi.
 *
 * TROISIEME REGLE, moins visible : les ecritures qui doivent reussir ou echouer
 * ENSEMBLE vivent dans une seule transaction. L'acceptation d'un devis en est le
 * cas extreme — elle cree un client, un contact, un projet, une activite et des
 * notifications. Un client sans projet serait un dossier fantome, et un projet
 * sans client une ligne que la base refuserait de toute facon.
 */

/**
 * Ce qu'une piece renvoie toujours : ses lignes dans l'ordre, et de quoi savoir
 * a qui elle appartient, sans exposer le dossier client en entier.
 */
const QUOTE_INCLUDE = {
  items: { orderBy: { position: 'asc' } },
  client: { select: { id: true, reference: true, companyName: true } },
  prospect: {
    select: {
      id: true,
      reference: true,
      companyName: true,
      contactFirstName: true,
      contactLastName: true,
      email: true,
      phone: true,
      jobTitle: true,
      sector: true,
      website: true,
      ownerId: true,
      status: true,
      convertedClientId: true,
    },
  },
} satisfies Prisma.QuoteInclude;

type QuoteWithItems = Prisma.QuoteGetPayload<{ include: typeof QUOTE_INCLUDE }>;

/** Le prospect d'un devis, tel que `QUOTE_INCLUDE` le renvoie. */
type QuoteProspect = QuoteWithItems['prospect'];

/** Ligne deja stockee, telle qu'il faut la relire pour recalculer des totaux. */
const STORED_LINE_SELECT = {
  title: true,
  description: true,
  quantity: true,
  unitPrice: true,
  discountPercent: true,
} satisfies Prisma.QuoteItemSelect;

/**
 * Trace d'audit : les champs qui decrivent la piece, jamais les lignes.
 *
 * Les montants y sont des CHAINES (`toFixed(2)`). Un `Decimal` laisse tel quel
 * serait serialise differemment selon le chemin (objet, ou nombre), et deux
 * entrees du journal ne seraient plus comparables entre elles.
 */
function quoteSnapshot(quote: Quote): Record<string, unknown> {
  return {
    reference: quote.reference,
    status: quote.status,
    clientId: quote.clientId,
    prospectId: quote.prospectId,
    currency: quote.currency,
    total: quote.total.toFixed(2),
  };
}

/** Cible d'un devis : un client OU un prospect, jamais les deux, jamais aucun. */
interface QuoteTarget {
  readonly clientId: string | null;
  readonly prospectId: string | null;
}

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CounterService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    private readonly clients: ClientsService,
    private readonly mail: MailService,
  ) {}

  /**
   * Liste des devis.
   *
   * `query.clientId` n'est applique QU'AU porteur interne : pour un porteur
   * CLIENT, la seule valeur qui compte est celle de son compte, et elle est deja
   * posee dans le `where`. Laisser le filtre de requete s'ajouter au filtre de
   * compte n'elargirait rien — les deux sont en `AND` — mais l'ecrire quand meme
   * serait la porte ouverte a une future negation, qui elargirait.
   */
  async list(query: ListQuotesQueryDto, policy: AccessPolicy) {
    // Aucun droit de lecture (ex. visiteur sans commande) : page vide, pas 403.
    if (!policy.widestScope('quote', 'read', [SCOPE_ANY, SCOPE_OWN])) {
      return paginated([], 0, resolvePagination(query));
    }
    const ownClientId = clientPerimeter(policy, 'quote', 'read');
    const search = query.search?.trim();

    const where: Prisma.QuoteWhereInput = {
      deletedAt: null,
      ...(ownClientId ? { clientId: ownClientId } : {}),
      ...(!ownClientId && query.clientId ? { clientId: query.clientId } : {}),
      ...(query.prospectId ? { prospectId: query.prospectId } : {}),
      ...(query.status ? { status: query.status } : {}),
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
      this.prisma.quote.findMany({
        where,
        include: QUOTE_INCLUDE,
        // La date d'emission d'abord : c'est l'ordre du carnet, et il ne bouge
        // pas quand un devis est renvoye. La reference departage deux devis du
        // meme jour.
        orderBy: [{ issueDate: 'desc' }, { reference: 'desc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.quote.count({ where }),
    ]);

    return paginated(items, total, pagination);
  }

  /** Un devis, ou 404 — jamais 403 : une ligne invisible n'existe pas. */
  async getOne(quoteId: string, policy: AccessPolicy): Promise<QuoteWithItems> {
    const ownClientId = clientPerimeter(policy, 'quote', 'read');

    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, deletedAt: null, ...(ownClientId ? { clientId: ownClientId } : {}) },
      include: QUOTE_INCLUDE,
    });

    if (!quote) {
      throw AppException.notFound('QUOTE_NOT_FOUND', "Ce devis n'existe pas.");
    }

    return quote;
  }

  /**
   * Cree un devis en BROUILLON.
   *
   * Un devis nait toujours brouillon, meme si `issueDate` est renseigne a une
   * date passee : le statut dit ou en est la NEGOCIATION, la date dit quand le
   * document a ete etabli. On peut etablir un devis aujourd'hui et l'envoyer
   * demain.
   */
  async create(
    dto: CreateQuoteDto,
    policy: AccessPolicy,
    meta: RequestMetadata,
  ): Promise<QuoteWithItems> {
    const actorId = policy.userId;

    // Un porteur `own` ne choisit pas son client : le sien s'impose. Un porteur
    // interne n'a pas de `clientId` sur son compte, donc il choisit — c'est
    // precisement lui qui etablit le devis.
    const ownClientId = clientPerimeter(policy, 'quote', 'write');
    assertRequestedClientAllowed(policy, dto.clientId);

    const target = resolveTarget({
      clientId: ownClientId ?? dto.clientId ?? null,
      prospectId: dto.prospectId ?? null,
    });

    const entries = toLineEntries(dto.items);
    const totals = computeTotals(entries, dto.taxRate ?? 0);
    const rows = buildLineRows(entries, totals, totals.taxRate);

    const created = await this.prisma.$transaction(async (tx) => {
      await assertTargetExists(tx, target);

      // Le numero est reserve DANS cette transaction : un echec plus loin annule
      // la reservation, donc il ne reste pas un numero attribue a un devis qui
      // n'existe pas.
      const stamp = resolveStamp({ scope: REFERENCE_SCOPES.QUOTE });
      const sequence = await this.counters.next(stamp, tx);

      const quote = await tx.quote.create({
        data: {
          reference: stampReference(stamp, sequence),
          // `sequence` et `year` sont des colonnes NOT NULL de `quotes` : elles
          // viennent du MEME timbre que la reference, donc les trois ne peuvent
          // pas diverger.
          sequence,
          year: stamp.year,
          prospectId: target.prospectId,
          clientId: target.clientId,
          subject: dto.subject,
          notes: dto.notes ?? null,
          terms: dto.terms ?? null,
          status: QuoteStatus.DRAFT,
          issueDate: dto.issueDate ? new Date(dto.issueDate) : new Date(),
          validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
          currency: (dto.currency ?? 'EUR').toUpperCase(),
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          taxRate: totals.taxRate,
          taxAmount: totals.taxAmount,
          total: totals.total,
          createdById: actorId,
          items: { create: rows },
        },
        include: QUOTE_INCLUDE,
      });

      await this.activity.record(
        {
          type: ActivityType.STATUS_CHANGE,
          message: `Devis ${quote.reference} cree.`,
          clientId: target.clientId,
          actorId,
          metadata: {
            reference: quote.reference,
            total: quote.total.toFixed(2),
            status: quote.status,
          },
          isClientVisible: true,
        },
        tx,
      );

      return quote;
    });

    // L'audit est ecrit APRES le commit, volontairement : il ne rejoint pas la
    // transaction (voir `AuditService`, qui ne prend pas de `tx`). Il peut donc
    // manquer une ligne si le processus meurt entre les deux, mais il ne peut pas
    // annoncer une ecriture qui n'a pas eu lieu — le sens qui compte pour une
    // trace d'audit.
    await this.audit.record({
      actorId,
      action: 'QUOTE_CREATED',
      entityType: 'Quote',
      entityId: created.id,
      after: quoteSnapshot(created),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return created;
  }

  /**
   * Modifie un BROUILLON.
   *
   * Des qu'un devis est envoye, il est fige : le client recoit un document, il
   * l'accepte, et l'acceptation declenche un projet. Si le document pouvait
   * encore changer entre l'envoi et l'acceptation, l'accord porterait sur autre
   * chose que ce qui a ete signe.
   *
   * `items`, s'il est fourni, REMPLACE toutes les lignes. Pas de modification
   * ligne a ligne : le client n'a pas d'identifiant de ligne stable, et un
   * remplacement complet evite l'etat intermediaire ou une ligne a change et les
   * totaux non.
   *
   * LE TAUX DE TVA SEUL RECALCULE AUSSI LES TOTAUX, et c'est le piege de cette
   * methode : changer le taux sans toucher aux lignes laisserait `taxAmount` et
   * `total` calcules sur l'ancien taux. Un devis dont les lignes portent 20 % et
   * dont le total porte 0 % est un document faux — et il est faux d'un montant
   * qui ne se voit pas a la premiere lecture.
   */
  async update(
    quoteId: string,
    dto: UpdateQuoteDto,
    policy: AccessPolicy,
    meta: RequestMetadata,
  ): Promise<QuoteWithItems> {
    const actorId = policy.userId;
    const ownClientId = clientPerimeter(policy, 'quote', 'write');
    assertRequestedClientAllowed(policy, dto.clientId);

    const before = await this.prisma.quote.findFirst({
      where: { id: quoteId, deletedAt: null, ...(ownClientId ? { clientId: ownClientId } : {}) },
      select: {
        id: true,
        status: true,
        clientId: true,
        prospectId: true,
        taxRate: true,
        total: true,
        items: { select: STORED_LINE_SELECT, orderBy: { position: 'asc' } },
      },
    });

    if (!before) {
      throw AppException.notFound('QUOTE_NOT_FOUND', "Ce devis n'existe pas.");
    }

    if (!canEditQuote(before.status)) {
      throw AppException.conflict(
        'QUOTE_NOT_EDITABLE',
        'Ce devis a ete envoye : il ne peut plus etre modifie. Creez un nouveau devis.',
      );
    }

    // Le changement de cible se juge sur l'etat FINAL : envoyer `clientId` sans
    // deplacer `prospectId` laisserait un devis vise par les deux. Le schema le
    // dit (« exactement l'un des deux ») mais aucune contrainte de base ne le
    // garantit — voir le rapport : la migration ne pose pas de CHECK.
    const target = resolveTarget({
      clientId: ownClientId ?? dto.clientId ?? before.clientId,
      prospectId: dto.prospectId ?? before.prospectId,
    });

    const replacements = dto.items ? toLineEntries(dto.items) : null;
    const needsTotals = replacements !== null || dto.taxRate !== undefined;

    // Sans nouvelles lignes, on recalcule a partir des lignes STOCKEES : elles
    // sont la seule verite sur ce que porte le document.
    const entries = replacements ?? storedLineEntries(before.items);
    const totals = needsTotals ? computeTotals(entries, dto.taxRate ?? before.taxRate) : null;
    const rows =
      replacements && totals ? buildLineRows(replacements, totals, totals.taxRate) : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      await assertTargetExists(tx, target);

      if (rows) {
        // Remplacement complet : les anciennes lignes partent avec leurs totaux.
        await tx.quoteItem.deleteMany({ where: { quoteId } });
      } else if (totals) {
        // Seul le taux a change : les lignes restent, mais leur `taxRate` est
        // recopie sur chacune pour qu'une ligne lue seule reste exacte.
        await tx.quoteItem.updateMany({
          where: { quoteId },
          data: { taxRate: totals.taxRate },
        });
      }

      return tx.quote.update({
        where: { id: quoteId },
        data: {
          ...(dto.subject === undefined ? {} : { subject: dto.subject }),
          ...(dto.notes === undefined ? {} : { notes: dto.notes }),
          ...(dto.terms === undefined ? {} : { terms: dto.terms }),
          ...(dto.issueDate === undefined ? {} : { issueDate: new Date(dto.issueDate) }),
          ...(dto.validUntil === undefined ? {} : { validUntil: new Date(dto.validUntil) }),
          ...(dto.currency === undefined ? {} : { currency: dto.currency.toUpperCase() }),
          clientId: target.clientId,
          prospectId: target.prospectId,
          ...(totals
            ? {
                subtotal: totals.subtotal,
                discountAmount: totals.discountAmount,
                taxRate: totals.taxRate,
                taxAmount: totals.taxAmount,
                total: totals.total,
              }
            : {}),
          ...(rows ? { items: { create: rows } } : {}),
        },
        include: QUOTE_INCLUDE,
      });
    });

    await this.audit.record({
      actorId,
      action: 'QUOTE_UPDATED',
      entityType: 'Quote',
      entityId: updated.id,
      before: {
        status: before.status,
        clientId: before.clientId,
        prospectId: before.prospectId,
        total: before.total.toFixed(2),
      },
      after: quoteSnapshot(updated),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return updated;
  }

  /**
   * Envoie le devis au client.
   *
   * Le statut passe a `SENT` et `sentAt` est pose. C'est cet etat — et lui seul —
   * qui rend le devis decidable (`canDecideQuote`), donc c'est aussi ce qui rend
   * la piece non modifiable.
   *
   * L'ENVOI PART SUR DEUX CANAUX, ET LE SECOND N'EST PAS UN DOUBLON DU PREMIER :
   *
   *  - dans l'APPLICATION, la notification est ecrite dans la transaction, pour
   *    les porteurs de l'espace client — ceux qui ont un compte ;
   *  - par COURRIEL, vers le contact du dossier — et c'est le SEUL canal qui
   *    atteint un devis adresse a un prospect, qui n'a par definition aucun
   *    compte. C'est le cas le plus frequent, et c'est celui ou l'absence de
   *    courriel rendait l'envoi invisible.
   *
   * Le courriel part apres le commit et son echec est journalise, jamais
   * propage : le statut, l'activite et la notification sont la verite de
   * l'operation, le courriel est un effet qui depend d'un relais externe.
   */
  async send(
    quoteId: string,
    policy: AccessPolicy,
    meta: RequestMetadata,
  ): Promise<QuoteWithItems> {
    const actorId = policy.userId;
    const ownClientId = clientPerimeter(policy, 'quote', 'write');

    const sent = await this.prisma.$transaction(async (tx) => {
      const quote = await tx.quote.findFirst({
        where: { id: quoteId, deletedAt: null, ...(ownClientId ? { clientId: ownClientId } : {}) },
        select: {
          id: true,
          reference: true,
          status: true,
          clientId: true,
          prospectId: true,
          total: true,
          currency: true,
          validUntil: true,
          // Le prospect est joint parce qu'il porte l'adresse quand le devis ne
          // vise pas encore de dossier client : sans lui, un devis parti avant
          // la conversion partirait sans destinataire.
          prospect: {
            select: { email: true, contactFirstName: true, contactLastName: true },
          },
        },
      });

      if (!quote) {
        throw AppException.notFound('QUOTE_NOT_FOUND', "Ce devis n'existe pas.");
      }

      if (!canSendQuote(quote.status)) {
        throw AppException.conflict(
          'QUOTE_NOT_SENDABLE',
          'Ce devis a deja ete envoye. Un renvoi redaterait un document que le client a peut-etre deja recu.',
        );
      }

      if (quote.clientId === null && quote.prospectId === null) {
        throw AppException.unprocessable(
          'QUOTE_TARGET_INVALID',
          "Ce devis ne vise ni client ni prospect : il n'y a personne a qui l'envoyer.",
        );
      }

      const updated = await tx.quote.update({
        where: { id: quote.id },
        data: { status: QuoteStatus.SENT, sentAt: new Date() },
        include: QUOTE_INCLUDE,
      });

      await this.activity.record(
        {
          type: ActivityType.STATUS_CHANGE,
          message: `Devis ${quote.reference} envoye au client.`,
          clientId: quote.clientId,
          actorId,
          metadata: { reference: quote.reference, status: QuoteStatus.SENT },
          isClientVisible: true,
        },
        tx,
      );

      // L'ENVOI SE NOTIFIE AUX COMPTES DU CLIENT, et seulement s'ils existent :
      // un devis adresse a un prospect n'a pas encore d'espace client, donc pas
      // de destinataire. Ce n'est pas une erreur, c'est l'etat normal d'un devis
      // parti avant la conversion — et c'est precisement le cas que le courriel
      // couvre.
      for (const userId of await clientPortalUserIds(quote.clientId, tx)) {
        await this.notifications.notify(
          userId,
          {
            type: NotificationType.QUOTE_SENT,
            title: `Devis ${quote.reference}`,
            body: 'Un devis vous a ete adresse.',
            link: `/devis/${quote.id}`,
            entityType: 'Quote',
            entityId: quote.id,
          },
          tx,
        );
      }

      return { quote: updated, recipient: await quoteRecipient(quote, tx) };
    });

    await this.audit.record({
      actorId,
      action: 'QUOTE_SENT',
      entityType: 'Quote',
      entityId: sent.quote.id,
      after: quoteSnapshot(sent.quote),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    await this.deliverQuote(sent.quote, sent.recipient);

    return sent.quote;
  }

  /**
   * Le courriel du devis — effet de l'envoi, jamais condition de sa reussite.
   *
   * Le raisonnement est celui de `InvoicesService.deliverInvoice` : l'etat est
   * deja ecrit, le client a peut-etre recu la piece, et refuser l'envoi parce que
   * le relais SMTP est en panne ferait perdre une operation correcte a cause
   * d'un effet secondaire. On journalise, et on continue.
   */
  private async deliverQuote(
    quote: QuoteWithItems,
    recipient: BillingContact | null,
  ): Promise<void> {
    if (!recipient) {
      this.logger.warn(
        `Devis ${quote.reference} envoye sans courriel : ni dossier client joignable, ni adresse sur le prospect.`,
      );
      return;
    }

    try {
      await this.mail.sendQuote({
        to: recipient.email,
        firstName: recipient.firstName,
        reference: quote.reference,
        total: quote.total.toFixed(2),
        currency: quote.currency,
        validUntil: quote.validUntil,
        // Meme chemin que la notification in-app : les deux canaux doivent mener
        // au meme ecran.
        path: `/devis/${quote.id}`,
      });
    } catch (error) {
      this.logger.error(
        `Devis ${quote.reference} envoye, mais le courriel a ${recipient.email} n'a pas pu partir : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Marque le devis comme CONSULTE.
   *
   * Reserve au porteur CLIENT, et c'est tout l'interet de la route : `viewedAt`
   * repond a « le client a-t-il ouvert le document ? ». Un commercial qui ouvre
   * la fiche depuis le back-office rendrait la reponse fausse, et un commercial
   * qui la marque a la main la rendrait fausse volontairement. Un devis deja
   * accepte ou refuse ne bouge pas : la consultation est un fait anterieur.
   *
   * La mise a jour vise `quote.id`, lu SOUS le filtre de perimetre : la ligne
   * ecrite est donc celle que le porteur avait le droit de lire, et il n'y a pas
   * de second chemin d'acces a surveiller.
   */
  async markViewed(quoteId: string, policy: AccessPolicy): Promise<QuoteWithItems> {
    if (!policy.isClient()) {
      throw AppException.forbidden(
        'Seul le client destinataire peut marquer un devis comme consulte.',
      );
    }

    const ownClientId = clientPerimeter(policy, 'quote', 'read');

    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, deletedAt: null, ...(ownClientId ? { clientId: ownClientId } : {}) },
      include: QUOTE_INCLUDE,
    });

    if (!quote) {
      throw AppException.notFound('QUOTE_NOT_FOUND', "Ce devis n'existe pas.");
    }

    if (quote.status === QuoteStatus.VIEWED) {
      // Idempotent : un client qui recharge la page ne doit pas provoquer
      // d'erreur, et la date de premiere consultation ne doit pas etre ecrasee.
      return quote;
    }

    if (quote.status !== QuoteStatus.SENT) {
      throw AppException.conflict(
        'QUOTE_NOT_VIEWABLE',
        'Ce devis ne peut pas etre marque comme consulte dans son etat actuel.',
      );
    }

    return this.prisma.quote.update({
      where: { id: quote.id },
      data: { status: QuoteStatus.VIEWED, viewedAt: new Date() },
      include: QUOTE_INCLUDE,
    });
  }

  /**
   * ACCEPTE le devis, et fait naitre le projet.
   *
   * C'est l'operation la plus lourde du module, et elle est integralement
   * transactionnelle. Elle :
   *
   *  1. relit le devis AVEC le perimetre dans le `where` — un porteur CLIENT ne
   *     peut donc pas accepter le devis d'un autre : la ligne est invisible, donc
   *     c'est un 404, et non un 403 qui confirmerait son existence ;
   *  2. refuse une seconde decision, au moyen de la machine a etats ;
   *  3. trouve ou cree le dossier client — un devis adresse a un prospect
   *     convertit ce prospect, dans CETTE transaction ;
   *  4. passe le devis en `ACCEPTED` et l'attache au client ;
   *  5. cree le projet du devis, `quoteId` TOUJOURS renseigne ;
   *  6. ecrit l'activite et les notifications DANS la transaction.
   *
   * L'IDEMPOTENCE DE L'ETAPE 5 REPOSE SUR LA BASE, PAS SUR UNE LECTURE.
   * `Project.quoteId` est `@unique`. Deux acceptations simultanees du meme devis
   * passeraient toutes les deux devant un `findFirst` avant creation ; la seconde
   * echouera en revanche sur la contrainte d'unicite, et c'est cette erreur
   * `P2002` qui est traduite en 409. Le devis n'est donc jamais accepte deux
   * fois, et il n'existe jamais deux projets nes du meme devis.
   *
   * LE DEVIS D'UN PROSPECT GARDE LES DEUX LIENS une fois accepte : `prospectId`
   * reste pose, et `clientId` s'y ajoute. C'est le seul etat ou les deux
   * coexistent, et il est fige — un devis accepte ne se modifie plus : le devis
   * reste ainsi lisible par l'historique du prospect comme par le dossier du
   * client, sans qu'aucune des deux vues ne perde la piece.
   */
  async accept(
    quoteId: string,
    policy: AccessPolicy,
    meta: RequestMetadata,
  ): Promise<QuoteAcceptanceResult> {
    const actorId = policy.userId;

    // `null` pour un porteur interne : il n'a pas de dossier client, donc pas de
    // filtre — mais la route exige `quote:write:any` pour lui. Voir
    // `acceptancePerimeter`.
    const ownClientId = acceptancePerimeter(policy);

    const accepted = await this.prisma.$transaction(async (tx) => {
      const quote = await tx.quote.findFirst({
        where: { id: quoteId, deletedAt: null, ...(ownClientId ? { clientId: ownClientId } : {}) },
        include: { items: { select: { id: true } }, prospect: true },
      });

      if (!quote) {
        throw AppException.notFound('QUOTE_NOT_FOUND', "Ce devis n'existe pas.");
      }

      const blocker = quoteDecisionBlocker(quote.status);

      if (blocker) {
        throw AppException.conflict(blocker, quoteDecisionMessage(blocker));
      }

      assertNotExpired(quote.validUntil, quote.status);

      if (quote.items.length === 0) {
        throw AppException.unprocessable(
          'QUOTE_EMPTY',
          'Un devis sans ligne ne peut pas etre accepte : il ne decrit rien.',
        );
      }

      const now = new Date();

      // Le nom est FIGE sur la piece : il est signe, donc il ne doit pas changer
      // si la fiche utilisateur est renommee plus tard.
      const acceptor = await tx.user.findUnique({
        where: { id: actorId },
        select: { firstName: true, lastName: true },
      });
      const acceptedByName = acceptor ? `${acceptor.firstName} ${acceptor.lastName}`.trim() : null;

      const client = await resolveClientForAcceptance(this.clients, tx, quote, actorId, now);

      const decided = await tx.quote.update({
        where: { id: quote.id },
        data: {
          status: QuoteStatus.ACCEPTED,
          acceptedAt: now,
          acceptedById: actorId,
          acceptedByName,
          acceptedByIp: meta.ipAddress,
          clientId: client.id,
        },
        select: { id: true, reference: true, subject: true, total: true, currency: true },
      });

      const stamp = resolveStamp({ scope: REFERENCE_SCOPES.PROJECT });
      const projectReference = await this.counters.reference(stamp, tx);

      const project = await createProjectFromQuote(tx, {
        quote: decided,
        clientId: client.id,
        reference: projectReference,
        actorId,
      });

      await this.activity.record(
        {
          type: ActivityType.STATUS_CHANGE,
          message: `Devis ${decided.reference} accepte par le client.`,
          projectId: project.id,
          clientId: client.id,
          actorId,
          metadata: {
            reference: decided.reference,
            status: QuoteStatus.ACCEPTED,
            projectReference: project.reference,
          },
          isClientVisible: true,
        },
        tx,
      );

      const audience = new Set<string>();

      // Le commercial qui a etabli le devis, et le proprietaire du prospect :
      // ce sont les deux personnes qui attendaient la reponse.
      if (quote.createdById) {
        audience.add(quote.createdById);
      }

      if (quote.prospect?.ownerId) {
        audience.add(quote.prospect.ownerId);
      }

      // Une acceptation enregistree par l'agence (courriel, telephone) doit etre
      // annoncee a l'espace client : c'est le client qui doit pouvoir verifier ce
      // qui a ete accepte en son nom.
      if (ownClientId === null) {
        for (const userId of await clientPortalUserIds(client.id, tx)) {
          audience.add(userId);
        }
      }

      for (const userId of audience) {
        if (userId === actorId) {
          continue;
        }

        await this.notifications.notify(
          userId,
          {
            type: NotificationType.QUOTE_ACCEPTED,
            title: `Devis ${decided.reference} accepte`,
            body: `Le devis a ete accepte. Un projet a ete ouvert : ${project.reference}.`,
            link: `/devis/${quote.id}`,
            entityType: 'Quote',
            entityId: quote.id,
          },
          tx,
        );
      }

      return {
        quoteId: quote.id,
        status: QuoteStatus.ACCEPTED,
        clientId: client.id,
        projectId: project.id,
        clientCreated: client.created,
        reference: decided.reference,
        projectReference: project.reference,
        previousStatus: quote.status,
      };
    });

    await this.audit.record({
      actorId,
      action: 'QUOTE_ACCEPTED',
      entityType: 'Quote',
      entityId: accepted.quoteId,
      before: { status: accepted.previousStatus },
      after: {
        status: QuoteStatus.ACCEPTED,
        reference: accepted.reference,
        clientId: accepted.clientId,
        projectId: accepted.projectId,
        projectReference: accepted.projectReference,
        clientCreated: accepted.clientCreated,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      quoteId: accepted.quoteId,
      status: accepted.status,
      clientId: accepted.clientId,
      projectId: accepted.projectId,
      clientCreated: accepted.clientCreated,
    };
  }

  /**
   * REFUSE le devis. Meme autorite que l'acceptation : c'est la meme decision,
   * prise dans l'autre sens.
   *
   * Le motif est OBLIGATOIRE (le DTO le garantit). Un refus sans motif prive le
   * commercial de la seule information qui lui permettrait de repondre — c'est la
   * difference entre un devis perdu et un devis perdu qu'on peut corriger.
   */
  async refuse(
    quoteId: string,
    dto: RefuseQuoteDto,
    policy: AccessPolicy,
    meta: RequestMetadata,
  ): Promise<QuoteWithItems> {
    const actorId = policy.userId;
    const ownClientId = acceptancePerimeter(policy);

    const refused = await this.prisma.$transaction(async (tx) => {
      const quote = await tx.quote.findFirst({
        where: { id: quoteId, deletedAt: null, ...(ownClientId ? { clientId: ownClientId } : {}) },
        select: {
          id: true,
          reference: true,
          status: true,
          clientId: true,
          validUntil: true,
          createdById: true,
        },
      });

      if (!quote) {
        throw AppException.notFound('QUOTE_NOT_FOUND', "Ce devis n'existe pas.");
      }

      const blocker = quoteDecisionBlocker(quote.status);

      if (blocker) {
        throw AppException.conflict(blocker, quoteDecisionMessage(blocker));
      }

      assertNotExpired(quote.validUntil, quote.status);

      const updated = await tx.quote.update({
        where: { id: quote.id },
        data: {
          status: QuoteStatus.REJECTED,
          rejectedAt: new Date(),
          rejectionReason: dto.reason,
        },
        include: QUOTE_INCLUDE,
      });

      await this.activity.record(
        {
          type: ActivityType.STATUS_CHANGE,
          message: `Devis ${quote.reference} refuse : ${dto.reason}`,
          clientId: quote.clientId,
          actorId,
          metadata: { reference: quote.reference, status: QuoteStatus.REJECTED },
          isClientVisible: true,
        },
        tx,
      );

      if (quote.createdById && quote.createdById !== actorId) {
        await this.notifications.notify(
          quote.createdById,
          {
            type: NotificationType.QUOTE_REJECTED,
            title: `Devis ${quote.reference} refuse`,
            body: dto.reason,
            link: `/devis/${quote.id}`,
            entityType: 'Quote',
            entityId: quote.id,
          },
          tx,
        );
      }

      return updated;
    });

    await this.audit.record({
      actorId,
      action: 'QUOTE_REJECTED',
      entityType: 'Quote',
      entityId: refused.id,
      after: { ...quoteSnapshot(refused), reason: dto.reason },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return refused;
  }

  /**
   * Supprime (logiquement) un BROUILLON.
   *
   * Un devis envoye ne se supprime pas : le client peut l'avoir recu, l'avoir
   * imprime, et une piece commerciale qui disparait sans trace est un probleme
   * pour tout le monde sauf celui qui l'a supprimee. L'annulation existe pour
   * cela, et elle laisse le document lisible.
   */
  async remove(
    quoteId: string,
    policy: AccessPolicy,
    meta: RequestMetadata,
  ): Promise<{ deleted: true }> {
    const actorId = policy.userId;
    const ownClientId = clientPerimeter(policy, 'quote', 'delete');

    const before = await this.prisma.quote.findFirst({
      where: { id: quoteId, deletedAt: null, ...(ownClientId ? { clientId: ownClientId } : {}) },
      select: { id: true, status: true, reference: true },
    });

    if (!before) {
      throw AppException.notFound('QUOTE_NOT_FOUND', "Ce devis n'existe pas.");
    }

    if (!canDeleteQuote(before.status)) {
      throw AppException.conflict(
        'QUOTE_NOT_DELETABLE',
        "Seul un brouillon peut etre supprime. Un devis envoye s'annule, pour garder sa trace.",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.quote.update({ where: { id: quoteId }, data: { deletedAt: new Date() } });

      await this.activity.record(
        {
          type: ActivityType.SYSTEM,
          message: `Devis ${before.reference} supprime.`,
          clientId: null,
          actorId,
          metadata: { reference: before.reference },
        },
        tx,
      );
    });

    await this.audit.record({
      actorId,
      action: 'QUOTE_DELETED',
      entityType: 'Quote',
      entityId: before.id,
      before: { reference: before.reference, status: before.status },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { deleted: true };
  }
}

/**
 * A QUI LE DEVIS PART — la seule question que le courriel ajoute au module.
 *
 * Deux chemins, parce qu'un devis vise un CLIENT ou un PROSPECT :
 *
 *  - le dossier client : l'adresse du contact principal, par
 *    `primaryContactEmail`, qui porte deja l'ordre de lecture (contact principal
 *    d'abord, puis un contact joignable) ;
 *  - le PROSPECT : l'adresse de sa fiche. C'est le cas d'un devis parti avant la
 *    conversion, ou le dossier client n'existe pas encore — et c'est le cas le
 *    plus courant, celui ou la notification in-app ne pouvait atteindre
 *    personne.
 *
 * Le repli sur le prospect quand le dossier client n'a AUCUN contact joignable
 * n'est pas un hasard : sur un devis accepte, le prospect et le client sont la
 * meme personne (`convertedClientId`), donc son adresse reste la bonne. Il vaut
 * mieux qu'un devis atteigne la bonne personne par le chemin de secours que de
 * n'atteindre personne parce que le contact du dossier a ete saisi sans adresse.
 *
 * `null` quand rien n'est joignable : ce n'est pas une erreur a lever, l'appelant
 * journalise et l'envoi aboutit.
 */
interface QuoteRecipientSource {
  readonly clientId: string | null;
  readonly prospect: {
    readonly email: string;
    readonly contactFirstName: string;
    readonly contactLastName: string;
  } | null;
}

async function quoteRecipient(
  quote: QuoteRecipientSource,
  tx: Prisma.TransactionClient,
): Promise<BillingContact | null> {
  const contact = await primaryContactEmail(quote.clientId, tx);

  if (contact) {
    return contact;
  }

  const email = quote.prospect?.email.trim();

  if (quote.prospect && email) {
    return {
      email,
      firstName: quote.prospect.contactFirstName,
      lastName: quote.prospect.contactLastName,
    };
  }

  return null;
}

/**
 * Un devis vise exactement une cible.
 *
 * Le schema le dit entre commentaires ; la base, elle, ne le contraint pas —
 * aucune contrainte CHECK dans la migration. Cette fonction est donc, avec
 * `assertTargetExists`, la seule barriere, et elle vit dans le service parce
 * qu'aucun garde de route ne peut voir la difference entre un `clientId` et un
 * `prospectId` presents tous les deux.
 */
function resolveTarget(input: QuoteTarget): QuoteTarget {
  const hasClient = input.clientId !== null;
  const hasProspect = input.prospectId !== null;

  if (hasClient === hasProspect) {
    throw AppException.unprocessable(
      'QUOTE_TARGET_INVALID',
      'Un devis vise exactement un client ou un prospect : les deux a la fois, ou aucun, ne decrit rien.',
      { clientId: input.clientId, prospectId: input.prospectId },
    );
  }

  return input;
}

/**
 * Verifie que la cible existe et n'est pas supprimee.
 *
 * Sans ce controle, une faute de frappe sur un identifiant remonterait en
 * violation de cle etrangere — donc en 500 — pour ce qui n'est qu'une saisie
 * erronee.
 */
async function assertTargetExists(
  tx: Prisma.TransactionClient,
  target: QuoteTarget,
): Promise<void> {
  if (target.clientId) {
    const client = await tx.client.findFirst({
      where: { id: target.clientId, deletedAt: null },
      select: { id: true },
    });

    if (!client) {
      throw AppException.unprocessable(
        'QUOTE_CLIENT_NOT_FOUND',
        "Le client designe n'existe pas ou a ete supprime.",
        { clientId: target.clientId },
      );
    }

    return;
  }

  if (target.prospectId) {
    const prospect = await tx.prospect.findFirst({
      where: { id: target.prospectId, deletedAt: null },
      select: { id: true },
    });

    if (!prospect) {
      throw AppException.unprocessable(
        'QUOTE_PROSPECT_NOT_FOUND',
        "Le prospect designe n'existe pas ou a ete supprime.",
        { prospectId: target.prospectId },
      );
    }
  }
}

/**
 * Un devis dont la date de validite est passee ne se decide plus.
 *
 * Le statut `EXPIRED` est pose par une tache planifiee, pas par ce service : un
 * devis reste donc `SENT` apres sa date limite jusqu'au prochain passage. Sans ce
 * controle, un client pourrait accepter en decembre un devis valable jusqu'en
 * septembre, et l'agence decouvrirait l'engagement apres coup.
 */
function assertNotExpired(validUntil: Date | null, status: QuoteStatus): void {
  if (status === QuoteStatus.EXPIRED) {
    throw AppException.conflict('QUOTE_EXPIRED', quoteDecisionMessage('QUOTE_EXPIRED'));
  }

  if (validUntil !== null && validUntil.getTime() < Date.now()) {
    throw AppException.conflict(
      'QUOTE_EXPIRED',
      'Ce devis a expire : sa date de validite est passee. Etablissez un nouveau devis.',
    );
  }
}

/** Ce que l'acceptation a besoin de lire d'un devis. */
type AcceptableQuote = Pick<Quote, 'id' | 'reference' | 'clientId'> & {
  readonly prospect: QuoteProspect;
};

/**
 * Le dossier client de l'acceptation : celui du devis, celui du prospect deja
 * converti, ou un dossier CREE depuis le prospect.
 *
 * Ce dernier cas est le seul du module qui fasse naitre un client, et il passe
 * par `ClientsService.createFromProspect` — l'implementation unique de la
 * conversion, appelee DANS la transaction du devis. Deux implementations de cette
 * regle produiraient deux dossiers pour le meme prospect, ce que la base
 * interdirait (`Prospect.convertedClientId` est `@unique`) mais au prix d'un 500
 * incomprehensible.
 *
 * L'ECRITURE DU PROSPECT (statut gagne, lien vers le client, date, historique)
 * est faite ici et non par le module prospects : son service de conversion prend
 * un `AuthenticatedUser` et ouvre SA transaction, donc il n'est pas appelable
 * depuis la notre. C'est un ecart signale au coordinateur — une methode
 * `markConverted(tx, ...)` cote prospects supprimerait ces vingt lignes.
 */
async function resolveClientForAcceptance(
  clients: ClientsService,
  tx: Prisma.TransactionClient,
  quote: AcceptableQuote,
  actorId: string,
  now: Date,
): Promise<{ id: string; created: boolean }> {
  if (quote.clientId) {
    return { id: quote.clientId, created: false };
  }

  const prospect = quote.prospect;

  if (!prospect) {
    // Un devis sans client ET sans prospect est deja refuse a la creation ; ce
    // garde couvre les lignes ecrites avant cette regle, ou a la main.
    throw AppException.unprocessable(
      'QUOTE_TARGET_INVALID',
      "Ce devis ne vise ni client ni prospect : il n'y a personne pour l'accepter.",
    );
  }

  // Deja converti : on REUTILISE le dossier. C'est ce qui rend acceptable un
  // second devis du meme prospect sans creer un deuxieme client.
  if (prospect.convertedClientId) {
    return { id: prospect.convertedClientId, created: false };
  }

  try {
    const client = await clients.createFromProspect(tx, {
      companyName: prospect.companyName,
      sector: prospect.sector,
      website: prospect.website,
      // Le prospect a un proprietaire commercial : c'est lui qui suit le dossier,
      // donc lui qui devient responsable de compte, faute d'information
      // contraire.
      accountManagerId: prospect.ownerId,
      contact: {
        firstName: prospect.contactFirstName,
        lastName: prospect.contactLastName,
        email: prospect.email,
        phone: prospect.phone,
        jobTitle: prospect.jobTitle,
      },
    });

    await tx.prospect.update({
      where: { id: prospect.id },
      data: {
        convertedClientId: client.id,
        convertedAt: now,
        status: LeadStatus.WON,
      },
    });

    // Le pipeline commercial garde la trace du changement d'etape : c'est ce qui
    // rend le tableau de bord commercial credible, et une conversion qui ne
    // laisserait pas de trace se lirait comme un prospect simplement disparu.
    await tx.leadStatusHistory.create({
      data: {
        prospectId: prospect.id,
        fromStatus: prospect.status,
        toStatus: LeadStatus.WON,
        note: `Acceptation du devis ${quote.reference}`,
        changedById: actorId,
      },
    });

    return { id: client.id, created: true };
  } catch (error) {
    // Deux acceptations simultanees de deux devis du MEME prospect : la deuxieme
    // ne peut pas creer un second client (`convertedClientId` est unique). Elle
    // est refusee, et un nouvel essai trouvera le lien pose par la premiere — la
    // relecture ci-dessus est donc le chemin de reprise, et non une lecture avant
    // ecriture.
    //
    // ON NE TENTE PAS DE RELIRE LE PROSPECT ICI : l'echec d'une instruction
    // avorte la transaction PostgreSQL, et toute requete suivante echouerait sur
    // « current transaction is aborted ». Le seul chemin de reprise est un nouvel
    // appel, qui repartira d'une transaction neuve.
    if (isUniqueViolationOn(error, 'convertedClientId')) {
      throw AppException.conflict(
        'PROSPECT_ALREADY_CONVERTED',
        "Ce prospect vient d'etre converti par une autre operation. Reessayez : le dossier client existe des maintenant.",
      );
    }

    throw error;
  }
}

/**
 * Le projet ne du devis accepte.
 *
 * `quoteId` est TOUJOURS renseigne, et c'est ce qui rend l'acceptation
 * idempotente : la contrainte `@unique` de `Project.quoteId` fait echouer la
 * seconde creation, et l'erreur est traduite en 409 « deja accepte ». Un
 * `findFirst` avant creation ne suffirait pas — deux acceptations simultanees le
 * passeraient toutes les deux.
 *
 * Le budget est COPIE du total du devis, jamais recalcule ni ressaisi : c'est la
 * meme somme, et deux calculs d'une meme somme finissent par diverger.
 */
async function createProjectFromQuote(
  tx: Prisma.TransactionClient,
  input: {
    quote: {
      id: string;
      reference: string;
      subject: string;
      total: Prisma.Decimal;
      currency: string;
    };
    clientId: string;
    reference: string;
    actorId: string;
  },
): Promise<{ id: string; reference: string }> {
  try {
    return await tx.project.create({
      data: {
        reference: input.reference,
        name: input.quote.subject,
        clientId: input.clientId,
        quoteId: input.quote.id,
        budget: input.quote.total,
        currency: input.quote.currency,
        // Un devis accepte est un engagement : le projet est planifie, pas
        // brouillon. `PLANNED` ne declare pas que le travail a commence — c'est
        // `IN_PROGRESS` — mais qu'il est commande.
        status: ProjectStatus.PLANNED,
        createdById: input.actorId,
      },
      select: { id: true, reference: true },
    });
  } catch (error) {
    if (isUniqueViolationOn(error, 'quoteId')) {
      throw AppException.conflict(
        'QUOTE_ALREADY_ACCEPTED',
        'Ce devis a deja ete accepte : un projet en est deja ne.',
      );
    }

    throw error;
  }
}
