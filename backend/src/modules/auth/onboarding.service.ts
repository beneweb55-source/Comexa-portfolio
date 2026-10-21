import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';
import {
  accessibleSpaces,
  effectivePermissions,
  SPACES,
} from '../../common/spaces/space-policy.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { OnboardingDto } from './dto/onboarding.dto.js';

/** Parcours accessibles : mêmes accès que le sélecteur, jamais ceux d'un rôle supposé. */
export function onboardingAreas(user: AuthenticatedUser) {
  const permissions = user.rolePermissions ?? user.permissions;
  const principal = { ...user, permissions };
  const spaces = accessibleSpaces(principal).map((id) => ({
    id: String(id),
    label: SPACES[id].label,
    description: SPACES[id].description,
    permissions: [...effectivePermissions(id, permissions)].sort(),
  }));
  // Le parcours de commande est aussi ouvert aux inscrits sans rôle avant leur première commande.
  // Les collaborateurs et les intégrations en sont exclus par le workflow OrdersService.
  if (!user.isIntegration && !user.roles.some((role) => role !== 'CLIENT')) {
    spaces.push({
      id: 'client',
      label: 'Espace client',
      description: 'Vos demandes, commandes et échanges avec COMEXA.',
      permissions: [...permissions].sort(),
    });
  }
  return spaces;
}

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthenticatedUser) {
    return this.prisma.onboardingProgress.findMany({
      where: { userId: user.id, area: { in: onboardingAreas(user).map((space) => space.id) } },
    });
  }

  async save(user: AuthenticatedUser, dto: OnboardingDto) {
    if (!onboardingAreas(user).some((space) => space.id === dto.area)) {
      throw AppException.forbidden('Ce parcours ne correspond à aucun de vos espaces accessibles.');
    }
    const ids = [...(dto.chapterIds ?? []), ...(dto.chapterId ? [dto.chapterId] : [])];
    if (
      ids.some((id) => !id.startsWith(`${dto.area}:`)) ||
      (dto.operation && dto.chapterId && !dto.chapterIds?.includes(dto.chapterId))
    ) {
      throw AppException.badRequest(
        'ONBOARDING_INVALID_CHAPTER',
        'Le chapitre ne correspond pas à ce parcours.',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      // Upsert sans changement : initialise un nouveau parcours sans écraser les autres appareils.
      const before = await tx.onboardingProgress.upsert({
        where: { userId_area: { userId: user.id, area: dto.area } },
        create: { userId: user.id, area: dto.area },
        update: {},
      });
      if (dto.revision !== undefined && before.revision !== dto.revision) {
        throw AppException.conflict(
          'ONBOARDING_CONFLICT',
          'Votre progression a changé sur un autre écran. Rechargez la page puis réessayez.',
        );
      }
      const completed = new Set(before.completedChapterIds);
      const known = new Set(before.knownChapterIds);
      for (const id of dto.chapterIds ?? []) known.add(id);
      if (dto.operation === 'complete' && dto.chapterId) completed.add(dto.chapterId);
      if (dto.operation === 'reopen' && dto.chapterId) completed.delete(dto.chapterId);
      if (dto.operation === 'restart') {
        // Recommencer uniquement les chapitres actuellement accessibles ; conserver les acquis masqués.
        for (const id of dto.chapterIds ?? []) completed.delete(id);
      }
      if (known.size > 400 || completed.size > 400) {
        throw AppException.badRequest(
          'ONBOARDING_TOO_MANY_CHAPTERS',
          'La progression contient trop de chapitres.',
        );
      }
      const visibleIds = dto.chapterIds ?? [];
      const done = visibleIds.length > 0 && visibleIds.every((id) => completed.has(id));
      let status = dto.status ?? before.status;
      if (dto.operation)
        status = done ? 'completed' : dto.operation === 'pause' ? 'paused' : 'active';
      const updated = await tx.onboardingProgress.updateMany({
        where: { userId: user.id, area: dto.area, revision: before.revision },
        data: {
          step: dto.step ?? before.step,
          status,
          completedChapterIds: [...completed],
          knownChapterIds: [...known],
          currentChapterId: dto.chapterId ?? before.currentChapterId,
          curriculumVersion: dto.operation ? 2 : before.curriculumVersion,
          revision: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw AppException.conflict(
          'ONBOARDING_CONFLICT',
          'Progression modifiée simultanément. Rechargez la page.',
        );
      }
      return tx.onboardingProgress.findUniqueOrThrow({
        where: { userId_area: { userId: user.id, area: dto.area } },
      });
    });
  }
}
