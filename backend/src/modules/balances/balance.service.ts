import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type MemberBalance,
  type BalanceTransaction,
  BalanceTransactionType,
  BalanceTransactionStatus,
} from '../../generated/prisma/client.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { AccessPolicy, SCOPE_ANY, SCOPE_OWN } from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';
import { paginated, resolvePagination, type Paginated } from '../../common/dto/pagination.dto.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * SERVICE DE GESTION DES SOLDES DES MEMBRES
 *
 * Ce service permet de:
 * - Obtenir le solde d'un membre pour une devise
 * - Créer des transactions de solde
 * - Obtenir l'historique des transactions
 * - Effectuer des ajustements manuels (ADMIN)
 *
 * RÈGLES MÉTIER:
 * - Un solde est SEPARÉ PAR DEVISE (pas de conversion implicite)
 * - Le solde est TOUJOURS calculé à partir de l'historique
 * - Chaque transaction est traçable et auditable
 * - Les transactions sont liées à leur source (répartition, paiement, etc.)
 */


@Injectable()
export class BalanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lecture des soldes
  // ---------------------------------------------------------------------------

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
  async getAllBalances(
    userId: string,
    policy: AccessPolicy,
  ): Promise<MemberBalance[]> {
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
    };

    const [items, total] = await Promise.all([
      this.prisma.balanceTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.balanceTransaction.count({ where }),
    ]);

    return paginated(items, total, p);
  }

  /**
   * Obtenir une transaction par ID
   */
  async getTransactionById(
    id: string,
    policy: AccessPolicy,
  ): Promise<BalanceTransaction | null> {
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
  // Création de transactions
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
    },
    policy: AccessPolicy,
    tx?: Prisma.TransactionClient,
  ): Promise<BalanceTransaction> {
    const prisma = tx ?? this.prisma;
    const decimalAmount = data.amount instanceof Prisma.Decimal ? data.amount : new Prisma.Decimal(data.amount);
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
      // Vérifier que le solde ne devient pas négatif (sauf si autorisé)
      if (newBalance.lessThan(0)) {
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
   * NOTE: Cette méthode convertit tous les soldes en une seule devise
   * en utilisant les taux de change. Si aucun taux n'est disponible,
   * les devises non convertibles sont ignorées.
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
      if (balance.currency === targetCurrency) {
        total = total.plus(balance.currentBalance);
      } else {
        // TODO: Convertir en utilisant ExchangeRateService
        // Pour l'instant, on ignore les devises non convertibles
        console.warn(`⚠️ Conversion non implémentée: ${balance.currency} → ${targetCurrency}`);
      }
    }

    return total;
  }
}
