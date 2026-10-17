import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { AccessPolicy, SCOPE_ANY } from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * SERVICE DE GESTION DES DEVISES
 *
 * Ce service permet de:
 * - Lister les devises disponibles
 * - Obtenir une devise par son code
 * - Valider qu'une devise existe et est active
 * - Créer de nouvelles devises (ADMIN uniquement)
 *
 * RÈGLES MÉTIER:
 * - Le code de devise doit être en majuscules (ISO 4217)
 * - Une seule devise peut être marquée comme isDefault
 * - Les devises inactives ne peuvent pas être utilisées
 */

@Injectable()
export class CurrencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lecture
  // ---------------------------------------------------------------------------

  /**
   * Obtenir toutes les devises actives
   */
  async getAllActive(policy: AccessPolicy): Promise<Prisma.Currency[]> {
    policy.requireScope('currency', 'read', [SCOPE_ANY]);

    return this.prisma.currency.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  /**
   * Obtenir toutes les devises (y compris inactives)
   */
  async getAll(policy: AccessPolicy): Promise<Prisma.Currency[]> {
    policy.requireScope('currency', 'read', [SCOPE_ANY]);

    return this.prisma.currency.findMany({
      orderBy: { code: 'asc' },
    });
  }

  /**
   * Obtenir une devise par son code
   */
  async getByCode(code: string, policy: AccessPolicy): Promise<Prisma.Currency | null> {
    policy.requireScope('currency', 'read', [SCOPE_ANY]);

    const normalizedCode = code.toUpperCase();
    return this.prisma.currency.findUnique({
      where: { code: normalizedCode },
    });
  }

  /**
   * Obtenir la devise par défaut
   */
  async getDefault(policy: AccessPolicy): Promise<Prisma.Currency> {
    policy.requireScope('currency', 'read', [SCOPE_ANY]);

    const defaultCurrency = await this.prisma.currency.findFirst({
      where: { isDefault: true, isActive: true },
    });

    // Si aucune devise par défaut n'est définie, retourner DZD
    if (!defaultCurrency) {
      const dz = await this.prisma.currency.findUnique({
        where: { code: 'DZD' },
      });
      if (dz) return dz;

      // Si DZD n'existe pas, retourner la première devise active
      const firstActive = await this.prisma.currency.findFirst({
        where: { isActive: true },
        orderBy: { code: 'asc' },
      });
      return firstActive;
    }

    return defaultCurrency;
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  /**
   * Valider qu'une devise existe et est active
   * @throws AppException si la devise est invalide
   */
  async validate(code: string, policy: AccessPolicy): Promise<Prisma.Currency> {
    const currency = await this.getByCode(code, policy);

    if (!currency) {
      throw AppException.badRequest(
        'INVALID_CURRENCY',
        `La devise ${code} n'est pas valide. Codes valides: DZD, EUR, USD`,
      );
    }

    if (!currency.isActive) {
      throw AppException.badRequest(
        'INACTIVE_CURRENCY',
        `La devise ${code} n'est pas active`,
      );
    }

    return currency;
  }

  /**
   * Valider plusieurs devises
   */
  async validateMultiple(codes: string[], policy: AccessPolicy): Promise<Prisma.Currency[]> {
    return Promise.all(codes.map(code => this.validate(code, policy)));
  }

  // ---------------------------------------------------------------------------
  // Gestion (ADMIN)
  // ---------------------------------------------------------------------------

  /**
   * Créer une nouvelle devise
   */
  async create(
    data: {
      code: string;
      name: string;
      symbol: string;
      isDefault?: boolean;
    },
    actor: { id: string },
    policy: AccessPolicy,
  ): Promise<Prisma.Currency> {
    policy.requireScope('currency', 'manage', [SCOPE_ANY]);

    const normalizedCode = data.code.toUpperCase();

    // Vérifier que le code est valide (3 lettres)
    if (!/^[A-Z]{3}$/.test(normalizedCode)) {
      throw AppException.badRequest(
        'INVALID_CURRENCY_CODE',
        'Le code de devise doit être composé de 3 lettres majuscules (ISO 4217)',
      );
    }

    // Vérifier que la devise n'existe pas déjà
    const existing = await this.prisma.currency.findUnique({
      where: { code: normalizedCode },
    });

    if (existing) {
      throw AppException.conflict(
        'CURRENCY_ALREADY_EXISTS',
        `La devise ${normalizedCode} existe déjà`,
      );
    }

    // Si isDefault = true, désactiver l'ancienne devise par défaut
    if (data.isDefault) {
      await this.prisma.currency.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const currency = await this.prisma.currency.create({
      data: {
        code: normalizedCode,
        name: data.name,
        symbol: data.symbol,
        isDefault: data.isDefault ?? false,
        isActive: true,
      },
    });

    await this.audit.log({
      actorId: actor.id,
      action: 'currency:create',
      entityType: 'Currency',
      entityId: currency.id,
      after: currency,
    });

    return currency;
  }

  /**
   * Mettre à jour une devise
   */
  async update(
    id: string,
    data: {
      name?: string;
      symbol?: string;
      isActive?: boolean;
      isDefault?: boolean;
    },
    actor: { id: string },
    policy: AccessPolicy,
  ): Promise<Prisma.Currency> {
    policy.requireScope('currency', 'manage', [SCOPE_ANY]);

    const existing = await this.prisma.currency.findUniqueOrThrow({
      where: { id },
    });

    // Si isDefault = true, désactiver l'ancienne devise par défaut
    if (data.isDefault && !existing.isDefault) {
      await this.prisma.currency.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    const currency = await this.prisma.currency.update({
      where: { id },
      data: {
        name: data.name,
        symbol: data.symbol,
        isActive: data.isActive,
        isDefault: data.isDefault,
      },
    });

    await this.audit.log({
      actorId: actor.id,
      action: 'currency:update',
      entityType: 'Currency',
      entityId: currency.id,
      before: existing,
      after: currency,
    });

    return currency;
  }

  /**
   * Supprimer une devise (la désactiver, pas la supprimer physiquement)
   */
  async deactivate(id: string, actor: { id: string }, policy: AccessPolicy): Promise<Prisma.Currency> {
    policy.requireScope('currency', 'manage', [SCOPE_ANY]);

    // Ne pas permettre la désactivation de la devise par défaut
    const currency = await this.prisma.currency.findUniqueOrThrow({
      where: { id },
    });

    if (currency.isDefault) {
      throw AppException.badRequest(
        'CANNOT_DEACTIVATE_DEFAULT',
        'Ne peut pas désactiver la devise par défaut. Changez la devise par défaut avant.',
      );
    }

    const updated = await this.prisma.currency.update({
      where: { id },
      data: { isActive: false, isDefault: false },
    });

    await this.audit.log({
      actorId: actor.id,
      action: 'currency:deactivate',
      entityType: 'Currency',
      entityId: updated.id,
      before: currency,
      after: updated,
    });

    return updated;
  }
}
