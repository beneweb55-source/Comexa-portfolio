import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreatePackageRateDto } from './dto/package-rate.dto.js';

/**
 * TARIFS PAR PACK ET PAR DEVISE.
 *
 * Un tarif n'est jamais reecrit : changer un prix cree une ligne avec une date
 * d'effet, et les commandes deja passees gardent le montant qu'elles ont figé.
 * Retirer un tarif le desactive, il ne le supprime pas.
 */
@Injectable()
export class PackageRatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(packageId: string) {
    await this.assertPackage(packageId);
    return this.prisma.packageRate.findMany({
      where: { packageId },
      orderBy: [{ currency: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }

  async create(packageId: string, dto: CreatePackageRateDto, actor: AuthenticatedUser) {
    await this.assertPackage(packageId);

    const rate = await this.prisma.packageRate.create({
      data: {
        packageId,
        currency: dto.currency,
        amount: dto.amount,
        effectiveFrom: dto.effectiveFrom,
        createdById: actor.id,
      },
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'PACKAGE_RATE_CREATED',
      entityType: 'PackageRate',
      entityId: rate.id,
      after: {
        packageId,
        currency: rate.currency,
        amount: rate.amount.toFixed(2),
        effectiveFrom: rate.effectiveFrom.toISOString(),
      },
    });

    return rate;
  }

  async deactivate(packageId: string, rateId: string, actor: AuthenticatedUser) {
    const rate = await this.prisma.packageRate.findFirst({
      where: { id: rateId, packageId },
      select: { id: true, isActive: true },
    });
    if (!rate) {
      throw AppException.notFound('RATE_NOT_FOUND', "Ce tarif n'existe pas pour ce pack.");
    }

    const updated = await this.prisma.packageRate.update({
      where: { id: rateId },
      data: { isActive: false },
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'PACKAGE_RATE_DEACTIVATED',
      entityType: 'PackageRate',
      entityId: rateId,
      before: { isActive: rate.isActive },
      after: { isActive: false },
    });

    return updated;
  }

  private async assertPackage(packageId: string): Promise<void> {
    const pack = await this.prisma.package.findFirst({
      where: { id: packageId, deletedAt: null },
      select: { id: true },
    });
    if (!pack) {
      throw AppException.notFound('PACKAGE_NOT_FOUND', "Ce pack n'existe pas.");
    }
  }
}
