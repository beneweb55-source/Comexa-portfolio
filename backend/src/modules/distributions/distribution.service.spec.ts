import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AuditService } from '../../common/audit/audit.service.js';
import { AccessPolicy } from '../../common/auth/principal.js';
import { Prisma } from '../../generated/prisma/client.js';
import { DistributionStatus } from '../../generated/prisma/enums.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { BalanceService } from '../balances/balance.service.js';
import { DistributionService } from './distribution.service.js';

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

function service(prisma: object) {
  return new DistributionService(
    prisma as PrismaService,
    { record: async () => {} } as unknown as AuditService,
    {} as BalanceService,
  );
}

describe('DistributionService — generated Prisma schema', () => {
  it('calculates rounded shares and writes a JSON-safe audit inside the transaction', async () => {
    const beneficiaries = [
      { id: 'a', percentage: new Prisma.Decimal('33.33') },
      { id: 'b', percentage: new Prisma.Decimal('33.33') },
      { id: 'c', percentage: new Prisma.Decimal('33.34') },
    ];
    let audited = false;
    const result = await service({
      project: {
        findUniqueOrThrow: async (query: Prisma.ProjectFindUniqueOrThrowArgs) => {
          const distributions = query.include?.distributions;
          assert.ok(distributions && typeof distributions === 'object');
          assert.equal('deletedAt' in (distributions.where ?? {}), false);
          return {
            id: 'project',
            currency: 'DZD',
            invoices: [{ amountPaid: new Prisma.Decimal('0.05') }],
            distributions: [],
          };
        },
      },
      distributionConfig: {
        findFirst: async () => ({ id: 'config', beneficiaries }),
      },
      projectDistribution: {
        findFirst: async (query: Prisma.ProjectDistributionFindFirstArgs) => {
          assert.equal('deletedAt' in (query.where ?? {}), false);
          return null;
        },
      },
      $transaction: async (run: (tx: object) => Promise<unknown>) =>
        run({
          projectDistribution: {
            create: async (query: Prisma.ProjectDistributionCreateArgs) => {
              const items = query.data.items?.create;
              assert.ok(Array.isArray(items));
              assert.deepEqual(
                items.map((item) => String(item.calculatedAmount)),
                ['0.02', '0.02', '0.01'],
              );
              return {
                id: 'distribution',
                baseAmount: query.data.baseAmount,
                createdAt: new Date('2026-10-18T00:00:00Z'),
              };
            },
          },
          auditLog: {
            create: async (query: Prisma.AuditLogCreateArgs) => {
              assert.equal(query.data.actorId, 'admin');
              assert.equal(query.data.action, 'distribution:calculate');
              assert.deepEqual(query.data.after, {
                id: 'distribution',
                baseAmount: '0.05',
                createdAt: '2026-10-18T00:00:00.000Z',
              });
              audited = true;
            },
          },
        }),
    }).calculateForProject('project', undefined, policy);
    assert.equal(result.id, 'distribution');
    assert.equal(audited, true);
  });

  it('cancels through status without writing a nonexistent deletedAt field', async () => {
    const result = await service({
      projectDistribution: {
        findUniqueOrThrow: async () => ({
          id: 'distribution',
          status: DistributionStatus.CALCULATED,
        }),
        update: async (query: Prisma.ProjectDistributionUpdateArgs) => {
          assert.deepEqual(query.data, { status: DistributionStatus.CANCELLED });
          return { id: 'distribution', ...query.data };
        },
      },
    }).cancelDistribution('distribution', { id: 'admin' }, policy);
    assert.equal(result.status, DistributionStatus.CANCELLED);
  });

  it('excludes cancelled distributions when listing a project', async () => {
    await service({
      projectDistribution: {
        findMany: async (query: Prisma.ProjectDistributionFindManyArgs) => {
          assert.deepEqual(query.where, {
            projectId: 'project',
            status: { not: DistributionStatus.CANCELLED },
          });
          return [];
        },
      },
    }).getProjectDistributions('project', policy);
  });
});
