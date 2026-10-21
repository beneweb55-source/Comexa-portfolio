import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser } from '../../common/decorators/auth.decorators.js';
import { CompleteGuideStepDto } from './dto/guide.dto.js';
import { GuideService } from './guide.service.js';

/**
 * GUIDE DE DÉMARRAGE — routes.
 *
 * Aucun `@RequirePermissions` : le CATALOGUE est déjà filtré par les droits
 * effectifs de chaque espace (`guide.rules.ts`), et une étape qu'on ne peut pas
 * exécuter n'est jamais renvoyée. Les routes restent derrière
 * l'authentification (défaut fermé du garde).
 *
 * Ces routes lisent et écrivent les données RÉELLES du porteur : la preuve
 * d'une étape est un `count` Prisma borné à `{{userId}}`. Il n'y a donc rien à
 * « réinitialiser » côté données métier — le guide ne fait que constater.
 */
@ApiTags('Guide')
@Controller()
export class GuideController {
  constructor(private readonly guide: GuideService) {}

  @Get('guide')
  @ApiOperation({ summary: 'Premiers pas : étapes visibles, état réel, prochaine étape.' })
  overview(@CurrentUser() actor: AuthenticatedUser) {
    return this.guide.overview(actor);
  }

  @Post('guide/steps/:stepId/complete')
  @ApiOperation({
    summary:
      'Valider une étape : vérifiée sur les données réelles (action) ou par une micro-question (visite).',
  })
  complete(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('stepId') stepId: string,
    @Body() body: CompleteGuideStepDto,
  ) {
    return this.guide.complete(actor, stepId, body.optionId);
  }
}
