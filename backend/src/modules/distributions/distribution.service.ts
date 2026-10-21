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
  BalanceTransactionKind,
} from '../../generated/prisma/client.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { AccessPolicy, SCOPE_ANY } from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EligibleMembersService } from '../../common/finance/eligible-members.service.js';
import { BalanceService } from '../balances/balance.service.js';
import { InvoiceStatus, PaymentStatus } from '../../generated/prisma/enums.js';
import {
  buildTrace,
  parsePercentage,
  splitAmount,
  validateShares,
  type ShareInput,
} from './distribution-math.js';

/**
 * SERVICE DE RÉPARTITION DES GAINS
 *
 * LE PRINCIPE QUI COMMANDE TOUT CE FICHIER :
 *
 * **UNE RÉPARTITION EST UN CALCUL FIGÉ, JUSTIFIÉ, ET REPRODUCTIBLE.**
 *
 *   - FIGÉ : elle porte la base, le pourcentage, la trace de l'arrondi et la
 *     version de la règle qui l'a produite. Modifier une règle ne la modifie
 *     pas : cela crée une nouvelle version, et les répartitions déjà
 *     validées gardent la règle qui les a produites.
 *   - JUSTIFIÉ : la base est reconstituée et affichée (facturé, encaissé,
 *     budget), l'arrondi est tracé centime par centime, et le total reparti
 *     vaut EXACTEMENT la base.
 *   - REPRODUCTIBLE : le même calcul sur les mêmes données donne le même
 *     résultat, et un rejeu (webhook, double clic, deux workers) ne crée pas
 *     deux répartitions.
 *
 * LES TROIS BASES, ET CE QUI LES DISTINGUE :
 *
 *   - `PROJECT_AMOUNT` : le budget contractuel du projet.
 *   - `INVOICED_AMOUNT` : ce qui a été FACTURÉ. Une facture émise n'est pas un
 *     paiement : c'est une promesse, pas de l'argent.
 *   - `COLLECTED_AMOUNT` : ce qui a été RÉELLEMENT ENCAISSÉ. On additionne les
 *     lignes de paiement réussies, pas le `amountPaid` d'une facture : un
 *     acompte et un solde sont deux paiements distincts, et un paiement ne
 *     peut pas être compté deux fois.
 */

type DistributionConfigWithBeneficiaries = Prisma.DistributionConfigGetPayload<{
  include: { beneficiaries: true };
}>;

/** Clé de périmètre : `global` ou `project:<id>`. */
export function scopeKeyFor(projectId: string | null | undefined): string {
  return projectId ? `project:${projectId}` : 'global';
}

export interface ShareInputDraft {
  readonly beneficiaryType: BeneficiaryType;
  readonly name: string;
  readonly percentage: string | number | Prisma.Decimal;
  readonly userId?: string | null;
  readonly order: number;
}

export interface RuleInput {
  readonly name: string;
  readonly description?: string | null;
  readonly baseType: DistributionBaseType;
  /** Date d'effet de la version. Une revision ne peut pas etre retroactive. */
  readonly effectiveDate?: Date | null;
  readonly projectId?: string | null;
  readonly beneficiaries: readonly ShareInputDraft[];
}

export interface BaseBreakdown {
  readonly baseType: DistributionBaseType;
  readonly baseAmount: Prisma.Decimal;
  readonly currency: string;
  readonly invoiced: Prisma.Decimal;
  readonly collected: Prisma.Decimal;
  readonly budget: Prisma.Decimal;
  readonly invoiceCount: number;
  readonly paymentCount: number;
  readonly anchor: string;
}

@Injectable()
export class DistributionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly balanceService: BalanceService,
    private readonly eligibleMembers: EligibleMembersService,
  ) {}

  // ---------------------------------------------------------------------------
  // REGLES
  // ---------------------------------------------------------------------------

  /**
   * Obtenir la configuration active (regle par defaut, sans exception projet).
   */
  async getActiveConfig(policy: AccessPolicy): Promise<DistributionConfigWithBeneficiaries | null> {
    policy.requireScope('distribution', 'read', [SCOPE_ANY]);

    return this.prisma.distributionConfig.findFirst({
      where: { isActive: true, deletedAt: null, scopeKey: scopeKeyFor(null) },
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
  async getConfigById(
    id: string,
    policy: AccessPolicy,
  ): Promise<DistributionConfigWithBeneficiaries | null> {
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
   * Lister toutes les configurations (toutes versions, tous périmètres).
   */
  async listConfigs(
    policy: AccessPolicy,
    filters: { projectId?: string | null; scope?: 'global' | 'project' } = {},
  ): Promise<DistributionConfigWithBeneficiaries[]> {
    policy.requireScope('distribution', 'read', [SCOPE_ANY]);

    return this.prisma.distributionConfig.findMany({
      where: {
        deletedAt: null,
        ...(filters.scope === 'global' ? { scopeKey: scopeKeyFor(null) } : {}),
        ...(filters.scope === 'project' ? { scopeKey: { not: scopeKeyFor(null) } } : {}),
        ...(filters.projectId ? { projectId: filters.projectId } : {}),
      },
      orderBy: [{ scopeKey: 'asc' }, { version: 'desc' }],
      include: {
        beneficiaries: {
          where: { isActive: true },
          orderBy: { order: 'asc' },
        },
      },
    });
  }

  /**
   * La regle applicable a un projet a une date donnee.
   *
   * L'EXCEPTION PROJET PRIME SUR LA REGLE PAR DEFAUT : un projet qui a sa
   * propre regle l'utilise, meme si la regle par defaut existe. Et la
   * VERSION est celle qui est en vigueur a la date demandee — c'est ce qui
   * rend les changements de regle FUTURS par construction.
   */
  async resolveRuleForProject(
    projectId: string | null,
    at: Date,
    policy: AccessPolicy,
  ): Promise<DistributionConfigWithBeneficiaries | null> {
    policy.requireScope('distribution', 'read', [SCOPE_ANY]);

    const scopes = projectId ? [scopeKeyFor(projectId), scopeKeyFor(null)] : [scopeKeyFor(null)];

    const rules = await this.prisma.distributionConfig.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        scopeKey: { in: scopes },
        effectiveDate: { lte: at },
        // La fenetre temporelle fait foi : une version remplacee cesse
        // de s'appliquer a la date d'effet de la version suivante, sans
        // qu'aucun projet ne se retrouve sans regle entre-temps.
        OR: [{ endDate: null }, { endDate: { gt: at } }],
      },
      orderBy: [{ version: 'desc' }],
      include: {
        beneficiaries: {
          where: { isActive: true },
          orderBy: { order: 'asc' },
        },
      },
    });

    // L'exception d'abord : la liste est triee par version decroissante, mais
    // c'est le PERIMETRE qui tranche.
    for (const scope of scopes) {
      const match = rules.find((rule) => rule.scopeKey === scope);
      if (match) {
        return match;
      }
    }

    return null;
  }

  /**
   * Valider qu'une configuration a un total de 100%
   */
  async validateConfig(config: DistributionConfigWithBeneficiaries): Promise<void> {
    validateShares(this.toShares(config.beneficiaries));
  }

  // ---------------------------------------------------------------------------
  // CREATION ET REVISION DES REGLES
  // ---------------------------------------------------------------------------

  /**
   * Creer une regle (regle par defaut ou exception de projet).
   *
   * La premiere version d'un perimetre porte le numero 1. Les versions
   * suivantes sont creees par `reviseConfig`, jamais ici.
   */
  async createRule(
    data: RuleInput,
    actor: { id: string },
    policy: AccessPolicy,
  ): Promise<DistributionConfigWithBeneficiaries> {
    policy.requireScope('distribution', 'manage', [SCOPE_ANY]);

    const shares = await this.prepareShares(data.beneficiaries, data.projectId ?? null);
    const scopeKey = scopeKeyFor(data.projectId ?? null);

    const effectiveDate = data.effectiveDate ?? new Date();

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.distributionConfig.findFirst({
        where: { scopeKey, deletedAt: null },
        orderBy: { version: 'desc' },
        select: { id: true, version: true },
      });

      if (existing) {
        throw AppException.conflict(
          'RULE_ALREADY_EXISTS',
          'Une règle existe déjà pour ce périmètre. Créez une nouvelle version plutôt qu’une seconde règle.',
        );
      }

      // Une regle precedente du meme perimetre cesse de s'appliquer a la
      // date d'effet de la nouvelle — elle n'est PAS desactivee : elle
      // reste la regle en vigueur jusqu'a cette date.
      await tx.distributionConfig.updateMany({
        where: { scopeKey, deletedAt: null, isActive: true, endDate: null },
        data: { endDate: effectiveDate },
      });

      const config = await tx.distributionConfig.create({
        data: {
          name: data.name,
          description: data.description ?? null,
          baseType: data.baseType,
          isActive: true,
          effectiveDate,
          scopeKey,
          projectId: data.projectId ?? null,
          version: 1,
          createdById: actor.id,
          confirmedAt: new Date(),
          confirmedById: actor.id,
          beneficiaries: {
            create: shares.map((share) => ({
              beneficiaryType: share.beneficiaryType,
              name: share.name,
              userId: share.userId ?? null,
              percentage: share.percentage,
              order: share.order,
              isActive: true,
            })),
          },
        },
        include: { beneficiaries: true },
      });

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'distribution:rule:create',
          entityType: 'DistributionConfig',
          entityId: config.id,
          after: JSON.parse(JSON.stringify(config)) as Prisma.InputJsonValue,
        },
      });

      return config;
    });
  }

  /**
   * Creer une NOUVELLE VERSION d'une regle.
   *
   * C'EST ICI QUE SE JOUE LA REGLE « UN CHANGEMENT NE RECALCULE RIEN ».
   *
   * L'ancienne version n'est JAMAIS modifiee : elle reste en base, avec ses
   * beneficiaires, et les repartitions qui l'ont utilisee continuent de
   * pointer dessus. La nouvelle version porte une date d'effet : elle ne
   * s'applique qu'a partir de cette date. Les repartitions deja calculees et
   * validees restent donc valides, sans recalcul silencieux.
   *
   * Une regularisation VOLONTAIRE (une nouvelle version appliquee a un
   * projet deja reparti) existe — mais c'est une operation explicite, tracee
   * et contre-passee, pas un effet de bord d'un changement de regle.
   */
  async reviseConfig(
    id: string,
    data: {
      name?: string;
      description?: string | null;
      baseType?: DistributionBaseType;
      effectiveDate?: Date | null;
      beneficiaries?: readonly ShareInputDraft[];
      /** Confirmation explicite : sans elle, le changement est refuse. */
      confirm?: boolean;
      reason?: string | null;
    },
    actor: { id: string },
    policy: AccessPolicy,
  ): Promise<DistributionConfigWithBeneficiaries> {
    policy.requireScope('distribution', 'manage', [SCOPE_ANY]);

    if (!data.confirm) {
      throw AppException.badRequest(
        'CONFIRMATION_REQUIRED',
        'Un changement de règle doit être confirmé explicitement.',
      );
    }

    const existing = await this.prisma.distributionConfig.findUniqueOrThrow({
      where: { id, deletedAt: null },
      include: { beneficiaries: true },
    });

    // La date d'effet d'une revision ne peut pas etre anterieure a maintenant :
    // une regle retroactive recalculerait le passe sans le dire.
    const now = new Date();
    const effectiveDate = data.effectiveDate ?? now;

    if (effectiveDate.getTime() < now.getTime() - 60_000) {
      throw AppException.badRequest(
        'RETROACTIVE_RULE',
        'Une règle ne peut pas s’appliquer dans le passé : choisissez une date d’effet à venir.',
      );
    }

    const shares = data.beneficiaries
      ? await this.prepareShares(data.beneficiaries, existing.projectId ?? null)
      : existing.beneficiaries.map((beneficiary) => ({
          beneficiaryType: beneficiary.beneficiaryType,
          name: beneficiary.name,
          userId: beneficiary.userId,
          percentage: beneficiary.percentage,
          order: beneficiary.order,
        }));

    validateShares(
      shares.map((share, index): ShareInput => ({
        key: `${index}`,
        percentage: share.percentage,
        userId: share.userId,
        beneficiaryType: share.beneficiaryType,
      })),
    );

    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.distributionConfig.findFirst({
        where: { scopeKey: existing.scopeKey, deletedAt: null },
        orderBy: { version: 'desc' },
        select: { id: true, version: true },
      });

      const version = (latest?.version ?? existing.version) + 1;

      const config = await tx.distributionConfig.create({
        data: {
          name: data.name ?? existing.name,
          description: data.description ?? existing.description,
          baseType: data.baseType ?? existing.baseType,
          isActive: true,
          effectiveDate,
          endDate: existing.endDate,
          scopeKey: existing.scopeKey,
          projectId: existing.projectId,
          version,
          supersedesId: existing.id,
          createdById: actor.id,
          confirmedAt: new Date(),
          confirmedById: actor.id,
          beneficiaries: {
            create: shares.map((share) => ({
              beneficiaryType: share.beneficiaryType,
              name: share.name,
              userId: share.userId ?? null,
              percentage: share.percentage,
              order: share.order,
              isActive: true,
            })),
          },
        },
        include: { beneficiaries: true },
      });

      // L'ancienne version cesse de s'appliquer a la date d'effet de la
      // nouvelle — elle n'est pas desactivee, elle n'est simplement plus celle
      // qui s'applique. Entre aujourd'hui et cette date, c'est ENCORE
      // l'ancienne qui regit : aucun projet ne se retrouve sans regle.
      await tx.distributionConfig.update({
        where: { id: existing.id },
        data: { endDate: effectiveDate },
      });

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'distribution:rule:revise',
          entityType: 'DistributionConfig',
          entityId: config.id,
          before: JSON.parse(JSON.stringify(existing)) as Prisma.InputJsonValue,
          after: JSON.parse(JSON.stringify(config)) as Prisma.InputJsonValue,
        },
      });

      return config;
    });
  }

  /**
   * L'historique des versions d'une regle (et les evenements qui l'ont touchee).
   */
  async getRuleHistory(
    id: string,
    policy: AccessPolicy,
  ): Promise<
    {
      id: string;
      version: number;
      name: string;
      baseType: DistributionBaseType;
      effectiveDate: Date;
      endDate: Date | null;
      createdAt: Date;
      isActive: boolean;
      confirmedAt: Date | null;
      createdBy: { id: string; firstName: string | null; lastName: string | null } | null;
      beneficiaries: { name: string; percentage: string; userId: string | null }[];
    }[]
  > {
    policy.requireScope('distribution', 'read', [SCOPE_ANY]);

    const rule = await this.prisma.distributionConfig.findUniqueOrThrow({
      where: { id, deletedAt: null },
      select: { scopeKey: true },
    });

    const versions = await this.prisma.distributionConfig.findMany({
      where: { scopeKey: rule.scopeKey, deletedAt: null },
      orderBy: { version: 'desc' },
      include: {
        beneficiaries: { orderBy: { order: 'asc' } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    return versions.map((version) => ({
      id: version.id,
      version: version.version,
      name: version.name,
      baseType: version.baseType,
      effectiveDate: version.effectiveDate,
      endDate: version.endDate,
      createdAt: version.createdAt,
      isActive: version.isActive,
      confirmedAt: version.confirmedAt,
      createdBy: version.createdBy,
      beneficiaries: version.beneficiaries.map((beneficiary) => ({
        name: beneficiary.name,
        percentage: beneficiary.percentage.toString(),
        userId: beneficiary.userId,
      })),
    }));
  }

  /**
   * Desactiver une regle (sans la supprimer : elle peut etre citee par des
   * repartitions deja calculees).
   */
  async deactivateConfig(
    id: string,
    actor: { id: string },
    policy: AccessPolicy,
  ): Promise<DistributionConfig> {
    policy.requireScope('distribution', 'manage', [SCOPE_ANY]);

    const existing = await this.prisma.distributionConfig.findUniqueOrThrow({
      where: { id, deletedAt: null },
    });

    const config = await this.prisma.distributionConfig.update({
      where: { id },
      data: { isActive: false, endDate: new Date() },
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'distribution:rule:deactivate',
      entityType: 'DistributionConfig',
      entityId: id,
      before: existing,
      after: config,
    });

    return config;
  }

  // ---------------------------------------------------------------------------
  // LA BASE DE CALCUL
  // ---------------------------------------------------------------------------

  /**
   * Reconstituer la base de calcul d'un projet, avec son detail.
   *
   * L'ENCAISSEMENT EST COMPTE LIGNE PAR LIGNE. On additionne les paiements
   * reussis, pas le `amountPaid` d'une facture : un acompte et un solde sont
   * deux paiements distincts, et un paiement edite (montant, statut) se
   * repercute immediatement, sans double comptage.
   */
  async buildBase(projectId: string, baseType: DistributionBaseType): Promise<BaseBreakdown> {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId, deletedAt: null },
      select: {
        id: true,
        name: true,
        code: true,
        currency: true,
        budget: true,
        invoices: {
          where: { deletedAt: null },
          select: {
            id: true,
            reference: true,
            status: true,
            total: true,
            currency: true,
            payments: {
              where: { deletedAt: null, status: PaymentStatus.SUCCEEDED },
              select: { id: true, amount: true, currency: true, paidAt: true, reference: true },
              orderBy: { paidAt: 'desc' },
            },
          },
        },
      },
    });

    const zero = new Prisma.Decimal(0);

    // FACTURE : une facture emise, meme impayee, est du chiffre d'affaires
    // facture. Une facture brouillon ne l'est pas encore ; une facture
    // annulee ne l'est plus.
    const invoicedInvoices = project.invoices.filter(
      (invoice) =>
        invoice.status !== InvoiceStatus.DRAFT && invoice.status !== InvoiceStatus.CANCELLED,
    );

    const invoiced = invoicedInvoices.reduce((sum, invoice) => sum.plus(invoice.total), zero);

    // ENCAISSEMENT : les paiements reussis, une fois chacun.
    const succeededPayments = project.invoices.flatMap((invoice) => invoice.payments);

    const collected = succeededPayments.reduce((sum, payment) => sum.plus(payment.amount), zero);

    const budget = project.budget ?? zero;

    const baseAmount =
      baseType === DistributionBaseType.PROJECT_AMOUNT
        ? budget
        : baseType === DistributionBaseType.INVOICED_AMOUNT
          ? invoiced
          : collected;

    // L'ANCRE : le dernier encaissement. Elle identifie l'etat du monde qui
    // a produit la base — et donc la cle d'idempotence du calcul automatique.
    const anchor = succeededPayments[0]?.id ?? 'none';

    return {
      baseType,
      baseAmount,
      currency: project.currency,
      invoiced,
      collected,
      budget,
      invoiceCount: invoicedInvoices.length,
      paymentCount: succeededPayments.length,
      anchor,
    };
  }

  /**
   * La base de calcul d'un projet, avec la regle qui s'y applique.
   *
   * C'est ce que l'administrateur voit AVANT de calculer : combien de
   * budget, combien de facture, combien reellement encaisse, et quelle regle
   * (et quelle version de regle) sera appliquee.
   */
  async getProjectBase(
    projectId: string,
    policy: AccessPolicy,
  ): Promise<
    BaseBreakdown & {
      ruleId: string | null;
      ruleName: string | null;
      ruleVersion: number | null;
      ruleScope: string | null;
    }
  > {
    policy.requireScope('distribution', 'read', [SCOPE_ANY]);

    const rule = await this.resolveRuleForProject(projectId, new Date(), policy);
    const base = await this.buildBase(
      projectId,
      rule?.baseType ?? DistributionBaseType.COLLECTED_AMOUNT,
    );

    return {
      ...base,
      ruleId: rule?.id ?? null,
      ruleName: rule?.name ?? null,
      ruleVersion: rule?.version ?? null,
      ruleScope: rule?.scopeKey ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // CALCUL
  // ---------------------------------------------------------------------------

  /**
   * Calculer une repartition pour un projet.
   *
   * IDEMPOTENTE : deux appels avec la meme cle d'idempotence rendent la MEME
   * repartition. C'est ce qui rend sur un rejeu de webhook, une double
   * soumission ou deux workers simultanes sans risque de double repartition.
   *
   * CONCURRENTE : le calcul prend un verrou consultatif sur le projet, de
   * sorte que deux calculs simultanes ne puissent pas creer deux tours de
   * repartition pour le meme etat du monde.
   */
  async calculateForProject(
    projectId: string,
    options: {
      configId?: string | null;
      idempotencyKey?: string | null;
      at?: Date;
    } = {},
    policy: AccessPolicy,
  ): Promise<ProjectDistribution> {
    policy.requireScope('distribution', 'manage', [SCOPE_ANY]);

    const at = options.at ?? new Date();

    const rule = options.configId
      ? await this.getConfigById(options.configId, policy)
      : await this.resolveRuleForProject(projectId, at, policy);

    if (!rule) {
      throw AppException.badRequest(
        'NO_ACTIVE_CONFIG',
        'Aucune règle de répartition applicable à ce projet. Créez-en une, ou une exception pour ce projet.',
      );
    }

    const base = await this.buildBase(projectId, rule.baseType);

    if (base.baseAmount.lessThanOrEqualTo(0)) {
      throw AppException.badRequest(
        'NO_AMOUNT_TO_DISTRIBUTE',
        'Aucun montant à répartir pour ce projet sur cette base.',
      );
    }

    // La cle d'idempotence DECRIT l'etat du monde : meme projet, meme regle,
    // meme base, meme dernier encaissement => meme cle => meme repartition.
    const idempotencyKey =
      options.idempotencyKey ??
      `auto:${projectId}:${rule.id}:${base.baseType}:${base.baseAmount.toString()}:${base.anchor}`;

    const existing = await this.prisma.projectDistribution.findUnique({
      where: { idempotencyKey },
      include: { items: true },
    });

    if (existing) {
      return existing;
    }

    const shares = this.toShares(rule.beneficiaries);
    const { results, total } = splitAmount(base.baseAmount, shares);

    if (!total.equals(base.baseAmount)) {
      throw AppException.internal(
        'DISTRIBUTION_AMOUNT_MISMATCH',
        `Somme distribuée (${total.toString()}) ≠ montant de base (${base.baseAmount.toString()})`,
      );
    }

    const trace = buildTrace(base.baseAmount, results, total);

    return this.prisma.$transaction(async (tx) => {
      // Verrou consultatif : deux calculs concurrents sur le meme projet
      // s'excluent au lieu de creer deux tours identiques.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`distribution:${projectId}`}))::text AS locked`;

      // Re-test sous le verrou : l'autre transaction a pu ecrire entre-temps.
      const alreadyThere = await tx.projectDistribution.findUnique({
        where: { idempotencyKey },
        include: { items: true },
      });

      if (alreadyThere) {
        return alreadyThere;
      }

      const lastRound = await tx.projectDistribution.aggregate({
        where: { projectId },
        _max: { round: true },
      });

      const round = (lastRound._max.round ?? 0) + 1;

      const distribution = await tx.projectDistribution.create({
        data: {
          projectId,
          configId: rule.id,
          baseAmount: base.baseAmount,
          baseCurrency: base.currency,
          totalPercentage: new Prisma.Decimal(100),
          status: DistributionStatus.CALCULATED,
          calculatedAt: new Date(),
          round,
          idempotencyKey,
          baseType: base.baseType,
          baseSource: JSON.parse(
            JSON.stringify({
              invoiced: base.invoiced.toString(),
              collected: base.collected.toString(),
              budget: base.budget.toString(),
              invoiceCount: base.invoiceCount,
              paymentCount: base.paymentCount,
              anchor: base.anchor,
            }),
          ) as Prisma.InputJsonValue,
          calculationTrace: JSON.parse(JSON.stringify(trace)) as Prisma.InputJsonValue,
          ruleVersion: rule.version,
          items: {
            create: results.map((result, index) => {
              const beneficiary = rule.beneficiaries[index];
              if (!beneficiary) {
                throw AppException.internal(
                  'MISSING_BENEFICIARY',
                  'Bénéficiaire introuvable pour la part calculée.',
                );
              }
              return {
                beneficiaryId: beneficiary.id,
                calculatedAmount: result.amount,
                percentage: result.percentage,
                currency: base.currency,
                status: DistributionItemStatus.PENDING,
                trace: JSON.parse(
                  JSON.stringify({
                    raw: result.raw.toString(),
                    floor: result.floor.toString(),
                    remainder: result.remainder.toString(),
                    adjustment: result.adjustment.toString(),
                    rank: result.rank,
                  }),
                ) as Prisma.InputJsonValue,
              };
            }),
          },
        },
        include: { items: true },
      });

      await tx.distributionHistory.create({
        data: {
          distributionId: distribution.id,
          changedById: policy.userId,
          changeType: DistributionChangeType.BASE_AMOUNT_UPDATED,
          newValues: JSON.parse(
            JSON.stringify({
              baseType: base.baseType,
              baseAmount: base.baseAmount.toString(),
              ruleId: rule.id,
              ruleVersion: rule.version,
              round,
              idempotencyKey,
            }),
          ) as Prisma.InputJsonValue,
        },
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
   * Appliquer une repartition (crediter les soldes).
   *
   * L'APPLIQUATION EST INCREMENTALE ET IDEMPOTENTE : le credited est la
   * difference entre le montant alloue par cette repartition et ce que le
   * membre a deja recu de ce projet. Un second appel ne credite rien de
   * plus.
   */
  async applyDistribution(
    distributionId: string,
    policy: AccessPolicy,
  ): Promise<ProjectDistribution> {
    policy.requireScope('distribution', 'manage', [SCOPE_ANY]);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`distribution-apply:${distributionId}`}))::text AS locked`;

      const distribution = await tx.projectDistribution.findUniqueOrThrow({
        where: { id: distributionId },
        include: {
          items: {
            include: {
              beneficiary: true,
            },
          },
          project: true,
        },
      });

      if (distribution.status === DistributionStatus.APPLIED) {
        return distribution;
      }

      if (distribution.status !== DistributionStatus.CALCULATED) {
        throw AppException.badRequest(
          'INVALID_STATUS',
          `La répartition doit être CALCULATED (actuelle: ${distribution.status})`,
        );
      }

      const totalDistributed = distribution.items.reduce(
        (sum, item) => sum.plus(item.calculatedAmount),
        new Prisma.Decimal(0),
      );

      if (!totalDistributed.equals(distribution.baseAmount)) {
        throw AppException.internal(
          'DISTRIBUTION_AMOUNT_MISMATCH',
          `Total distribué (${totalDistributed.toString()}) ≠ montant de base (${distribution.baseAmount.toString()})`,
        );
      }

      // Ce que chaque membre a deja recu de ce projet, toutes repartitions
      // appliquees confondues : c'est la reference du calcul incremental.
      const creditedByUser = new Map<string, Prisma.Decimal>();
      const previousItems = await tx.distributionItem.findMany({
        where: {
          distribution: {
            projectId: distribution.projectId,
            status: DistributionStatus.APPLIED,
          },
        },
        include: { beneficiary: true },
      });

      for (const item of previousItems) {
        const userId = item.beneficiary.userId;
        if (!userId) continue;
        creditedByUser.set(
          userId,
          (creditedByUser.get(userId) ?? new Prisma.Decimal(0)).plus(item.creditedAmount),
        );
      }

      for (const item of distribution.items) {
        if (item.beneficiary.beneficiaryType === BeneficiaryType.MEMBER) {
          if (!item.beneficiary.userId) {
            throw AppException.internal(
              'MISSING_USER_ID',
              `Bénéficiaire MEMBER ${item.beneficiary.name} n'a pas de userId`,
            );
          }

          const already = creditedByUser.get(item.beneficiary.userId) ?? new Prisma.Decimal(0);
          const delta = item.calculatedAmount.minus(already);

          if (!delta.isZero()) {
            await this.balanceService.createTransaction(
              {
                userId: item.beneficiary.userId,
                type: delta.isNegative()
                  ? BalanceTransactionType.DEBIT
                  : BalanceTransactionType.CREDIT,
                amount: delta.abs(),
                currency: distribution.baseCurrency,
                description: `Part de répartition — projet ${distribution.project.name} (tour ${distribution.round})`,
                distributionItemId: item.id,
                projectId: distribution.projectId,
                kind: BalanceTransactionKind.SHARE,
                reason: `Part de répartition — projet ${distribution.project.name} (tour ${distribution.round})`,
                idempotencyKey: `share:${item.id}`,
                authorId: policy.userId,
              },
              policy,
              tx,
            );
          }

          await tx.distributionItem.update({
            where: { id: item.id },
            data: {
              creditedAmount: item.calculatedAmount,
              creditedAt: new Date(),
              status: DistributionItemStatus.CREDITED,
            },
          });
        } else {
          // COMPANY ou RESERVE : suivi seul, aucun solde.
          await tx.distributionItem.update({
            where: { id: item.id },
            data: {
              creditedAmount: item.calculatedAmount,
              creditedAt: new Date(),
              status: DistributionItemStatus.PAID,
            },
          });
        }
      }

      const updatedDistribution = await tx.projectDistribution.update({
        where: { id: distributionId },
        data: {
          status: DistributionStatus.APPLIED,
          appliedAt: new Date(),
          appliedById: policy.userId,
        },
        include: { items: true },
      });

      await tx.distributionHistory.create({
        data: {
          distributionId,
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
   * REGULARISER : appliquer une autre regle a une repartition deja appliquee.
   *
   * C'est l'operation EXPLICITE que l'absence de recalcul automatique
   * rend necessaire. Elle ne modifie pas la repartition d'origine : elle
   * cree un NOUVEAU TOUR, avec la meme base et la nouvelle regle, et ne
   * credite que la DIFFERENCE. L'historique conserve les deux etats, et
   * l'ecart passe par une ecriture tracee, signee, datee et attribuee.
   */
  async regularizeDistribution(
    distributionId: string,
    input: { configId: string; reason: string },
    actor: { id: string },
    policy: AccessPolicy,
  ): Promise<ProjectDistribution> {
    policy.requireScope('distribution', 'manage', [SCOPE_ANY]);

    if (!input.reason?.trim()) {
      throw AppException.badRequest(
        'MISSING_REASON',
        'Une régularisation doit dire ce qu’elle corrige.',
      );
    }

    const original = await this.prisma.projectDistribution.findUniqueOrThrow({
      where: { id: distributionId },
      include: { items: { include: { beneficiary: true } } },
    });

    if (original.status !== DistributionStatus.APPLIED) {
      throw AppException.badRequest(
        'INVALID_STATUS',
        'Seule une répartition appliquée peut être régularisée.',
      );
    }

    const rule = await this.getConfigById(input.configId, policy);

    if (!rule) {
      throw AppException.notFound('RULE_NOT_FOUND', 'Règle de répartition introuvable.');
    }

    const shares = this.toShares(rule.beneficiaries);
    const { results, total } = splitAmount(original.baseAmount, shares);

    if (!total.equals(original.baseAmount)) {
      throw AppException.internal(
        'DISTRIBUTION_AMOUNT_MISMATCH',
        `Somme distribuée (${total.toString()}) ≠ montant de base (${original.baseAmount.toString()})`,
      );
    }

    const idempotencyKey = `regularization:${original.id}:${rule.id}`;

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`distribution:${original.projectId}`}))::text AS locked`;

      const existing = await tx.projectDistribution.findUnique({
        where: { idempotencyKey },
        include: { items: true },
      });

      if (existing) {
        return existing;
      }

      const lastRound = await tx.projectDistribution.aggregate({
        where: { projectId: original.projectId },
        _max: { round: true },
      });

      const round = (lastRound._max.round ?? 0) + 1;

      const distribution = await tx.projectDistribution.create({
        data: {
          projectId: original.projectId,
          configId: rule.id,
          baseAmount: original.baseAmount,
          baseCurrency: original.baseCurrency,
          totalPercentage: new Prisma.Decimal(100),
          status: DistributionStatus.CALCULATED,
          calculatedAt: new Date(),
          round,
          idempotencyKey,
          baseType: original.baseType,
          baseSource: original.baseSource ?? undefined,
          calculationTrace: JSON.parse(
            JSON.stringify(buildTrace(original.baseAmount, results, total)),
          ) as Prisma.InputJsonValue,
          ruleVersion: rule.version,
          items: {
            create: results.map((result, index) => ({
              beneficiaryId: (rule.beneficiaries[index] as { id: string }).id,
              calculatedAmount: result.amount,
              percentage: result.percentage,
              currency: original.baseCurrency,
              status: DistributionItemStatus.PENDING,
              trace: JSON.parse(
                JSON.stringify({
                  raw: result.raw.toString(),
                  floor: result.floor.toString(),
                  remainder: result.remainder.toString(),
                  adjustment: result.adjustment.toString(),
                  rank: result.rank,
                }),
              ) as Prisma.InputJsonValue,
            })),
          },
        },
        include: { items: true },
      });

      await tx.distributionHistory.create({
        data: {
          distributionId: original.id,
          previousConfigId: original.configId,
          changedById: policy.userId,
          changeType: DistributionChangeType.MANUAL_ADJUSTMENT,
          newValues: JSON.parse(
            JSON.stringify({
              regularizationId: distribution.id,
              newConfigId: rule.id,
              reason: input.reason.trim(),
              baseAmount: original.baseAmount.toString(),
            }),
          ) as Prisma.InputJsonValue,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'distribution:regularize',
          entityType: 'ProjectDistribution',
          entityId: distribution.id,
          after: JSON.parse(
            JSON.stringify({
              from: original.id,
              to: distribution.id,
              reason: input.reason.trim(),
              ruleId: rule.id,
            }),
          ) as Prisma.InputJsonValue,
        },
      });

      return distribution;
    });
  }

  // ---------------------------------------------------------------------------
  // CONSULTATION
  // ---------------------------------------------------------------------------

  /**
   * Obtenir les répartitions pour un projet
   */
  async getProjectDistributions(
    projectId: string,
    policy: AccessPolicy,
  ): Promise<ProjectDistribution[]> {
    policy.requireScope('distribution', 'read', [SCOPE_ANY]);

    return this.prisma.projectDistribution.findMany({
      where: {
        projectId,
        status: { not: DistributionStatus.CANCELLED },
      },
      orderBy: [{ round: 'desc' }],
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
  async getDistributionById(id: string, policy: AccessPolicy): Promise<ProjectDistribution | null> {
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
        history: {
          include: { changedBy: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  /**
   * Annuler une répartition (uniquement si elle n'a pas ete appliquee : une
   * repartition appliquee se contre-passe, elle ne s'annule pas).
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
        'Une répartition appliquée ne s’annule pas : elle se régularise par une contre-passation tracée.',
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
   * Recalculer les repartitions d'un projet apres un encaissement.
   *
   * Le calcul etant idempotent, un rejeu de webhook ne cree pas de seconde
   * repartition : la cle d'idempotence suffit.
   */
  async recalculateForProjectOnPayment(
    projectId: string,
    policy: AccessPolicy,
  ): Promise<ProjectDistribution | null> {
    policy.requireScope('distribution', 'manage', [SCOPE_ANY]);

    const rule = await this.resolveRuleForProject(projectId, new Date(), policy);

    if (!rule) {
      return null;
    }

    const base = await this.buildBase(projectId, rule.baseType);

    if (base.baseAmount.lessThanOrEqualTo(0)) {
      return null;
    }

    return this.calculateForProject(projectId, {}, policy);
  }

  // ---------------------------------------------------------------------------
  // OUTILS INTERNES
  // ---------------------------------------------------------------------------

  /** Les parts d'une regle, au format du calcul. */
  private toShares(
    beneficiaries: readonly {
      id: string;
      beneficiaryType: BeneficiaryType;
      percentage: Prisma.Decimal;
      userId: string | null;
    }[],
  ): ShareInput[] {
    return beneficiaries.map((beneficiary) => ({
      key: beneficiary.id,
      percentage: new Prisma.Decimal(beneficiary.percentage),
      userId: beneficiary.userId,
      beneficiaryType: beneficiary.beneficiaryType,
    }));
  }

  /**
   * Valider une saisie de beneficiaires, et verifier que les membres cites
   * sont ELIGIBLES (actifs, de l'equipe, pas des clients).
   */
  private async prepareShares(
    beneficiaries: readonly ShareInputDraft[],
    projectId: string | null,
  ): Promise<
    {
      beneficiaryType: BeneficiaryType;
      name: string;
      userId: string | null;
      percentage: Prisma.Decimal;
      order: number;
    }[]
  > {
    if (beneficiaries.length === 0) {
      throw AppException.badRequest('EMPTY_SHARE_LIST', 'Ajoutez au moins un bénéficiaire.');
    }

    const memberIds = beneficiaries
      .filter((beneficiary) => beneficiary.beneficiaryType === BeneficiaryType.MEMBER)
      .map((beneficiary) => beneficiary.userId)
      .filter((id): id is string => Boolean(id));

    if (memberIds.length > 0) {
      const eligible = await this.eligibleMembers.findMany(memberIds);
      const eligibleIds = new Set(eligible.map((user) => user.id));
      const ineligible = memberIds.filter((id) => !eligibleIds.has(id));

      if (ineligible.length > 0) {
        throw AppException.badRequest(
          'INELIGIBLE_MEMBER',
          'Un bénéficiaire n’est pas un membre actif de l’équipe. Vérifiez les comptes retenus.',
        );
      }
    }

    const prepared = beneficiaries.map((beneficiary) => ({
      beneficiaryType: beneficiary.beneficiaryType,
      name: beneficiary.name.trim(),
      userId:
        beneficiary.beneficiaryType === BeneficiaryType.MEMBER
          ? (beneficiary.userId ?? null)
          : null,
      percentage: parsePercentage(beneficiary.percentage),
      order: beneficiary.order,
    }));

    validateShares(
      prepared.map((share, index): ShareInput => ({
        key: `${index}`,
        percentage: share.percentage,
        userId: share.userId,
        beneficiaryType: share.beneficiaryType,
      })),
    );

    void projectId;

    return prepared;
  }
}
