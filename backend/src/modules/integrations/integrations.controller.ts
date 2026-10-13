import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import type { Paginated } from '../../common/dto/pagination.dto.js';
import { RequestMeta, type RequestContext } from '../projects/request-meta.decorator.js';
import {
  CreateIntegrationTokenDto,
  ListIntegrationTokensQueryDto,
  RenewIntegrationTokenDto,
} from './dto/integration-token.dto.js';
import { IntegrationTokenService } from './integration-token.service.js';
import type { IntegrationTokenView } from './integration-token.presenter.js';

/**
 * ADMINISTRATION DES INTEGRATIONS.
 *
 * Ces routes sont les seules de l'API qu'aucun jeton d'integration ne peut
 * atteindre, meme avec toutes les permissions : `normalizeIntegrationScopes`
 * refuse `integration:manage:any` sur un jeton. Une machine ne distribue pas
 * d'acces — sinon un jeton vole dans un workflow permettrait de s'en fabriquer
 * d'autres, et la revocation perdrait tout effet.
 *
 * Le secret n'apparait que dans DEUX reponses : la creation et le
 * renouvellement. Partout ailleurs il n'existe plus nulle part, pas meme en base
 * : ce qui est stocke est son empreinte.
 */
@ApiTags('Integrations')
@Controller()
export class IntegrationsController {
  constructor(private readonly tokens: IntegrationTokenService) {}

  @Post('integrations/tokens')
  @RequirePermissions('integration:manage:any')
  @ApiOperation({
    summary: 'Creer un jeton d’integration (le secret est rendu une seule fois).',
  })
  async create(
    @Body() dto: CreateIntegrationTokenDto,
    @CurrentUser() actor: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ): Promise<{ token: IntegrationTokenView; secret: string }> {
    return this.tokens.create(dto, actor, meta);
  }

  @Get('integrations/tokens')
  @RequirePermissions('integration:read:any')
  @ApiOperation({ summary: 'Lister les jetons d’integration (jamais les secrets).' })
  async list(
    @Query() query: ListIntegrationTokensQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Paginated<IntegrationTokenView>> {
    return this.tokens.list(query, actor);
  }

  @Post('integrations/tokens/:id/renew')
  @RequirePermissions('integration:manage:any')
  @ApiOperation({
    summary: 'Renouveler le secret d’un jeton (l’ancien cesse de fonctionner immediatement).',
  })
  async renew(
    @Param('id') id: string,
    @Body() dto: RenewIntegrationTokenDto,
    @CurrentUser() actor: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ): Promise<{ token: IntegrationTokenView; secret: string }> {
    return this.tokens.renew(id, dto, actor, meta);
  }

  @Post('integrations/tokens/:id/revoke')
  @RequirePermissions('integration:manage:any')
  @ApiOperation({ summary: 'Revoquer un jeton (effet immediat, a la requete suivante).' })
  async revoke(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ): Promise<IntegrationTokenView> {
    return this.tokens.revoke(id, actor, meta);
  }

  @Delete('integrations/tokens/:id')
  @RequirePermissions('integration:manage:any')
  @ApiOperation({ summary: 'Supprimer un jeton et son compte technique.' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ): Promise<{ deleted: true }> {
    await this.tokens.remove(id, actor, meta);
    return { deleted: true };
  }
}
