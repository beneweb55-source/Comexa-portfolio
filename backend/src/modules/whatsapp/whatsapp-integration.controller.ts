import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import type { Paginated } from '../../common/dto/pagination.dto.js';
import { RequestMeta, type RequestContext } from '../projects/request-meta.decorator.js';
import {
  AcceptWhatsAppDelegationDto,
  ListWhatsAppContactsQueryDto,
  ListWhatsAppMessagesQueryDto,
  RefuseWhatsAppDelegationDto,
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
 * WHATSAPP — ROUTES DU BOT (n8n).
 *
 * -------------------------------------------------------------------------
 * QUI APPELLE CES ROUTES, ET AVEC QUOI
 * -------------------------------------------------------------------------
 * Le workflow n8n du bot @ComexaWork_bot, avec un jeton d'integration `cxi_…`
 * dont les scopes sont un sous-ensemble de :
 *
 *   whatsapp:link:any   appairer, interroger l'etat, revoquer, redeemre un code
 *   whatsapp:send:any   envoyer un message depuis un compte autorise
 *   whatsapp:read:any   lire le repertoire et le journal des envois
 *
 * L'URL publique est `https://<api>/api/v1/integrations/whatsapp/...` (l'alias
 * `/v1` est reecrit par le middleware, comme pour les routes Telegram — voir
 * `docs/API-N8N.md` §1).
 *
 * -------------------------------------------------------------------------
 * POURQUOI `:userId` EST DANS LE CHEMIN
 * -------------------------------------------------------------------------
 * Le bot ne connait pas les identifiants Comexa : il connait des identifiants
 * Telegram. Il appelle D'ABORD `GET /integrations/telegram/resolve/:telegramUserId`,
 * qui rend `userId` et les permissions du membre, puis il emploie `userId` ici.
 *
 * Ce decoupage n'est pas une commodite : il evite que DEUX routes resolvent la
 * meme liaison Telegram, avec deux implementations qui finiraient par ne plus
 * refuser les memes comptes. La resolution reste une seule fois dans
 * `TelegramLinkService`.
 *
 * -------------------------------------------------------------------------
 * AUCUNE DE CES ROUTES N'EST PUBLIQUE
 * -------------------------------------------------------------------------
 * Le garde d'authentification est global : sans jeton valide, tout repond 401.
 * Les scopes, eux, sont verifies PAR ROUTE ci-dessous — un jeton qui n'a que
 * `whatsapp:send:any` ne peut ni appairer, ni lire le repertoire.
 */
@ApiTags('WhatsApp')
@Controller('integrations/whatsapp')
export class WhatsAppIntegrationController {
  constructor(
    private readonly accounts: WhatsAppAccountService,
    private readonly messaging: WhatsAppMessagingService,
  ) {}

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Post('users/:userId/session')
  @RequirePermissions('whatsapp:link:any')
  @ApiOperation({
    summary: "Demarrer l'appairage du compte WhatsApp d'un membre.",
    description:
      'Rend le QR code en base64 (PNG) a envoyer dans le chat Telegram du membre, ' +
      'avec la marche a suivre. `acceptConsent: true` est obligatoire : le bot doit ' +
      'avoir montre le texte de consentement avant d’appeler.',
  })
  async startSession(
    @Param('userId') userId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: StartWhatsAppSessionDto,
    @RequestMeta() meta: RequestContext,
  ): Promise<WhatsAppPairingView> {
    return this.accounts.startSessionForUser(userId, actor, meta, dto);
  }

  @Get('users/:userId/session')
  @RequirePermissions('whatsapp:link:any')
  @ApiOperation({
    summary: 'Etat de la session WhatsApp d’un membre.',
    description:
      'A interroger apres l’affichage du QR : `status` passe a `CONNECTED` quand le ' +
      'telephone a scanne. `lastStatusAt` date la lecture.',
  })
  async sessionStatus(
    @Param('userId') userId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<WhatsAppAccountView> {
    return this.accounts.sessionStatusForUser(userId, actor);
  }

  @Delete('users/:userId/session')
  @RequirePermissions('whatsapp:link:any')
  @ApiOperation({
    summary: 'Revoquer la session WhatsApp d’un membre.',
    description:
      'Coupe la session cote passerelle et supprime les contacts copies. Aboutit ' +
      'meme si la passerelle ne repond pas.',
  })
  async revokeSession(
    @Param('userId') userId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ): Promise<{ revoked: true }> {
    return this.accounts.revokeSessionForUser(userId, actor, meta);
  }

  // ---------------------------------------------------------------------------
  // Delegations (consentement d'un tiers)
  // ---------------------------------------------------------------------------

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('delegations/accept')
  @RequirePermissions('whatsapp:link:any')
  @ApiOperation({
    summary: "Redeemre le code d'autorisation d'un tiers.",
    description:
      'Appelé quand le tiers envoie `/autoriser <code>` au bot. Rend le QR a lui ' +
      'afficher : c’est son scan, depuis son telephone, qui termine l’appairage.',
  })
  async acceptDelegation(
    @Body() dto: AcceptWhatsAppDelegationDto,
    @CurrentUser() actor: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ): Promise<{
    pairing: WhatsAppPairingView;
    consentText: string;
    delegation: WhatsAppDelegationView;
  }> {
    return this.accounts.acceptDelegation(dto, actor, meta);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('delegations/refuse')
  @RequirePermissions('whatsapp:link:any')
  @ApiOperation({
    summary: 'Enregistrer le refus d’un tiers (`/refuser <code>`).',
    description: 'Ne connecte rien : l’invitation passe a `REFUSED` et son code est consommé.',
  })
  async refuseDelegation(
    @Body() dto: RefuseWhatsAppDelegationDto,
    @CurrentUser() actor: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ): Promise<{ refused: true }> {
    return this.accounts.refuseDelegation(dto, actor, meta);
  }

  // ---------------------------------------------------------------------------
  // Envois et lecture
  // ---------------------------------------------------------------------------

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('users/:userId/messages')
  @RequirePermissions('whatsapp:send:any')
  @ApiOperation({
    summary: 'Envoyer un message WhatsApp via le compte appaire d’un membre.',
    description:
      'La regle d’envoi s’applique avant tout appel a la passerelle : consentement, ' +
      'etat de session, destinataire, longueur, plafond horaire. Un refus rend un ' +
      'code stable (`WHATSAPP_CONSENT_EXPIRED`, `WHATSAPP_RATE_LIMITED`, …) et laisse ' +
      'une ligne `REFUSED` dans le journal. `idempotencyKey` evite le double envoi ' +
      'sur un rejeu du workflow.',
  })
  async sendMessage(
    @Param('userId') userId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: SendWhatsAppMessageDto,
    @RequestMeta() meta: RequestContext,
  ): Promise<WhatsAppMessageView> {
    return this.messaging.sendForUser(userId, actor, dto, meta);
  }

  @Get('users/:userId/messages')
  @RequirePermissions('whatsapp:read:any')
  @ApiOperation({ summary: 'Journal des envois WhatsApp d’un membre.' })
  async listMessages(
    @Param('userId') userId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListWhatsAppMessagesQueryDto,
  ): Promise<Paginated<WhatsAppMessageView>> {
    return this.messaging.listMessagesForUser(userId, actor, query);
  }

  @Get('users/:userId/contacts')
  @RequirePermissions('whatsapp:read:any')
  @ApiOperation({
    summary: 'Repertoire du compte appaire d’un membre (cache).',
    description:
      'Exige que le titulaire ait accorde `contact:read`. Sans cette capacite, la ' +
      'route repond 403 `WHATSAPP_SCOPE_NOT_GRANTED` : lire le repertoire d’un ' +
      'telephone copie les donnees de personnes qui n’ont rien demande.',
  })
  async listContacts(
    @Param('userId') userId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListWhatsAppContactsQueryDto,
  ): Promise<Paginated<WhatsAppContactView>> {
    return this.messaging.listContactsForUser(userId, actor, query);
  }
}
