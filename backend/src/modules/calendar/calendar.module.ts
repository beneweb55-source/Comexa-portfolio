import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { CalendarController } from './calendar.controller.js';
import { CalendarService } from './calendar.service.js';

/**
 * MODULE CALENDRIER.
 *
 * Il reutilise les services d'acces des taches et des projets pour valider les
 * liens optionnels d'un evenement : « cette tache est-elle lisible par
 * l'appelant ? » a deja une reponse ecrite une fois (TaskAccessService), la
 * redemander ici ferait deux perimetres qui divergeraient un jour.
 *
 * PAS de NotificationModule : un evenement invite ne cree pas de notification
 * dans cette version — la liste des invites est la source de verite, et un
 * systeme de notifications volontaire n'est pas une demi-fonctionnalite.
 * PAS de cycle : ni TasksModule ni ProjectsModule n'importent CalendarModule.
 */
@Module({
  imports: [TasksModule, ProjectsModule],
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
