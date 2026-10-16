import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import { AppException } from '../../common/errors/app-error.js';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { UserStatus } from '../../generated/prisma/enums.js';
import type { RequestContext } from '../projects/request-meta.decorator.js';
import {
  PAIRING_CODE_TTL_MINUTES,
  SUCCESS_OUTCOMES,
  TELEGRAM_BOT_USERNAME,
  isGroupChat,
  normalizePairingCode,
  normalizeTelegramId,
  outcomeForErrorCode,
  parseTelegramMessage,
  telegramReply,
  type TelegramLinkOutcome,
} from './telegram-command.js';

const BOT_USERNAME = TELEGRAM_BOT_USERNAME;

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

/** Violation de contrainte d'unicité Prisma (P2002). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
  );
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

/**
 * Resultat d'une liaison REUSSIE.
 *
 * `linkStatus` precise ce qui s'est passe, sans changer le contrat existant
 * (les champs du profil restent a la racine) :
 *  - `linked`    : premiere liaison (ou nouvelle liaison apres une revocation) ;
 *  - `relinked`  : le compte Comexa etait lie a UN AUTRE compte Telegram, qui
 *                  est remplace (changement d'appareil, voulu par le membre) ;
 *  - `refreshed` : le meme compte Telegram etait deja lie, la liaison est
 *                  simplement reconfirmee (chat et pseudo mis a jour).
 */
export interface TelegramVerifyResult extends TelegramLinkedProfile {
  linkStatus: 'linked' | 'relinked' | 'refreshed';
  previousTelegramUsername: string | null;
}

/** Reponse de `POST /integrations/telegram/command`, lue par le workflow n8n. */
export interface TelegramCommandResult {
  /** `false` : le message n'est pas une commande Comexa, il revient a l'agent. */
  handled: boolean;
  command: 'lier' | null;
  /** Issue detaillee, `null` quand le message n'est pas traite. */
  status: TelegramLinkOutcome | null;
  /** VRAI uniquement si la liaison est reellement enregistree en base. */
  ok: boolean;
  /** Texte a renvoyer tel quel dans la conversation Telegram. */
  reply: string | null;
  /** Profil lie, seulement quand `ok` est vrai. */
  profile: TelegramLinkedProfile | null;
}

@Injectable()
export class TelegramLinkService {
  private readonly logger = new Logger(TelegramLinkService.name);

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
        //
        // En revanche, on LÈVE une révocation antérieure. C'était le défaut à
        // l'origine du « code invalide » systématique : `revokeForSelf` pose
        // `revokedAt`, que rien ne remettait à `null`, alors que `verifyCode`
        // exigeait `revokedAt: null`. Après une première déconnexion, tous les
        // codes suivants étaient donc refusés. Lever la révocation ici ne
        // rétablit aucune liaison : `telegramUserId` reste vide (il a été effacé
        // à la révocation) tant que le membre n'a pas envoyé ce nouveau code.
        revokedAt: null,
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
   * `/lier <code>` dans Telegram — directement, ou via `handleCommand`.
   *
   * Garanties :
   *  - le code est normalisé (espaces, tirets, chiffres arabes, nombre transmis
   *    sans ses zéros de tête) avant d'être haché ;
   *  - un code EXPIRÉ est distingué d'un code inconnu ou déjà utilisé (410
   *    `TELEGRAM_CODE_EXPIRED` contre 404 `TELEGRAM_CODE_INVALID`) ;
   *  - la consommation est ATOMIQUE : le même code envoyé deux fois en même
   *    temps ne lie qu'une fois (`updateMany` conditionné par l'empreinte) ;
   *  - un compte Telegram déjà lié à un AUTRE profil répond 409, y compris
   *    quand la contrainte d'unicité tranche une course entre deux requêtes ;
   *  - rien n'est confirmé avant l'écriture en base.
   */
  async verifyCode(
    body: {
      code: unknown;
      telegramUserId: unknown;
      telegramChatId: unknown;
      telegramUsername?: unknown;
    },
    actor: AuthenticatedUser,
    meta: RequestContext,
  ): Promise<TelegramVerifyResult> {
    this.assertTelegramScope(actor);

    const code = normalizePairingCode(body.code);
    if (!code) {
      throw AppException.unprocessable(
        'TELEGRAM_CODE_INVALID',
        'Le code doit comporter exactement 6 chiffres.',
      );
    }

    const telegramUserId = normalizeTelegramId(body.telegramUserId);
    const telegramChatId = normalizeTelegramId(body.telegramChatId);
    if (!telegramUserId || !telegramChatId) {
      throw AppException.unprocessable(
        'TELEGRAM_DATA_MISSING',
        'telegramUserId et telegramChatId sont obligatoires (identifiants numériques Telegram).',
      );
    }

    const telegramUsername =
      typeof body.telegramUsername === 'string'
        ? body.telegramUsername.replace(/^@/, '').trim() || null
        : null;

    const pairingCodeHash = hashPairingCode(code);
    const now = new Date();

    // Le code en attente est la preuve que le membre, authentifié dans Comexa,
    // veut lier un compte : `revokedAt` n'entre donc pas dans la recherche (une
    // liaison révoquée puis redemandée doit aboutir).
    const link = await this.prisma.telegramLink.findFirst({
      where: { pairingCodeHash },
      select: {
        id: true,
        userId: true,
        pairingExpiresAt: true,
        telegramUserId: true,
        telegramUsername: true,
        revokedAt: true,
      },
    });

    if (!link) {
      throw AppException.notFound('TELEGRAM_CODE_INVALID', 'Code invalide ou déjà utilisé.');
    }
    if (!link.pairingExpiresAt || link.pairingExpiresAt.getTime() <= now.getTime()) {
      throw new AppException(
        'TELEGRAM_CODE_EXPIRED',
        `Ce code a expiré (validité : ${PAIRING_CODE_TTL_MINUTES} minutes). Générez-en un nouveau.`,
        HttpStatus.GONE,
      );
    }

    // Le compte Telegram ne doit pas être lié à un AUTRE profil Comexa.
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

    // Charge l'utilisateur avec ses permissions (refuse un compte inactif).
    const profile = await this.loadLinkedUser(link.userId);

    const wasLinked = Boolean(link.telegramUserId) && !link.revokedAt;
    const linkStatus: TelegramVerifyResult['linkStatus'] = !wasLinked
      ? 'linked'
      : link.telegramUserId === telegramUserId
        ? 'refreshed'
        : 'relinked';

    const pairedAt = new Date();
    let consumed = 0;
    try {
      const result = await this.prisma.telegramLink.updateMany({
        where: { id: link.id, pairingCodeHash, pairingExpiresAt: { gt: now } },
        data: {
          telegramUserId,
          telegramChatId,
          // Un workflow qui n'envoie pas le pseudo ne doit pas effacer celui
          // d'une liaison simplement reconfirmée.
          telegramUsername:
            telegramUsername ?? (linkStatus === 'refreshed' ? link.telegramUsername : null),
          pairedAt,
          pairingCodeHash: null,
          pairingExpiresAt: null,
          revokedAt: null,
        },
      });
      consumed = result.count;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'TELEGRAM_ALREADY_LINKED',
          'Ce compte Telegram est déjà lié à un autre profil Comexa.',
        );
      }
      throw error;
    }

    // Une requête concurrente a consommé le code entre la lecture et l'écriture.
    if (consumed === 0) {
      throw AppException.notFound('TELEGRAM_CODE_INVALID', 'Code invalide ou déjà utilisé.');
    }

    await this.audit.record({
      actorId: link.userId,
      action: 'TELEGRAM_LINK_CREATED',
      entityType: 'TelegramLink',
      entityId: link.id,
      before: wasLinked
        ? { telegramUserId: link.telegramUserId, telegramUsername: link.telegramUsername }
        : undefined,
      after: { telegramUserId, telegramUsername, linkStatus },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      ...profile,
      telegramChatId,
      linkStatus,
      previousTelegramUsername: linkStatus === 'relinked' ? link.telegramUsername : null,
    };
  }

  /**
   * AIGUILLAGE D'UN MESSAGE TELEGRAM (`POST /integrations/telegram/command`).
   *
   * Le workflow n8n transmet le texte brut reçu par le bot. Si c'est une
   * commande Comexa (`/lier …`), elle est exécutée ICI avec le mécanisme de
   * liaison existant (`verifyCode`) et la réponse contient la phrase à renvoyer
   * à l'utilisateur. Sinon `handled: false` : le workflow passe le message à son
   * agent conversationnel, comme avant.
   *
   * Les issues métier (code invalide, expiré, compte déjà lié…) répondent 200
   * avec `ok: false` et un texte explicite : un nœud HTTP n8n qui reçoit un 4xx
   * échoue par défaut, et c'est précisément ce qui faisait retomber `/lier`
   * dans une réponse générique. `ok: true` n'est renvoyé qu'après l'écriture en
   * base. Une panne inattendue est journalisée et rapportée comme
   * `server_error`, sans jamais confirmer de liaison.
   */
  async handleCommand(
    body: {
      text: unknown;
      telegramUserId: unknown;
      telegramChatId: unknown;
      telegramUsername?: unknown;
      chatType?: unknown;
    },
    actor: AuthenticatedUser,
    meta: RequestContext,
  ): Promise<TelegramCommandResult> {
    this.assertTelegramScope(actor);

    const parsed = parseTelegramMessage(body.text, BOT_USERNAME);
    const notHandled: TelegramCommandResult = {
      handled: false,
      command: null,
      status: null,
      ok: false,
      reply: null,
      profile: null,
    };
    if (
      parsed.kind === 'text' ||
      parsed.kind === 'other-command' ||
      parsed.kind === 'foreign-bot'
    ) {
      return notHandled;
    }

    const answer = (
      status: TelegramLinkOutcome,
      profile: TelegramLinkedProfile | null = null,
      previous: string | null = null,
    ): TelegramCommandResult => ({
      handled: true,
      command: 'lier',
      status,
      ok: SUCCESS_OUTCOMES.has(status),
      reply: telegramReply(status, {
        firstName: profile?.firstName,
        email: profile?.email,
        previousTelegramUsername: previous,
      }),
      profile: SUCCESS_OUTCOMES.has(status) ? profile : null,
    });

    if (isGroupChat(body.chatType)) return answer('group_chat');
    if (parsed.kind === 'link-usage') return answer('usage');
    if (parsed.kind === 'link-invalid') return answer('invalid_format');

    try {
      const result = await this.verifyCode(
        {
          code: parsed.code,
          telegramUserId: body.telegramUserId,
          telegramChatId: body.telegramChatId,
          telegramUsername: body.telegramUsername,
        },
        actor,
        meta,
      );
      const { linkStatus, previousTelegramUsername, ...profile } = result;
      return answer(linkStatus, profile, previousTelegramUsername);
    } catch (error) {
      if (!(error instanceof AppException)) {
        this.logger.error(
          `Commande /lier : erreur inattendue (${error instanceof Error ? error.message : String(error)})`,
        );
        return answer('server_error');
      }
      // Données Telegram absentes : c'est le workflow qui est mal câblé, pas
      // l'utilisateur. On le signale par une erreur, jamais par un faux succès.
      if (error.code === 'TELEGRAM_DATA_MISSING' || error.code === 'FORBIDDEN') throw error;

      const outcome = outcomeForErrorCode(error.code);
      // Code refusé, mais ce compte Telegram est DÉJÀ lié : on le dit, plutôt
      // que d'inviter à générer un code dont il n'a pas besoin.
      if (outcome === 'invalid_code' || outcome === 'expired_code') {
        const current = await this.activeProfileFor(body.telegramUserId);
        if (current) return answer('already_linked', current);
      }
      return answer(outcome);
    }
  }

  /**
   * Résout un telegramUserId en profil Comexa (utilisé par le bot à chaque message).
   */
  async resolve(telegramUserId: string, actor: AuthenticatedUser): Promise<TelegramLinkedProfile> {
    this.assertTelegramScope(actor);

    const id = normalizeTelegramId(telegramUserId);
    if (!id) {
      throw AppException.unprocessable(
        'TELEGRAM_USER_ID_REQUIRED',
        'telegramUserId est obligatoire.',
      );
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
      throw AppException.notFound(
        'TELEGRAM_LINK_NOT_FOUND',
        'Aucun compte Comexa lié à cet utilisateur Telegram.',
      );
    }

    const profile = await this.loadLinkedUser(link.userId);
    return { ...profile, telegramChatId: link.telegramChatId };
  }

  // ---------------------------------------------------------------------------
  // Internes
  // ---------------------------------------------------------------------------

  /** Profil actif déjà lié à ce compte Telegram, ou `null` (sans lever). */
  private async activeProfileFor(
    rawTelegramUserId: unknown,
  ): Promise<TelegramLinkedProfile | null> {
    const telegramUserId = normalizeTelegramId(rawTelegramUserId);
    if (!telegramUserId) return null;
    const link = await this.prisma.telegramLink.findUnique({
      where: { telegramUserId },
      select: { userId: true, telegramChatId: true, revokedAt: true, pairedAt: true },
    });
    if (!link || link.revokedAt || !link.pairedAt) return null;
    try {
      const profile = await this.loadLinkedUser(link.userId);
      return { ...profile, telegramChatId: link.telegramChatId };
    } catch {
      return null;
    }
  }

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

    // 403 et non 401 : l'appelant (le jeton du bot) est bien authentifié. Un
    // 401 laissait croire au workflow que SON jeton était refusé.
    if (!user || user.isServiceAccount || user.status !== UserStatus.ACTIVE) {
      throw new AppException(
        'TELEGRAM_LINK_UNUSABLE',
        "Ce compte Comexa n'est plus actif.",
        HttpStatus.FORBIDDEN,
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
