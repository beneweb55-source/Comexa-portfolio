import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser, RequireAnyPermission } from '../../common/decorators/auth.decorators.js';
import type { Paginated } from '../../common/dto/pagination.dto.js';
import { RequestMeta, type RequestContext } from '../projects/request-meta.decorator.js';
import {
  CreateWhatsAppDelegationDto,
  ListWhatsAppAccountsQueryDto,
  ListWhatsAppContactsQueryDto,
  ListWhatsAppDelegationsQueryDto,
  ListWhatsAppMessagesQueryDto,
  SendWhatsAppMessageDto,
  StartWhatsAppSessionDto,
} from './dto/whatsapp.dto.js';
import { WhatsAppAccountService } from './whatsapp-account.service.js';
import { WhatsAppMessagingService } from './whatsapp-messaging.service.js';
import type {
  WhatsAppAccountView,
  WhatsAppContactView,
  WhatsAppDelegationView,
  WhatsAppMessageView,
  WhatsAppPairingView,
} from './whatsapp.presenter.js';

/**
 * WHATSAPP — ROUTES DES MEMBRES ET DE L'ADMINISTRATION.
 *
 * -------------------------------------------------------------------------
 * DEUX PUBLICS, DEUX PREFIXES
 * -------------------------------------------------------------------------
 *  - `/me/whatsapp/*` : le membre connecte gere SON compte. Aucune permission
 *    n'est exigee au-dela de l'authentification — comme `/me/telegram-link` — et
 *    le perimetre est tenu par le service, qui ne lit jamais d'identifiant dans le
 *    corps : il prend celui du jeton.
 *
 *  - `/whatsapp/*` : delegations et administration. Ces routes exigent des codes
 *    du catalogue (`whatsapp:delegate:any`, `whatsapp:manage:any`), verifies par
 *    `PermissionsGuard` AVANT d'entrer dans le service.
 *
 * Les routes du BOT ne sont pas ici : voir `whatsapp-integration.controller.ts`,
 * sous `/integrations/whatsapp/*` (alias `/api/v1/...`), protegees par les scopes
 * d'un jeton `cxi_`.
 *
 * -------------------------------------------------------------------------
 * LIMITES DE DEBIT PROPRES
 * -------------------------------------------------------------------------
 * Le plafond global (120 requetes/minute) est dimensionne pour un navigateur.
 * Deux routes d'ici meritent plus strict, et pour des raisons differentes :
 *
 *  - `POST /me/whatsapp/messages` : chaque appel envoie un message REEL depuis le
 *    telephone de quelqu'un. La limite horaire par compte
 *    (`WHATSAPP_MAX_MESSAGES_PER_HOUR`) borne le volume ; celle-ci borne la rafale
 *    — dix envois en deux secondes depuis un compte appaire sont le signe d'une
 *    boucle, pas d'un usage.
 *  - `POST /me/whatsapp/session` : chaque appel cree une session cote passerelle
 *    et affiche un QR. Sans limite, un clic repete empile des sessions inutiles
 *    sur le telephone du titulaire.
 */
@ApiTags('WhatsApp')
@Controller()
export class WhatsAppController {
  constructor(
    private readonly accounts: WhatsAppAccountService,
    private readonly messaging: WhatsAppMessagingService,
  ) {}

  // ---------------------------------------------------------------------------
  // Espace du membre
  // ---------------------------------------------------------------------------

  @Get('me/whatsapp')
  @ApiOperation({
    summary: 'Etat du compte WhatsApp du membre connecte.',
    description:
      'Rend `null` tant qu’aucun appairage n’a ete lance. L’etat est rafraichi ' +
      'depuis la passerelle quand le cache est perime (WHATSAPP_SESSION_CACHE_MS).',
  })
  async getState(@CurrentUser() actor: AuthenticatedUser): Promise<WhatsAppAccountView | null> {
    return this.accounts.getSelfState(actor);
  }

  @Get('me/whatsapp/consent')
  @ApiOperation({
    summary: 'Texte de consentement en vigueur.',
    description:
      'A afficher AVANT `POST /me/whatsapp/session` : l’acceptation (`acceptConsent: true`) ' +
      'n’a de sens que si le texte a ete lu.',
  })
  async getConsent(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('scopes') scopes?: string,
  ): Promise<{ version: string; text: string; maxMessagesPerHour: number }> {
    return this.accounts.consentText(actor, splitScopes(scopes));
  }

  @Throttle({ default: { limit: 6, ttl: 600_000 } })
  @Post('me/whatsapp/session')
  @ApiOperation({
    summary: "Demarre l'appairage du compte WhatsApp du membre.",
    description:
      'Rend le QR code (PNG base64) a scanner depuis WhatsApp > Appareils connectes, ' +
      'la marche a suivre et le texte de consentement. `acceptConsent: true` est obligatoire.',
  })
  async startSession(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: StartWhatsAppSessionDto,
    @RequestMeta() meta: RequestContext,
  ): Promise<WhatsAppPairingView> {
    return this.accounts.startSelfSession(actor, dto, meta);
  }

  @Delete('me/whatsapp/session')
  @ApiOperation({
    summary: 'Revoque son compte WhatsApp.',
    description:
      'Coupe la session cote passerelle, supprime les contacts copies et retire ' +
      "l'autorisation. Toujours effectif, meme si la passerelle ne repond pas.",
  })
  async revokeSession(
    @CurrentUser() actor: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ): Promise<{ revoked: true }> {
    return this.accounts.revokeSelf(actor, meta);
  }

  @Get('me/whatsapp/contacts')
  @ApiOperation({
    summary: 'Contacts du compte appaire (cache).',
    description:
      'Exige la capacite `contact:read`, accordee au moment du consentement. ' +
      '`?refresh=true` resynchronise depuis la passerelle.',
  })
  async listContacts(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListWhatsAppContactsQueryDto,
  ): Promise<Paginated<WhatsAppContactView>> {
    return this.messaging.listContactsForSelf(actor, query);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('me/whatsapp/messages')
  @ApiOperation({
    summary: 'Envoyer un message WhatsApp depuis son compte appaire.',
    description:
      'Applique la regle d’envoi (consentement, session, destinataire, plafond). ' +
      'Un refus est journalise comme tel (`REFUSED`) et n’appelle jamais la passerelle.',
  })
  async sendMessage(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: SendWhatsAppMessageDto,
    @RequestMeta() meta: RequestContext,
  ): Promise<WhatsAppMessageView> {
    return this.messaging.sendForSelf(actor, dto, meta);
  }

  @Get('me/whatsapp/messages')
  @ApiOperation({ summary: 'Journal de ses envois WhatsApp.' })
  async listMessages(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListWhatsAppMessagesQueryDto,
  ): Promise<Paginated<WhatsAppMessageView>> {
    return this.messaging.listMessagesForSelf(actor, query);
  }

  // ---------------------------------------------------------------------------
  // Delegations et administration
  // ---------------------------------------------------------------------------

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('whatsapp/delegations')
  @RequireAnyPermission('whatsapp:delegate:any', 'whatsapp:manage:any')
  @ApiOperation({
    summary: "Demander a un tiers l'autorisation d'envoyer via son compte WhatsApp.",
    description:
      'Envoie le texte de consentement par courriel et rend le code d’autorisation ' +
      'UNE SEULE FOIS. Le tiers ouvre le lien Telegram, tape `/autoriser <code>`, ' +
      'puis scanne le QR depuis son telephone.',
  })
  async createDelegation(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateWhatsAppDelegationDto,
    @RequestMeta() meta: RequestContext,
  ): Promise<{
    delegation: WhatsAppDelegationView;
    code: string;
    botUrl: string;
    consentText: string;
  }> {
    return this.accounts.createDelegation(actor, dto, meta);
  }

  @Get('whatsapp/delegations')
  @RequireAnyPermission('whatsapp:delegate:any', 'whatsapp:manage:any', 'whatsapp:read:any')
  @ApiOperation({
    summary: 'Lister les invitations.',
    description:
      'Sauf `whatsapp:manage:any` avec `?all=true`, la liste reste bornee aux ' +
      'invitations du membre authentifie.',
  })
  async listDelegations(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListWhatsAppDelegationsQueryDto,
  ): Promise<Paginated<WhatsAppDelegationView>> {
    return this.accounts.listDelegations(actor, query);
  }

  @Delete('whatsapp/delegations/:id')
  @RequireAnyPermission('whatsapp:delegate:any', 'whatsapp:manage:any')
  @ApiOperation({
    summary: 'Retirer une invitation (et couper la session si elle avait ete acceptee).',
  })
  async revokeDelegation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @RequestMeta() meta: RequestContext,
  ): Promise<WhatsAppDelegationView> {
    return this.accounts.revokeDelegation(actor, id, meta);
  }

  @Get('whatsapp/accounts')
  @RequireAnyPermission('whatsapp:manage:any')
  @ApiOperation({
    summary: 'Tous les comptes WhatsApp appaires (administration).',
    description:
      'Etats EN CACHE : une page de vingt comptes ne provoque pas vingt ' +
      'interrogations de la passerelle. `lastStatusAt` date chaque etat.',
  })
  async listAccounts(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListWhatsAppAccountsQueryDto,
  ): Promise<Paginated<WhatsAppAccountView>> {
    return this.accounts.listAccounts(actor, query);
  }

  @Delete('whatsapp/accounts/:id')
  @RequireAnyPermission('whatsapp:manage:any')
  @ApiOperation({ summary: 'Revoquer n’importe quel compte WhatsApp (administration).' })
  async revokeAccount(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @RequestMeta() meta: RequestContext,
  ): Promise<{ revoked: true }> {
    return this.accounts.revokeAnyAccount(actor, id, meta);
  }
}

/**
 * `?scopes=message:send,contact:read` -> liste.
 *
 * Une query string ne porte pas de tableau dans ce projet (les DTO de liste
 * n'emploient pas `@Transform`), et ajouter un format de tableau ici creerait une
 * exception au contrat. La virgule est la forme la moins surprenante, et une
 * valeur inconnue est ignoree par `normalizeGrantScopes` — jamais devinee.
 */
function splitScopes(raw: string | undefined): string[] | undefined {
  const value = (raw ?? '').trim();
  if (value.length === 0) return undefined;
  return value
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
}
