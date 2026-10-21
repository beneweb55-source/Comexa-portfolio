import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser } from '../../common/decorators/auth.decorators.js';
import {
  CompleteMissionDto,
  EnterTrainingDto,
  ResetTrainingDto,
  StartMissionDto,
} from './dto/training.dto.js';
import { TrainingService } from './training.service.js';

/**
 * FORMATION — parcours guidé et environnement d'entraînement.
 *
 * AUCUN `@RequirePermissions` sur ces routes, et c'est délibéré :
 *
 *  - apprendre n'exige aucun droit métier particulier — le CATALOGUE est déjà
 *    filtré par les permissions réelles du porteur (`TrainingService.catalog`),
 *    et personne ne reçoit une mission qu'il ne peut pas exécuter ;
 *  - ces routes n'écrivent que dans la base d'ENTRAÎNEMENT (objets d'exercice)
 *    et dans la progression pédagogique du porteur — jamais dans les données
 *    métier de production ;
 *  - elles restent protégées par l'authentification (défaut fermé du garde) et
 *    par les mêmes contrôles de jeton que le reste de l'API. Un jeton de
 *    formation n'ouvre QUE ce contrôleur et les opérations métier qu'il
 *    déclenche côté base fictive.
 *
 * La réinitialisation (`POST /training/reset`) est ouverte à tout membre
 * authentifié, avec confirmation explicite : l'environnement de formation est
 * un bac à sable partagé (voir docs/FORMATION.md, section limites connues).
 */
@ApiTags('Formation')
@Controller()
export class TrainingController {
  constructor(private readonly training: TrainingService) {}

  @Get('training/status')
  @ApiOperation({ summary: 'État de la formation : configurée, session active, bannière.' })
  status(@CurrentUser() actor: AuthenticatedUser) {
    return this.training.status(actor);
  }

  @Post('training/enter')
  @ApiOperation({
    summary:
      'Entrer en mode formation : amorce la base d’exercice et émet un jeton de formation.',
  })
  enter(@CurrentUser() actor: AuthenticatedUser, @Body() body: EnterTrainingDto) {
    return this.training.enter(actor, body.missionId);
  }

  @Post('training/exit')
  @ApiOperation({ summary: 'Quitter le mode formation (ferme les sessions actives).' })
  exit(@CurrentUser() actor: AuthenticatedUser) {
    return this.training.exit(actor);
  }

  @Post('training/reset')
  @ApiOperation({
    summary:
      'Réinitialiser l’environnement de formation (base d’exercice uniquement, jamais la production).',
  })
  reset(@CurrentUser() actor: AuthenticatedUser, @Body() body: ResetTrainingDto) {
    void body; // `confirm` validé par le DTO : son seul rôle est d'exiger l'intention.
    return this.training.reset(actor);
  }

  @Get('training/catalog')
  @ApiOperation({ summary: 'Missions ouvertes avec vos permissions, et votre progression.' })
  catalog(@CurrentUser() actor: AuthenticatedUser, @Query('space') space?: string) {
    return this.training.catalog(actor, space);
  }

  @Post('training/missions/:missionId/start')
  @ApiOperation({ summary: 'Démarrer (ou reprendre) une mission.' })
  start(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('missionId') missionId: string,
    @Body() body: StartMissionDto,
  ) {
    return this.training.start(actor, missionId, body.assistanceLevel ?? 'full');
  }

  @Get('training/missions/:missionId/check')
  @ApiOperation({
    summary:
      'Vérifier les critères de la mission sur la base d’entraînement (?evaluation=true pour l’évaluation finale).',
  })
  check(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('missionId') missionId: string,
    @Query('evaluation') evaluation?: string,
  ) {
    return this.training.check(actor, missionId, evaluation === 'true');
  }

  @Post('training/missions/:missionId/complete')
  @ApiOperation({
    summary:
      'Valider la mission : réussie UNIQUEMENT si les critères sont satisfaits sur les données d’exercice.',
  })
  complete(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('missionId') missionId: string,
    @Body() body: CompleteMissionDto,
  ) {
    return this.training.complete(actor, missionId, body.assistanceLevel ?? 'full');
  }

  @Get('training/report')
  @ApiOperation({ summary: 'Bilan de fin de parcours : acquis, reste, checklist, raccourcis réels.' })
  report(@CurrentUser() actor: AuthenticatedUser) {
    return this.training.report(actor);
  }
}
