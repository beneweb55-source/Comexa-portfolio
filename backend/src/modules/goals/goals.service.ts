import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AccessPolicy } from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { GoalStatus, type TaskStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { RequestContext } from '../projects/request-meta.decorator.js';
import { mineTaskWhere } from '../tasks/task-rules.js';
import type { CreateGoalDto, GoalQueryDto, UpdateGoalDto } from './dto/goal.dto.js';
import { achievedAtAfter, goalAcceptsTasks, goalProgressOf } from './goal-rules.js';

/**
 * OBJECTIFS PERSONNELS — un but, et le groupe de taches qui y mene.
 *
 * TROIS REGLES, TOUTES DANS LE `where` :
 *
 *  1. UN OBJECTIF N'APPARTIENT QU'A SON PROPRIETAIRE. Chaque lecture et chaque
 *     ecriture filtre `ownerId: <porteur>` ; l'objectif d'un collegue repond
 *     404, exactement comme une tache hors perimetre. Aucun scope `any` ne
 *     l'ouvre : c'est l'espace personnel.
 *  2. ON NE RATTACHE QUE « MES TACHES » : une tache personnelle du porteur, ou
 *     une tache de projet qui LUI EST ASSIGNEE (`mineTaskWhere`, le meme
 *     perimetre que `GET /me/tasks`). La tache de projet n'est pas modifiee :
 *     la liaison vit dans `goal_tasks`, et l'equipe n'en voit rien.
 *  3. L'AVANCEMENT SE DEDUIT DES TACHES VISIBLES. Une tache de projet reassignee
 *     a quelqu'un d'autre sort de l'objectif a la lecture (elle n'est plus « a
 *     moi ») — la liaison reste, et revient si la tache revient. Rien n'est
 *     efface en douce dans le module des taches.
 */

const GOAL_TASK_SELECT = {
  id: true,
  title: true,
  status: true,
  priority: true,
  dueDate: true,
  completedAt: true,
  isPersonal: true,
  estimateMinutes: true,
  project: { select: { id: true, name: true } },
} as const;

const GOAL_SELECT = {
  id: true,
  title: true,
  description: true,
  targetDate: true,
  color: true,
  status: true,
  achievedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type GoalRow = Prisma.GoalGetPayload<{ select: typeof GOAL_SELECT }>;
type GoalTaskRow = Prisma.TaskGetPayload<{ select: typeof GOAL_TASK_SELECT }>;

@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: GoalQueryDto, policy: AccessPolicy) {
    this.refuseClientSpace(policy);
    const status = query.status ?? null;
    const where: Prisma.GoalWhereInput = {
      ownerId: policy.userId,
      ...(status === 'all'
        ? {}
        : status
          ? { status }
          : { status: { in: [GoalStatus.ACTIVE, GoalStatus.ACHIEVED] } }),
    };

    const goals = await this.prisma.goal.findMany({
      where,
      // Les objectifs ouverts d'abord, puis par date cible (sans date en fin).
      orderBy: [
        { status: 'asc' },
        { targetDate: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'asc' },
      ],
      take: 100,
      select: GOAL_SELECT,
    });

    const tasksByGoal = await this.visibleTasksOf(
      goals.map((goal) => goal.id),
      policy,
    );
    return goals.map((goal) => present(goal, tasksByGoal.get(goal.id) ?? []));
  }

  async getOne(goalId: string, policy: AccessPolicy) {
    this.refuseClientSpace(policy);
    const goal = await this.requireOwn(goalId, policy);
    const tasks = await this.visibleTasksOf([goal.id], policy);
    return present(goal, tasks.get(goal.id) ?? []);
  }

  async create(dto: CreateGoalDto, policy: AccessPolicy, meta: RequestContext) {
    this.refuseClientSpace(policy);
    const created = await this.prisma.goal.create({
      data: {
        ownerId: policy.userId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
        color: dto.color ?? 'blue',
      },
      select: GOAL_SELECT,
    });

    // Le titre reste hors du journal : un objectif personnel est prive, et
    // l'identifiant suffit a la tracabilite.
    await this.audit.record({
      actorId: policy.userId,
      action: 'GOAL_CREATED',
      entityType: 'Goal',
      entityId: created.id,
      after: { status: created.status },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return present(created, []);
  }

  async update(goalId: string, dto: UpdateGoalDto, policy: AccessPolicy, meta: RequestContext) {
    this.refuseClientSpace(policy);
    const before = await this.requireOwn(goalId, policy);
    const statusChanged = dto.status !== undefined && dto.status !== before.status;

    const updated = await this.prisma.goal.update({
      where: { id: before.id },
      data: {
        ...(dto.title === undefined ? {} : { title: dto.title.trim() }),
        ...(dto.description === undefined ? {} : { description: dto.description?.trim() || null }),
        ...(dto.targetDate === undefined
          ? {}
          : { targetDate: dto.targetDate ? new Date(dto.targetDate) : null }),
        ...(dto.color === undefined ? {} : { color: dto.color }),
        ...(statusChanged && dto.status
          ? { status: dto.status, achievedAt: achievedAtAfter(before, dto.status, new Date()) }
          : {}),
      },
      select: GOAL_SELECT,
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'GOAL_UPDATED',
      entityType: 'Goal',
      entityId: before.id,
      before: { status: before.status },
      after: { status: updated.status, fields: Object.keys(dto) },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const tasks = await this.visibleTasksOf([updated.id], policy);
    return present(updated, tasks.get(updated.id) ?? []);
  }

  /**
   * Suppression PHYSIQUE de l'objectif — ses taches restent intactes.
   *
   * Un objectif est une note d'organisation personnelle, pas une piece de
   * gestion (devis, facture, projet) dont l'historique engage l'agence. Ses
   * liaisons partent avec lui (`ON DELETE CASCADE`) ; les taches, elles, ne
   * sont jamais supprimees par ce geste. L'audit garde la trace du geste.
   */
  async remove(goalId: string, policy: AccessPolicy, meta: RequestContext) {
    this.refuseClientSpace(policy);
    const before = await this.requireOwn(goalId, policy);
    await this.prisma.goal.delete({ where: { id: before.id } });

    await this.audit.record({
      actorId: policy.userId,
      action: 'GOAL_DELETED',
      entityType: 'Goal',
      entityId: before.id,
      before: { status: before.status },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { deleted: true as const };
  }

  /**
   * Rattache une de MES taches a l'objectif. Si elle servait un autre de mes
   * objectifs, elle change d'objectif (une tache, un objectif par personne).
   */
  async linkTask(goalId: string, taskId: string, policy: AccessPolicy, meta: RequestContext) {
    this.refuseClientSpace(policy);
    const goal = await this.requireOwn(goalId, policy);
    if (!goalAcceptsTasks(goal.status)) {
      throw AppException.unprocessable(
        'GOAL_ARCHIVED',
        "Cet objectif est archive : reactivez-le avant d'y ajouter une tache.",
      );
    }

    const task = await this.prisma.task.findFirst({
      where: { id: taskId, AND: [mineTaskWhere(policy)] },
      select: { id: true },
    });
    if (!task) {
      // 404 et non 403 : une tache hors de « mes taches » n'existe pas pour moi.
      throw AppException.notFound('TASK_NOT_FOUND', 'Cette tache est introuvable.');
    }

    const previous = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.goalTask.findUnique({
        where: { ownerId_taskId: { ownerId: policy.userId, taskId: task.id } },
        select: { goalId: true },
      });
      if (existing?.goalId === goal.id) return existing.goalId;
      if (existing) {
        await tx.goalTask.delete({
          where: { ownerId_taskId: { ownerId: policy.userId, taskId: task.id } },
        });
      }
      await tx.goalTask.create({
        data: { goalId: goal.id, taskId: task.id, ownerId: policy.userId },
      });
      return existing?.goalId ?? null;
    });

    if (previous !== goal.id) {
      await this.audit.record({
        actorId: policy.userId,
        action: 'GOAL_TASK_LINKED',
        entityType: 'Goal',
        entityId: goal.id,
        before: { goalId: previous },
        after: { goalId: goal.id, taskId: task.id },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    }

    return this.getOne(goal.id, policy);
  }

  async unlinkTask(goalId: string, taskId: string, policy: AccessPolicy, meta: RequestContext) {
    this.refuseClientSpace(policy);
    const goal = await this.requireOwn(goalId, policy);
    const removed = await this.prisma.goalTask.deleteMany({
      where: { goalId: goal.id, taskId, ownerId: policy.userId },
    });
    if (removed.count === 0) {
      throw AppException.notFound(
        'GOAL_TASK_NOT_FOUND',
        "Cette tache ne fait pas partie de l'objectif.",
      );
    }

    await this.audit.record({
      actorId: policy.userId,
      action: 'GOAL_TASK_UNLINKED',
      entityType: 'Goal',
      entityId: goal.id,
      before: { taskId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.getOne(goal.id, policy);
  }

  // ---------------------------------------------------------------------------
  // Garde-fous
  // ---------------------------------------------------------------------------

  private async requireOwn(goalId: string, policy: AccessPolicy): Promise<GoalRow> {
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, ownerId: policy.userId },
      select: GOAL_SELECT,
    });
    if (!goal) {
      throw AppException.notFound('GOAL_NOT_FOUND', 'Cet objectif est introuvable.');
    }
    return goal;
  }

  /** Taches rattachees ET encore « a moi », par objectif, dans l'ordre d'ajout. */
  private async visibleTasksOf(goalIds: readonly string[], policy: AccessPolicy) {
    const byGoal = new Map<string, GoalTaskRow[]>();
    if (goalIds.length === 0) return byGoal;

    const links = await this.prisma.goalTask.findMany({
      where: { goalId: { in: [...goalIds] }, ownerId: policy.userId, task: mineTaskWhere(policy) },
      orderBy: { addedAt: 'asc' },
      select: { goalId: true, task: { select: GOAL_TASK_SELECT } },
    });

    for (const link of links) {
      const list = byGoal.get(link.goalId) ?? [];
      list.push(link.task);
      byGoal.set(link.goalId, list);
    }
    return byGoal;
  }

  private refuseClientSpace(policy: AccessPolicy): void {
    if (policy.isClient()) {
      throw AppException.forbidden("Les objectifs ne sont pas accessibles depuis l'espace client.");
    }
  }
}

function present(goal: GoalRow, tasks: readonly GoalTaskRow[]) {
  return {
    ...goal,
    progress: goalProgressOf(tasks.map((task) => task.status as TaskStatus)),
    tasks,
  };
}
