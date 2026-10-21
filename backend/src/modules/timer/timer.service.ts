import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AccessPolicy } from '../../common/auth/principal.js';
import { paginated, resolvePagination } from '../../common/dto/pagination.dto.js';
import { AppException } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { TimerSessionStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TaskAccessService } from '../tasks/task-access.service.js';
import { CLOSED_TASK_STATUSES, taskWriteWhereFor } from '../tasks/task-rules.js';
import type { RequestContext } from '../projects/request-meta.decorator.js';
import { normalizeWorkDay } from '../time-entries/time-rules.js';
import type {
  StartTimerDto,
  StopTimerDto,
  TimerTasksQueryDto,
  UpdateTimerDto,
} from './dto/timer.dto.js';
import {
  canPauseTimer,
  canResumeTimer,
  canStopTimer,
  elapsedSecondsOf,
  minutesForSeconds,
} from './timer-rules.js';

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
  note: true,
  task: {
    select: {
      id: true,
      title: true,
      isPersonal: true,
      projectId: true,
      status: true,
      estimateMinutes: true,
      project: { select: { id: true, name: true } },
    },
  },
} as const;

type TimerSessionRow = Prisma.TimerSessionGetPayload<{ select: typeof TIMER_SESSION_SELECT }>;

/** Une tache telle que le selecteur du minuteur la presente. */
const TIMER_TASK_SELECT = {
  id: true,
  title: true,
  status: true,
  priority: true,
  dueDate: true,
  isPersonal: true,
  estimateMinutes: true,
  assigneeId: true,
  assignee: { select: { id: true, firstName: true, lastName: true } },
  project: { select: { id: true, name: true } },
} as const;

type TimerTaskRow = Prisma.TaskGetPayload<{ select: typeof TIMER_TASK_SELECT }>;

/** Fenetre des « taches recentes » proposees au redemarrage. */
const RECENT_WINDOW_DAYS = 30;
const RECENT_LIMIT = 6;

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
   * TACHES CHRONOMETRABLES : exactement celles que `start` acceptera.
   *
   * Le filtre est celui de l'ecriture (`taskWriteWhereFor`), le meme que
   * `requireWritable` au demarrage : un developpeur ne voit que ses taches
   * assignees (et ses taches personnelles dans son espace), un chef de projet
   * dans l'espace equipe toutes les taches de projet. Avant, le selecteur ne
   * proposait que « mes taches assignees » : une tache de projet non assignee
   * etait impossible a chronometrer depuis l'ecran, alors que le serveur
   * l'acceptait. Les taches closes sont ecartees (on ne demarre pas sur un
   * travail fini) ; la saisie manuelle reste possible pour un oubli.
   */
  async chronometrableTasks(query: TimerTasksQueryDto, policy: AccessPolicy) {
    this.refuseClientSpace(policy);
    const p = resolvePagination(query);
    const where = this.chronometrableWhere(policy, query.search, query.scope);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        orderBy: [
          { dueDate: { sort: 'asc', nulls: 'last' } },
          { priority: 'desc' },
          { createdAt: 'desc' },
        ],
        skip: p.skip,
        take: p.take,
        select: TIMER_TASK_SELECT,
      }),
      this.prisma.task.count({ where }),
    ]);

    return paginated(
      items.map((task) => presentTask(task, policy.userId)),
      total,
      p,
    );
  }

  /**
   * Les dernieres taches chronometrees ou saisies, encore chronometrables :
   * relancer le travail d'hier en un geste.
   */
  async recentTasks(policy: AccessPolicy) {
    this.refuseClientSpace(policy);
    const since = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const entries = await this.prisma.timeEntry.findMany({
      where: { userId: policy.userId, taskId: { not: null }, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 80,
      select: { taskId: true },
    });

    const ids: string[] = [];
    for (const entry of entries) {
      if (entry.taskId && !ids.includes(entry.taskId)) ids.push(entry.taskId);
      if (ids.length >= RECENT_LIMIT * 2) break;
    }
    if (ids.length === 0) return [];

    const rows = await this.prisma.task.findMany({
      where: { id: { in: ids }, AND: [this.chronometrableWhere(policy)] },
      select: TIMER_TASK_SELECT,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids
      .map((id) => byId.get(id))
      .filter((row): row is TimerTaskRow => Boolean(row))
      .slice(0, RECENT_LIMIT)
      .map((row) => presentTask(row, policy.userId));
  }

  /**
   * Mon temps du jour et de la semaine, et les dernieres saisies du jour.
   *
   * Les jours sont ceux de la feuille de temps (`normalizeWorkDay`, en UTC) :
   * le total affiche par le minuteur est celui que la feuille de temps
   * montrera. Dans l'espace EQUIPE, le temps des taches PERSONNELLES est
   * retire : il ne sort que dans l'espace personnel, comme les taches.
   */
  async summary(policy: AccessPolicy) {
    this.refuseClientSpace(policy);
    const today = normalizeWorkDay(new Date());
    const weekStart = new Date(today);
    weekStart.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));

    const base: Prisma.TimeEntryWhereInput = {
      userId: policy.userId,
      OR: [{ projectId: null }, { project: { deletedAt: null } }],
      ...(policy.space === 'team' ? { NOT: [{ task: { is: { isPersonal: true } } }] } : {}),
    };

    const [todayTotals, weekTotals, entries] = await Promise.all([
      this.prisma.timeEntry.aggregate({
        where: { ...base, spentOn: today },
        _sum: { minutes: true },
      }),
      this.prisma.timeEntry.aggregate({
        where: { ...base, spentOn: { gte: weekStart, lte: today } },
        _sum: { minutes: true },
      }),
      this.prisma.timeEntry.findMany({
        where: { ...base, spentOn: today },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          minutes: true,
          description: true,
          billable: true,
          createdAt: true,
          task: { select: { id: true, title: true, isPersonal: true } },
          project: { select: { id: true, name: true } },
        },
      }),
    ]);

    return {
      day: today.toISOString().slice(0, 10),
      todayMinutes: todayTotals._sum.minutes ?? 0,
      weekMinutes: weekTotals._sum.minutes ?? 0,
      entries,
    };
  }

  /**
   * Demarre une session sur une tache.
   *
   * LA TACHE EST VERIFIEE AVEC LE FILTRE D'ECRITURE, pas un filtre de lecture :
   * chronometrer est une activite qui sortira du temps facturable, et ce n'est
   * pas parce qu'on voit une tache qu'on doit pouvoir l'imputer. C'est la meme
   * exigence que `POST /tasks/:id/time-entries` sous `time:write:own`.
   */
  async start(dto: StartTimerDto, policy: AccessPolicy, meta: RequestContext) {
    this.refuseClientSpace(policy);
    const taskId = dto.taskId ?? null;
    // Sans tache : pas de perimetre a verifier — le temps sera non facturable
    // et sans projet (regle documentee dans `StartTimerDto`).
    const task = taskId ? await this.tasks.requireWritable(taskId, policy) : null;

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
    let created;
    try {
      created = await this.prisma.timerSession.create({
        data: {
          userId: policy.userId,
          taskId: task?.id ?? null,
          status: TimerSessionStatus.RUNNING,
          startedAt: now,
          resumedAt: now,
          pausedAt: null,
          accumulatedSeconds: 0,
          note: dto.note?.trim() || null,
        },
        select: TIMER_SESSION_SELECT,
      });
    } catch (caught) {
      // DEUX `start` CONCURRENTS passent tous les deux la verification
      // ci-dessus ; l'index partiel `timer_sessions_one_active_per_user` en
      // laisse passer un seul. Le second arrive ici (P2002) et recoit le meme
      // 409 que s'il etait arrive une seconde plus tard. Sans ce rattrapage,
      // une course produirait un 500 « contrainte violee » — exactement le
      // genre d'etat incoherent que le minuteur promet de ne jamais creer.
      if ((caught as { code?: string })?.code === 'P2002') {
        throw AppException.conflict(
          'TIMER_ALREADY_ACTIVE',
          'Un minuteur est deja en cours. Terminez-le ou mettez-le en pause avant d’en demarrer un autre.',
        );
      }
      throw caught;
    }

    await this.audit.record({
      actorId: policy.userId,
      action: 'TIMER_STARTED',
      entityType: 'TimerSession',
      entityId: created.id,
      after: { taskId: task?.id ?? null, isPersonal: task?.isPersonal ?? null },
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
      throw AppException.conflict(
        'TIMER_NOT_RUNNING',
        'Aucun minuteur en cours à mettre en pause.',
      );
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
      throw AppException.conflict(
        'TIMER_STATE_CONFLICT',
        'Le minuteur a changé pendant la mise en pause.',
      );
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

    return this.present({
      ...session,
      status: TimerSessionStatus.PAUSED,
      pausedAt: now,
      resumedAt: null,
      accumulatedSeconds: seconds,
    });
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
      throw AppException.conflict(
        'TIMER_STATE_CONFLICT',
        'Le minuteur a changé pendant la reprise.',
      );
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

    return this.present({
      ...session,
      status: TimerSessionStatus.RUNNING,
      resumedAt: now,
      pausedAt: null,
    });
  }

  /**
   * Corrige la session EN COURS : tache chronometree et/ou note.
   *
   * CHANGER DE TACHE GARDE LE TEMPS ECOULE. Le cas reel : on demarre vite,
   * sans tache ou sur la mauvaise, et l'on corrige ensuite. Jeter la session
   * pour en recommencer une perdrait du temps travaille — exactement ce que le
   * minuteur promet d'eviter. La nouvelle tache passe par le MEME filtre
   * d'ecriture que le demarrage.
   *
   * La note n'est pas journalisee a chaque frappe (l'ecran l'enregistre au fil
   * de l'eau) ; le changement de tache, lui, l'est : il change l'imputation.
   */
  async update(dto: UpdateTimerDto, policy: AccessPolicy, meta: RequestContext) {
    this.refuseClientSpace(policy);
    const session = await this.findActive(policy);
    if (!session) {
      throw AppException.conflict('TIMER_NOT_ACTIVE', 'Aucun minuteur en cours à modifier.');
    }

    let nextTaskId = session.taskId;
    if (dto.taskId !== undefined) {
      nextTaskId =
        dto.taskId === null ? null : (await this.tasks.requireWritable(dto.taskId, policy)).id;
    }
    const taskChanged = nextTaskId !== session.taskId;
    const noteChanged = dto.note !== undefined;

    if (!taskChanged && !noteChanged) return this.present(session);

    const moved = await this.prisma.timerSession.updateMany({
      where: {
        id: session.id,
        userId: policy.userId,
        status: { in: [TimerSessionStatus.RUNNING, TimerSessionStatus.PAUSED] },
      },
      data: {
        ...(taskChanged ? { taskId: nextTaskId } : {}),
        ...(noteChanged ? { note: dto.note?.trim() || null } : {}),
      },
    });
    if (moved.count !== 1) {
      throw AppException.conflict('TIMER_STATE_CONFLICT', 'Le minuteur a changé entre-temps.');
    }

    if (taskChanged) {
      await this.audit.record({
        actorId: policy.userId,
        action: 'TIMER_UPDATED',
        entityType: 'TimerSession',
        entityId: session.id,
        before: { taskId: session.taskId },
        after: { taskId: nextTaskId },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    }

    const fresh = await this.findActive(policy);
    return fresh ? this.present(fresh) : null;
  }

  /**
   * ABANDON : la session est close SANS saisie de temps.
   *
   * C'est la seule sortie qui n'ecrit rien dans la feuille de temps, et elle
   * est explicite (l'ecran demande confirmation) : un minuteur lance par
   * erreur ne doit pas obliger a enregistrer une minute fantome puis a la
   * supprimer a la main. La session reste en base, STOPPED et sans
   * `timeEntryId`, et l'audit garde la duree abandonnee.
   */
  async discard(policy: AccessPolicy, meta: RequestContext) {
    this.refuseClientSpace(policy);
    const session = await this.findActive(policy);
    if (!session || !canStopTimer(session.status)) {
      throw AppException.conflict('TIMER_NOT_ACTIVE', 'Aucun minuteur en cours à abandonner.');
    }

    const now = new Date();
    const totalSeconds = elapsedSecondsOf(session, now);
    const stopped = await this.prisma.timerSession.updateMany({
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
        savedMinutes: null,
        timeEntryId: null,
      },
    });
    if (stopped.count !== 1) {
      throw AppException.conflict(
        'TIMER_STATE_CONFLICT',
        'Le minuteur a déjà été terminé ailleurs.',
      );
    }

    await this.audit.record({
      actorId: policy.userId,
      action: 'TIMER_DISCARDED',
      entityType: 'TimerSession',
      entityId: session.id,
      before: { status: session.status, taskId: session.taskId },
      after: { discardedSeconds: totalSeconds },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { discarded: true as const, discardedSeconds: totalSeconds };
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
  async stop(dto: StopTimerDto, policy: AccessPolicy, meta: RequestContext) {
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
      // LA SAISIE EST TOUJOURS CREEE, MEME SI LA TACHE A DISPARU pendant la
      // session (relation `SetNull`). Un temps reellement travaille ne se perd
      // pas parce que sa tache a ete supprimee entre-temps : la ligne devient
      // simplement orpheline (sans tache ni projet) et reste visible dans la
      // feuille de temps de son auteur. Refuser de l'ecrire et rendre 0 minute
      // serait une perte silencieuse — exactement ce que le minuteur promet de
      // ne plus faire.
      const entry = await tx.timeEntry.create({
        data: {
          projectId: task?.projectId ?? null,
          taskId: session.taskId,
          userId: policy.userId,
          spentOn,
          minutes,
          // Ce que le porteur a ecrit l'emporte (description finale, sinon la
          // note prise pendant la session) ; a defaut, le libelle historique.
          description: (
            dto.description?.trim() ||
            session.note?.trim() ||
            (task ? `Minuteur : ${task.title}` : 'Minuteur')
          ).slice(0, 500),
          // Une tache personnelle n'a pas de client : rien a facturer. Une
          // tache disparue n'a plus de perimetre facturable : non plus.
          billable: task ? !task.isPersonal : false,
        },
        select: { id: true },
      });
      const timeEntryId = entry.id;

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
      ...(await this.present({
        ...session,
        status: TimerSessionStatus.STOPPED,
        stoppedAt: now,
        resumedAt: null,
        accumulatedSeconds: totalSeconds,
        savedMinutes: minutes,
        timeEntryId: result.timeEntryId,
      })),
      savedMinutes: minutes,
      overflowMinutes,
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

  /**
   * Forme renvoyee au frontend. `task` porte de quoi afficher l'avancement
   * (estimation, temps deja saisi, projet) ; `taskTitle` et `taskIsPersonal`
   * restent pour les ecrans qui les lisent deja.
   */
  private async present(session: TimerSessionRow) {
    const logged = session.task
      ? await this.prisma.timeEntry.aggregate({
          where: { taskId: session.task.id },
          _sum: { minutes: true },
        })
      : null;

    return {
      id: session.id,
      status: session.status,
      taskId: session.taskId,
      taskTitle: session.task?.title ?? null,
      taskIsPersonal: session.task?.isPersonal ?? false,
      task: session.task
        ? {
            id: session.task.id,
            title: session.task.title,
            isPersonal: session.task.isPersonal,
            status: session.task.status,
            estimateMinutes: session.task.estimateMinutes,
            loggedMinutes: logged?._sum.minutes ?? 0,
            project: session.task.project,
          }
        : null,
      note: session.note,
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

  /** Taches ouvertes que le porteur peut chronometrer (filtre d'ecriture). */
  private chronometrableWhere(
    policy: AccessPolicy,
    search?: string,
    scope?: 'mine' | 'team',
  ): Prisma.TaskWhereInput {
    const term = search?.trim();
    const and: Prisma.TaskWhereInput[] = [taskWriteWhereFor(policy)];
    if (term) {
      and.push({
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { project: { is: { name: { contains: term, mode: 'insensitive' } } } },
        ],
      });
    }
    if (scope === 'mine') and.push({ assigneeId: policy.userId });
    // `assigneeId <> moi` seul ecarterait les taches SANS assigne (NULL en SQL
    // n'est ni egal ni different) : ce sont pourtant celles qu'il faut voir.
    if (scope === 'team') {
      and.push({
        isPersonal: false,
        OR: [{ assigneeId: null }, { assigneeId: { not: policy.userId } }],
      });
    }
    return {
      deletedAt: null,
      status: { notIn: [...CLOSED_TASK_STATUSES] },
      OR: [{ project: { deletedAt: null } }, { projectId: null }],
      AND: and,
    };
  }

  /** Un compte client n'a pas de minuteur : le temps est une donnee d'agence. */
  private refuseClientSpace(policy: AccessPolicy): void {
    if (policy.isClient()) {
      throw AppException.forbidden("Le minuteur n'est pas accessible depuis l'espace client.");
    }
  }
}

/** Une tache du selecteur, avec `isMine` pour grouper « mes taches » a l'ecran. */
function presentTask(task: TimerTaskRow, userId: string) {
  const { assigneeId, ...rest } = task;
  return { ...rest, isMine: assigneeId === userId };
}
