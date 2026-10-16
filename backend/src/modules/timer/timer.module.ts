import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module.js';
import { TimerController } from './timer.controller.js';
import { TimerService } from './timer.service.js';

/**
 * MODULE MINUTEUR.
 *
 * IL IMPORTE `TasksModule` POUR `TaskAccessService`, exactement comme le module
 * temps : la question « ce porteur peut-il chronometrer CETTE tache » a deja une
 * reponse, ecrite une fois, et la dupliquer ici ferait deux perimetres qui
 * finiraient par diverger. Le minutage est un flux d'ecriture de temps : il
 * doit passer par le meme sas que `POST /tasks/:id/time-entries`.
 *
 * PAS DE `NotificationModule`, PAS DE `ActivityModule` : arreter un minuteur ne
 * previent personne et n'ecrit rien dans le fil d'activite du projet — la trace
 * est le journal d'AUDIT (`TIMER_STARTED`, `TIMER_PAUSED`, `TIMER_RESUMED`,
 * `TIMER_UPDATED`, `TIMER_STOPPED`, `TIMER_DISCARDED`) et la saisie de temps
 * elle-meme. Un « X a arrete son
 * minuteur » dans le fil d'un projet serait du bruit : le fil raconte le
 * projet, pas la presence de chacun.
 *
 * AUCUN CYCLE : `TasksModule` n'importe pas `TimerModule`. Une tache ignore qui
 * la chronometre.
 */
@Module({
  imports: [TasksModule],
  controllers: [TimerController],
  providers: [TimerService],
})
export class TimerModule {}
