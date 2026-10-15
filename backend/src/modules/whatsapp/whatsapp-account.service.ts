import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { MailService } from '../../common/mail/mail.service.js';
import { AppException } from '../../common/errors/app-error.js';
import { paginated, resolvePagination, type Paginated } from '../../common/dto/pagination.dto.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  UserStatus,
  WhatsAppDelegationStatus,
  WhatsAppOwnerKind,
  WhatsAppSessionStatus,
} from '../../generated/prisma/enums.js';
import type { RequestContext } from '../projects/request-meta.decorator.js';
import {
  CONSENT_VERSION,
  describeConsent,
  evaluateConsent,
  normalizeGrantScopes,
} from './consent.js';
import {
  generateDelegationCode,
  hashDelegationCode,
  isUsableSessionName,
  looksLikeDelegationCode,
  normalizeDelegationCode,
  sessionNameFor,
} from './whatsapp-identity.js';
import {
  PAIRING_INSTRUCTIONS,
  toWhatsAppAccountView,
  toWhatsAppDelegationView,
  type WhatsAppAccountView,
  type WhatsAppDelegationView,
  type WhatsAppPairingView,
} from './whatsapp.presenter.js';
import {
  WhatsAppGatewayError,
  WHATSAPP_ERROR_CODES,
  WHATSAPP_GATEWAY_CONFIG_TOKEN,
  WHATSAPP_GATEWAY_TOKEN,
  type GatewaySessionState,
  type WhatsAppGateway,
  type WhatsAppGatewayConfig,
} from './whatsapp.types.js';
import type {
  AcceptWhatsAppDelegationDto,
  RefuseWhatsAppDelegationDto,
  CreateWhatsAppDelegationDto,
  ListWhatsAppAccountsQueryDto,
  ListWhatsAppDelegationsQueryDto,
  StartWhatsAppSessionDto,
} from './dto/whatsapp.dto.js';

/**
 * COMPTES WHATSAPP — appairage, consentement, delegations, revocation.
 *
 * -------------------------------------------------------------------------
 * CE QUE CE SERVICE FAIT, ET CE QU'IL NE FAIT PAS
 * -------------------------------------------------------------------------
 * Il tient le CYCLE DE VIE d'une autorisation : qui a accepte quoi, quand, pour
 * quelles capacites, et jusqu'a quand. Il parle a la passerelle pour appairer,
 * interroger l'etat et couper une session.
 *
 * Il n'envoie AUCUN message : c'est `WhatsAppMessagingService`, qui applique la
 * regle d'envoi (`whatsapp-send-policy.ts`) avant de toucher la passerelle. La
 * separation n'est pas esthetique : si l'envoi et l'appairage vivaient dans la
 * meme classe, le chemin d'envoi finirait par ne plus passer par la regle — et la
 * regle est la seule chose qui empeche d'envoyer depuis un compte dont le
 * titulaire a retire l'autorisation.
 *
 * -------------------------------------------------------------------------
 * TROIS INVARIANTS TENUS ICI
 * -------------------------------------------------------------------------
 *  1. AUCUN COMPTE N'EST CREE SANS CONSENTEMENT ENREGISTRE. `acceptConsent` doit
 *     valoir `true`, et la version du texte accepte est stockee. Un compte sans
 *     consentement est refuse a l'envoi par la regle — donc jamais utilisable.
 *
 *  2. UN NOM DE SESSION N'EST JAMAIS REUTILISE. Une revocation coupe LA session
 *     nommee ; recycler un nom laisserait un doute sur l'acces reel d'un compte.
 *     Le nom porte donc de l'alea, et la contrainte UNIQUE en base est le filet.
 *
 *  3. REVOQUER ABOUTIT TOUJOURS. Un echec de la passerelle (injoignable, session
 *     deja supprimee) n'empeche pas la revocation en base : l'autorisation est
 *     retiree, et la session orpheline est rejetee au prochain demarrage de la
 *     passerelle. Refuser une revocation parce que la passerelle ne repond pas
 *     serait la pire des reponses — c'est precisement quand elle ne repond pas
 *     qu'on veut couper.
 */

/** Projection commune des comptes. */
const ACCOUNT_SELECT = {
  id: true,
  userId: true,
  ownerKind: true,
  gatewayDriver: true,
  sessionName: true,
  status: true,
  phoneNumber: true,
  pushName: true,
  grantedScopes: true,
  consentVersion: true,
  consentAcceptedAt: true,
  consentIpAddress: true,
  consentExpiresAt: true,
  pairedAt: true,
  revokedAt: true,
  lastStatusAt: true,
  lastError: true,
  delegationId: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, firstName: true, lastName: true } },
  delegation: { select: { id: true, status: true, delegatorName: true } },
} as const;

/**
 * Forme d'une ligne de compte, telle que `ACCOUNT_SELECT` la rend.
 *
 * ECRITE A LA MAIN plutot que derivee du client Prisma : les utilitaires
 * `GetPayload` ne sont pas reexportes par le generateur Prisma 7 dans le
 * namespace `Prisma`, et une declaration explicite a un second avantage — elle
 * dit quelles colonnes existent reellement cote service. Ajouter une colonne au
 * `select` sans mettre a jour ce type casse la compilation, ce qui est
 * precisement le filet que le presenter attend.
 */
export interface WhatsAppAccountRow {
  readonly id: string;
  readonly userId: string;
  readonly ownerKind: WhatsAppOwnerKind;
  readonly gatewayDriver: string;
  readonly sessionName: string;
  readonly status: WhatsAppSessionStatus;
  readonly phoneNumber: string | null;
  readonly pushName: string | null;
  readonly grantedScopes: string[];
  readonly consentVersion: string;
  readonly consentAcceptedAt: Date | null;
  readonly consentIpAddress: string | null;
  readonly consentExpiresAt: Date | null;
  readonly pairedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly lastStatusAt: Date | null;
  readonly lastError: string | null;
  readonly delegationId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly user: { readonly id: string; readonly firstName: string; readonly lastName: string };
  readonly delegation: {
    readonly id: string;
    readonly status: WhatsAppDelegationStatus;
    readonly delegatorName: string | null;
  } | null;
}

const DELEGATION_SELECT = {
  id: true,
  requestedById: true,
  delegatorName: true,
  delegatorEmail: true,
  delegatorPhone: true,
  delegatorTelegramUserId: true,
  delegatorTelegramChatId: true,
  note: true,
  status: true,
  grantedScopes: true,
  codeHash: true,
  codeExpiresAt: true,
  acceptedAt: true,
  acceptedIpAddress: true,
  refusedAt: true,
  revokedAt: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  requestedBy: { select: { id: true, firstName: true, lastName: true } },
  account: { select: { id: true } },
} as const;

/** Forme d'une ligne d'invitation — meme raison d'etre que `WhatsAppAccountRow`. */
export interface WhatsAppDelegationRow {
  readonly id: string;
  readonly requestedById: string;
  readonly delegatorName: string | null;
  readonly delegatorEmail: string | null;
  readonly delegatorPhone: string | null;
  readonly delegatorTelegramUserId: string | null;
  readonly delegatorTelegramChatId: string | null;
  readonly note: string | null;
  readonly status: WhatsAppDelegationStatus;
  readonly grantedScopes: string[];
  readonly codeHash: string | null;
  readonly codeExpiresAt: Date | null;
  readonly acceptedAt: Date | null;
  readonly acceptedIpAddress: string | null;
  readonly refusedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly requestedBy: {
    readonly id: string;
    readonly firstName: string;
    readonly lastName: string;
  };
  readonly account: { readonly id: string } | null;
}

@Injectable()
export class WhatsAppAccountService {
  private readonly logger = new Logger(WhatsAppAccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    @Inject(WHATSAPP_GATEWAY_TOKEN) private readonly gateway: WhatsAppGateway,
    @Inject(WHATSAPP_GATEWAY_CONFIG_TOKEN) private readonly gatewayConfig: WhatsAppGatewayConfig,
  ) {}

  // ---------------------------------------------------------------------------
  // Texte de consentement
  // ---------------------------------------------------------------------------

  /**
   * Rend le texte en vigueur.
   *
   * Route separee de l'appairage, et c'est important : le membre doit pouvoir
   * LIRE ce qu'il autorise avant d'envoyer `acceptConsent: true`. Sans cette
   * route, l'interface n'aurait rien a montrer et l'acceptation serait un clic
   * sur une case vide.
   */
  consentText(
    actor: AuthenticatedUser,
    scopes?: readonly string[],
  ): {
    version: string;
    text: string;
    maxMessagesPerHour: number;
  } {
    return {
      version: CONSENT_VERSION,
      text: describeConsent({
        requestedBy: memberLabel(actor),
        scopes: normalizeGrantScopes(scopes),
        expiresAt: this.defaultConsentExpiry(new Date()),
        maxMessagesPerHour: this.gatewayConfig.maxMessagesPerHour,
      }),
      maxMessagesPerHour: this.gatewayConfig.maxMessagesPerHour,
    };
  }

  // ---------------------------------------------------------------------------
  // Routes du membre connecte
  // ---------------------------------------------------------------------------

  /** Etat du compte WhatsApp du membre, ou `null` s'il n'en a aucun. */
  async getSelfState(actor: AuthenticatedUser): Promise<WhatsAppAccountView | null> {
    const account = await this.prisma.whatsAppAccount.findFirst({
      where: { userId: actor.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: ACCOUNT_SELECT,
    });

    if (!account) return null;

    // L'etat est relu si le cache est perime : afficher « CONNECTED » alors que
    // le telephone est hors ligne depuis une heure ferait echouer l'envoi suivant
    // sans explication.
    return this.toView(await this.syncStatus(account));
  }

  /** Demarre (ou reprend) l'appairage du compte du membre. */
  async startSelfSession(
    actor: AuthenticatedUser,
    dto: StartWhatsAppSessionDto,
    meta: RequestContext,
  ): Promise<WhatsAppPairingView> {
    this.assertGatewayConfigured();
    this.assertConsentAccepted(dto.acceptConsent);

    const scopes = normalizeGrantScopes(dto.scopes);

    const existing = await this.prisma.whatsAppAccount.findFirst({
      where: { userId: actor.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: ACCOUNT_SELECT,
    });

    // Reprendre une session existante plutot que d'en creer une seconde : deux
    // sessions pour un meme membre signifieraient deux acces concurrents a son
    // numero, et WhatsApp deconnecte l'une des deux sans prevenir.
    if (existing) {
      return this.pairingViewFor(await this.syncStatus(existing, { force: true }));
    }

    const account = await this.createAccount({
      userId: actor.id,
      ownerKind: WhatsAppOwnerKind.SELF,
      scopes,
      ipAddress: meta.ipAddress,
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'WHATSAPP_SESSION_STARTED',
      entityType: 'WhatsAppAccount',
      entityId: account.id,
      after: { ownerKind: 'SELF', scopes, consentVersion: CONSENT_VERSION },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.pairingViewFor(account);
  }

  /** Revoque le compte du membre : coupe la session et supprime les contacts copies. */
  async revokeSelf(actor: AuthenticatedUser, meta: RequestContext): Promise<{ revoked: true }> {
    const account = await this.prisma.whatsAppAccount.findFirst({
      where: { userId: actor.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: ACCOUNT_SELECT,
    });

    if (!account) return { revoked: true };

    await this.revokeAccount(account, actor.id, meta, 'Revoque par le membre lui-meme');
    return { revoked: true };
  }

  // ---------------------------------------------------------------------------
  // Delegations : demander l'autorisation d'un tiers
  // ---------------------------------------------------------------------------

  /**
   * Cree une invitation et envoie le texte de consentement au tiers.
   *
   * LE CODE N'EST RENDU QU'ICI. Ni la liste, ni le detail, ni les journaux ne le
   * portent : la base n'en conserve que l'empreinte (`hashDelegationCode`).
   */
  async createDelegation(
    actor: AuthenticatedUser,
    dto: CreateWhatsAppDelegationDto,
    meta: RequestContext,
  ): Promise<{
    delegation: WhatsAppDelegationView;
    code: string;
    botUrl: string;
    consentText: string;
  }> {
    this.assertGatewayConfigured();

    const email = (dto.delegatorEmail ?? '').trim();
    if (email.length === 0) {
      // Une invitation sans destinataire ne part nulle part : le code expirerait
      // sans avoir ete lu, et le membre croirait avoir demande une autorisation.
      throw AppException.unprocessable(
        'WHATSAPP_DELEGATION_UNREACHABLE',
        'Une adresse courriel est requise pour remettre l’invitation et le texte de consentement au tiers.',
      );
    }

    const scopes = normalizeGrantScopes(dto.scopes);
    const code = generateDelegationCode();
    const now = new Date();
    const codeExpiresAt = new Date(now.getTime() + this.gatewayConfig.delegationCodeTtlMs);
    const consentExpiresAt = dto.expiresInDays
      ? new Date(now.getTime() + dto.expiresInDays * 86_400_000)
      : this.defaultConsentExpiry(now);

    const consentText = describeConsent({
      requestedBy: memberLabel(actor),
      delegatorName: dto.delegatorName ?? null,
      scopes,
      expiresAt: consentExpiresAt,
      maxMessagesPerHour: this.gatewayConfig.maxMessagesPerHour,
    });

    const delegation = await this.prisma.whatsAppDelegation.create({
      data: {
        requestedById: actor.id,
        delegatorName: dto.delegatorName?.trim() || null,
        delegatorEmail: email,
        delegatorPhone: dto.delegatorPhone?.trim() || null,
        note: dto.note?.trim() || null,
        status: WhatsAppDelegationStatus.PENDING,
        grantedScopes: [...scopes],
        codeHash: hashDelegationCode(code),
        codeExpiresAt,
        expiresAt: consentExpiresAt,
      },
      select: DELEGATION_SELECT,
    });

    const botUrl = this.telegramStartUrl(code);

    // L'envoi du courriel est tente APRES la creation : si le transport echoue,
    // l'invitation existe encore et le code reste affiche ici. Inverser
    // produirait un courriel sans delegation en base, donc un code inutilisable.
    try {
      await this.mail.sendWhatsAppDelegation({
        to: email,
        delegatorName: delegation.delegatorName,
        requesterName: memberLabel(actor),
        code,
        botUrl,
        consentText,
        expiresInLabel: humanDuration(this.gatewayConfig.delegationCodeTtlMs),
        note: delegation.note,
      });
    } catch (error) {
      this.logger.warn(
        `Invitation WhatsApp non envoyee a ${email} (delegation ${delegation.id}) : ` +
          `${error instanceof Error ? error.message : String(error)}. Le code reste valable.`,
      );
    }

    await this.audit.record({
      actorId: actor.id,
      action: 'WHATSAPP_DELEGATION_REQUESTED',
      entityType: 'WhatsAppDelegation',
      entityId: delegation.id,
      // Le code n'est PAS journalise : le journal d'audit se lit dans
      // l'administration, et un code lisible y serait utilisable.
      after: { scopes, codeExpiresAt, expiresAt: consentExpiresAt },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      delegation: this.toDelegationView(delegation),
      code,
      botUrl,
      consentText,
    };
  }

  /** Liste des invitations, bornee aux permissions reelles du porteur. */
  async listDelegations(
    actor: AuthenticatedUser,
    query: ListWhatsAppDelegationsQueryDto,
  ): Promise<Paginated<WhatsAppDelegationView>> {
    const pagination = resolvePagination(query);

    // `all=true` n'ouvre rien par lui-meme : sans `whatsapp:manage:any`, le
    // filtre reste celui du membre. Un parametre qui elargirait l'acces serait
    // une faille d'acces horizontal — exactement ce que les tests de perimetre du
    // projet cherchent a rendre impossible.
    const canManageAll = actor.permissions.has('whatsapp:manage:any');
    const where = {
      // `all` est une CHAINE : `?all=false` est vrai en test de veracite, donc la
      // comparaison est explicite. Sans `whatsapp:manage:any`, le filtre reste de
      // toute facon applique — le parametre demande, il n'ouvre rien.
      ...(query.all === 'true' && canManageAll ? {} : { requestedById: actor.id }),
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.whatsAppDelegation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
        select: DELEGATION_SELECT,
      }),
      this.prisma.whatsAppDelegation.count({ where }),
    ]);

    return paginated(
      rows.map((row) => this.toDelegationView(row)),
      total,
      pagination,
    );
  }

  /** Retire une invitation : coupe la session si elle avait ete acceptee. */
  async revokeDelegation(
    actor: AuthenticatedUser,
    delegationId: string,
    meta: RequestContext,
  ): Promise<WhatsAppDelegationView> {
    const delegation = await this.prisma.whatsAppDelegation.findUnique({
      where: { id: delegationId },
      select: DELEGATION_SELECT,
    });

    if (!delegation) {
      // 404 et non 403 : ne pas reveler qu'une invitation existe ailleurs. C'est
      // la regle appliquee partout dans ce projet (voir `docs/API-N8N.md` §4).
      throw AppException.notFound('WHATSAPP_DELEGATION_NOT_FOUND', 'Invitation introuvable.');
    }

    const isRequester = delegation.requestedById === actor.id;
    if (!isRequester && !actor.permissions.has('whatsapp:manage:any')) {
      throw AppException.forbidden(
        'Droit insuffisant : sa propre invitation, ou whatsapp:manage:any.',
      );
    }

    const account = delegation.account?.id
      ? await this.prisma.whatsAppAccount.findUnique({
          where: { id: delegation.account.id },
          select: ACCOUNT_SELECT,
        })
      : null;

    if (account && !account.revokedAt) {
      await this.revokeAccount(account, actor.id, meta, 'Invitation retiree');
    }

    const updated = await this.prisma.whatsAppDelegation.update({
      where: { id: delegationId },
      data: { status: WhatsAppDelegationStatus.REVOKED, revokedAt: new Date() },
      select: DELEGATION_SELECT,
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'WHATSAPP_DELEGATION_REVOKED',
      entityType: 'WhatsAppDelegation',
      entityId: delegationId,
      before: { status: delegation.status, accountId: account?.id ?? null },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.toDelegationView(updated);
  }

  // ---------------------------------------------------------------------------
  // Routes d'integration (bot n8n)
  // ---------------------------------------------------------------------------

  /**
   * Redeeme un code d'autorisation : le tiers accepte, une session est ouverte.
   *
   * Appele par le bot quand le tiers envoie `/autoriser <code>` dans Telegram. Le
   * QR rendu est celui que le bot affiche ensuite : c'est le scan, depuis LE
   * TELEPHONE DU TIERS, qui termine l'appairage — Comexa ne peut pas le faire a sa
   * place, et c'est la garantie que le titulaire est bien celui qui accepte.
   */
  async acceptDelegation(
    dto: AcceptWhatsAppDelegationDto,
    actor: AuthenticatedUser,
    meta: RequestContext,
  ): Promise<{
    pairing: WhatsAppPairingView;
    consentText: string;
    delegation: WhatsAppDelegationView;
  }> {
    this.assertGatewayConfigured();
    this.assertConsentAccepted(dto.acceptConsent);

    if (!looksLikeDelegationCode(dto.code)) {
      throw AppException.unprocessable(
        'WHATSAPP_CODE_INVALID',
        'Le code d’autorisation est illisible. Forme attendue : WA-XXXX-XXXX-XXXX.',
      );
    }

    const now = new Date();
    const delegation = await this.prisma.whatsAppDelegation.findUnique({
      where: { codeHash: hashDelegationCode(dto.code) },
      select: DELEGATION_SELECT,
    });

    // UN SEUL MESSAGE POUR TROIS CAUSES (absent, deja utilise, expire) : un code
    // d'autorisation est un secret, et distinguer « inconnu » de « deja redeemé »
    // donnerait un oracle pour en tester d'autres.
    if (
      !delegation ||
      delegation.status !== WhatsAppDelegationStatus.PENDING ||
      !delegation.codeExpiresAt ||
      delegation.codeExpiresAt.getTime() <= now.getTime()
    ) {
      throw AppException.notFound(
        'WHATSAPP_CODE_INVALID',
        'Code d’autorisation invalide, deja utilise ou expire.',
      );
    }

    // Les capacites accordees sont CELLES DE LA DEMANDE : ce que le tiers a lu
    // dans le courriel est exactement ce que le compte obtient.
    const scopes = normalizeGrantScopes(delegation.grantedScopes);

    const consentText = describeConsent({
      requestedBy: `${delegation.requestedBy.firstName} ${delegation.requestedBy.lastName}`.trim(),
      delegatorName: delegation.delegatorName,
      scopes,
      expiresAt: delegation.expiresAt,
      maxMessagesPerHour: this.gatewayConfig.maxMessagesPerHour,
    });

    const account = await this.createAccount({
      userId: delegation.requestedById,
      ownerKind: WhatsAppOwnerKind.DELEGATED,
      delegationId: delegation.id,
      scopes,
      ipAddress: meta.ipAddress,
      consentExpiresAt: delegation.expiresAt,
    });

    const updatedDelegation = await this.prisma.whatsAppDelegation.update({
      where: { id: delegation.id },
      data: {
        status: WhatsAppDelegationStatus.ACCEPTED,
        acceptedAt: now,
        acceptedIpAddress: meta.ipAddress,
        delegatorTelegramUserId: dto.telegramUserId,
        delegatorTelegramChatId: dto.telegramChatId,
        // Le code est CONSOMME : sans cette mise a null, une seconde redemption
        // du meme code ouvrirait une seconde session sur le meme compte.
        codeHash: null,
        codeExpiresAt: null,
      },
      select: DELEGATION_SELECT,
    });

    await this.audit.record({
      // L'ACTEUR EST LE COMPTE TECHNIQUE DU JETON, pas le demandeur de
      // l'invitation. Celui qui a redeeme le code est le TIERS (identifie par
      // `telegramUserId` ci-dessous) ; attribuer l'acceptation au demandeur
      // ecrirait dans le journal qu'il s'est autorise lui-meme — exactement ce
      // que le consentement d'un tiers existe pour empecher.
      actorId: actor.id,
      action: 'WHATSAPP_DELEGATION_ACCEPTED',
      entityType: 'WhatsAppDelegation',
      entityId: delegation.id,
      after: {
        accountId: account.id,
        telegramUserId: dto.telegramUserId,
        telegramUsername: dto.telegramUsername ?? null,
        scopes,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      pairing: await this.pairingViewFor(account),
      consentText,
      delegation: this.toDelegationView(updatedDelegation),
    };
  }

  /** Refus explicite du tiers (`/refuser <code>`). */
  async refuseDelegation(
    dto: RefuseWhatsAppDelegationDto,
    actor: AuthenticatedUser,
    meta: RequestContext,
  ): Promise<{ refused: true }> {
    const code = dto.code;

    if (!looksLikeDelegationCode(code)) {
      throw AppException.unprocessable(
        'WHATSAPP_CODE_INVALID',
        'Le code d’autorisation est illisible. Forme attendue : WA-XXXX-XXXX-XXXX.',
      );
    }

    const delegation = await this.prisma.whatsAppDelegation.findUnique({
      where: { codeHash: hashDelegationCode(code) },
      select: DELEGATION_SELECT,
    });

    if (!delegation || delegation.status !== WhatsAppDelegationStatus.PENDING) {
      throw AppException.notFound(
        'WHATSAPP_CODE_INVALID',
        'Code d’autorisation invalide, deja utilise ou expire.',
      );
    }

    await this.prisma.whatsAppDelegation.update({
      where: { id: delegation.id },
      data: {
        status: WhatsAppDelegationStatus.REFUSED,
        refusedAt: new Date(),
        codeHash: null,
        codeExpiresAt: null,
      },
    });

    await this.audit.record({
      // Meme raison que pour l'acceptation : le refus vient du tiers, par
      // l'intermediaire du bot. Le demandeur n'a rien fait ici.
      actorId: actor.id,
      action: 'WHATSAPP_DELEGATION_REFUSED',
      entityType: 'WhatsAppDelegation',
      entityId: delegation.id,
      // Le chat d'ou vient le refus est journalise : c'est la seule trace de QUI
      // a dit non, aucune identite Telegram n'etant connue avant l'acceptation.
      before: { status: delegation.status, refusedFromTelegramUserId: dto.telegramUserId ?? null },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { refused: true };
  }

  /**
   * Demarre (ou reprend) l'appairage du compte d'un membre, a la demande du bot.
   *
   * `userId` vient du CHEMIN, pas du corps : le bot l'a obtenu en resolvant
   * l'identifiant Telegram (`GET /integrations/telegram/resolve/:id`), et le jeton
   * d'integration porte le scope `whatsapp:link:any` qui autorise cet appel pour
   * n'importe quel membre.
   */
  async startSessionForUser(
    userId: string,
    actor: AuthenticatedUser,
    meta: RequestContext,
    dto: StartWhatsAppSessionDto,
  ): Promise<WhatsAppPairingView> {
    this.assertScope(actor, 'whatsapp:link:any');
    this.assertGatewayConfigured();
    this.assertConsentAccepted(dto.acceptConsent);

    const target = await this.loadActiveMember(userId);
    const scopes = normalizeGrantScopes(dto.scopes);

    const existing = await this.prisma.whatsAppAccount.findFirst({
      where: { userId: target.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: ACCOUNT_SELECT,
    });

    if (existing) {
      return this.pairingViewFor(await this.syncStatus(existing, { force: true }));
    }

    const account = await this.createAccount({
      userId: target.id,
      ownerKind: WhatsAppOwnerKind.SELF,
      scopes,
      ipAddress: meta.ipAddress,
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'WHATSAPP_SESSION_STARTED',
      entityType: 'WhatsAppAccount',
      entityId: account.id,
      after: { ownerKind: 'SELF', forUserId: target.id, scopes, viaIntegration: true },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.pairingViewFor(account);
  }

  /** Etat du compte d'un membre, rafraichi si le cache est perime. */
  async sessionStatusForUser(
    userId: string,
    actor: AuthenticatedUser,
  ): Promise<WhatsAppAccountView> {
    this.assertScope(actor, 'whatsapp:link:any');

    const account = await this.prisma.whatsAppAccount.findFirst({
      where: { userId },
      // Une session revoquee passe en dernier : tant qu'un compte actif existe,
      // c'est lui qui interesse le bot.
      orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
      select: ACCOUNT_SELECT,
    });

    if (!account) {
      throw AppException.notFound(
        'WHATSAPP_ACCOUNT_NOT_FOUND',
        'Aucun compte WhatsApp pour ce membre. Lancer l’appairage d’abord.',
      );
    }

    return this.toView(await this.syncStatus(account));
  }

  /** Revoque le compte d'un membre (le titulaire via le bot, ou un admin). */
  async revokeSessionForUser(
    userId: string,
    actor: AuthenticatedUser,
    meta: RequestContext,
  ): Promise<{ revoked: true }> {
    this.assertScope(actor, 'whatsapp:link:any');

    const account = await this.prisma.whatsAppAccount.findFirst({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: ACCOUNT_SELECT,
    });

    if (!account) return { revoked: true };

    await this.revokeAccount(account, actor.id, meta, 'Revoque via le bot');
    return { revoked: true };
  }

  // ---------------------------------------------------------------------------
  // Administration
  // ---------------------------------------------------------------------------

  /** Tous les comptes appaires, pour l'administration. */
  async listAccounts(
    actor: AuthenticatedUser,
    query: ListWhatsAppAccountsQueryDto,
  ): Promise<Paginated<WhatsAppAccountView>> {
    this.assertScope(actor, 'whatsapp:manage:any');
    const pagination = resolvePagination(query);

    const where = query.status ? { status: query.status as WhatsAppSessionStatus } : {};

    const [rows, total] = await Promise.all([
      this.prisma.whatsAppAccount.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
        select: ACCOUNT_SELECT,
      }),
      this.prisma.whatsAppAccount.count({ where }),
    ]);

    // L'administration lit l'etat EN CACHE : rafraichir chaque session d'une page
    // de vingt lignes ferait vingt allers-retours vers la passerelle, donc vers
    // vingt telephones. Le champ `lastStatusAt` dit de quand date chaque etat.
    return paginated(
      rows.map((row) => this.toView(row)),
      total,
      pagination,
    );
  }

  /** Revoque n'importe quel compte (administration). */
  async revokeAnyAccount(
    actor: AuthenticatedUser,
    accountId: string,
    meta: RequestContext,
  ): Promise<{ revoked: true }> {
    this.assertScope(actor, 'whatsapp:manage:any');

    const account = await this.prisma.whatsAppAccount.findUnique({
      where: { id: accountId },
      select: ACCOUNT_SELECT,
    });

    if (!account) {
      throw AppException.notFound('WHATSAPP_ACCOUNT_NOT_FOUND', 'Compte WhatsApp introuvable.');
    }

    if (!account.revokedAt) {
      await this.revokeAccount(account, actor.id, meta, 'Revoque par un administrateur');
    }

    return { revoked: true };
  }

  // ---------------------------------------------------------------------------
  // Internes partages avec le service d'envoi
  // ---------------------------------------------------------------------------

  /** Compte utilisable d'un membre, ou `null`. */
  async loadUsableAccount(userId: string): Promise<WhatsAppAccountRow | null> {
    return this.prisma.whatsAppAccount.findFirst({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: ACCOUNT_SELECT,
    });
  }

  /**
   * Interroge la passerelle si l'etat en base est perime.
   *
   * `force` sert a l'appairage et a l'envoi : dans ces deux cas, un etat vieux de
   * quelques secondes change la reponse (le QR a afficher, l'envoi a refuser).
   * Ailleurs, la lecture reste en cache pour ne pas multiplier les allers-retours
   * vers une passerelle qui, elle, parle a un telephone.
   */
  async syncStatus(
    account: WhatsAppAccountRow,
    options: { force?: boolean } = {},
  ): Promise<WhatsAppAccountRow> {
    const fresh =
      account.lastStatusAt !== null &&
      Date.now() - account.lastStatusAt.getTime() < this.gatewayConfig.sessionCacheMs;

    if (account.revokedAt || (!options.force && fresh)) return account;

    try {
      const status = await this.gateway.getStatus(account.sessionName);

      return await this.prisma.whatsAppAccount.update({
        where: { id: account.id },
        data: {
          status: statusToDb(status.state),
          phoneNumber: status.phoneNumber ?? account.phoneNumber,
          pushName: status.pushName ?? account.pushName,
          pairedAt:
            status.state === 'CONNECTED' ? (account.pairedAt ?? new Date()) : account.pairedAt,
          lastStatusAt: new Date(),
          lastError: status.error,
        },
        select: ACCOUNT_SELECT,
      });
    } catch (error) {
      if (
        error instanceof WhatsAppGatewayError &&
        error.code === WHATSAPP_ERROR_CODES.SESSION_NOT_FOUND
      ) {
        // La session a disparu cote passerelle (volume perdu, instance supprimee).
        // L'ecrire en base evite de proposer un envoi qui echouerait sans raison
        // apparente.
        return await this.prisma.whatsAppAccount.update({
          where: { id: account.id },
          data: {
            status: WhatsAppSessionStatus.DISCONNECTED,
            lastStatusAt: new Date(),
            lastError: 'Session absente cote passerelle : relancer l’appairage.',
          },
          select: ACCOUNT_SELECT,
        });
      }

      // Passerelle injoignable : l'etat en base reste, avec l'erreur lue. Ne pas
      // faire echouer la requete — un etat un peu ancien vaut mieux qu'un espace
      // WhatsApp entierement indisponible pendant une panne reseau.
      this.logger.warn(
        `Etat de session illisible pour ${account.sessionName} : ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );

      return await this.prisma.whatsAppAccount.update({
        where: { id: account.id },
        data: {
          lastStatusAt: new Date(),
          lastError:
            error instanceof WhatsAppGatewayError
              ? error.message.slice(0, 500)
              : 'Passerelle injoignable.',
        },
        select: ACCOUNT_SELECT,
      });
    }
  }

  /** Rend la vue d'un compte, validite du consentement calculee. */
  toView(account: WhatsAppAccountRow): WhatsAppAccountView {
    const consent = evaluateConsent({
      consentVersion: account.consentVersion,
      consentAcceptedAt: account.consentAcceptedAt,
      consentExpiresAt: account.consentExpiresAt,
      revokedAt: account.revokedAt,
      grantedScopes: account.grantedScopes,
    });

    return toWhatsAppAccountView(account, consent.ok && !account.revokedAt);
  }

  /** Traduit une erreur de passerelle en exception applicative. */
  toAppException(error: unknown): AppException {
    if (error instanceof AppException) return error;

    if (!(error instanceof WhatsAppGatewayError)) {
      this.logger.error(
        `Erreur inattendue de la passerelle WhatsApp : ${
          error instanceof Error ? error.stack : String(error)
        }`,
      );
      return new AppException(
        WHATSAPP_ERROR_CODES.UPSTREAM_FAILED,
        'La passerelle WhatsApp a echoue pour une raison inattendue.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    return new AppException(error.code, error.message, httpStatusForGatewayError(error.code));
  }

  // ---------------------------------------------------------------------------
  // Internes prives
  // ---------------------------------------------------------------------------

  /** Cree la ligne en base, puis la session cote passerelle. */
  private async createAccount(params: {
    userId: string;
    ownerKind: WhatsAppOwnerKind;
    scopes: readonly string[];
    ipAddress: string | null;
    delegationId?: string | null;
    consentExpiresAt?: Date | null;
  }): Promise<WhatsAppAccountRow> {
    const now = new Date();
    const consentExpiresAt =
      params.consentExpiresAt === undefined
        ? this.defaultConsentExpiry(now)
        : params.consentExpiresAt;

    // LE NOM DE SESSION EST TIRE AU SORT, ET LA CONTRAINTE UNIQUE EST LE FILET.
    // Trois tentatives suffisent largement (6 octets d'alea) ; au-dela, autre
    // chose ne va pas et il faut le dire plutot que de boucler.
    let account: WhatsAppAccountRow | null = null;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 3 && !account; attempt++) {
      const sessionName = sessionNameFor(this.gatewayConfig.sessionPrefix);
      if (!isUsableSessionName(sessionName)) continue;

      try {
        account = await this.prisma.whatsAppAccount.create({
          data: {
            userId: params.userId,
            ownerKind: params.ownerKind,
            gatewayDriver: this.gateway.driver,
            sessionName,
            status: WhatsAppSessionStatus.STARTING,
            grantedScopes: [...params.scopes],
            consentVersion: CONSENT_VERSION,
            consentAcceptedAt: now,
            consentIpAddress: params.ipAddress,
            consentExpiresAt,
            delegationId: params.delegationId ?? null,
          },
          select: ACCOUNT_SELECT,
        });
      } catch (error) {
        lastError = error;
        // P2002 : nom de session deja pris. On retente avec un autre alea.
        if (!isUniqueViolation(error)) throw error;
      }
    }

    if (!account) {
      throw new AppException(
        'WHATSAPP_SESSION_NAME_EXHAUSTED',
        'Impossible de choisir un nom de session unique. Reessayer ; si l’erreur persiste, ' +
          'verifier WHATSAPP_SESSION_PREFIX.',
        HttpStatus.INTERNAL_SERVER_ERROR,
        { cause: lastError instanceof Error ? lastError.message : String(lastError) },
      );
    }

    // La session cote passerelle est creee APRES la ligne : si la passerelle
    // refuse, la ligne reste et son etat dit l'echec. Creer d'abord la session
    // laisserait, en cas d'echec en base, une session orpheline — donc un acces
    // WhatsApp que personne ne peut revoquer depuis Comexa.
    try {
      await this.gateway.ensureSession(account.sessionName);
      await this.gateway.startSession(account.sessionName);
    } catch (error) {
      await this.prisma.whatsAppAccount.update({
        where: { id: account.id },
        data: {
          status: WhatsAppSessionStatus.FAILED,
          lastStatusAt: new Date(),
          lastError:
            error instanceof Error ? error.message.slice(0, 500) : 'Echec de la passerelle.',
        },
      });
      throw this.toAppException(error);
    }

    return await this.prisma.whatsAppAccount.update({
      where: { id: account.id },
      data: { status: WhatsAppSessionStatus.WAITING_QR, lastStatusAt: new Date() },
      select: ACCOUNT_SELECT,
    });
  }

  /** Construit la vue d'appairage, QR compris. */
  private async pairingViewFor(account: WhatsAppAccountRow): Promise<WhatsAppPairingView> {
    let qr: WhatsAppPairingView['qr'] = null;
    let status: WhatsAppSessionStatus = account.status;

    try {
      const code = await this.gateway.getQrCode(account.sessionName);
      qr = {
        imageBase64: code.imageBase64,
        rawValue: code.rawValue,
        pairingCode: code.pairingCode,
      };
      status = WhatsAppSessionStatus.WAITING_QR;
    } catch (error) {
      // Session deja appairee, ou passerelle muette : l'etat reel est plus utile
      // qu'un QR. On rend la vue SANS QR, et le bot pourra dire « deja connecte »
      // au lieu d'afficher une image vide.
      status = (await this.syncStatus(account, { force: true })).status;
      this.logger.warn(
        `QR indisponible pour ${account.sessionName} (${status}) : ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const consentText = describeConsent({
      requestedBy: `${account.user.firstName} ${account.user.lastName}`.trim(),
      delegatorName: account.delegation?.delegatorName ?? null,
      // REPASSER PAR `normalizeGrantScopes` ET NON PAR UN CAST : la colonne est
      // un tableau de chaines, donc une valeur ajoutee en base hors de ce service
      // (migration, correction manuelle) arriverait ici. Normaliser ignore ce qui
      // n'est pas une capacite connue et retombe sur `message:send` si rien ne
      // subsiste — un texte de consentement qui annoncerait une capacite
      // inexistante serait une promesse fausse.
      scopes: normalizeGrantScopes(account.grantedScopes),
      expiresAt: account.consentExpiresAt,
      maxMessagesPerHour: this.gatewayConfig.maxMessagesPerHour,
    });

    return {
      accountId: account.id,
      sessionName: account.sessionName,
      status,
      ownerKind: account.ownerKind === WhatsAppOwnerKind.DELEGATED ? 'DELEGATED' : 'SELF',
      qr,
      consentText,
      consentVersion: CONSENT_VERSION,
      consentExpiresAt: account.consentExpiresAt?.toISOString() ?? null,
      instructions: PAIRING_INSTRUCTIONS,
    };
  }

  /**
   * Revoque : coupe la session, supprime les contacts copies, journalise.
   *
   * LES CONTACTS SONT SUPPRIMES, ET CE N'EST PAS UNE PRECAUTION DE STYLE. Ce sont
   * les donnees de personnes qui n'ont rien demande, copiees sous le couvert d'une
   * autorisation qui prend fin. Les conserver apres la revocation transformerait
   * un retrait d'acces en simple changement d'etat.
   */
  private async revokeAccount(
    account: WhatsAppAccountRow,
    actorId: string,
    meta: RequestContext,
    reason: string,
  ): Promise<void> {
    const before = {
      status: account.status,
      sessionName: account.sessionName,
      phoneNumber: account.phoneNumber,
    };

    // 1. Couper cote passerelle : `logout` retire l'appareil visible dans le
    //    WhatsApp du titulaire, `deleteSession` efface les identifiants du volume.
    //    Un echec ne bloque PAS la suite — invariant 3 en tete de fichier.
    try {
      await this.gateway.logout(account.sessionName);
      await this.gateway.deleteSession(account.sessionName);
    } catch (error) {
      this.logger.warn(
        `Session ${account.sessionName} non coupee cote passerelle (${reason}) : ` +
          `${error instanceof Error ? error.message : String(error)}. ` +
          'La revocation en base est appliquee quand meme.',
      );
    }

    // 2. En base, dans une transaction : l'etat et les contacts partent ensemble.
    //    Les separer laisserait une fenetre ou le compte est revoque mais son
    //    repertoire encore lisible.
    await this.prisma.$transaction([
      this.prisma.whatsAppAccount.update({
        where: { id: account.id },
        data: {
          status: WhatsAppSessionStatus.REVOKED,
          revokedAt: new Date(),
          lastStatusAt: new Date(),
          lastError: reason,
          // L'adresse IP du consentement est effacee : elle n'a plus d'usage une
          // fois l'autorisation retiree, et c'est une donnee de localisation.
          consentIpAddress: null,
        },
      }),
      this.prisma.whatsAppContact.deleteMany({ where: { accountId: account.id } }),
    ]);

    await this.audit.record({
      actorId,
      action: 'WHATSAPP_SESSION_REVOKED',
      entityType: 'WhatsAppAccount',
      entityId: account.id,
      before,
      after: { reason, contactsDeleted: true },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  private toDelegationView(row: WhatsAppDelegationRow): WhatsAppDelegationView {
    return toWhatsAppDelegationView({ ...row, grantedScopes: row.grantedScopes });
  }

  private defaultConsentExpiry(now: Date): Date | null {
    const ttl = this.gatewayConfig.consentTtlMs;
    return ttl === null ? null : new Date(now.getTime() + ttl);
  }

  /** Lien profond Telegram : `https://t.me/<bot>?start=wa_<code>`. */
  private telegramStartUrl(code: string): string {
    const bot = (this.config.get<string>('TELEGRAM_BOT_USERNAME') ?? 'ComexaWork_bot').replace(
      /^@/,
      '',
    );
    // Le payload `start` est borne par Telegram a 64 caracteres et a
    // `[A-Za-z0-9_-]` : le code normalise (sans tirets) tient largement.
    const payload = `wa_${normalizeDelegationCode(code) ?? ''}`;
    return `https://t.me/${bot}?start=${encodeURIComponent(payload)}`;
  }

  private assertGatewayConfigured(): void {
    if (!this.gateway.configured) {
      throw new AppException(
        WHATSAPP_ERROR_CODES.NOT_CONFIGURED,
        'Aucune passerelle WhatsApp n’est configuree (WHATSAPP_GATEWAY_DRIVER=none). ' +
          'Voir docs/TELEGRAM-VOIX-WHATSAPP.md pour en heberger une.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private assertConsentAccepted(accepted: boolean | undefined): void {
    if (accepted !== true) {
      throw AppException.unprocessable(
        'WHATSAPP_CONSENT_REQUIRED',
        'Le texte de consentement doit etre accepte explicitement (acceptConsent: true). ' +
          'Il est rendu par GET /me/whatsapp/consent.',
      );
    }
  }

  private assertScope(actor: AuthenticatedUser, scope: string): void {
    if (!actor.permissions.has(scope)) {
      throw AppException.forbidden(`Droit insuffisant : ${scope}`);
    }
  }

  /**
   * Charge un membre actif, en refusant comptes suspendus, supprimes et comptes
   * de service — meme regle que `TelegramLinkService.loadLinkedUser`.
   */
  private async loadActiveMember(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, status: true, isServiceAccount: true },
    });

    if (!user || user.isServiceAccount || user.status !== UserStatus.ACTIVE) {
      throw AppException.unauthenticated(
        'WHATSAPP_TARGET_UNUSABLE',
        'Ce compte Comexa n’est pas actif : aucun compte WhatsApp ne peut lui etre rattache.',
      );
    }

    return user;
  }
}

/** Etat de passerelle -> enum Prisma. */
function statusToDb(state: GatewaySessionState): WhatsAppSessionStatus {
  switch (state) {
    case 'CONNECTED':
      return WhatsAppSessionStatus.CONNECTED;
    case 'WAITING_QR':
      return WhatsAppSessionStatus.WAITING_QR;
    case 'STARTING':
      return WhatsAppSessionStatus.STARTING;
    case 'FAILED':
      return WhatsAppSessionStatus.FAILED;
    default:
      return WhatsAppSessionStatus.DISCONNECTED;
  }
}

/**
 * Statut HTTP d'une erreur de passerelle.
 *
 *  - 503 quand rien n'est configure : l'appelant peut corriger son deploiement ;
 *  - 502 quand la passerelle est en cause (injoignable, en erreur, cle refusee,
 *    fonctionnalite absente) : la faute est en amont, pas dans la requete ;
 *  - 409 quand l'etat de la session empeche l'operation : la meme requete
 *    reussira apres un appairage ;
 *  - 400 quand le destinataire est illisible : la requete est a corriger.
 */
function httpStatusForGatewayError(code: string): HttpStatus {
  switch (code) {
    case WHATSAPP_ERROR_CODES.NOT_CONFIGURED:
      return HttpStatus.SERVICE_UNAVAILABLE;
    case WHATSAPP_ERROR_CODES.SESSION_NOT_FOUND:
    case WHATSAPP_ERROR_CODES.SESSION_NOT_CONNECTED:
      return HttpStatus.CONFLICT;
    case WHATSAPP_ERROR_CODES.INVALID_RECIPIENT:
      return HttpStatus.BAD_REQUEST;
    default:
      return HttpStatus.BAD_GATEWAY;
  }
}

/** Vrai sur une violation de contrainte d'unicite Prisma (code P2002). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
  );
}

/** Etiquette d'un membre, pour les textes adresses a des personnes. */
function memberLabel(actor: AuthenticatedUser): string {
  return `${actor.firstName} ${actor.lastName}`.trim();
}

/** Duree lisible par une personne : `72h` -> « 3 jours », `45m` -> « 45 minutes ». */
export function humanDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minutes`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} heure${hours > 1 ? 's' : ''}`;

  const days = Math.round(hours / 24);
  return `${days} jour${days > 1 ? 's' : ''}`;
}
