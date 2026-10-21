import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type MemberBalance,
  type BalanceTransaction,
  BalanceTransactionType,
  BalanceTransactionStatus,
  BalanceTransactionKind,
} from '../../generated/prisma/client.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { AccessPolicy, SCOPE_ANY, SCOPE_OWN } from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';
import { paginated, resolvePagination, type Paginated } from '../../common/dto/pagination.dto.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  EligibleMembersService,
  type EligibleMember,
} from '../../common/finance/eligible-members.service.js';

/**
 * SERVICE DE GESTION DES SOLDES DES MEMBRES
 *
 * Un solde n'est pas un chiffre : c'est un HISTORIQUE. Le service ne calcule
 * jamais un solde « a la volee » sur une donnee qui n'existe pas — il additionne
 * des operations datées, signées, attribuees a un auteur, et le solde n'est
 * qu'une projection de cet historique.
 *
 * QUATRE REGLES, ET ELLES SONT STRUCTURANTES.
 *
 *  1. UN SOLDE PAR DEVISE, JAMAIS DE CONVERSION IMPLICITE. Un membre qui a
 *     100 000 DZD et 200 EUR a deux soldes. Les additionner sans taux
 *     documenté serait une invention ; le module des devises existe pour
 *     le faire EXPLICITEMENT, opération par opération.
 *
 *  2. UNE OPERATION VALIDEE NE S'EFFACE JAMAIS. Il n'y a pas de suppression :
 *     une erreur se corrige par une CONTRE-PASSATION, qui porte l'identifiant
 *     de l'operation qu'elle reprend. L'historique reste lisible, et le total
 *     reste juste.
 *
 *  3. TOUTE ECRITURE EST ATTRIBUEE. Un auteur, une date d'effet, un motif, une
 *     reference. Une operation sans auteur n'est pas une operation : c'est un
 *     chiffre qui apparait.
 *
 *  4. LE CALCUL EST FAIT EN DECIMAL, JAMAIS EN FLOTTANT. Les montants sont
 *     des `Decimal` Prisma du bout en bout ; un `number` JavaScript ne passe
 *     jamais par un montant.
 */

/** Nature d'une operation de solde. */
export type BalanceOperationKind = BalanceTransactionKind;

/** Ce qu'une operation fait du solde : credit, debit, ou les deux selon le signe. */
export type BalanceOperationSign = 'credit' | 'debit';

export interface BalanceOperationInput {
  readonly userId: string;
  readonly kind: BalanceOperationKind;
  /** Montant signe : positif pour un credit, negatif pour un debit. */
  readonly amount: Prisma.Decimal | string | number;
  readonly currency: string;
  /** Motif — obligatoire pour tout ce qui n'est pas un simple credit de part. */
  readonly reason?: string | null;
  /** Date d'effet (peut differer de la date d'ecriture). */
  readonly occurredAt?: Date | null;
  /** Reference externe (virement, piece justificative). */
  readonly reference?: string | null;
  readonly projectId?: string | null;
  readonly distributionItemId?: string | null;
  readonly paymentId?: string | null;
  /** Operation contre-passee par celle-ci. */
  readonly reversalOfId?: string | null;
  /** Cle d'idempotence : un rejeu ne cree pas deux fois la meme ecriture. */
  readonly idempotencyKey?: string | null;
}

export interface MemberBalanceSummary {
  readonly userId: string;
  readonly currency: string;
  /** Parts accumulees (crédits de répartition). */
  readonly accrued: Prisma.Decimal;
  /** Versements faits au membre. */
  readonly paid: Prisma.Decimal;
  /** Avances versees au membre. */
  readonly advances: Prisma.Decimal;
  /** Ajustements manuels, signes. */
  readonly adjustments: Prisma.Decimal;
  /** Corrections et regularisations, signees. */
  readonly corrections: Prisma.Decimal;
  /** Solde restant du. */
  readonly remaining: Prisma.Decimal;
  readonly transactionCount: number;
  readonly lastUpdatedAt: Date | null;
}

@Injectable()
export class BalanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly eligibleMembers: EligibleMembersService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lecture des soldes
  // ---------------------------------------------------------------------------

  /**
   * Les comptes qui peuvent recevoir de l'argent.
   *
   * Meme source que la validation d'ecriture : la liste proposee a
   * l'administrateur et la regle appliquee au serveur ne peuvent pas
   * diverger. Un client n'y figure pas — un client recoit une facture, pas
   * une part de repartition.
   */
  async listEligibleMembers(): Promise<EligibleMember[]> {
    return this.eligibleMembers.list();
  }

  /**
   * Obtenir le solde d'un membre pour une devise spécifique
   */
  async getBalance(
    userId: string,
    currency: string,
    policy: AccessPolicy,
  ): Promise<MemberBalance | null> {
    // Vérifier les permissions
    if (policy.userId !== userId) {
      policy.requireScope('balance', 'read', [SCOPE_ANY]);
    } else {
      policy.requireScope('balance', 'read', [SCOPE_OWN]);
    }

    return this.prisma.memberBalance.findUnique({
      where: {
        userId_currency: {
          userId,
          currency: currency.toUpperCase(),
        },
      },
    });
  }

  /**
   * Obtenir tous les soldes d'un membre
   */
  async getAllBalances(userId: string, policy: AccessPolicy): Promise<MemberBalance[]> {
    // Vérifier les permissions
    if (policy.userId !== userId) {
      policy.requireScope('balance', 'read', [SCOPE_ANY]);
    } else {
      policy.requireScope('balance', 'read', [SCOPE_OWN]);
    }

    return this.prisma.memberBalance.findMany({
      where: { userId },
      orderBy: { currency: 'asc' },
    });
  }

  // ---------------------------------------------------------------------------
  // Lecture des transactions
  // ---------------------------------------------------------------------------

  /**
   * Obtenir l'historique des transactions d'un membre
   */
  async getTransactionHistory(
    userId: string,
    query: {
      currency?: string;
      page?: number;
      perPage?: number;
      type?: BalanceTransactionType;
      status?: BalanceTransactionStatus;
      kind?: BalanceTransactionKind;
    },
    policy: AccessPolicy,
  ): Promise<Paginated<BalanceTransaction>> {
    // Vérifier les permissions
    if (policy.userId !== userId) {
      policy.requireScope('balance', 'read', [SCOPE_ANY]);
    } else {
      policy.requireScope('balance', 'read', [SCOPE_OWN]);
    }

    const p = resolvePagination(query);
    const where: Prisma.BalanceTransactionWhereInput = {
      userId,
      ...(query.currency ? { currency: query.currency.toUpperCase() } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.balanceTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: p.skip,
        take: p.take,
        // L'AUTEUR EST AFFICHE, MEME DANS LE RELEVE PERSONNEL : un membre a
        // le droit de savoir QUI a enregistre l'ecriture qui le concerne.
        include: {
          author: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
      this.prisma.balanceTransaction.count({ where }),
    ]);

    return paginated(items, total, p);
  }

  /**
   * Obtenir une transaction par ID
   */
  async getTransactionById(id: string, policy: AccessPolicy): Promise<BalanceTransaction | null> {
    const transaction = await this.prisma.balanceTransaction.findUnique({
      where: { id },
    });

    if (!transaction) {
      return null;
    }

    // Vérifier les permissions
    if (policy.userId !== transaction.userId) {
      policy.requireScope('balance', 'read', [SCOPE_ANY]);
    } else {
      policy.requireScope('balance', 'read', [SCOPE_OWN]);
    }

    return transaction;
  }

  // ---------------------------------------------------------------------------
  // Ecriture
  // ---------------------------------------------------------------------------

  /**
   * Créer une transaction de solde
   *
   * Cette méthode crée une transaction et met à jour le solde du membre.
   * Elle peut être appelée directement ou via une transaction Prisma.
   *
   * @param data - Données de la transaction
   * @param policy - Politique d'accès
   * @param tx - Client Prisma transactionnel (optionnel)
   */
  async createTransaction(
    data: {
      userId: string;
      type: BalanceTransactionType;
      amount: Prisma.Decimal | string | number;
      currency: string;
      description: string;
      distributionItemId?: string;
      projectId?: string;
      paymentId?: string;
      reference?: string;
      kind?: BalanceTransactionKind;
      reason?: string | null;
      occurredAt?: Date | null;
      reversalOfId?: string | null;
      idempotencyKey?: string | null;
      authorId?: string | null;
      /**
       * Autorise un solde final NEGATIF.
       *
       * Un REGLEMENT (paiement) ne doit pas depasser le solde du membre : c'est
       * une erreur de saisie, pas une dette. Une AVANCE, en revanche, peut le
       * depasser — c'est precisement son objet : de l'argent verse avant que
       * la part ne soit acquise. Une CORRECTION ou un AJUSTEMENT, eux,
       * revelent parfois une dette : les bloquer empecherait de corriger.
       */
      allowNegativeBalance?: boolean;
    },
    policy: AccessPolicy,
    tx?: Prisma.TransactionClient,
  ): Promise<BalanceTransaction> {
    const prisma = tx ?? this.prisma;
    const decimalAmount =
      data.amount instanceof Prisma.Decimal ? data.amount : new Prisma.Decimal(data.amount);
    const currency = data.currency.toUpperCase();

    // Récupérer le solde actuel pour cette devise
    const currentBalance = await prisma.memberBalance.findUnique({
      where: {
        userId_currency: {
          userId: data.userId,
          currency,
        },
      },
    });

    const previousBalance = currentBalance?.currentBalance ?? new Prisma.Decimal(0);

    // Calculer le nouveau solde
    // CREDIT = +amount, DEBIT = -amount, CORRECTION = ±amount
    let newBalance: Prisma.Decimal;
    if (data.type === BalanceTransactionType.CREDIT) {
      newBalance = previousBalance.plus(decimalAmount);
    } else if (data.type === BalanceTransactionType.DEBIT) {
      newBalance = previousBalance.minus(decimalAmount);
      // Verifier que le solde ne devient pas negatif (sauf si autorise)
      if (newBalance.lessThan(0) && !data.allowNegativeBalance) {
        throw AppException.badRequest(
          'INSUFFICIENT_BALANCE',
          `Solde insuffisant pour effectuer ce débit (solde actuel: ${previousBalance}, montant: ${decimalAmount})`,
        );
      }
    } else {
      // CORRECTION: peut être positif ou négatif
      newBalance = previousBalance.plus(decimalAmount);
    }

    // Le lien vers la répartition passe par distributionItemId (pas de distributionId).
    // Créer la transaction
    const transaction = await prisma.balanceTransaction.create({
      data: {
        userId: data.userId,
        type: data.type,
        amount: decimalAmount,
        currency,
        previousBalance,
        newBalance,
        description: data.description,
        distributionItemId: data.distributionItemId,
        projectId: data.projectId,
        paymentId: data.paymentId,
        reference: data.reference,
        kind: data.kind ?? BalanceTransactionKind.SHARE,
        reason: data.reason ?? null,
        occurredAt: data.occurredAt ?? new Date(),
        reversalOfId: data.reversalOfId ?? null,
        idempotencyKey: data.idempotencyKey ?? null,
        authorId: data.authorId ?? policy.userId,
        status: BalanceTransactionStatus.CONFIRMED,
      },
    });

    // Mettre à jour le solde
    await prisma.memberBalance.upsert({
      where: {
        userId_currency: {
          userId: data.userId,
          currency,
        },
      },
      create: {
        userId: data.userId,
        currency,
        currentBalance: newBalance,
        lastUpdatedAt: new Date(),
        updatedById: policy.userId,
      },
      update: {
        currentBalance: newBalance,
        lastUpdatedAt: new Date(),
        updatedById: policy.userId,
      },
    });

    // Audit (uniquement si pas de transaction en cours)
    if (!tx) {
      await this.audit.record({
        actorId: policy.userId,
        action: 'balance:transaction:create',
        entityType: 'BalanceTransaction',
        entityId: transaction.id,
        after: transaction,
      });
    }

    return transaction;
  }

  // ---------------------------------------------------------------------------
  // OPERATIONS DECLAREES PAR UN ADMINISTRATEUR
  // ---------------------------------------------------------------------------

  /**
   * Enregistrer une operation de solde (paiement, avance, ajustement,
   * correction, regularisation).
   *
   * LE MONTANT EST SIGNE. Un paiement de 50 000 DZD est `-50000` (le membre
   * recoit de l'argent, son solde diminue) ; un ajustement de +2 000 est
   * `+2000`. La nature (`kind`) dit POURQUOI, le signe dit QUOI.
   *
   * AUCUNE SUPPRESSION N'EXISTE. Une operation fausse se contre-passe :
   * `reverseOperation` cree l'ecriture opposee, qui la reprend par son
   * identifiant.
   */
  async recordOperation(
    input: BalanceOperationInput,
    actor: { id: string },
    policy: AccessPolicy,
  ): Promise<BalanceTransaction> {
    policy.requireScope('balance', 'manage', [SCOPE_ANY]);

    const amount =
      input.amount instanceof Prisma.Decimal ? input.amount : new Prisma.Decimal(input.amount);

    if (amount.isZero()) {
      throw AppException.badRequest('INVALID_AMOUNT', 'Le montant ne peut pas être nul.');
    }

    const kind = input.kind;

    // LE SIGNE.
    //
    // Un PAIXEMENT et une AVANCE sont des SORTIES : ils diminuent le solde du
    // membre. Le signe saisi est donc normalise — un paiement reste un
    // paiement, que l'on tape « 10000 » ou « -10000 ». Un AJUSTEMENT, une
    // CORRECTION ou une REGULARISATION, eux, portent un signe EXPLICITE :
    // ils peuvent aller dans les deux sens, et c'est leur raison d'etre.
    let signed: Prisma.Decimal;

    if (kind === BalanceTransactionKind.PAYMENT || kind === BalanceTransactionKind.ADVANCE) {
      signed = amount.abs().negated();
    } else if (kind === BalanceTransactionKind.SHARE) {
      if (amount.isNegative()) {
        throw AppException.badRequest(
          'INVALID_AMOUNT',
          'Une part de répartition ne peut pas être négative.',
        );
      }
      signed = amount;
    } else {
      signed = amount;
    }

    if (kind !== BalanceTransactionKind.SHARE && !input.reason?.trim()) {
      throw AppException.badRequest(
        'MISSING_REASON',
        'Un motif est obligatoire : une écriture financière sans motif n’est pas traçable.',
      );
    }

    const currency = input.currency.toUpperCase();

    // LA CIBLE DOIT ÊTRE UN MEMBRE DE L'ÉQUIPE. Un client, un compte
    // technique ou un compte désactivé ne peut pas recevoir de part, de
    // versement ni d'avance : le solde de ce compte n'aurait aucun sens, et
    // personne n'en serait responsable.
    await this.eligibleMembers.assertEligible(input.userId);

    // LA DEVISE DOIT ÊTRE DÉCLARÉE. Un code de devise inventé (ou une faute
    // de frappe) créerait un solde que personne ne pourra jamais convertir ni
    // rapprocher. Les devises du module « devises » font foi — et une devise
    // qui n'y figure pas s'y ajoute, avec son nom et son symbole.
    //
    // Une devise « inactive » reste receivable : « inactive » veut dire qu'on
    // ne la propose pas par défaut sur un nouveau document, pas qu'on ne peut
    // pas payer en euros un projet qui est facturé en euros. Seule la
    // CONVERSION exige un taux documenté — et elle ne se fait jamais ici.
    const knownCurrency = await this.prisma.currency.findFirst({
      where: { code: currency },
      select: { code: true },
    });

    if (!knownCurrency) {
      throw AppException.badRequest(
        'UNKNOWN_CURRENCY',
        `Devise inconnue : ${currency}. Ajoutez-la au module « devises » avant d’ouvrir un solde dans cette devise.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Idempotence : un rejeu renvoie l'ecriture deja faite.
      if (input.idempotencyKey) {
        const existing = await tx.balanceTransaction.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (existing) {
          return existing;
        }
      }

      const type = signed.isNegative()
        ? BalanceTransactionType.DEBIT
        : BalanceTransactionType.CREDIT;

      const transaction = await this.createTransaction(
        {
          userId: input.userId,
          type,
          amount: signed.abs(),
          currency,
          description: input.reason?.trim() ?? 'Opération de solde',
          distributionItemId: input.distributionItemId ?? undefined,
          projectId: input.projectId ?? undefined,
          paymentId: input.paymentId ?? undefined,
          reference: input.reference ?? undefined,
          kind,
          reason: input.reason?.trim() ?? null,
          occurredAt: input.occurredAt ?? new Date(),
          reversalOfId: input.reversalOfId ?? undefined,
          idempotencyKey: input.idempotencyKey ?? undefined,
          authorId: actor.id,
          // Seule une AVANCE peut depasser le solde du membre.
          allowNegativeBalance: kind !== BalanceTransactionKind.PAYMENT,
        },
        policy,
        tx,
      );

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: `balance:${kind.toLowerCase()}:record`,
          entityType: 'BalanceTransaction',
          entityId: transaction.id,
          after: JSON.parse(JSON.stringify(transaction)) as Prisma.InputJsonValue,
        },
      });

      return transaction;
    });
  }

  /**
   * Contre-passer une operation validee.
   *
   * L'operation d'origine n'est PAS modifiee et PAS supprimee : elle reste
   * visible, avec le lien vers sa contre-passation. C'est la seule maniere
   * honnete de corriger une ecriture deja communiquee a un membre.
   */
  async reverseOperation(
    transactionId: string,
    input: { reason: string; reference?: string | null; occurredAt?: Date | null },
    actor: { id: string },
    policy: AccessPolicy,
  ): Promise<BalanceTransaction> {
    policy.requireScope('balance', 'manage', [SCOPE_ANY]);

    if (!input.reason?.trim()) {
      throw AppException.badRequest(
        'MISSING_REASON',
        'Un motif est obligatoire : une contre-passation doit dire ce qu’elle corrige.',
      );
    }

    const original = await this.prisma.balanceTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!original) {
      throw AppException.notFound('TRANSACTION_NOT_FOUND', 'Opération introuvable.');
    }

    if (original.status === BalanceTransactionStatus.CANCELLED) {
      throw AppException.badRequest('TRANSACTION_CANCELLED', 'Cette opération est déjà annulée.');
    }

    const alreadyReversed = await this.prisma.balanceTransaction.count({
      where: { reversalOfId: original.id },
    });

    if (alreadyReversed > 0) {
      throw AppException.conflict('ALREADY_REVERSED', 'Cette opération a déjà été contre-passée.');
    }

    const signed =
      original.type === BalanceTransactionType.CREDIT
        ? new Prisma.Decimal(original.amount).negated()
        : new Prisma.Decimal(original.amount);

    return this.recordOperation(
      {
        userId: original.userId,
        kind: BalanceTransactionKind.CORRECTION,
        amount: signed,
        currency: original.currency,
        reason: input.reason.trim(),
        reference: input.reference ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        projectId: original.projectId,
        distributionItemId: original.distributionItemId,
        reversalOfId: original.id,
        idempotencyKey: `reversal:${original.id}`,
      },
      actor,
      policy,
    );
  }

  // ---------------------------------------------------------------------------
  // TABLEAU DE BORD ADMINISTRATEUR
  // ---------------------------------------------------------------------------

  /**
   * Les soldes de tous les membres, avec le detail de leur mouvement.
   *
   * Les filtres portent sur le membre, le projet, la periode, la devise et la
   * nature de l'operation. Le solde affiche reste TOUJOURS le solde reel du
   * membre (toutes operations confondues) : les filtres servent a lire
   * l'historique, pas a tronquer le solde — un solde filtre serait un solde
   * faux.
   */
  async listBalances(
    filters: {
      userId?: string;
      projectId?: string;
      currency?: string;
      kind?: BalanceTransactionKind;
      from?: Date;
      to?: Date;
    },
    policy: AccessPolicy,
  ): Promise<MemberBalanceSummary[]> {
    // Un membre peut consulter son PROPRE relevé : le filtre qui ne cible
    // que lui ouvre le scope « own ». Toute autre lecture exige le scope
    // « any », réservé à l'administration.
    const isOwnScope =
      typeof filters.userId === 'string' &&
      filters.userId.length > 0 &&
      filters.userId === policy.userId;

    if (isOwnScope) {
      policy.requireScope('balance', 'read', [SCOPE_OWN]);
    } else {
      policy.requireScope('balance', 'read', [SCOPE_ANY]);
    }

    const currency = filters.currency?.toUpperCase();

    const balances = await this.prisma.memberBalance.findMany({
      where: {
        ...(filters.userId ? { userId: filters.userId } : {}),
        ...(currency ? { currency } : {}),
      },
      orderBy: [{ currency: 'asc' }, { userId: 'asc' }],
    });

    if (balances.length === 0) {
      return [];
    }

    const userIds = [...new Set(balances.map((balance) => balance.userId))];

    const where: Prisma.BalanceTransactionWhereInput = {
      userId: { in: userIds },
      status: BalanceTransactionStatus.CONFIRMED,
      ...(currency ? { currency } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.projectId ? { projectId: filters.projectId } : {}),
      ...(filters.from || filters.to
        ? {
            occurredAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    };

    const transactions = await this.prisma.balanceTransaction.findMany({
      where,
      select: {
        userId: true,
        currency: true,
        kind: true,
        type: true,
        amount: true,
        occurredAt: true,
      },
    });

    const zero = () => new Prisma.Decimal(0);

    return balances.map((balance) => {
      const rows = transactions.filter(
        (row) => row.userId === balance.userId && row.currency === balance.currency,
      );

      let accrued = zero();
      let paid = zero();
      let advances = zero();
      let adjustments = zero();
      let corrections = zero();

      for (const row of rows) {
        const amount = new Prisma.Decimal(row.amount);
        const signed = row.type === BalanceTransactionType.DEBIT ? amount.negated() : amount;

        switch (row.kind) {
          case BalanceTransactionKind.SHARE:
            accrued = accrued.plus(signed);
            break;
          case BalanceTransactionKind.PAYMENT:
            paid = paid.plus(signed);
            break;
          case BalanceTransactionKind.ADVANCE:
            advances = advances.plus(signed);
            break;
          case BalanceTransactionKind.ADJUSTMENT:
            adjustments = adjustments.plus(signed);
            break;
          case BalanceTransactionKind.CORRECTION:
          case BalanceTransactionKind.REGULARIZATION:
            corrections = corrections.plus(signed);
            break;
          default:
            break;
        }
      }

      return {
        userId: balance.userId,
        currency: balance.currency,
        accrued,
        paid,
        advances,
        adjustments,
        corrections,
        remaining: balance.currentBalance,
        transactionCount: rows.length,
        lastUpdatedAt: balance.lastUpdatedAt,
      };
    });
  }

  /**
   * Le detail d'un membre : ce qu'il a gagne, ce qu'il a touche, ce qu'il
   * doit encore, et l'historique.
   */
  async getMemberSummary(
    userId: string,
    currency: string,
    policy: AccessPolicy,
  ): Promise<MemberBalanceSummary | null> {
    const [summary] = await this.listBalances({ userId, currency }, policy);
    return summary ?? null;
  }

  /**
   * Toutes les transactions, tous membres confondus (administrateur).
   */
  async listTransactions(
    filters: {
      userId?: string;
      projectId?: string;
      currency?: string;
      kind?: BalanceTransactionKind;
      type?: BalanceTransactionType;
      status?: BalanceTransactionStatus;
      from?: Date;
      to?: Date;
      page?: number;
      perPage?: number;
    },
    policy: AccessPolicy,
  ): Promise<Paginated<BalanceTransaction>> {
    policy.requireScope('balance', 'read', [SCOPE_ANY]);

    const p = resolvePagination(filters);

    const where: Prisma.BalanceTransactionWhereInput = {
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.projectId ? { projectId: filters.projectId } : {}),
      ...(filters.currency ? { currency: filters.currency.toUpperCase() } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.from || filters.to
        ? {
            occurredAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.balanceTransaction.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        skip: p.skip,
        take: p.take,
        include: {
          author: { select: { id: true, firstName: true, lastName: true, email: true } },
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
      this.prisma.balanceTransaction.count({ where }),
    ]);

    return paginated(items, total, p);
  }

  // ---------------------------------------------------------------------------
  // Ajustements manuels (ADMIN)
  // ---------------------------------------------------------------------------

  /**
   * Effectuer un ajustement manuel d'un solde
   *
   * Cette méthode permet à un administrateur de corriger un solde.
   * L'ajustement crée une transaction de type CORRECTION.
   *
   * @param userId - ID du membre
   * @param currency - Devise
   * @param amount - Montant de l'ajustement (positif ou négatif)
   * @param description - Description de l'ajustement
   * @param actor - Qui effectue l'ajustement
   * @param policy - Politique d'accès
   */
  async adjustBalance(
    userId: string,
    currency: string,
    amount: Prisma.Decimal | string | number,
    description: string,
    actor: { id: string },
    policy: AccessPolicy,
  ): Promise<BalanceTransaction> {
    policy.requireScope('balance', 'manage', [SCOPE_ANY]);

    const decimalAmount = amount instanceof Prisma.Decimal ? amount : new Prisma.Decimal(amount);
    const normalizedCurrency = currency.toUpperCase();

    return this.prisma.$transaction(async (tx) => {
      const transaction = await this.createTransaction(
        {
          userId,
          type: decimalAmount.greaterThanOrEqualTo(0)
            ? BalanceTransactionType.CREDIT
            : BalanceTransactionType.DEBIT,
          amount: decimalAmount.abs(),
          currency: normalizedCurrency,
          description: `Ajustement manuel: ${description}`,
          kind: BalanceTransactionKind.ADJUSTMENT,
          reason: description,
          authorId: actor.id,
        },
        policy,
        tx,
      );

      await this.audit.record({
        actorId: actor.id,
        action: 'balance:adjust',
        entityType: 'BalanceTransaction',
        entityId: transaction.id,
        after: transaction,
      });

      return transaction;
    });
  }

  // ---------------------------------------------------------------------------
  // Statistiques
  // ---------------------------------------------------------------------------

  /**
   * Obtenir le total des gains pour un membre
   */
  async getTotalEarnings(
    userId: string,
    policy: AccessPolicy,
  ): Promise<{ total: Prisma.Decimal; byCurrency: Record<string, Prisma.Decimal> }> {
    if (policy.userId !== userId) {
      policy.requireScope('balance', 'read', [SCOPE_ANY]);
    } else {
      policy.requireScope('balance', 'read', [SCOPE_OWN]);
    }

    const transactions = await this.prisma.balanceTransaction.findMany({
      where: {
        userId,
        type: BalanceTransactionType.CREDIT,
        status: BalanceTransactionStatus.CONFIRMED,
      },
    });

    const byCurrency: Record<string, Prisma.Decimal> = {};
    let total = new Prisma.Decimal(0);

    for (const t of transactions) {
      byCurrency[t.currency] = (byCurrency[t.currency] ?? new Prisma.Decimal(0)).plus(t.amount);
      total = total.plus(t.amount);
    }

    return { total, byCurrency };
  }

  /**
   * Obtenir le solde total d'un membre (toutes devises confondues)
   *
   * ATTENTION : cette méthode ne convertit PAS les devises. Elle additionne
   * les soldes de la devise demandée, et ignore les autres. Une conversion
   * automatique sans taux documenté serait une invention : la conversion
   * existe dans le module des taux de change, à la demande, opération par
   * opération.
   */
  async getTotalBalanceInCurrency(
    userId: string,
    targetCurrency: string,
    policy: AccessPolicy,
  ): Promise<Prisma.Decimal> {
    if (policy.userId !== userId) {
      policy.requireScope('balance', 'read', [SCOPE_ANY]);
    } else {
      policy.requireScope('balance', 'read', [SCOPE_OWN]);
    }

    const balances = await this.getAllBalances(userId, policy);
    let total = new Prisma.Decimal(0);

    for (const balance of balances) {
      if (balance.currency === targetCurrency.toUpperCase()) {
        total = total.plus(balance.currentBalance);
      }
    }

    return total;
  }
}
