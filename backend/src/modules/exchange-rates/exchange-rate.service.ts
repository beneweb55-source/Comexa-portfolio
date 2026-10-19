import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { AccessPolicy, SCOPE_ANY } from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';
import { Prisma, type ExchangeRate } from '../../generated/prisma/client.js';
import { CurrencyService } from '../currencies/currency.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * SERVICE DE GESTION DES TAUX DE CHANGE
 *
 * Ce service permet de:
 * - Obtenir un taux de change entre deux devises
 * - Convertir un montant d'une devise à une autre
 * - Ajouter ou mettre à jour des taux de change
 *
 * RÈGLES MÉTIER:
 * - Un taux de change doit TOUJOURS avoir une source vérifiable
 * - Aucun taux fictif n'est accepté
 * - Les taux sont historiques (valables à partir d'une date)
 * - Si aucune date n'est spécifiée, le taux le plus récent est utilisé
 */

@Injectable()
export class ExchangeRateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currencies: CurrencyService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lecture
  // ---------------------------------------------------------------------------

  /**
   * Obtenir un taux de change entre deux devises
   * @param from - Code de la devise source (3 lettres)
   * @param to - Code de la devise cible (3 lettres)
   * @param date - Date pour laquelle obtenir le taux (optionnelle, utilise aujourd'hui par défaut)
   * @returns Le taux de change (1 from = X to)
   */
  async getRate(
    from: string,
    to: string,
    date: Date | undefined,
    policy: AccessPolicy,
  ): Promise<Prisma.Decimal> {
    policy.requireScope('exchangerate', 'read', [SCOPE_ANY]);

    // Normaliser les codes
    from = from.toUpperCase();
    to = to.toUpperCase();

    // Même une conversion identité ne doit pas contourner la règle des devises
    // actives. On valide donc les deux codes avant le cas `from === to`.
    await this.currencies.validate(from, policy);
    await this.currencies.validate(to, policy);

    // Si même devise, taux = 1
    if (from === to) {
      return new Prisma.Decimal(1);
    }

    const effectiveDate = date ?? new Date();

    // Chercher le taux le plus récent avant ou à la date spécifiée
    const rate = await this.prisma.exchangeRate.findFirst({
      where: {
        fromCurrency: from,
        toCurrency: to,
        effectiveDate: {
          lte: effectiveDate,
        },
      },
      orderBy: {
        effectiveDate: 'desc',
      },
    });

    if (!rate) {
      // Essayer le taux inverse (to -> from)
      const inverseRate = await this.prisma.exchangeRate.findFirst({
        where: {
          fromCurrency: to,
          toCurrency: from,
          effectiveDate: {
            lte: effectiveDate,
          },
        },
        orderBy: {
          effectiveDate: 'desc',
        },
      });

      if (inverseRate) {
        // Taux inverse: 1/rate
        return new Prisma.Decimal(1).div(inverseRate.rate);
      }

      throw AppException.badRequest(
        'EXCHANGE_RATE_NOT_FOUND',
        `Aucun taux de change trouvé de ${from} vers ${to} à la date ${effectiveDate.toISOString().split('T')[0]}. ` +
          `Veuillez ajouter un taux manuellement avec une source vérifiable.`,
      );
    }

    // Vérifier que le taux a une source
    if (!rate.source) {
      throw AppException.internal(
        'EXCHANGE_RATE_MISSING_SOURCE',
        `Le taux ${from}→${to} n'a pas de source`,
      );
    }

    return rate.rate;
  }

  /**
   * Convertir un montant d'une devise à une autre
   * @param amount - Montant à convertir
   * @param from - Devise source
   * @param to - Devise cible
   * @param date - Date du taux (optionnelle)
   * @returns Montant converti
   */
  async convert(
    amount: Prisma.Decimal | string | number,
    from: string,
    to: string,
    date: Date | undefined,
    policy: AccessPolicy,
  ): Promise<Prisma.Decimal> {
    const decimalAmount = amount instanceof Prisma.Decimal ? amount : new Prisma.Decimal(amount);
    const rate = await this.getRate(from, to, date, policy);
    return decimalAmount.times(rate);
  }

  /**
   * Obtenir l'historique des taux entre deux devises
   */
  async getRateHistory(from: string, to: string, policy: AccessPolicy): Promise<ExchangeRate[]> {
    policy.requireScope('exchangerate', 'read', [SCOPE_ANY]);

    from = from.toUpperCase();
    to = to.toUpperCase();

    return this.prisma.exchangeRate.findMany({
      where: {
        fromCurrency: from,
        toCurrency: to,
      },
      orderBy: {
        effectiveDate: 'desc',
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Gestion (ADMIN)
  // ---------------------------------------------------------------------------

  /**
   * Ajouter ou mettre à jour un taux de change
   */
  async upsertRate(
    data: {
      fromCurrency: string;
      toCurrency: string;
      rate: Prisma.Decimal | string | number;
      effectiveDate?: Date;
      source: string;
      reference?: string;
    },
    actor: { id: string },
    policy: AccessPolicy,
  ): Promise<ExchangeRate> {
    policy.requireScope('exchangerate', 'manage', [SCOPE_ANY]);

    const normalizedFrom = data.fromCurrency.toUpperCase();
    const normalizedTo = data.toCurrency.toUpperCase();

    if (normalizedFrom === normalizedTo) {
      throw AppException.badRequest(
        'INVALID_CURRENCY_PAIR',
        'Les devises source et cible doivent être différentes',
      );
    }

    // Convertir le taux en Decimal
    const decimalRate =
      data.rate instanceof Prisma.Decimal ? data.rate : new Prisma.Decimal(data.rate);

    // Si la date n'est pas spécifiée, utiliser aujourd'hui
    const effectiveDate = data.effectiveDate ?? new Date();

    // Vérifier que le taux est positif
    if (decimalRate.lessThanOrEqualTo(0)) {
      throw AppException.badRequest('INVALID_EXCHANGE_RATE', 'Le taux de change doit être positif');
    }

    const source = data.source.trim();
    if (!source) {
      throw AppException.badRequest(
        'EXCHANGE_RATE_SOURCE_REQUIRED',
        'La source du taux de change est obligatoire',
      );
    }

    // Une devise inactive peut être activée par le premier taux vérifiable qui
    // l'utilise. Validation d'existence, activation des deux devises et taux
    // sont une seule transaction : un échec ne laisse jamais une activation
    // orpheline, et une devise inexistante n'est jamais créée implicitement.
    const { rate, activatedCurrencies } = await this.prisma.$transaction(async (tx) => {
      const fromCurrency = await tx.currency.findUnique({ where: { code: normalizedFrom } });
      const toCurrency = await tx.currency.findUnique({ where: { code: normalizedTo } });

      if (!fromCurrency) {
        throw AppException.badRequest(
          'INVALID_CURRENCY',
          `La devise ${normalizedFrom} n'existe pas`,
        );
      }
      if (!toCurrency) {
        throw AppException.badRequest('INVALID_CURRENCY', `La devise ${normalizedTo} n'existe pas`);
      }

      const activatedCurrencies: Array<{
        before: NonNullable<typeof fromCurrency>;
        after: NonNullable<typeof fromCurrency>;
      }> = [];
      for (const currency of [fromCurrency, toCurrency]) {
        if (!currency.isActive) {
          const after = await tx.currency.update({
            where: { code: currency.code },
            data: { isActive: true },
          });
          activatedCurrencies.push({ before: currency, after });
        }
      }

      const rate = await tx.exchangeRate.upsert({
        where: {
          fromCurrency_toCurrency_effectiveDate: {
            fromCurrency: normalizedFrom,
            toCurrency: normalizedTo,
            effectiveDate,
          },
        },
        create: {
          fromCurrency: normalizedFrom,
          toCurrency: normalizedTo,
          rate: decimalRate,
          effectiveDate,
          source,
          reference: data.reference,
        },
        update: {
          rate: decimalRate,
          source,
          reference: data.reference,
        },
      });

      return { rate, activatedCurrencies };
    });

    for (const currency of activatedCurrencies) {
      await this.audit.record({
        actorId: actor.id,
        action: 'currency:activate',
        entityType: 'Currency',
        entityId: currency.after.id,
        before: currency.before,
        after: currency.after,
      });
    }

    await this.audit.record({
      actorId: actor.id,
      action: 'exchangerate:upsert',
      entityType: 'ExchangeRate',
      entityId: rate.id,
      after: rate,
    });

    return rate;
  }

  /**
   * Supprimer un taux de change
   */
  async deleteRate(
    fromCurrency: string,
    toCurrency: string,
    effectiveDate: Date,
    actor: { id: string },
    policy: AccessPolicy,
  ): Promise<ExchangeRate> {
    policy.requireScope('exchangerate', 'manage', [SCOPE_ANY]);

    const normalizedFrom = fromCurrency.toUpperCase();
    const normalizedTo = toCurrency.toUpperCase();

    const rate = await this.prisma.exchangeRate.findUniqueOrThrow({
      where: {
        fromCurrency_toCurrency_effectiveDate: {
          fromCurrency: normalizedFrom,
          toCurrency: normalizedTo,
          effectiveDate,
        },
      },
    });

    const deleted = await this.prisma.exchangeRate.delete({
      where: {
        id: rate.id,
      },
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'exchangerate:delete',
      entityType: 'ExchangeRate',
      entityId: deleted.id,
      before: deleted,
    });

    return deleted;
  }
}
