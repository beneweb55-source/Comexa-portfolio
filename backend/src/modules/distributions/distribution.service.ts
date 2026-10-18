import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type DistributionConfig,
  type ProjectDistribution,
  DistributionBaseType,
  BeneficiaryType,
  DistributionStatus,
  DistributionItemStatus,
  DistributionChangeType,
  BalanceTransactionType,
} from '../../generated/prisma/client.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { AccessPolicy, SCOPE_ANY } from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BalanceService } from '../balances/balance.service.js';
import { PaymentStatus } from '../../generated/prisma/enums.js';

/**
 * SERVICE DE RÉPARTITION DES GAINS
 *
 * Ce service permet de:
 * - Calculer les répartitions pour un projet
 * - Appliquer une répartition (créditer les soldes)
 * - Gérer les configurations de répartition
 * - Valider les pourcentages
 *
 * RÈGLES MÉTIER:
 * - Le total des pourcentages doit TOUJOURS être égal à 100%
 * - Une répartition est calculée sur les montants encaissés (par défaut)
 * - Chaque répartition est incrémentale (seulement les nouveaux montants)
 * - Les parts sont distinguées: calculée, créditée, payée
 * - Protection contre les doubles traitements
 */

type DistributionConfigWithBeneficiaries = Prisma.DistributionConfigGetPayload<{
  include: { beneficiaries: true };
}>;

const ROUND_HALF_UP = Prisma.Decimal.ROUND_HALF_UP;
const CENTS = 2;

@Injectable()
export class DistributionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly balanceService: BalanceService,
  ) {}

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  /**
   * Obtenir la configuration active
   */
  async getActiveConfig(policy: AccessPolicy): Promise<DistributionConfigWithBeneficiaries | null> {
    policy.requireScope('distribution', 'read', [SCOPE_ANY]);

    return this.prisma.distributionConfig.findFirst({
      where: { isActive: true, deletedAt: null },
      include: {
        beneficiaries: {
          where: { isActive: true },
          orderBy: { order: 'asc' },
        },
      },
    });
  }

  /**
   * Obtenir une configuration par ID
   */
  async getConfigById(id: string, policy: AccessPolicy): Promise<DistributionConfigWithBeneficiaries | null> {
    policy.requireScope('distribution', 'read', [SCOPE_ANY]);

    return this.prisma.distributionConfig.findUnique({
      where: { id, deletedAt: null },
      include: {
        beneficiaries: {
          where: { isActive: true },
          orderBy: { order: 'asc' },
        },
      },
    });
  }

  /**
   * Lister toutes les configurations
   */
  async listConfigs(policy: AccessPolicy): Promise<DistributionConfigWithBeneficiaries[]> {
    policy.requireScope('distribution', 'read', [SCOPE_ANY]);

    return this.prisma.distributionConfig.findMany({
      where: { deletedAt: null },
      orderBy: { effectiveDate: 'desc' },
      include: {
        beneficiaries: {
          where: { isActive: true },
          orderBy: { order: 'asc' },
        },
      },
    });
  }

  /**
   * Valider qu'une configuration a un total de 100%
   */
  async validateConfig(config: DistributionConfigWithBeneficiaries): Promise<void> {
    const beneficiaries = config.beneficiaries || [];
    const total = beneficiaries.reduce(
      (sum, b) => sum.plus(b.percentage),
      new Prisma.Decimal(0),
    );

    if (!total.equals(new Prisma.Decimal(100))) {
      throw AppException.badRequest(
        'INVALID_PERCENTAGE_SUM',
        `Le total des pourcentages (${total.toString()}) n'est pas égal à 100%`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Gestion des configurations (ADMIN)
  // ---------------------------------------------------------------------------

  /**
   * Créer une nouvelle configuration
   */
  async createConfig(
    data: {
      name: string;
      description?: string;
      baseType?: DistributionBaseType;
      effectiveDate?: Date;
      endDate?: Date;
      beneficiaries: {
        beneficiaryType: BeneficiaryType;
        name: string;
        percentage: Prisma.Decimal | string | number;
        userId?: string;
        order: number;
      }[];
    },
    actor: { id: string },
    policy: AccessPolicy,
  ): Promise<DistributionConfig> {
    policy.requireScope('distribution', 'manage', [SCOPE_ANY]);

    // Si une configuration est déjà active, la désactiver
    if (data.effectiveDate === undefined || data.effectiveDate <= new Date()) {
      const activeConfigs = await this.prisma.distributionConfig.findMany({
        where: { isActive: true, deletedAt: null },
      });

      if (activeConfigs.length > 0) {
        await this.prisma.distributionConfig.updateMany({
          where: { id: { in: activeConfigs.map(c => c.id) } },
          data: { isActive: false },
        });
      }
    }

    // Calculer le total des pourcentages
    const totalPercentage = data.beneficiaries.reduce(
      (sum, b) => {
        const p = b.percentage instanceof Prisma.Decimal ? b.percentage : new Prisma.Decimal(b.percentage);
        return sum.plus(p);
      },
      new Prisma.Decimal(0),
    );

    if (!totalPercentage.equals(new Prisma.Decimal(100))) {
      throw AppException.badRequest(
        'INVALID_PERCENTAGE_SUM',
        `Le total des pourcentages (${totalPercentage.toString()}) n'est pas égal à 100%`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const config = await tx.distributionConfig.create({
        data: {
          name: data.name,
          description: data.description,
          baseType: data.baseType ?? DistributionBaseType.COLLECTED_AMOUNT,
          isActive: true,
          effectiveDate: data.effectiveDate ?? new Date(),
          endDate: data.endDate,
          beneficiaries: {
            create: data.beneficiaries.map(b => ({
              beneficiaryType: b.beneficiaryType,
              name: b.name,
              percentage: b.percentage instanceof Prisma.Decimal ? b.percentage : new Prisma.Decimal(b.percentage),
              userId: b.userId,
              order: b.order,
              isActive: true,
            })),
          },
        },
        include: { beneficiaries: true },
      });

      await this.audit.record({
        actorId: actor.id,
        action: 'distribution:config:create',
        entityType: 'DistributionConfig',
        entityId: config.id,
        after: config,
      });

      return config;
    });
  }

  /**
   * Mettre à jour une configuration
   */
  async updateConfig(
    id: string,
    data: {
      name?: string;
      description?: string;
      baseType?: DistributionBaseType;
      effectiveDate?: Date;
      endDate?: Date;
      isActive?: boolean;
      beneficiaries?: {
        id?: string;
        beneficiaryType: BeneficiaryType;
        name: string;
        percentage: Prisma.Decimal | string | number;
        userId?: string;
        order: number;
        isActive: boolean;
      }[];
    },
    actor: { id: string },
    policy: AccessPolicy,
  ): Promise<DistributionConfig> {
    policy.requireScope('distribution', 'manage', [SCOPE_ANY]);

    const existing = await this.prisma.distributionConfig.findUniqueOrThrow({
      where: { id, deletedAt: null },
      include: { beneficiaries: true },
    });

    // Si on active cette configuration, désactiver les autres
    if (data.isActive && !existing.isActive) {
      await this.prisma.distributionConfig.updateMany({
        where: { isActive: true, id: { not: id }, deletedAt: null },
        data: { isActive: false },
      });
    }

    // Si des bénéficiaires sont fournis, valider le total
    if (data.beneficiaries) {
      const totalPercentage = data.beneficiaries.reduce(
        (sum, b) => {
          const p = b.percentage instanceof Prisma.Decimal ? b.percentage : new Prisma.Decimal(b.percentage);
          return sum.plus(p);
        },
        new Prisma.Decimal(0),
      );

      if (!totalPercentage.equals(new Prisma.Decimal(100))) {
        throw AppException.badRequest(
          'INVALID_PERCENTAGE_SUM',
          `Le total des pourcentages (${totalPercentage.toString()}) n'est pas égal à 100%`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // Supprimer les anciens bénéficiaires
      if (data.beneficiaries) {
        await tx.distributionBeneficiary.deleteMany({
          where: { configId: id },
        });
      }

      const config = await tx.distributionConfig.update({
        where: { id },
        data: {
          name: data.name,
          description: data.description,
          baseType: data.baseType,
          effectiveDate: data.effectiveDate,
          endDate: data.endDate,
          isActive: data.isActive,
          beneficiaries: data.beneficiaries
            ? {
                create: data.beneficiaries.map(b => ({
                  beneficiaryType: b.beneficiaryType,
                  name: b.name,
                  percentage: b.percentage instanceof Prisma.Decimal ? b.percentage : new Prisma.Decimal(b.percentage),
                  userId: b.userId,
                  order: b.order,
                  isActive: b.isActive,
                })),
              }
            : undefined,
        },
        include: { beneficiaries: true },
      });

      await this.audit.record({
        actorId: actor.id,
        action: 'distribution:config:update',
        entityType: 'DistributionConfig',
        entityId: config.id,
        before: existing,
        after: config,
      });

      return config;
    });
  }

  /**
   * Supprimer une configuration
   */
  async deleteConfig(id: string, actor: { id: string }, policy: AccessPolicy): Promise<DistributionConfig> {
    policy.requireScope('distribution', 'manage', [SCOPE_ANY]);

    const existing = await this.prisma.distributionConfig.findUniqueOrThrow({
      where: { id, deletedAt: null },
    });

    // Ne pas permettre la suppression de la configuration active
    if (existing.isActive) {
      throw AppException.badRequest(
        'CANNOT_DELETE_ACTIVE_CONFIG',
        'Ne peut pas supprimer la configuration active. Désactivez-la d\'abord.',
      );
    }

    const config = await this.prisma.distributionConfig.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'distribution:config:delete',
      entityType: 'DistributionConfig',
      entityId: config.id,
      before: existing,
      after: config,
    });

    return config;
  }

  // ---------------------------------------------------------------------------
  // Répartitions par projet
  // ---------------------------------------------------------------------------

  /**
   * Calculer la répartition pour un projet
   * 
   * Cette méthode calcule une répartition INCÉMENTALE basée sur les montants
   * réellement encaissés (par défaut). Chaque paiement déclenche un recalcul.
   * 
   * @param projectId - ID du projet
   * @param configId - ID de la configuration (optionnel, utilise la configuration active)
   * @returns La répartition calculée
   */
  async calculateForProject(
    projectId: string,
    configId: string | undefined,
    policy: AccessPolicy,
  ): Promise<ProjectDistribution> {
    policy.requireScope('distribution', 'manage', [SCOPE_ANY]);

    // Récupérer le projet avec ses factures et paiements
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId, deletedAt: null },
      include: {
        invoices: {
          where: { deletedAt: null },
          include: {
            payments: {
              where: {
                deletedAt: null,
                status: PaymentStatus.SUCCEEDED,
              },
            },
          },
        },
        // Récupérer la dernière répartition CALCULATED ou APPLIED
        distributions: {
          where: { status: { in: [DistributionStatus.CALCULATED, DistributionStatus.APPLIED] } },
          orderBy: { calculatedAt: 'desc' },
          take: 1,
          include: { items: true },
        },
      },
    });

    // Calculer le montant total encaissé
    const totalCollected = project.invoices.reduce(
      (sum, invoice) => sum.plus(invoice.amountPaid),
      new Prisma.Decimal(0),
    );

    // Si aucun montant encaissé, ne pas créer de répartition
    if (totalCollected.equals(new Prisma.Decimal(0))) {
      throw AppException.badRequest(
        'NO_AMOUNT_COLLECTED',
        'Aucun montant encaissé pour ce projet. Impossible de calculer une répartition.',
      );
    }

    // Récupérer la configuration
    const config = configId
      ? await this.getConfigById(configId, policy)
      : await this.getActiveConfig(policy);

    if (!config) {
      throw AppException.badRequest(
        'NO_ACTIVE_CONFIG',
        'Aucune configuration de répartition active. Veuillez en créer une.',
      );
    }

    // Valider la configuration
    await this.validateConfig(config);

    // Vérifier qu'il n'y a pas déjà une répartition PENDING ou CALCULATED
    const existingPending = await this.prisma.projectDistribution.findFirst({
      where: {
        projectId,
        status: { in: [DistributionStatus.PENDING, DistributionStatus.CALCULATED] },
      },
    });

    if (existingPending) {
      throw AppException.conflict(
        'DISTRIBUTION_ALREADY_PENDING',
        `Une répartition est déjà en cours pour ce projet (${existingPending.id})`,
      );
    }

    // Calculer les montants pour chaque bénéficiaire
    const items = config.beneficiaries.map(beneficiary => {
      const amount = totalCollected
        .times(beneficiary.percentage)
        .div(100)
        .toDecimalPlaces(CENTS, ROUND_HALF_UP);

      return {
        beneficiaryId: beneficiary.id,
        calculatedAmount: amount,
        currency: project.currency,
        status: DistributionItemStatus.PENDING,
      };
    });

    // Vérifier que la somme des parts = montant de base
    const totalDistributed = items.reduce(
      (sum, item) => sum.plus(item.calculatedAmount),
      new Prisma.Decimal(0),
    );

    const lastItem = items.at(-1);
    if (!totalDistributed.equals(totalCollected) && lastItem) {
      // Ajuster les arrondis sur le dernier item
      const difference = totalCollected.minus(totalDistributed);
      lastItem.calculatedAmount = lastItem.calculatedAmount.plus(difference);
    }

    // Vérifier à nouveau
    const finalTotal = items.reduce(
      (sum, item) => sum.plus(item.calculatedAmount),
      new Prisma.Decimal(0),
    );

    if (!finalTotal.equals(totalCollected)) {
      throw AppException.internal(
        'DISTRIBUTION_AMOUNT_MISMATCH',
        `Somme distribuée (${finalTotal}) ≠ montant de base (${totalCollected})`,
      );
    }

    // Créer la répartition
    return this.prisma.$transaction(async (tx) => {
      // Si une répartition APPLIED existe, la marquer comme PENDING
      const lastApplied = project.distributions.find(d => d.status === DistributionStatus.APPLIED);
      if (lastApplied) {
        await tx.projectDistribution.update({
          where: { id: lastApplied.id },
          data: { status: DistributionStatus.PENDING },
        });

        // Écrire dans l'historique
        await tx.distributionHistory.create({
          data: {
            distributionId: lastApplied.id,
            changedById: policy.userId,
            changeType: DistributionChangeType.PAYMENT_RECEIVED,
            newValues: { status: 'PENDING' },
          },
        });
      }

      const distribution = await tx.projectDistribution.create({
        data: {
          projectId,
          configId: config.id,
          baseAmount: totalCollected,
          baseCurrency: project.currency,
          totalPercentage: new Prisma.Decimal(100),
          status: DistributionStatus.CALCULATED,
          calculatedAt: new Date(),
          items: { create: items },
        },
        include: { items: true },
      });

      await tx.auditLog.create({
        data: {
          actorId: policy.userId,
          action: 'distribution:calculate',
          entityType: 'ProjectDistribution',
          entityId: distribution.id,
          after: JSON.parse(JSON.stringify(distribution)) as Prisma.InputJsonValue,
        },
      });

      return distribution;
    });
  }

  /**
   * Appliquer une répartition (créditer les soldes)
   * 
   * Cette méthode applique une répartition CALCULATED en créant des
   * transactions de solde pour chaque bénéficiaire MEMBRE.
   * 
   * @param distributionId - ID de la répartition à appliquer
   * @returns La répartition appliquée
   */
  async applyDistribution(
    distributionId: string,
    policy: AccessPolicy,
  ): Promise<ProjectDistribution> {
    policy.requireScope('distribution', 'manage', [SCOPE_ANY]);

    return this.prisma.$transaction(async (tx) => {
      // Récupérer la répartition avec ses items
      const distribution = await tx.projectDistribution.findUniqueOrThrow({
        where: { id: distributionId, status: { not: DistributionStatus.CANCELLED } },
        include: {
          items: {
            include: {
              beneficiary: true,
            },
          },
          project: true,
        },
      });

      // Vérifier qu'elle est CALCULATED
      if (distribution.status !== DistributionStatus.CALCULATED) {
        throw AppException.badRequest(
          'INVALID_STATUS',
          `La répartition doit être CALCULATED (actuelle: ${distribution.status})`,
        );
      }

      // Vérifier que le total des items = baseAmount
      const totalDistributed = distribution.items.reduce(
        (sum, item) => sum.plus(item.calculatedAmount),
        new Prisma.Decimal(0),
      );

      if (!totalDistributed.equals(distribution.baseAmount)) {
        throw AppException.internal(
          'DISTRIBUTION_AMOUNT_MISMATCH',
          `Total distribué (${totalDistributed}) ≠ montant de base (${distribution.baseAmount})`,
        );
      }

      // Vérifier qu'aucune répartition n'est déjà APPLIED pour ce projet
      const existingApplied = await tx.projectDistribution.findFirst({
        where: {
          projectId: distribution.projectId,
          status: DistributionStatus.APPLIED,
        },
      });

      if (existingApplied) {
        throw AppException.conflict(
          'DISTRIBUTION_ALREADY_APPLIED',
          `Une répartition a déjà été appliquée pour ce projet (${existingApplied.id})`,
        );
      }

      // Récupérer la dernière répartition APPLIED pour calculer les DELTA
      const lastApplied = await tx.projectDistribution.findFirst({
        where: {
          projectId: distribution.projectId,
          status: DistributionStatus.APPLIED,
        },
        include: { items: true },
        orderBy: { appliedAt: 'desc' },
      });

      // Pour chaque item, créer les transactions de solde (si MEMBER)
      for (const item of distribution.items) {
        if (item.beneficiary.beneficiaryType === BeneficiaryType.MEMBER) {
          if (!item.beneficiary.userId) {
            throw AppException.internal(
              'MISSING_USER_ID',
              `Bénéficiaire MEMBER ${item.beneficiary.name} n'a pas de userId`,
            );
          }

          // Calculer le DELTA à créditer
          const lastCreditedAmount = lastApplied?.items.find(
            i => i.beneficiaryId === item.beneficiaryId,
          )?.creditedAmount ?? new Prisma.Decimal(0);

          const delta = item.calculatedAmount.minus(lastCreditedAmount);

          if (delta.greaterThan(0)) {
            // Créer une transaction CREDIT
            await this.balanceService.createTransaction(
              {
                userId: item.beneficiary.userId,
                type: BalanceTransactionType.CREDIT,
                amount: delta,
                currency: distribution.baseCurrency,
                description: `Répartition projet ${distribution.project.name} (${distribution.project.code ?? distribution.project.id})`,
                distributionItemId: item.id,
                projectId: distribution.projectId,
              },
              policy,
              tx,
            );

            // Mettre à jour l'item
            await tx.distributionItem.update({
              where: { id: item.id },
              data: {
                creditedAmount: item.calculatedAmount,
                creditedAt: new Date(),
                status: DistributionItemStatus.CREDITED,
              },
            });
          } else if (delta.lessThan(0)) {
            // Créer une transaction DEBIT (remboursement)
            await this.balanceService.createTransaction(
              {
                userId: item.beneficiary.userId,
                type: BalanceTransactionType.DEBIT,
                amount: delta.abs(),
                currency: distribution.baseCurrency,
                description: `Ajustement répartition projet ${distribution.project.name}`,
                distributionItemId: item.id,
                projectId: distribution.projectId,
              },
              policy,
              tx,
            );

            // Mettre à jour l'item
            await tx.distributionItem.update({
              where: { id: item.id },
              data: {
                creditedAmount: item.calculatedAmount,
                creditedAt: new Date(),
                status: DistributionItemStatus.CREDITED,
              },
            });
          }
        } else {
          // COMPANY ou RESERVE: juste mettre à jour le statut
          await tx.distributionItem.update({
            where: { id: item.id },
            data: {
              status: DistributionItemStatus.PAID,
              paidAt: new Date(),
            },
          });
        }
      }

      // Mettre à jour la répartition
      const updatedDistribution = await tx.projectDistribution.update({
        where: { id: distributionId },
        data: {
          status: DistributionStatus.APPLIED,
          appliedAt: new Date(),
          appliedById: policy.userId,
        },
        include: { items: true },
      });

      // Écrire dans l'historique
      await tx.distributionHistory.create({
        data: {
          distributionId: distributionId,
          changedById: policy.userId,
          changeType: DistributionChangeType.DISTRIBUTION_APPLIED,
          newValues: { status: 'APPLIED' },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: policy.userId,
          action: 'distribution:apply',
          entityType: 'ProjectDistribution',
          entityId: distributionId,
          before: JSON.parse(JSON.stringify(distribution)) as Prisma.InputJsonValue,
          after: JSON.parse(JSON.stringify(updatedDistribution)) as Prisma.InputJsonValue,
        },
      });

      return updatedDistribution;
    });
  }

  /**
   * Obtenir les répartitions pour un projet
   */
  async getProjectDistributions(
    projectId: string,
    policy: AccessPolicy,
  ): Promise<ProjectDistribution[]> {
    policy.requireScope('distribution', 'read', [SCOPE_ANY]);

    // Ce modèle n'a pas de deletedAt : l'annulation est portée par le statut.
    return this.prisma.projectDistribution.findMany({
      where: {
        projectId,
        status: { not: DistributionStatus.CANCELLED },
      },
      orderBy: { calculatedAt: 'desc' },
      include: {
        items: {
          include: {
            beneficiary: true,
          },
        },
        config: true,
      },
    });
  }

  /**
   * Obtenir une répartition par ID
   */
  async getDistributionById(
    id: string,
    policy: AccessPolicy,
  ): Promise<ProjectDistribution | null> {
    policy.requireScope('distribution', 'read', [SCOPE_ANY]);

    return this.prisma.projectDistribution.findUnique({
      where: { id, status: { not: DistributionStatus.CANCELLED } },
      include: {
        items: {
          include: {
            beneficiary: true,
          },
        },
        config: true,
        project: true,
      },
    });
  }

  /**
   * Annuler une répartition
   */
  async cancelDistribution(
    id: string,
    actor: { id: string },
    policy: AccessPolicy,
  ): Promise<ProjectDistribution> {
    policy.requireScope('distribution', 'manage', [SCOPE_ANY]);

    const existing = await this.prisma.projectDistribution.findUniqueOrThrow({
      where: { id, status: { not: DistributionStatus.CANCELLED } },
    });

    if (existing.status === DistributionStatus.APPLIED) {
      throw AppException.badRequest(
        'CANNOT_CANCEL_APPLIED',
        'Ne peut pas annuler une répartition déjà appliquée',
      );
    }

    const distribution = await this.prisma.projectDistribution.update({
      where: { id },
      data: {
        status: DistributionStatus.CANCELLED,
      },
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'distribution:cancel',
      entityType: 'ProjectDistribution',
      entityId: distribution.id,
      before: existing,
      after: distribution,
    });

    return distribution;
  }

  /**
   * Recalculer toutes les répartitions pour un projet
   * (Utilisé après un nouveau paiement)
   */
  async recalculateForProjectOnPayment(
    projectId: string,
    policy: AccessPolicy,
  ): Promise<ProjectDistribution | null> {
    policy.requireScope('distribution', 'manage', [SCOPE_ANY]);

    // Vérifier s'il y a des paiements sur ce projet
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId, deletedAt: null },
      include: {
        invoices: {
          where: { deletedAt: null },
          include: {
            payments: {
              where: {
                deletedAt: null,
                status: PaymentStatus.SUCCEEDED,
              },
            },
          },
        },
      },
    });

    const totalCollected = project.invoices.reduce(
      (sum, invoice) => sum.plus(invoice.amountPaid),
      new Prisma.Decimal(0),
    );

    // Si aucun montant encaissé, ne pas créer de répartition
    if (totalCollected.equals(new Prisma.Decimal(0))) {
      return null;
    }

    // Appeler calculateForProject
    return this.calculateForProject(projectId, undefined, policy);
  }
}
