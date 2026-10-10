import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module.js';
import { NotificationModule } from '../notifications/notification.module.js';
import { MilestonesController } from './milestones.controller.js';
import { MilestonesService } from './milestones.service.js';

/**
 * MODULE JALONS.
 *
 * IL N'IMPORTE PAS `ProjectsModule`, ET C'EST DELIBERE.
 *
 * Les taches importent `ProjectsModule` parce qu'elles ont besoin de
 * `ProjectAccessService` : une tache se charge PAR SON ID, donc il faut d'abord
 * resoudre son projet et verifier le perimetre. Un jalon se charge par le projet
 * (`/projects/:id/milestones`) ou par un identifiant dont on remonte le projet
 * DANS LA MEME REQUETE (`project: { AND: [projectScopeWhere(...)] }`). Le filtre
 * est compose a partir de `project-scope.ts`, qui est la source unique de la
 * regle ; passer par le service n'ajouterait qu'une requete supplementaire.
 *
 * Ce qui compte, c'est que la regle ne soit pas REECRITE : `projectScopeWhere` et
 * `PROJECT_READ_ORDER` viennent du module PROJETS et ne sont pas dupliques ici.
 *
 * `ActivityModule` et `NotificationModule` sont importes et non reecrits : le fil
 * d'activite et les notifications sont partages. Un jalon atteint est l'evenement
 * le plus visible de tout le domaine — c'est celui que le client attend — et il
 * passe par les memes services que le reste.
 */
@Module({
  imports: [ActivityModule, NotificationModule],
  controllers: [MilestonesController],
  providers: [MilestonesService],
  exports: [MilestonesService],
})
export class MilestonesModule {}
