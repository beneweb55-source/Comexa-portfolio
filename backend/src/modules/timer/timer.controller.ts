import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import {
  CurrentUser,
  RequireAnyPermission,
} from '../../common/decorators/auth.decorators.js';
import { RequestMeta, type RequestContext } from '../projects/request-meta.decorator.js';
import { StartTimerDto } from './dto/timer.dto.js';
import { TimerService } from './timer.service.js';

/**
 * ROUTES DU MINUTEUR.
 *
 * UN SEUL CHEMIN PAR ACTION, et toutes portent la meme permission :
 * `time:write:own` ou `time:write:any`. C'est un choix et pas un raccourci —
 * consulter le minuteur n'est pas une lecture anodine : c'est deja la moitie
 * d'une saisie de temps (la duree affichee sera enregistree a l'arret). Qui ne
 * peut pas saisir de temps n'a pas de minuteur a consulter, et l'ecart entre
 * les gardes de lecture et d'ecriture serait une porte entrouverte que personne
 * n'a decide d'ouvrir.
 *
 * `time:read:own` NE SUFFIT PAS et c'est volontaire : lire sa feuille de temps
 * ne donne pas le droit d'en ecrire, et le minuteur est un instrument
 * d'ecriture. Le garde `@RequireAnyPermission` ouvre la ROUTE ; le service,
 * lui, reperimetre la tache chronometree (`TaskAccessService.requireWritable`)
 * et interdit l'espace client — les deux niveaux, comme partout.
 */
@ApiTags('Minuteur')
@Controller()
export class TimerController {
  constructor(private readonly timer: TimerService) {}

  @Get('timer')
  @RequireAnyPermission('time:write:own', 'time:write:any')
  @ApiOperation({ summary: 'Session active du porteur (ou null), avec le decompte serveur.' })
  async current(@CurrentUser() user: AuthenticatedUser) {
    return this.timer.current(new AccessPolicy(user));
  }

  @Post('timer/start')
  @RequireAnyPermission('time:write:own', 'time:write:any')
  @ApiOperation({ summary: 'Demarrer le minuteur sur une tache (409 si un autre est deja actif).' })
  async start(
    @Body() dto: StartTimerDto,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.timer.start(dto.taskId, new AccessPolicy(user), meta);
  }

  @Post('timer/pause')
  @RequireAnyPermission('time:write:own', 'time:write:any')
  @ApiOperation({ summary: 'Mettre en pause (le segment en cours est replie).' })
  async pause(@CurrentUser() user: AuthenticatedUser, @RequestMeta() meta: RequestContext) {
    return this.timer.pause(new AccessPolicy(user), meta);
  }

  @Post('timer/resume')
  @RequireAnyPermission('time:write:own', 'time:write:any')
  @ApiOperation({ summary: 'Reprendre une session en pause.' })
  async resume(@CurrentUser() user: AuthenticatedUser, @RequestMeta() meta: RequestContext) {
    return this.timer.resume(new AccessPolicy(user), meta);
  }

  @Post('timer/stop')
  @RequireAnyPermission('time:write:own', 'time:write:any')
  @ApiOperation({ summary: "Terminer la session et enregistrer la saisie de temps." })
  async stop(@CurrentUser() user: AuthenticatedUser, @RequestMeta() meta: RequestContext) {
    return this.timer.stop(new AccessPolicy(user), meta);
  }
}
