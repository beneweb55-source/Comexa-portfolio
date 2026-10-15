import { Injectable } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import { AppException } from '../../common/errors/app-error.js';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { UserStatus } from '../../generated/prisma/enums.js';
import type { RequestContext } from '../projects/request-meta.decorator.js';

const BOT_USERNAME = 'ComexaWork_bot';
const PAIRING_CODE_TTL_MINUTES = 10;

/** Nom de la permission que doit posséder une intégration n8n pour lier/résoudre. */
const TELEGRAM_LINK_SCOPE = 'telegram:link:any';

/** Empreinte hex SHA-256 du code d'appairage. */
function hashPairingCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

/** Génère un code à 6 chiffres (000000..999999). */
function generatePairingCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export interface TelegramLinkView {
  linked: boolean;
  telegramUsername: string | null;
  telegramUserId: string | null;
  pairedAt: Date | null;
  pairingExpiresAt: Date | null;
}

export interface TelegramCodeView {
  code: string;
  expiresAt: Date;
  botUsername: string;
}

export interface TelegramLinkedProfile {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  roles: string[];
  permissions: string[];
  telegramChatId: string | null;
}

@Injectable()
export class TelegramLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Routes pour le membre connecté (JWT humain)
  // ---------------------------------------------------------------------------

  /** État de liaison du membre courant. */
  async getState(actor: AuthenticatedUser): Promise<TelegramLinkView> {
    const link = await this.prisma.telegramLink.findUnique({
      where: { userId: actor.id },
      select: {
        telegramUserId: true,
        telegramUsername: true,
        pairedAt: true,
        pairingExpiresAt: true,
        revokedAt: true,
      },
    });

    if (!link) {
      return {
        linked: false,
        telegramUsername: null,
        telegramUserId: null,
        pairedAt: null,
        pairingExpiresAt: null,
      };
    }

    // Une liaison révoquée n'est plus « linkée ».
    const linked = Boolean(link.telegramUserId && link.pairedAt && !link.revokedAt);

    return {
      linked,
      telegramUsername: linked ? link.telegramUsername : null,
      telegramUserId: linked ? link.telegramUserId : null,
      pairedAt: linked ? link.pairedAt : null,
      pairingExpiresAt: link.pairingExpiresAt,
    };
  }

  /** Génère un nouveau code d'appairage ( invalide le précédent s'il existe). */
  async createCode(actor: AuthenticatedUser): Promise<TelegramCodeView> {
    const code = generatePairingCode();
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MINUTES * 60 * 1000);
    const pairingCodeHash = hashPairingCode(code);

    await this.prisma.telegramLink.upsert({
      where: { userId: actor.id },
      create: {
        userId: actor.id,
        pairingCodeHash,
        pairingExpiresAt: expiresAt,
      },
      update: {
        pairingCodeHash,
        pairingExpiresAt: expiresAt,
        // En générant un nouveau code, on ne révoque pas une liaison existante :
        // le membre pourrait vouloir changer d'appareil Telegram.
      },
    });

    return { code, expiresAt, botUsername: BOT_USERNAME };
  }

  /** Révoque la liaison Telegram du membre (DELETE /me/telegram-link). */
  async revokeForSelf(actor: AuthenticatedUser, meta: RequestContext): Promise<{ unlinked: true }> {
    const link = await this.prisma.telegramLink.findUnique({ where: { userId: actor.id } });
    if (!link) return { unlinked: true };

    await this.prisma.telegramLink.update({
      where: { userId: actor.id },
      data: {
        revokedAt: new Date(),
        telegramUserId: null,
        telegramChatId: null,
        pairingCodeHash: null,
        pairingExpiresAt: null,
      },
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'TELEGRAM_LINK_REVOKED',
      entityType: 'TelegramLink',
      entityId: link.id,
      before: { telegramUserId: link.telegramUserId, telegramUsername: link.telegramUsername },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { unlinked: true };
  }

  // ---------------------------------------------------------------------------
  // Routes pour l'intégration n8n (jeton cxi_ avec scope telegram:link:any)
  // ---------------------------------------------------------------------------

  /**
   * Vérifie le code et lie le compte Comexa au compte Telegram.
   *
   * Appelé par le bot @ComexaWork_bot (workflow n8n) quand un membre tape
   * `/lier <code>` dans Telegram.
   */
  async verifyCode(
    body: { code: string; telegramUserId: string; telegramChatId: string; telegramUsername?: string },
    actor: AuthenticatedUser,
    meta: RequestContext,
  ): Promise<TelegramLinkedProfile> {
    this.assertTelegramScope(actor);

    const code = (body.code ?? '').trim();
    if (!/^\d{6}$/.test(code)) {
      throw AppException.unprocessable('TELEGRAM_CODE_INVALID', 'Le code doit comporter exactement 6 chiffres.');
    }

    const telegramUserId = (body.telegramUserId ?? '').toString().trim();
    const telegramChatId = (body.telegramChatId ?? '').toString().trim();
    if (!telegramUserId || !telegramChatId) {
      throw AppException.unprocessable(
        'TELEGRAM_DATA_MISSING',
        'telegramUserId et telegramChatId sont obligatoires.',
      );
    }

    const telegramUsername = typeof body.telegramUsername === 'string'
      ? body.telegramUsername.replace(/^@/, '').trim() || null
      : null;

    const pairingCodeHash = hashPairingCode(code);
    const now = new Date();

    // Vérifie qu'un lien non révoqué, non expiré correspond à ce hash.
    const link = await this.prisma.telegramLink.findFirst({
      where: {
        pairingCodeHash,
        pairingExpiresAt: { not: null, gt: now },
        revokedAt: null,
      },
      select: { id: true, userId: true },
    });

    if (!link) {
      throw AppException.notFound('TELEGRAM_CODE_INVALID', 'Code invalide ou expiré.');
    }

    // Vérifie que le telegramUserId n'est pas déjà lié à un AUTRE compte.
    const existing = await this.prisma.telegramLink.findFirst({
      where: { telegramUserId, NOT: { userId: link.userId } },
      select: { id: true },
    });
    if (existing) {
      throw AppException.conflict(
        'TELEGRAM_ALREADY_LINKED',
        'Ce compte Telegram est déjà lié à un autre profil Comexa.',
      );
    }

    // Charge l'utilisateur avec ses permissions.
    const profile = await this.loadLinkedUser(link.userId);

    const pairedAt = new Date();
    await this.prisma.telegramLink.update({
      where: { id: link.id },
      data: {
        telegramUserId,
        telegramChatId,
        telegramUsername,
        pairedAt,
        pairingCodeHash: null,
        pairingExpiresAt: null,
        revokedAt: null,
      },
    });

    await this.audit.record({
      actorId: link.userId,
      action: 'TELEGRAM_LINK_CREATED',
      entityType: 'TelegramLink',
      entityId: link.id,
      after: { telegramUserId, telegramUsername },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { ...profile, telegramChatId };
  }

  /**
   * Résout un telegramUserId en profil Comexa (utilisé par le bot à chaque message).
   */
  async resolve(telegramUserId: string, actor: AuthenticatedUser): Promise<TelegramLinkedProfile> {
    this.assertTelegramScope(actor);

    const id = (telegramUserId ?? '').toString().trim();
    if (!id) {
      throw AppException.unprocessable('TELEGRAM_USER_ID_REQUIRED', 'telegramUserId est obligatoire.');
    }

    const link = await this.prisma.telegramLink.findUnique({
      where: { telegramUserId: id },
      select: {
        userId: true,
        telegramChatId: true,
        revokedAt: true,
      },
    });

    if (!link || link.revokedAt) {
      throw AppException.notFound('TELEGRAM_LINK_NOT_FOUND', 'Aucun compte Comexa lié à cet utilisateur Telegram.');
    }

    const profile = await this.loadLinkedUser(link.userId);
    return { ...profile, telegramChatId: link.telegramChatId };
  }

  // ---------------------------------------------------------------------------
  // Internes
  // ---------------------------------------------------------------------------

  private assertTelegramScope(actor: AuthenticatedUser): void {
    if (!actor.permissions.has(TELEGRAM_LINK_SCOPE)) {
      throw AppException.forbidden(`Droit insuffisant : ${TELEGRAM_LINK_SCOPE}`);
    }
  }

  /**
   * Charge un utilisateur lié avec ses rôles/permissions, en refusant comptes
   * suspendus/supprimés/comptes de service.
   */
  private async loadLinkedUser(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        isServiceAccount: true,
        roles: {
          select: {
            role: {
              select: {
                code: true,
                permissions: { select: { permission: { select: { code: true } } } },
              },
            },
          },
        },
      },
    });

    if (!user || user.isServiceAccount || user.status !== UserStatus.ACTIVE) {
      throw AppException.unauthenticated(
        'TELEGRAM_LINK_UNUSABLE',
        "Ce compte Comexa n'est plus actif.",
      );
    }

    const roles: string[] = [];
    const permissions = new Set<string>();
    for (const userRole of user.roles) {
      roles.push(userRole.role.code);
      for (const rp of userRole.role.permissions) {
        permissions.add(rp.permission.code);
      }
    }

    return {
      userId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      roles: roles.sort(),
      permissions: [...permissions].sort(),
    };
  }
}
