import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AccessPolicy } from '../../common/auth/principal.js';
import { paginated, resolvePagination, type Paginated } from '../../common/dto/pagination.dto.js';
import { AppException } from '../../common/errors/app-error.js';
import { REFERENCE_SCOPES } from '../../common/references/reference.scopes.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ActivityType, NotificationType, PaymentStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { CounterService } from '../counters/counter.service.js';
import { clientPortalUserIds } from '../invoices/audience.js';
import { clientPerimeter } from '../invoices/billing-access.js';
import { canRecordPayment } from '../invoices/invoice-state.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { balanceOf, money, zero } from '../invoices/money.js';
import type { RequestMetadata } from '../invoices/request-meta.js';
import { NotificationService } from '../notifications/notification.service.js';
import type { CreatePaymentDto, ListPaymentsQueryDto } from './dto/payment.dto.js';

/**
 * Ce qu'une lecture de paiement renvoie : le paiement, et sa facture en resume.
 *
 * La facture est JOINTE a chaque lecture, et ce n'est pas du confort : un
 * paiement sans sa facture ne dit ni a qui il appartient ni quel solde il
 * laisse, donc l'ecran qui doit afficher « 1 200,00 EUR sur FAC-2026-0003 »
 * ferait une seconde requete par ligne. Les colonnes monétaires sont lues
 * BRUTES (`Decimal`) : le formatage a deux decimales se fait a la sortie, une
 * seule fois, dans `PaymentResult`.
 */
const PAYMENT_INCLUDE = {
  invoice: {
    select: {
      id: true,
      reference: true,
      status: true,
      currency: true,
      total: true,
      amountPaid: true,
      clientId: true,
    },
  },
} satisfies Prisma.PaymentInclude;

type PaymentWithInvoice = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

/**
 * PAIEMENTS — l'argent qui entre, et rien d'autre.
 *
 * UN PAIEMENT ENREGISTRE EST UN ENCAISSEMENT CONSTATE. Il nait `SUCCEEDED`, et
 * ce n'est pas un raccourci : une intention de paiement (`PENDING`) ne vient pas
 * d'une saisie humaine mais d'un prestataire, et une ligne `PENDING` creee a la
 * main serait un encaissement qui n'a pas eu lieu, compte dans les listes et pas
 * dans le solde — le genre d'ecart qui se decouvre a la cloture. L'API
 * n'enregistre donc que ce qui est arrive sur le compte ; le cycle de vie
 * complet d'un paiement en ligne viendra avec son integration.
 *
 * LE PLAFOND EST LE SOLDE, ET IL SE VERIFIE SOUS VERROU. La borne du DTO
 * (`amount` positif et borne) ne dit rien du solde : c'est une propriete de la
 * facture, et elle change entre la lecture et l'ecriture. Voir `invoice-lock.ts`
 * pour ce que trois implementations naives de ce controle laissent passer.
 *
 * LE STATUT DE LA FACTURE N'EST PAS ECRIT ICI. Ce service insere le paiement,
 * puis appelle `InvoicesService.recomputePaymentState`, qui est le SEUL ecrivain
 * de `amountPaid`, `status` et `paidAt`. Deux ecrivains divergeraient au premier
 * remboursement.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CounterService,
    private readonly invoices: InvoicesService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  /**
   * ENREGISTRE un encaissement sur une facture.
   *
   * L'ORDRE DES OPERATIONS COMPTE :
   *
   *  1. VERROUILLER la facture (`lockForPayment`) — avant toute lecture de
   *     solde, sans quoi deux encaissements simultanes passent chacun le
   *     controle ;
   *  2. verifier l'etat (`canRecordPayment`) : on n'encaisse pas un brouillon,
   *     que le client n'a jamais recu ;
   *  3. lire le solde et refuser tout depassement ;
   *  4. reserver la reference, inserer le paiement ;
   *  5. recalculer l'etat de la facture, dans la MEME transaction ;
   *  6. ecrire l'activite et notifier le client, dans la MEME transaction.
   *
   * Le perimetre (`ownClientId`) vient du COMPTE authentifie et non de la
   * requete : un porteur CLIENT qui vise la facture d'un autre client ne la
   * trouve pas, donc 404, et ne peut rien y encaisser.
   */
  async createForInvoice(
    invoiceId: string,
    dto: CreatePaymentDto,
    policy: AccessPolicy,
    meta: RequestMetadata,
  ): Promise<PaymentResult> {
    const actorId = policy.userId;
    const ownClientId = clientPerimeter(policy, 'payment', 'write');

    const result = await this.prisma.$transaction(async (tx) => {
      const invoice = await this.invoices.lockForPayment(tx, invoiceId, ownClientId);

      if (!invoice) {
        // Invisible dans le perimetre, ou inexistante : meme reponse. Un 403
        // distinct confirmerait l'existence d'une facture a laquelle le porteur
        // n'a pas acces.
        throw AppException.notFound('INVOICE_NOT_FOUND', "Cette facture n'existe pas.");
      }

      if (!canRecordPayment(invoice.status)) {
        throw AppException.conflict(
          'INVOICE_NOT_PAYABLE',
          "Cette facture n'est pas payable dans son etat actuel : elle doit d'abord avoir ete envoyee.",
        );
      }

      const amount = money(dto.amount);

      // Le DTO garantit `amount > 0` ; ce garde couvre les appels internes, qui
      // ne passent pas par le `ValidationPipe`.
      if (amount.lessThanOrEqualTo(zero())) {
        throw AppException.unprocessable(
          'PAYMENT_AMOUNT_INVALID',
          'Un paiement doit etre strictement positif.',
        );
      }

      const balance = balanceOf(invoice.total, invoice.amountPaid);

      if (amount.greaterThan(balance)) {
        throw AppException.unprocessable(
          'PAYMENT_EXCEEDS_BALANCE',
          "Le montant depasse le solde du a cette facture. Le trop-percu n'est pas accepte : corrigez le montant, ou etablissez un avoir.",
          { balance: balance.toFixed(2), amount: amount.toFixed(2), currency: invoice.currency },
        );
      }

      if (dto.proofDocumentId) {
        // Verification de cle etrangere, faite ici pour rendre un 422 lisible au
        // lieu d'un 500 sur violation de contrainte.
        const proof = await tx.document.findFirst({
          where: { id: dto.proofDocumentId, deletedAt: null },
          select: { id: true },
        });

        if (!proof) {
          throw AppException.unprocessable(
            'PAYMENT_PROOF_NOT_FOUND',
            "Le justificatif designe n'existe pas.",
            { proofDocumentId: dto.proofDocumentId },
          );
        }
      }

      // Le numero d'un paiement : `PAY-2026-0001`. La table des prefixes vit
      // dans `reference.scopes.ts`, la reservation dans `CounterService` — et
      // elle rejoint CETTE transaction, donc un echec plus loin annule le
      // numero au lieu de laisser un trou dans la numerotation.
      const reference = await this.counters.reference({ scope: REFERENCE_SCOPES.PAYMENT }, tx);

      const payment = await tx.payment.create({
        data: {
          reference,
          invoiceId: invoice.id,
          amount,
          // La devise est celle de la FACTURE, jamais une autre : un encaissement
          // dans une devise differente est une conversion, et il n'y a nulle part
          // ou la stocker.
          currency: invoice.currency,
          method: dto.method,
          status: PaymentStatus.SUCCEEDED,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
          externalReference: dto.externalReference ?? null,
          proofDocumentId: dto.proofDocumentId ?? null,
          receivedById: actorId,
          notes: dto.notes ?? null,
        },
        include: PAYMENT_INCLUDE,
      });

      const state = await this.invoices.recomputePaymentState(invoice.id, tx);

      await this.activity.record(
        {
          type: ActivityType.STATUS_CHANGE,
          message: `Paiement de ${amount.toFixed(2)} ${invoice.currency} recu sur la facture ${invoice.reference}.`,
          clientId: invoice.clientId,
          actorId,
          metadata: {
            reference: payment.reference,
            invoiceReference: invoice.reference,
            amount: amount.toFixed(2),
            method: payment.method,
            invoiceStatus: state.status,
          },
          isClientVisible: true,
        },
        tx,
      );

      for (const userId of await clientPortalUserIds(invoice.clientId, tx)) {
        await this.notifications.notify(
          userId,
          {
            type: NotificationType.PAYMENT_RECEIVED,
            title: `Paiement recu sur la facture ${invoice.reference}`,
            body: `Nous avons enregistre un paiement de ${amount.toFixed(2)} ${invoice.currency}.`,
            link: `/factures/${invoice.id}`,
            entityType: 'Invoice',
            entityId: invoice.id,
          },
          tx,
        );
      }

      return {
        payment,
        invoiceId: invoice.id,
        invoiceReference: invoice.reference,
        invoiceStatus: state.status,
        amountPaid: state.amountPaid,
        total: invoice.total,
        currency: invoice.currency,
      };
    });

    await this.audit.record({
      actorId,
      action: 'PAYMENT_RECORDED',
      entityType: 'Payment',
      entityId: result.payment.id,
      after: {
        reference: result.payment.reference,
        invoiceReference: result.invoiceReference,
        amount: result.payment.amount.toFixed(2),
        method: result.payment.method,
        status: result.payment.status,
        invoiceStatus: result.invoiceStatus,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      payment: result.payment,
      invoice: {
        id: result.invoiceId,
        reference: result.invoiceReference,
        status: result.invoiceStatus,
        amountPaid: result.amountPaid.toFixed(2),
        total: result.total.toFixed(2),
        balance: balanceOf(result.total, result.amountPaid).toFixed(2),
        currency: result.currency,
      },
    };
  }

  /**
   * ANNULE un encaissement (correction d'une saisie erronee).
   *
   * Suppression LOGIQUE : la ligne reste, avec sa date de suppression. Un
   * paiement supprime physiquement rendrait incomprehensible un releve bancaire
   * qui le porte encore ; une ligne barree, non.
   *
   * L'ORDRE EST LE MEME QUE POUR L'ENREGISTREMENT : on verrouille la facture
   * avant de recalculer son etat. Sans le verrou, l'annulation d'un paiement et
   * l'enregistrement d'un autre pourraient se croiser et laisser `amountPaid`
   * sur une somme que plus aucune liste de paiements ne reproduit.
   *
   * Le statut de la facture REDESCEND tout seul : `recomputePaymentState` derive
   * l'etat de la somme, donc une facture `PAID` dont on retire un paiement
   * redevient `SENT` ou `PARTIALLY_PAID`.
   */
  async remove(
    paymentId: string,
    policy: AccessPolicy,
    meta: RequestMetadata,
  ): Promise<{ deleted: true }> {
    const actorId = policy.userId;
    const ownClientId = clientPerimeter(policy, 'payment', 'write');

    const removed = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({
        where: {
          id: paymentId,
          deletedAt: null,
          ...(ownClientId ? { invoice: { clientId: ownClientId } } : {}),
        },
        select: {
          id: true,
          reference: true,
          invoiceId: true,
          amount: true,
          currency: true,
          status: true,
        },
      });

      if (!payment) {
        throw AppException.notFound('PAYMENT_NOT_FOUND', "Ce paiement n'existe pas.");
      }

      // `updateMany` conditionne par `deletedAt: null` : deux annulations
      // simultanees du meme paiement ne peuvent pas en compter deux.
      const updated = await tx.payment.updateMany({
        where: { id: payment.id, deletedAt: null },
        data: { deletedAt: new Date() },
      });

      if (updated.count === 0) {
        throw AppException.conflict('PAYMENT_ALREADY_REMOVED', 'Ce paiement a deja ete annule.');
      }

      await this.invoices.lockForPayment(tx, payment.invoiceId, ownClientId);
      const state = await this.invoices.recomputePaymentState(payment.invoiceId, tx);

      await this.activity.record(
        {
          type: ActivityType.STATUS_CHANGE,
          message: `Paiement de ${payment.amount.toFixed(2)} ${payment.currency} annule.`,
          clientId: null,
          actorId,
          metadata: {
            reference: payment.reference,
            invoiceStatus: state.status,
          },
          isClientVisible: false,
        },
        tx,
      );

      return { payment, state };
    });

    await this.audit.record({
      actorId,
      action: 'PAYMENT_REMOVED',
      entityType: 'Payment',
      entityId: removed.payment.id,
      before: {
        reference: removed.payment.reference,
        amount: removed.payment.amount.toFixed(2),
        status: removed.payment.status,
      },
      after: { invoiceStatus: removed.state.status },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { deleted: true };
  }

  /** Liste globale des paiements (filtres internes, perimetre client respecte). */
  async list(
    query: ListPaymentsQueryDto,
    policy: AccessPolicy,
  ): Promise<Paginated<PaymentWithInvoice>> {
    const ownClientId = clientPerimeter(policy, 'payment', 'read');

    const where: Prisma.PaymentWhereInput = {
      deletedAt: null,
      // Le perimetre d'un porteur CLIENT passe par SA facture : un paiement n'a
      // pas de `clientId` a lui, il appartient au dossier de la facture qu'il
      // solde. Le filtre est donc une relation, posee dans le `where` — la ligne
      // d'un autre client n'est pas lue, elle n'est pas retournee.
      ...(ownClientId ? { invoice: { clientId: ownClientId, deletedAt: null } } : {}),
      ...(!ownClientId && query.clientId
        ? { invoice: { clientId: query.clientId, deletedAt: null } }
        : {}),
      ...(query.invoiceId ? { invoiceId: query.invoiceId } : {}),
      ...(query.method ? { method: query.method } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            paidAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const pagination = resolvePagination(query);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        include: PAYMENT_INCLUDE,
        orderBy: [{ paidAt: 'desc' }, { reference: 'desc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return paginated(items, total, pagination);
  }

  /**
   * Les paiements d'UNE facture.
   *
   * La facture est d'abord cherchee DANS le perimetre : sans cette lecture, un
   * identifiant de facture inexistant renverrait une liste vide, et un
   * identifiant hors perimetre aussi — deux situations tres differentes
   * (ressource absente, acces refuse) que le meme 404 confond. La lecture
   * prealable donne au frontend une reponse qu'il peut afficher.
   */
  async listForInvoice(
    invoiceId: string,
    query: ListPaymentsQueryDto,
    policy: AccessPolicy,
  ): Promise<Paginated<PaymentWithInvoice>> {
    const ownClientId = clientPerimeter(policy, 'payment', 'read');

    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, deletedAt: null, ...(ownClientId ? { clientId: ownClientId } : {}) },
      select: { id: true },
    });

    if (!invoice) {
      throw AppException.notFound('INVOICE_NOT_FOUND', "Cette facture n'existe pas.");
    }

    const pagination = resolvePagination(query);

    const where: Prisma.PaymentWhereInput = { invoiceId: invoice.id, deletedAt: null };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        include: PAYMENT_INCLUDE,
        orderBy: [{ paidAt: 'desc' }, { reference: 'desc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return paginated(items, total, pagination);
  }

  /** Un paiement, ou 404. */
  async getOne(paymentId: string, policy: AccessPolicy): Promise<PaymentWithInvoice> {
    const ownClientId = clientPerimeter(policy, 'payment', 'read');

    const payment = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        deletedAt: null,
        ...(ownClientId ? { invoice: { clientId: ownClientId, deletedAt: null } } : {}),
      },
      include: PAYMENT_INCLUDE,
    });

    if (!payment) {
      throw AppException.notFound('PAYMENT_NOT_FOUND', "Ce paiement n'existe pas.");
    }

    return payment;
  }
}

/**
 * Reponse d'un encaissement : le paiement cree, et l'etat de la facture APRES
 * recalcul.
 *
 * Les montants sont des CHAINES a deux decimales. Le frontend affiche un solde
 * sans avoir a refaire un calcul decimal, et deux reponses successives sont
 * comparables caractere par caractere.
 */
export interface PaymentResult {
  readonly payment: PaymentWithInvoice;
  readonly invoice: {
    readonly id: string;
    readonly reference: string;
    readonly status: string;
    readonly amountPaid: string;
    readonly total: string;
    readonly balance: string;
    readonly currency: string;
  };
}

/** Un paiement, tel qu'il sort d'une lecture simple (avec sa facture en resume). */
export type { PaymentWithInvoice };
