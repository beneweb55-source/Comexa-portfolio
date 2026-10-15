import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { RequestMeta, type RequestContext } from '../projects/request-meta.decorator.js';
import { VerifyTelegramCodeDto } from './dto/telegram-link.dto.js';
import { TelegramLinkService } from './telegram-link.service.js';

/**
 * LIAISON TELEGRAM — deux publics distincts :
 *
 *  1. `/me/telegram-link*` — le membre connecté (JWT humain) consulte son état,
 *     génère un code d'appairage ou révoque sa liaison.
 *
 *  2. `/integrations/telegram/*` — appelées par le workflow n8n du bot
 *     @ComexaWork_bot via le préfixe versionné `/api/v1/integrations/telegram/*`
 *     (l'alias /v1 est réécrit en interne par le middleware dans app.setup.ts).
 *     Le jeton `cxi_...` doit porter le scope `telegram:link:any`.
 */
@ApiTags('Telegram')
@Controller()
export class TelegramLinkController {
  constructor(private readonly links: TelegramLinkService) {}

  // ---------------------------------------------------------------------------
  // Routes du membre connecté
  // ---------------------------------------------------------------------------

  @Get('me/telegram-link')
  @ApiOperation({ summary: "État de la liaison Telegram du membre connecté." })
  async getState(@CurrentUser() actor: AuthenticatedUser) {
    return this.links.getState(actor);
  }

  @Post('me/telegram-link/code')
  @ApiOperation({
    summary: "Génère un code d'appairage à 6 chiffres valable 10 minutes.",
  })
  async createCode(@CurrentUser() actor: AuthenticatedUser) {
    return this.links.createCode(actor);
  }

  @Delete('me/telegram-link')
  @ApiOperation({ summary: 'Révoque la liaison Telegram du membre connecté.' })
  async revoke(
    @CurrentUser() actor: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.links.revokeForSelf(actor, meta);
  }

  // ---------------------------------------------------------------------------
  // Routes de l'intégration n8n (protégées par scope telegram:link:any)
  // ---------------------------------------------------------------------------

  @Post('integrations/telegram/verify-code')
  @RequirePermissions('telegram:link:any')
  @ApiOperation({
    summary: "Vérifie un code d'appairage soumis par le bot et lie le compte.",
  })
  async verify(
    @Body() dto: VerifyTelegramCodeDto,
    @CurrentUser() actor: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.links.verifyCode(dto, actor, meta);
  }

  @Get('integrations/telegram/resolve/:telegramUserId')
  @RequirePermissions('telegram:link:any')
  @ApiOperation({
    summary: 'Résout un utilisateur Telegram en profil Comexa actif.',
  })
  async resolve(
    @Param('telegramUserId') telegramUserId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.links.resolve(telegramUserId, actor);
  }
}
