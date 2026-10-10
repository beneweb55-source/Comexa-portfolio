import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module.js';
import { NotificationModule } from '../notifications/notification.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { TaskAccessService } from './task-access.service.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

/**
 * MODULE TACHES.
 *
 * IL IMPORTE `ProjectsModule` POUR UNE SEULE CHOSE : `ProjectAccessService`.
 * Une tache vit toujours dans un projet, et `GET /projects/:id/tasks` doit
 * repondre 404 si le PROJET est hors du perimetre du porteur — sinon une liste
 * vide apprendrait a un client qu'un projet interne existe et n'a pas de taches.
 * Ce controle est le meme que celui des routes de projet ; le reecrire ici aurait
 * cree deux perimetres a maintenir, et c'est toujours le plus permissif qui gagne
 * a l'usage.
 *
 * `TaskAccessService` est EXPORTE pour le module TEMPS : avant de saisir du temps
 * sur une tache, il faut la meme reponse a « ce porteur peut-il la voir ». Voir le
 * commentaire d'en-tete de `task-access.service.ts`.
 *
 * `ActivityModule` et `NotificationModule` sont importes et non reecrits : ce sont
 * des services PARTAGES, montes une fois dans `AppModule`. Une ecriture directe
 * dans `prisma.activity.create` contournerait la garantie centrale du fil
 * d'activite — `isClientVisible` vaut FAUX par defaut — et laisserait passer une
 * note interne dans l'espace client sans qu'aucun test ne s'en apercoive.
 *
 * AUCUN CYCLE : `ProjectsModule` n'importe pas `TasksModule`. Le projet ne
 * connait pas ses taches, les taches connaissent leur projet.
 */
@Module({
  imports: [ProjectsModule, ActivityModule, NotificationModule],
  controllers: [TasksController],
  providers: [TasksService, TaskAccessService],
  exports: [TasksService, TaskAccessService],
})
export class TasksModule {}
