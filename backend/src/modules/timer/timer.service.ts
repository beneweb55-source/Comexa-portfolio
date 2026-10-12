import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AccessPolicy } from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';
import { TimerSessionStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TaskAccessService } from '../tasks/task-access.service.js';
import type { RequestContext } from '../projects/request-meta.decorator.js';
import { normalizeWorkDay } from '../time-entries/time-rules.js';
import { canPauseTimer, canResumeTimer, canStopTimer, elapsedSecondsOf, minutesForSeconds } from './timer-rules.js';

/**
 * MINUTEUR SERVEUR — la source de verite du chronometrage.
 *
 * LE MINUTEUR N'EST PLUS UNE MONTRE COTE CLIENT. L'ancien stockage local
 * (localStorage) survivait au rechargement de la page mais a TROIS failles que
 * ce service ferme :
 *
 *  1. deux onglets ou deux machines creaient DEUX sessions paralleles — le
 *     client ne pouvait pas le savoir. Ici, l'index partiel unique
 *     `timer_sessions_one_active_per_user` rend l'etat double IMPOSSIBLE en
 *     base : le second `start` recoit un 409, jamais une seconde session ;
 *  2. la duree venait de l'horloge du navigateur (reprise a la seconde pres,
 *     horloge modifiee, mise en veille). Ici, le decompte se RECONSTRUIT
 *     (voir `timer-rules.ts`) depuis les horodatages serveur ;
 *  3. fermer l'onglet en cours de route « perdait » le minuteur : la session
 *     vit maintenant en base, et `GET /timer` la retrouve intacte, sur une
 *     autre machine comprise.
 *
 * L'ARRET ECRIT LA SAISIE DE TEMPS DANS LA MEME TRANSACTION QUE L'ARRET DE LA
 * SESSION. C'est la garantie la plus importante du module : pas de session
 * arretee sans ligne dans la feuille de temps (le temps serait perdu), et pas
 * de deuxieme saisie si deux `stop` concurrents se croisent — le compare-and-
 * swap sur le statut n'en laisse passer qu'un.
 *
 * TACHES PERSONNELLES : chronometrables comme les autres. `requireWritable`
 * porte le perimetre compose (`task-rules`) : une tache personnelle est
 * modifiable par son proprietaire, une tache de projet par qui la regle
 * d'ecriture autorise. La saisie produite est alors NON FACTURABLE — pas de
 * client, donc rien a facturer.
 *
 * Le `entityId` de l'audit est la session, et le `before` garde le statut
 * precedent : dans le journal d'audit, on doit pouvoir reconstituer « qui a
 * arrete quoi, quand, et combien de temps a ete enregistre ».
 */

/** Ce que le service lit d'une session : la forme de presentation, rien de plus. */
const TIMER_SESSION_SELECT = {
  id: true,
  status: true,
  taskId: true,
  startedAt: true,
  resumedAt: true,
  pausedAt: true,
  stoppedAt: true,
  accumulatedSeconds: true,
  savedMinutes: true,
  timeEntryId: true,
  task: { select: { id: true, title: true, isPersonal: true, projectId: true } },
} as const;

type TimerSessionRow = {
  id: string;
  status: TimerSessionStatus;
  taskId: string | null;
  startedAt: Date;
  resumedAt: Date | null;
  pausedAt: Date | null;
  stoppedAt: Date | null;
  accumulatedSeconds: number;
  savedMinutes: number | null;
  timeEntryId: string | null;
  task: { id: string; title: string; isPersonal: boolean; projectId: string | null } | null;
};

@Injectable()
export class TimerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TaskAccessService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Session active du porteur, avec le decompte a l'instant `serverTime`.
   *
   * `serverTime` est renvoye expressement : le frontend qui veut afficher un
   * compteur vivant ajoute `(Date.now() - serverTime)` au decompte recu — le
   * serveur reste la reference, le client n'interpole qu'entre deux reponses.
   */
  async current(policy: AccessPolicy) {
    this.refuseClientSpace(policy);
    const session = await this.findActive(policy);
    if (!session) return null;
    return this.present(session);
  }

  /**
   * Demarre une session sur une tache.
   *
   * LA TACHE EST VERIFIEE AVEC LE FILTRE D'ECRITURE, pas un filtre de lecture :
   * chronometrer est une activite qui sortira du temps facturable, et ce n'est
   * pas parce qu'on voit une tache qu'on doit pouvoir l'imputer. C'est la meme
   * exigence que `POST /tasks/:id/time-entries` sous `time:write:own`.
   */
  async start(taskId: string, policy: AccessPolicy, meta: RequestContext) {
    this.refuseClientSpace(policy);
    const task = await this.tasks.requireWritable(taskId, policy);

    // Double verification, avant l'ecriture : l'index unique partiel de la base
    // est la garantie finale (il couvre la concurrence), mais un 409 propre est
    // plus parlant qu'une violation de contrainte.
    const existing = await this.findActive(policy);
    if (existing) {
      throw AppException.conflict(
        'TIMER_ALREADY_ACTIVE',
        'Un minuteur est deja en cours. Terminez-le ou mettez-le en pause avant d’en demarrer un autre.',
      );
    }

    const now = new Date();
    const created = await this.prisma.timerSession.create({
      data: {
        userId: policy.userId,
        taskId: task.id,
        status: TimerSessionStatus.RUNNING,
        startedAt: now,
        resumedAt: now,
        pausedAt: null,
        accumulatedSeconds: 0,
      },
      select: TIMER_SESSION_SELECT,
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'TIMER_STARTED',
      entityType: 'TimerSession',
      entityId: created.id,
      after: { taskId: task.id, isPersonal: task.isPersonal },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.present(created);
  }

  /**
   * Mise en pause : le segment en cours est replie dans `accumulatedSeconds`.
   *
   * Le `where` porte le statut attendu : c'est un compare-and-swap. Deux
   * pauses simultanes n'en replient qu'une seule — la seconde ne trouve plus de
   * ligne RUNNING et recoit 409.
   */
  async pause(policy: AccessPolicy, meta: RequestContext) {
    this.refuseClientSpace(policy);
    const session = await this.findActive(policy);
    if (!session || !canPauseTimer(session.status)) {
      throw AppException.conflict('TIMER_NOT_RUNNING', 'Aucun minuteur en cours à mettre en pause.');
    }

    const now = new Date();
    const seconds = elapsedSecondsOf(session, now);
    const moved = await this.prisma.timerSession.updateMany({
      where: { id: session.id, userId: policy.userId, status: TimerSessionStatus.RUNNING },
      data: {
        status: TimerSessionStatus.PAUSED,
        pausedAt: now,
        resumedAt: null,
        accumulatedSeconds: seconds,
      },
    });

    if (moved.count !== 1) {
      throw AppException.conflict('TIMER_STATE_CONFLICT', 'Le minuteur a changé pendant la mise en pause.');
    }

    await this.audit.record({
      actorId: policy.userId,
      action: 'TIMER_PAUSED',
      entityType: 'TimerSession',
      entityId: session.id,
      before: { status: session.status },
      after: { status: TimerSessionStatus.PAUSED, accumulatedSeconds: seconds },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.present({ ...session, status: TimerSessionStatus.PAUSED, pausedAt: now, resumedAt: null, accumulatedSeconds: seconds });
  }

  /** Reprise : un nouveau segment part de maintenant. */
  async resume(policy: AccessPolicy, meta: RequestContext) {
    this.refuseClientSpace(policy);
    const session = await this.findActive(policy);
    if (!session || !canResumeTimer(session.status)) {
      throw AppException.conflict('TIMER_NOT_PAUSED', 'Aucun minuteur en pause à reprendre.');
    }

    const now = new Date();
    const moved = await this.prisma.timerSession.updateMany({
      where: { id: session.id, userId: policy.userId, status: TimerSessionStatus.PAUSED },
      data: {
        status: TimerSessionStatus.RUNNING,
        resumedAt: now,
        pausedAt: null,
        // `accumulatedSeconds` n'est PAS touche : c'est le solde des segments
        // passes, et le segment courant s'y ajoutera au prochain calcul.
      },
    });

    if (moved.count !== 1) {
      throw AppException.conflict('TIMER_STATE_CONFLICT', 'Le minuteur a changé pendant la reprise.');
    }

    await this.audit.record({
      actorId: policy.userId,
      action: 'TIMER_RESUMED',
      entityType: 'TimerSession',
      entityId: session.id,
      before: { status: session.status },
      after: { status: TimerSessionStatus.RUNNING },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.present({ ...session, status: TimerSessionStatus.RUNNING, resumedAt: now, pausedAt: null });
  }

  /**
   * Arret : SAUVE LA SAISIE DE TEMPS, dans la meme transaction que l'arret.
   *
   * `spentOn` est le jour du DEMARRAGE (en UTC, comme toute saisie) : une
   * session de 23 h a 1 h est imputee au jour ou le travail a commence, pas a
   * celui ou on a clique « terminer ». C'est la meme regle que la saisie
   * manuelle, qui refuse un jour futur — rien n'a change cote calendrier.
   *
   * Une tache PERSONNELLE produit une saisie NON FACTURABLE et sans projet :
   * `time-rules` l'accepte (une saisie appartient a une personne, pas a un
   * projet), et les rapports financiers ne la voient pas.
   */
  async stop(policy: AccessPolicy, meta: RequestContext) {
    this.refuseClientSpace(policy);
    const session = await this.findActive(policy);
    if (!session || !canStopTimer(session.status)) {
      throw AppException.conflict('TIMER_NOT_ACTIVE', 'Aucun minuteur en cours à terminer.');
    }

    const now = new Date();
    const totalSeconds = elapsedSecondsOf(session, now);
    const minutes = minutesForSeconds(totalSeconds);
    // Au-dela de 24 h, la saisie est PLAFONNEE (meme borne que la saisie
    // manuelle) et l'ecart est signale : mieux vaut une saisie corrigee a la
    // main qu'une duree gonflee silencieusement dans la feuille de temps.
    const rawMinutes = Math.round(totalSeconds / 60);
    const overflowMinutes = Math.max(0, rawMinutes - minutes);
    const spentOn = normalizeWorkDay(session.startedAt);
    const task = session.task;

    const result = await this.prisma.$transaction(async (tx) => {
      // La tache peut avoir ete supprimee pendant la session (relation
      // `SetNull`) : on arrete la session dans tous les cas — un minuteur qui
      // refuse de s'arreter est pire qu'une saisie introuvable.
      let timeEntryId: string | null = null;

      if (session.taskId && task) {
        const entry = await tx.timeEntry.create({
          data: {
            projectId: task.projectId,
            taskId: session.taskId,
            userId: policy.userId,
            spentOn,
            minutes,
            description: `Minuteur : ${task.title}`.slice(0, 500),
            // Une tache personnelle n'a pas de client : rien a facturer.
            billable: !task.isPersonal,
          },
          select: { id: true },
        });
        timeEntryId = entry.id;
      }

      // Compare-and-swap sur le statut : un second `stop` concurrent ne trouve
      // plus de ligne active et n'ecrit PAS une seconde saisie.
      const stopped = await tx.timerSession.updateMany({
        where: {
          id: session.id,
          userId: policy.userId,
          status: { in: [TimerSessionStatus.RUNNING, TimerSessionStatus.PAUSED] },
        },
        data: {
          status: TimerSessionStatus.STOPPED,
          stoppedAt: now,
          resumedAt: null,
          accumulatedSeconds: totalSeconds,
          savedMinutes: timeEntryId ? minutes : null,
          timeEntryId,
        },
      });

      if (stopped.count !== 1) {
        throw AppException.conflict(
          'TIMER_STATE_CONFLICT',
          'Le minuteur a déjà été terminé ailleurs.',
        );
      }

      return { timeEntryId };
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'TIMER_STOPPED',
      entityType: 'TimerSession',
      entityId: session.id,
      before: { status: session.status, accumulatedSeconds: session.accumulatedSeconds },
      after: { minutes, timeEntryId: result.timeEntryId, startedAt: session.startedAt },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      ...this.present({
        ...session,
        status: TimerSessionStatus.STOPPED,
        stoppedAt: now,
        resumedAt: null,
        accumulatedSeconds: totalSeconds,
        savedMinutes: result.timeEntryId ? minutes : null,
        timeEntryId: result.timeEntryId,
      }),
      savedMinutes: result.timeEntryId ? minutes : 0,
      overflowMinutes: result.timeEntryId ? overflowMinutes : 0,
      timeEntryId: result.timeEntryId,
    };
  }

  // ---------------------------------------------------------------------------
  // Garde-fous
  // ---------------------------------------------------------------------------

  private async findActive(policy: AccessPolicy): Promise<TimerSessionRow | null> {
    return this.prisma.timerSession.findFirst({
      where: {
        userId: policy.userId,
        status: { in: [TimerSessionStatus.RUNNING, TimerSessionStatus.PAUSED] },
      },
      orderBy: { startedAt: 'desc' },
      select: TIMER_SESSION_SELECT,
    });
  }

  private present(session: TimerSessionRow) {
    return {
      id: session.id,
      status: session.status,
      taskId: session.taskId,
      taskTitle: session.task?.title ?? null,
      taskIsPersonal: session.task?.isPersonal ?? false,
      startedAt: session.startedAt,
      pausedAt: session.pausedAt,
      stoppedAt: session.stoppedAt,
      accumulatedSeconds: session.accumulatedSeconds,
      elapsedSeconds: elapsedSecondsOf(session, new Date()),
      savedMinutes: session.savedMinutes,
      timeEntryId: session.timeEntryId,
      serverTime: new Date().toISOString(),
    };
  }

  /** Un compte client n'a pas de minuteur : le temps est une donnee d'agence. */
  private refuseClientSpace(policy: AccessPolicy): void {
    if (policy.isClient()) {
      throw AppException.forbidden("Le minuteur n'est pas accessible depuis l'espace client.");
    }
  }
}
