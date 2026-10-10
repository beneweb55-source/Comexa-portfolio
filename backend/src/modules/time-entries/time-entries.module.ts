import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { TimeEntriesController } from './time-entries.controller.js';
import { TimeEntriesService } from './time-entries.service.js';

/**
 * MODULE TEMPS.
 *
 * IL IMPORTE `TasksModule` POUR `TaskAccessService`, ET C'EST LE COEUR DE SA
 * SECURITE. On ne saisit pas du temps « dans le vide » : une saisie appartient a
 * une tache, et le droit de la saisir se decide sur cette tache. Sous
 * `time:write:own`, le service appelle `requireWritable` — la tache doit etre
 * assignee au porteur — et sous `time:write:any`, `requireReadable` suffit.
 * Reecrire ce filtre ici aurait fait diverger deux definitions de « ma tache »,
 * et la divergence va toujours dans le sens de l'ouverture.
 *
 * PAS DE `NotificationModule` : saisir du temps ne notifie personne. Notifier un
 * responsable a chaque heure pointee produirait exactement l'effet inverse de
 * celui recherche — un flux qu'on apprend a ignorer.
 *
 * AUCUN CYCLE : `TasksModule` n'importe pas `TimeEntriesModule`. Les taches ne
 * connaissent pas le temps qu'on y passe, elles le comptent par le schema.
 *
 * `ActivityModule` est importe et non reecrit : chaque saisie ecrit une entree
 * `TIME_LOGGED` DANS LA MEME TRANSACTION que la ligne. Le service partage fixe
 * `isClientVisible` a FAUX par defaut, ce qui est ici la bonne valeur — le temps
 * est une donnee interne.
 */
@Module({
  imports: [TasksModule, ActivityModule],
  controllers: [TimeEntriesController],
  providers: [TimeEntriesService],
  exports: [TimeEntriesService],
})
export class TimeEntriesModule {}
