import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';
import { paginated, resolvePagination, type Paginated } from '../../common/dto/pagination.dto.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { WhatsAppMessageDirection, WhatsAppMessageStatus } from '../../generated/prisma/enums.js';
import type { RequestContext } from '../projects/request-meta.decorator.js';
import { hasGrantedScope } from './consent.js';
import { resolveRecipient } from './whatsapp-identity.js';
import {
  evaluateSendPolicy,
  httpStatusForSendRejection,
  type StoredSessionStatus,
} from './whatsapp-send-policy.js';
import {
  toWhatsAppContactView,
  toWhatsAppMessageView,
  type WhatsAppContactView,
  type WhatsAppMessageView,
} from './whatsapp.presenter.js';
import {
  WHATSAPP_GATEWAY_CONFIG_TOKEN,
  WHATSAPP_GATEWAY_TOKEN,
  type WhatsAppGateway,
  type WhatsAppGatewayConfig,
} from './whatsapp.types.js';
import { WhatsAppAccountService, type WhatsAppAccountRow } from './whatsapp-account.service.js';
import type {
  ListWhatsAppContactsQueryDto,
  ListWhatsAppMessagesQueryDto,
  SendWhatsAppMessageDto,
} from './dto/whatsapp.dto.js';

/**
 * ENVOIS ET CONTACTS WHATSAPP.
 *
 * -------------------------------------------------------------------------
 * LE CHEMIN D'UN ENVOI, DANS L'ORDRE
 * -------------------------------------------------------------------------
 *  1. charger le compte (non revoque) ;
 *  2. rafraichir son etat depuis la passerelle — envoyer sur une session morte
 *     produit un echec que personne ne comprend ;
 *  3. resoudre le destinataire (numero -> JID), sans jamais deviner un indicatif ;
 *  4. compter les envois de l'heure glissante ;
 *  5. appliquer `evaluateSendPolicy` — consentement, etat, destinataire, corps,
 *     plafond ;
 *  6. ecrire la ligne `whatsapp_messages` AVANT l'appel (QUEUED) ;
 *  7. appeler la passerelle, puis marquer SENT ou FAILED.
 *
 * L'ETAPE 6 N'EST PAS UNE COQUETTERIE DE JOURNALISATION. Un message dont l'envoi
 * coupe le processus reste visible comme « demande, non confirme ». N'ecrire
 * qu'apres le succes produirait l'inverse — des envois reels sans aucune trace,
 * c'est-a-dire exactement ce qu'un journal d'envoi existe pour empecher.
 *
 * -------------------------------------------------------------------------
 * LE REJEU
 * -------------------------------------------------------------------------
 * `idempotencyKey` est verifiee AVANT l'appel a la passerelle : n8n rejoue un
 * noeud HTTP qui a expire, et sans cette cle un client recevrait deux fois le
 * meme message. La reponse rend alors `replayed: true`, pour que le workflow
 * sache qu'il n'a rien envoye de plus.
 *
 * -------------------------------------------------------------------------
 * LE REPERTOIRE
 * -------------------------------------------------------------------------
 * Lire les contacts COPIE LES DONNEES DE PERSONNES QUI N'ONT RIEN DEMANDE. La
 * synchronisation est donc conditionnee a la capacite `contact:read`, accordee
 * explicitement au moment du consentement, et la copie est SUPPRIMEE a la
 * revocation (voir `WhatsAppAccountService.revokeAccount`).
 */

/** Taille d'une page de repertoire demandee a la passerelle. */
const CONTACTS_PAGE_SIZE = 500;

/**
 * Nombre maximal de pages lues par synchronisation.
 *
 * BORNE VOLONTAIRE : un repertoire de dix mille entrees ne se copie pas en une
 * requete, et sans plafond une synchronisation pourrait tourner pendant tout le
 * delai HTTP. 4 000 contacts couvrent tres largement un telephone personnel ou
 * professionnel ; au-dela, la page suivante se lira a la synchronisation
 * suivante, ce qui est acceptable pour un cache.
 */
const CONTACTS_MAX_PAGES = 8;

interface MessageRow {
  readonly id: string;
  readonly direction: string;
  readonly toJid: string;
  readonly toPhoneNumber: string | null;
  readonly body: string;
  readonly status: string;
  readonly gatewayMessageId: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly telegramChatId: string | null;
  readonly telegramMessageId: string | null;
  readonly idempotencyKey: string | null;
  readonly sentAt: Date | null;
  readonly createdAt: Date;
  readonly requestedBy: { id: string; firstName: string; lastName: string } | null;
}

const MESSAGE_SELECT = {
  id: true,
  direction: true,
  toJid: true,
  toPhoneNumber: true,
  body: true,
  status: true,
  gatewayMessageId: true,
  errorCode: true,
  errorMessage: true,
  telegramChatId: true,
  telegramMessageId: true,
  idempotencyKey: true,
  sentAt: true,
  createdAt: true,
  requestedBy: { select: { id: true, firstName: true, lastName: true } },
} as const;

@Injectable()
export class WhatsAppMessagingService {
  private readonly logger = new Logger(WhatsAppMessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly accounts: WhatsAppAccountService,
    @Inject(WHATSAPP_GATEWAY_TOKEN) private readonly gateway: WhatsAppGateway,
    @Inject(WHATSAPP_GATEWAY_CONFIG_TOKEN) private readonly gatewayConfig: WhatsAppGatewayConfig,
  ) {}

  // ---------------------------------------------------------------------------
  // Envois
  // ---------------------------------------------------------------------------

  /** Envoi depuis le compte du membre authentifie. */
  async sendForSelf(
    actor: AuthenticatedUser,
    dto: SendWhatsAppMessageDto,
    meta: RequestContext,
  ): Promise<WhatsAppMessageView> {
    const account = await this.requireUsableAccount(actor.id);
    return this.dispatch(account, dto, actor.id, meta);
  }

  /**
   * Envoi depuis le compte d'un membre, a la demande du bot.
   *
   * `userId` vient du CHEMIN : le bot l'a obtenu en resolvant l'identifiant
   * Telegram, et le jeton porte `whatsapp:send:any`. Le compte utilise est celui
   * du membre — jamais celui du compte technique du jeton, qui n'a pas de
   * telephone.
   */
  async sendForUser(
    userId: string,
    actor: AuthenticatedUser,
    dto: SendWhatsAppMessageDto,
    meta: RequestContext,
  ): Promise<WhatsAppMessageView> {
    if (!actor.permissions.has('whatsapp:send:any')) {
      throw AppException.forbidden('Droit insuffisant : whatsapp:send:any');
    }

    const account = await this.requireUsableAccount(userId);
    return this.dispatch(account, dto, userId, meta);
  }

  /**
   * Le chemin d'envoi unique.
   *
   * UNE SEULE IMPLEMENTATION pour les deux publics (membre et bot) : deux chemins
   * finiraient par diverger sur un controle, et le controle oublie serait
   * toujours celui du chemin le moins teste.
   */
  private async dispatch(
    account: WhatsAppAccountRow,
    dto: SendWhatsAppMessageDto,
    requestedById: string,
    meta: RequestContext,
  ): Promise<WhatsAppMessageView> {
    const refreshed = await this.accounts.syncStatus(account, { force: true });

    const recipient = resolveRecipient(
      dto.to,
      dto.countryCode?.trim().toUpperCase() || this.gatewayConfig.defaultCountryCode,
    );

    const sentInLastHour = await this.countRecentSends(refreshed.id);

    const verdict = evaluateSendPolicy({
      sessionStatus: refreshed.status as StoredSessionStatus,
      consent: {
        consentVersion: refreshed.consentVersion,
        consentAcceptedAt: refreshed.consentAcceptedAt,
        consentExpiresAt: refreshed.consentExpiresAt,
        revokedAt: refreshed.revokedAt,
        grantedScopes: refreshed.grantedScopes,
      },
      recipient,
      body: dto.body,
      sentInLastHour,
      maxBodyLength: this.gatewayConfig.maxBodyLength,
      maxMessagesPerHour: this.gatewayConfig.maxMessagesPerHour,
    });

    // REFUS : la ligne est ecrite quand meme. Un refus invisible serait un trou
    // dans le journal — et « le bot a-t-il essaye d'envoyer ? » est la premiere
    // question posee quand un destinataire dit n'avoir rien recu.
    if (!verdict.ok) {
      const refused = await this.prisma.whatsAppMessage.create({
        data: {
          accountId: refreshed.id,
          direction: WhatsAppMessageDirection.OUTBOUND,
          toJid: recipient.ok ? recipient.jid : dto.to,
          toPhoneNumber: recipient.ok ? recipient.phone : null,
          body: dto.body,
          status: WhatsAppMessageStatus.REFUSED,
          errorCode: verdict.code,
          errorMessage: verdict.message,
          requestedById,
          telegramChatId: dto.telegramChatId ?? null,
          telegramMessageId: dto.telegramMessageId ?? null,
          idempotencyKey: dto.idempotencyKey ?? null,
        },
        select: MESSAGE_SELECT,
      });

      await this.audit.record({
        actorId: requestedById,
        action: 'WHATSAPP_MESSAGE_REFUSED',
        entityType: 'WhatsAppMessage',
        entityId: refused.id,
        after: { code: verdict.code, accountId: refreshed.id },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      throw new AppException(
        verdict.code,
        verdict.message,
        httpStatusForSendRejection(verdict.code),
        { accountId: refreshed.id, messageId: refused.id },
      );
    }

    // REJEU : la cle existe deja, donc le message est deja parti (ou deja tente).
    if (dto.idempotencyKey) {
      const existing = await this.prisma.whatsAppMessage.findUnique({
        where: {
          accountId_idempotencyKey: {
            accountId: refreshed.id,
            idempotencyKey: dto.idempotencyKey,
          },
        },
        select: MESSAGE_SELECT,
      });

      if (existing) {
        return toWhatsAppMessageView(existing, { replayed: true });
      }
    }

    const queued = await this.prisma.whatsAppMessage.create({
      data: {
        accountId: refreshed.id,
        direction: WhatsAppMessageDirection.OUTBOUND,
        toJid: verdict.jid,
        toPhoneNumber: verdict.phone,
        body: dto.body,
        status: WhatsAppMessageStatus.QUEUED,
        requestedById,
        telegramChatId: dto.telegramChatId ?? null,
        telegramMessageId: dto.telegramMessageId ?? null,
        idempotencyKey: dto.idempotencyKey ?? null,
      },
      select: MESSAGE_SELECT,
    });

    try {
      const sent = await this.gateway.sendText(refreshed.sessionName, verdict.jid, dto.body);

      const row = await this.prisma.whatsAppMessage.update({
        where: { id: queued.id },
        data: {
          status: WhatsAppMessageStatus.SENT,
          gatewayMessageId: sent.messageId,
          sentAt: sent.sentAt,
          errorCode: null,
          errorMessage: null,
        },
        select: MESSAGE_SELECT,
      });

      await this.audit.record({
        actorId: requestedById,
        action: 'WHATSAPP_MESSAGE_SENT',
        entityType: 'WhatsAppMessage',
        entityId: row.id,
        // Le destinataire et l'identifiant WhatsApp sont journalises ; le corps ne
        // l'est PAS : il est deja dans `whatsapp_messages`, et le dupliquer ici
        // ferait deux copies d'un meme contenu personnel.
        after: { accountId: refreshed.id, to: verdict.jid, gatewayMessageId: sent.messageId },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      return toWhatsAppMessageView(row);
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error
          ? String((error as { code: unknown }).code)
          : 'WHATSAPP_GATEWAY_FAILED';
      const message = error instanceof Error ? error.message : String(error);

      await this.prisma.whatsAppMessage.update({
        where: { id: queued.id },
        data: {
          status: WhatsAppMessageStatus.FAILED,
          errorCode: code.slice(0, 80),
          errorMessage: message.slice(0, 500),
        },
      });

      this.logger.warn(
        `Echec d'envoi WhatsApp (message ${queued.id}, compte ${refreshed.sessionName}) : ${message}`,
      );

      throw this.accounts.toAppException(error);
    }
  }

  /** Nombre d'envois acceptes (ou en cours) dans l'heure glissante. */
  private async countRecentSends(accountId: string): Promise<number> {
    const since = new Date(Date.now() - 3_600_000);

    return this.prisma.whatsAppMessage.count({
      where: {
        accountId,
        createdAt: { gte: since },
        // QUEUED compte aussi : un envoi en cours est un envoi reel, et l'ignorer
        // permettrait de depasser le plafond en envoyant en parallele.
        status: { in: [WhatsAppMessageStatus.SENT, WhatsAppMessageStatus.QUEUED] },
      },
    });
  }

  /** Journal des envois du membre authentifie. */
  async listMessagesForSelf(
    actor: AuthenticatedUser,
    query: ListWhatsAppMessagesQueryDto,
  ): Promise<Paginated<WhatsAppMessageView>> {
    const account = await this.accounts.loadUsableAccount(actor.id);
    if (!account) return paginated([], 0, resolvePagination(query));

    return this.listMessages(account.id, query);
  }

  /** Journal des envois d'un membre, pour le bot (`whatsapp:read:any`). */
  async listMessagesForUser(
    userId: string,
    actor: AuthenticatedUser,
    query: ListWhatsAppMessagesQueryDto,
  ): Promise<Paginated<WhatsAppMessageView>> {
    if (!actor.permissions.has('whatsapp:read:any')) {
      throw AppException.forbidden('Droit insuffisant : whatsapp:read:any');
    }

    const account = await this.accounts.loadUsableAccount(userId);
    if (!account) {
      throw AppException.notFound(
        'WHATSAPP_ACCOUNT_NOT_FOUND',
        'Aucun compte WhatsApp actif pour ce membre.',
      );
    }

    return this.listMessages(account.id, query);
  }

  private async listMessages(
    accountId: string,
    query: ListWhatsAppMessagesQueryDto,
  ): Promise<Paginated<WhatsAppMessageView>> {
    const pagination = resolvePagination(query);

    const where = {
      accountId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.to?.trim()
        ? {
            OR: [
              { toJid: { contains: query.to.trim(), mode: 'insensitive' as const } },
              { toPhoneNumber: { contains: query.to.trim() } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.whatsAppMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
        select: MESSAGE_SELECT,
      }),
      this.prisma.whatsAppMessage.count({ where }),
    ]);

    return paginated(
      rows.map((row) => toWhatsAppMessageView(row)),
      total,
      pagination,
    );
  }

  // ---------------------------------------------------------------------------
  // Repertoire
  // ---------------------------------------------------------------------------

  /** Contacts du compte du membre authentifie. */
  async listContactsForSelf(
    actor: AuthenticatedUser,
    query: ListWhatsAppContactsQueryDto,
  ): Promise<Paginated<WhatsAppContactView>> {
    const account = await this.accounts.loadUsableAccount(actor.id);
    if (!account) return paginated([], 0, resolvePagination(query));

    return this.listContacts(account, query, actor.id);
  }

  /** Contacts du compte d'un membre, pour le bot (`whatsapp:read:any`). */
  async listContactsForUser(
    userId: string,
    actor: AuthenticatedUser,
    query: ListWhatsAppContactsQueryDto,
  ): Promise<Paginated<WhatsAppContactView>> {
    if (!actor.permissions.has('whatsapp:read:any')) {
      throw AppException.forbidden('Droit insuffisant : whatsapp:read:any');
    }

    const account = await this.accounts.loadUsableAccount(userId);
    if (!account) {
      throw AppException.notFound(
        'WHATSAPP_ACCOUNT_NOT_FOUND',
        'Aucun compte WhatsApp actif pour ce membre.',
      );
    }

    return this.listContacts(account, query, userId);
  }

  private async listContacts(
    account: WhatsAppAccountRow,
    query: ListWhatsAppContactsQueryDto,
    requestedById: string,
  ): Promise<Paginated<WhatsAppContactView>> {
    const scope = hasGrantedScope(account, 'contact:read');
    if (!scope.ok) {
      // 403 et non 422 : ce n'est pas un etat metier, c'est une capacite que le
      // titulaire n'a pas accordee. Le message nomme la capacite manquante.
      throw new AppException(`WHATSAPP_${scope.code}`, scope.message, HttpStatus.FORBIDDEN, {
        accountId: account.id,
      });
    }

    if (query.refresh === 'true' || (await this.isContactCacheStale(account.id))) {
      await this.syncContacts(account, requestedById);
    }

    const pagination = resolvePagination(query);
    const search = query.q?.trim();

    const where = {
      accountId: account.id,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { phoneNumber: { contains: search.replace(/\D/g, '') } },
              { jid: { contains: search.replace(/\D/g, '') } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.whatsAppContact.findMany({
        where,
        orderBy: [{ name: 'asc' }, { jid: 'asc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.whatsAppContact.count({ where }),
    ]);

    return paginated(
      rows.map((row) => toWhatsAppContactView(row)),
      total,
      pagination,
    );
  }

  /** Le cache a-t-il depasse `WHATSAPP_CONTACT_CACHE_MINUTES` ? */
  private async isContactCacheStale(accountId: string): Promise<boolean> {
    const minutes = this.gatewayConfig.contactCacheMinutes;
    if (minutes === 0) return true;

    const newest = await this.prisma.whatsAppContact.findFirst({
      where: { accountId },
      orderBy: { syncedAt: 'desc' },
      select: { syncedAt: true },
    });

    // Aucun contact copie : le cache est vide, donc perime. Un compte dont le
    // repertoire est reellement vide refera une tentative a chaque lecture, ce
    // qui est acceptable — et preferable a un cache vide jamais rempli.
    if (!newest) return true;

    return Date.now() - newest.syncedAt.getTime() > minutes * 60_000;
  }

  /**
   * Recopie le repertoire depuis la passerelle.
   *
   * SUPPRIMER PUIS RECREER, ET NON FUSIONNER : une fusion laisserait en base les
   * contacts que le titulaire a supprimes de son telephone. Or ce cache contient
   * les donnees de personnes qui n'ont rien demande : conserver une entree que le
   * titulaire a lui-meme effacee serait une collecte sans fondement.
   *
   * Les deux operations sont dans UNE TRANSACTION : entre les deux, une lecture
   * ne doit jamais voir un repertoire vide.
   */
  private async syncContacts(account: WhatsAppAccountRow, requestedById: string): Promise<number> {
    const refreshed = await this.accounts.syncStatus(account);

    if (refreshed.status !== 'CONNECTED') {
      throw new AppException(
        'WHATSAPP_SESSION_NOT_CONNECTED',
        `Le repertoire ne peut etre lu que sur une session appairee (etat : ${refreshed.status}).`,
        HttpStatus.CONFLICT,
      );
    }

    const contacts: Array<{
      jid: string;
      name: string | null;
      phoneNumber: string | null;
      isBusiness: boolean;
    }> = [];

    const seen = new Set<string>();

    for (let page = 0; page < CONTACTS_MAX_PAGES; page++) {
      let rows;
      try {
        rows = await this.gateway.listContacts(refreshed.sessionName, {
          limit: CONTACTS_PAGE_SIZE,
          offset: page * CONTACTS_PAGE_SIZE,
        });
      } catch (error) {
        // Une premiere page en erreur est un echec ; une page suivante en erreur
        // laisse le cache partiel mais utilisable, et l'erreur est journalisee.
        if (page === 0) throw this.accounts.toAppException(error);
        this.logger.warn(
          `Synchronisation du repertoire arretee a la page ${page} pour ` +
            `${refreshed.sessionName} : ${error instanceof Error ? error.message : String(error)}`,
        );
        break;
      }

      if (rows.length === 0) break;

      for (const row of rows) {
        if (seen.has(row.jid)) continue;
        seen.add(row.jid);
        contacts.push({
          jid: row.jid,
          name: row.name?.slice(0, 200) ?? null,
          phoneNumber: row.phoneNumber,
          isBusiness: row.isBusiness,
        });
      }

      if (rows.length < CONTACTS_PAGE_SIZE) break;
    }

    const syncedAt = new Date();

    await this.prisma.$transaction([
      this.prisma.whatsAppContact.deleteMany({ where: { accountId: refreshed.id } }),
      this.prisma.whatsAppContact.createMany({
        data: contacts.map((contact) => ({ accountId: refreshed.id, syncedAt, ...contact })),
      }),
    ]);

    await this.audit.record({
      actorId: requestedById,
      action: 'WHATSAPP_CONTACTS_SYNCED',
      entityType: 'WhatsAppAccount',
      entityId: refreshed.id,
      // Le NOMBRE, pas la liste : journaliser les contacts eux-memes dupliquerait
      // des donnees de tiers dans un second endroit.
      after: { count: contacts.length },
    });

    return contacts.length;
  }

  /** Compte utilisable d'un membre, ou 404. */
  private async requireUsableAccount(userId: string): Promise<WhatsAppAccountRow> {
    const account = await this.accounts.loadUsableAccount(userId);

    if (!account) {
      throw AppException.notFound(
        'WHATSAPP_ACCOUNT_NOT_FOUND',
        'Aucun compte WhatsApp actif. Lancer l’appairage (POST /me/whatsapp/session) d’abord.',
      );
    }

    return account;
  }
}

/** Reexport pour les tests : la forme d'une ligne de message. */
export type { MessageRow };
