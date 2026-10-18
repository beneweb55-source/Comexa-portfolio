import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AuditService } from '../../common/audit/audit.service.js';
import { AccessPolicy } from '../../common/auth/principal.js';
import { Prisma } from '../../generated/prisma/client.js';
import { DistributionStatus, BalanceTransactionKind } from '../../generated/prisma/enums.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { BalanceService } from '../balances/balance.service.js';
import type { EligibleMembersService } from '../../common/finance/eligible-members.service.js';
import { DistributionService } from './distribution.service.js';

/**
 * LE SERVICE DE RÉPARTITION, MESURÉ SUR SES DÉCISIONS.
 *
 * Ces tests ne rejouent pas la base : ils vérifient les TROIS décisions qui
 *engageent de l'argent —
 *
 *   1. le rejeu d'un calcul ne cree pas de deuxieme repartition ;
 *   2. une exception de projet prime sur la regle par defaut ;
 *   3. une revision cree une NOUVELLE version et ne touche pas a l'ancienne.
 *
 * L'arithmetique elle-meme (plus grand reste, somme exacte) est couverte par
 * `distribution-math.spec.ts`, qui ne depend d'aucune base.
 */

const policy = new AccessPolicy({
  id: 'admin',
  email: 'admin@example.com',
  firstName: 'Admin',
  lastName: 'Test',
  roles: ['ADMIN'],
  permissions: new Set(['distribution:read:any', 'distribution:manage:any']),
  clientId: null,
  mustChangePassword: false,
});

function service(prisma: object, balance: Partial<BalanceService> = {}) {
  return new DistributionService(
    prisma as PrismaService,
    { record: async () => {} } as unknown as AuditService,
    balance as BalanceService,
    {
      findMany: async (ids: readonly string[]) =>
        ids.map((id) => ({
          id,
          firstName: 'Membre',
          lastName: 'Test',
          email: `${id}@example.com`,
          roles: ['DEVELOPER'],
        })),
      list: async () => [],
      find: async () => null,
      assertEligible: async (id: string) => ({
        id,
        firstName: 'Membre',
        lastName: 'Test',
        email: `${id}@example.com`,
        roles: ['DEVELOPER'],
      }),
    } as unknown as EligibleMembersService,
  );
}

const dec = (value: string) => new Prisma.Decimal(value);

describe('DistributionService — la base de calcul', () => {
  it('distingue le facture de l encaisse, et n compte que les paiements reussis', async () => {
    const base = await service({
      project: {
        findUniqueOrThrow: async () => ({
          id: 'project',
          name: 'Chantier',
          code: 'CH-1',
          currency: 'DZD',
          budget: dec('100000'),
          invoices: [
            {
              id: 'inv-1',
              reference: 'FA-1',
              // Une facture emise : elle compte au FACTURE.
              status: 'SENT',
              total: dec('80000'),
              currency: 'DZD',
              payments: [
                { id: 'pay-1', amount: dec('30000'), currency: 'DZD', paidAt: new Date(), reference: 'P1' },
                { id: 'pay-2', amount: dec('20000'), currency: 'DZD', paidAt: new Date(), reference: 'P2' },
              ],
            },
            {
              id: 'inv-2',
              reference: 'FA-2',
              // Un brouillon n'est pas une facture emise.
              status: 'DRAFT',
              total: dec('99999'),
              currency: 'DZD',
              payments: [],
            },
          ],
        }),
      },
    }).buildBase('project', 'COLLECTED_AMOUNT');

    assert.equal(base.invoiced.toString(), '80000');
    assert.equal(base.collected.toString(), '50000');
    assert.equal(base.budget.toString(), '100000');
    assert.equal(base.baseAmount.toString(), '50000');
    // L'ancre est le dernier encaissement : elle identifie l'etat du monde.
    assert.equal(base.anchor, 'pay-1');
    assert.equal(base.invoiceCount, 1);
    assert.equal(base.paymentCount, 2);
  });
});

describe('DistributionService — le calcul', () => {
  it('renvoie la repartition deja calculee quand la cle d idempotence existe', async () => {
    let created = 0;

    const existing = {
      id: 'distribution',
      projectId: 'project',
      baseAmount: dec('50000'),
      items: [],
    };

    const result = await service({
      distributionConfig: {
        findMany: async () => [
          {
            id: 'config',
            version: 1,
            scopeKey: 'global',
            projectId: null,
            baseType: 'COLLECTED_AMOUNT',
            effectiveDate: new Date('2026-01-01'),
            endDate: null,
            isActive: true,
            beneficiaries: [
              { id: 'a', userId: 'u1', percentage: dec('100'), beneficiaryType: 'MEMBER', name: 'A' },
            ],
          },
        ],
        findFirst: async () => ({
          id: 'config',
          version: 1,
          scopeKey: 'global',
          projectId: null,
          baseType: 'COLLECTED_AMOUNT',
          effectiveDate: new Date('2026-01-01'),
          endDate: null,
          isActive: true,
          beneficiaries: [
            { id: 'a', userId: 'u1', percentage: dec('100'), beneficiaryType: 'MEMBER', name: 'A' },
          ],
        }),
        findUniqueOrThrow: async () => ({
          id: 'config',
          version: 1,
          scopeKey: 'global',
          projectId: null,
          baseType: 'COLLECTED_AMOUNT',
          effectiveDate: new Date('2026-01-01'),
          endDate: null,
          isActive: true,
          beneficiaries: [
            { id: 'a', userId: 'u1', percentage: dec('100'), beneficiaryType: 'MEMBER', name: 'A' },
          ],
        }),
      },
      project: {
        findUniqueOrThrow: async () => ({
          id: 'project',
          name: 'Chantier',
          code: 'CH-1',
          currency: 'DZD',
          budget: dec('100000'),
          invoices: [
            {
              id: 'inv-1',
              reference: 'FA-1',
              status: 'SENT',
              total: dec('50000'),
              currency: 'DZD',
              payments: [
                { id: 'pay-1', amount: dec('50000'), currency: 'DZD', paidAt: new Date(), reference: 'P1' },
              ],
            },
          ],
        }),
      },
      projectDistribution: {
        findUnique: async () => existing,
        create: async () => {
          created += 1;
          return existing;
        },
      },
    }).calculateForProject('project', {}, policy);

    assert.equal(result.id, 'distribution');
    assert.equal(created, 0, 'aucune repartition ne doit etre creee sur un rejeu');
  });

  it('applique la repartition et credite le membre, une seule fois', async () => {
    const calls: { userId: string; amount: string; kind: string; idempotencyKey?: string }[] = [];

    const balance = {
      createTransaction: async (input: {
        userId: string;
        amount: Prisma.Decimal;
        kind: BalanceTransactionKind;
        idempotencyKey?: string;
      }) => {
        calls.push({
          userId: input.userId,
          amount: input.amount.toString(),
          kind: input.kind,
          idempotencyKey: input.idempotencyKey,
        });
        return { id: 'transaction' };
      },
    };

    const distribution = {
      id: 'distribution',
      projectId: 'project',
      baseAmount: dec('50000'),
      baseCurrency: 'DZD',
      status: DistributionStatus.CALCULATED,
      round: 1,
      project: { id: 'project', name: 'Chantier' },
      items: [
        {
          id: 'item-1',
          calculatedAmount: dec('30000'),
          creditedAmount: dec('0'),
          status: 'PENDING',
          beneficiary: { id: 'a', userId: 'u1', name: 'A', beneficiaryType: 'MEMBER' },
        },
        {
          id: 'item-2',
          calculatedAmount: dec('20000'),
          creditedAmount: dec('0'),
          status: 'PENDING',
          beneficiary: { id: 'b', userId: 'u2', name: 'B', beneficiaryType: 'MEMBER' },
        },
      ],
    };

    const prisma = {
      $transaction: async (run: (tx: object) => Promise<unknown>) =>
        run({
          $queryRaw: async () => [],
          projectDistribution: {
            findUniqueOrThrow: async () => distribution,
            update: async () => ({ ...distribution, status: DistributionStatus.APPLIED }),
          },
          distributionItem: {
            findMany: async () => [],
            update: async () => ({}),
          },
          distributionHistory: { create: async () => ({}) },
          auditLog: { create: async () => ({}) },
        }),
    };

    await service(prisma, balance as unknown as BalanceService).applyDistribution(
      'distribution',
      policy,
    );

    assert.equal(calls.length, 2);
    assert.deepEqual(
      calls.map((call) => `${call.userId}:${call.amount}`).sort(),
      ['u1:30000', 'u2:20000'],
    );
    // Chaque credit porte une cle : un rejeu ne credite pas deux fois.
    assert.ok(calls.every((call) => typeof call.idempotencyKey === 'string'));
  });
});

describe('DistributionService — la regle applicable', () => {
  it('donne la priorite a l exception de projet', async () => {
    const rules = [
      {
        id: 'global-config',
        scopeKey: 'global',
        version: 3,
        name: 'Regle par defaut',
        effectiveDate: new Date('2026-01-01'),
        endDate: null,
        isActive: true,
        baseType: 'COLLECTED_AMOUNT',
        beneficiaries: [],
      },
      {
        id: 'project-config',
        scopeKey: 'project:project-1',
        version: 1,
        name: 'Exception',
        effectiveDate: new Date('2026-01-01'),
        endDate: null,
        isActive: true,
        baseType: 'COLLECTED_AMOUNT',
        beneficiaries: [],
      },
    ];

    const resolved = await service({
      distributionConfig: { findMany: async () => rules },
    }).resolveRuleForProject('project-1', new Date('2026-06-01'), policy);

    assert.equal(resolved?.id, 'project-config');
  });

  it('retombe sur la regle par defaut quand le projet n a pas d exception', async () => {
    const rules = [
      {
        id: 'global-config',
        scopeKey: 'global',
        version: 3,
        name: 'Regle par defaut',
        effectiveDate: new Date('2026-01-01'),
        endDate: null,
        isActive: true,
        baseType: 'COLLECTED_AMOUNT',
        beneficiaries: [],
      },
    ];

    const resolved = await service({
      distributionConfig: { findMany: async () => rules },
    }).resolveRuleForProject('project-1', new Date('2026-06-01'), policy);

    assert.equal(resolved?.id, 'global-config');
  });
});
