import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AccessPolicy } from '../../common/auth/principal.js';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { ExchangeRateService } from './exchange-rate.service.js';

function policy(): AccessPolicy {
  const user: AuthenticatedUser = {
    id: 'admin-1',
    email: 'admin@example.test',
    firstName: 'Admin',
    lastName: 'Test',
    roles: ['ADMIN'],
    permissions: new Set(['exchangerate:manage:any']),
    clientId: null,
    mustChangePassword: false,
  };
  return new AccessPolicy(user);
}

describe('ExchangeRateService', () => {
  it('active les devises inactives avec le taux et trace chaque activation', async () => {
    const currencies = [
      { id: 'currency-eur', code: 'EUR', isActive: false },
      { id: 'currency-usd', code: 'USD', isActive: false },
    ];
    const updates: string[] = [];
    const tx = {
      currency: {
        findUnique: async ({ where }: { where: { code: string } }) =>
          currencies.find((currency) => currency.code === where.code) ?? null,
        update: async ({ where }: { where: { code: string } }) => {
          updates.push(where.code);
          return {
            ...currencies.find((currency) => currency.code === where.code)!,
            isActive: true,
          };
        },
      },
      exchangeRate: {
        upsert: async () => ({
          id: 'rate-1',
          fromCurrency: 'EUR',
          toCurrency: 'USD',
          rate: new Prisma.Decimal('1.08'),
          effectiveDate: new Date('2026-10-19T00:00:00.000Z'),
          source: 'Banque de référence',
          reference: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
    };
    const prisma = {
      $transaction: async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
    } as unknown as PrismaService;
    const auditEntries: Array<{ action: string; entityId?: string | null }> = [];
    const audit = {
      record: async (entry: { action: string; entityId?: string | null }) => {
        auditEntries.push(entry);
      },
    };
    const service = new ExchangeRateService(prisma, {} as never, audit as never);

    const result = await service.upsertRate(
      {
        fromCurrency: 'eur',
        toCurrency: 'usd',
        rate: '1.08',
        effectiveDate: new Date('2026-10-19T00:00:00.000Z'),
        source: ' Banque de référence ',
      },
      { id: 'admin-1' },
      policy(),
    );

    assert.equal(result.id, 'rate-1');
    assert.deepEqual(updates, ['EUR', 'USD']);
    assert.deepEqual(
      auditEntries.map(({ action, entityId }) => ({ action, entityId })),
      [
        { action: 'currency:activate', entityId: 'currency-eur' },
        { action: 'currency:activate', entityId: 'currency-usd' },
        { action: 'exchangerate:upsert', entityId: 'rate-1' },
      ],
    );
  });

  it('refuse une paire identique avant toute écriture', async () => {
    let transactionStarted = false;
    const prisma = {
      $transaction: async () => {
        transactionStarted = true;
        throw new Error('La transaction ne doit pas démarrer');
      },
    } as unknown as PrismaService;
    const service = new ExchangeRateService(
      prisma,
      {} as never,
      { record: async () => {} } as never,
    );

    await assert.rejects(
      service.upsertRate(
        {
          fromCurrency: 'DZD',
          toCurrency: 'dzd',
          rate: '1',
          source: 'Banque de référence',
        },
        { id: 'admin-1' },
        policy(),
      ),
      (error: { code?: string }) => error.code === 'INVALID_CURRENCY_PAIR',
    );
    assert.equal(transactionStarted, false);
  });
});
