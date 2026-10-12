import { Injectable } from '@nestjs/common';
import type { AccessPolicy } from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { TaskStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { taskReadWhereFor, taskWriteWhereFor } from './task-rules.js';

/**
 * ACCES A UNE TACHE, EN UN SEUL ENDROIT.
 *
 * Le module TEMPS en a besoin autant que le module TACHES : avant de saisir du
 * temps sur une tache, il faut savoir si le porteur a le droit de la voir — et,
 * pour un developpeur, s'il a le droit d'y toucher. Dupliquer ce filtre la aurait
 * fait diverger deux perimetres, et la divergence va toujours dans le sens de
 * l'ouverture.
 *
 * LE PERIMETRE D'UNE TACHE EST SON PROPRE SCOPE, PAS CELUI DU PROJET.
 *
 * C'est un choix, et il merite d'etre justifie parce que l'inverse est tentant :
 * on pourrait exiger en plus que le porteur puisse lire le projet. Ce serait une
 * erreur. `task:read:assigned` veut dire « je vois les taches qui me sont
 * assignees » — une ensemble plus ETROIT que le projet. Ajouter une condition de
 * projet ferait disparaitre une tache qu'un chef de projet vient d'assigner a
 * quelqu'un qui n'est pas encore membre de l'equipe : l'assignation serait
 * silencieusement sans effet, et personne ne comprendrait pourquoi.
 *
 * La composition inverse est en place : assigner une tache AJOUTE l'assigne a
 * l'equipe du projet (voir `TasksService.create` et `assign`). La coherence est
 * donc obtenue en elargissant l'equipe au bon moment, jamais en restreignant la
 * lecture de la tache.
 */
@Injectable()
export class TaskAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** La tache, si le porteur peut la LIRE. Sinon : 404. */
  async requireReadable(taskId: string, policy: AccessPolicy): Promise<TaskRef> {
    return this.load(taskId, taskReadWhereFor(policy));
  }

  /** La tache, si le porteur peut la MODIFIER. Sinon : 404. */
  async requireWritable(taskId: string, policy: AccessPolicy): Promise<TaskRef> {
    return this.load(taskId, taskWriteWhereFor(policy));
  }

  /**
   * La tache PERSONNELLE du porteur, si elle existe. Sinon : 404.
   *
   * Reservee aux routes dont la seule ouverture est « la mienne » — aujourd'hui
   * `DELETE /tasks/:id` via `task:write:personal`. Elle n'utilise pas les
   * scopes classiques : un porteur de `task:read:any` ne doit PAS passer par
   * ici pour atteindre l'espace prive d'un collegue, et un porteur sans scope
   * de lecture de projet (ex. gerant communication) doit pourtant pouvoir
   * supprimer ses propres taches personnelles.
   */
  async requireOwnPersonal(taskId: string, policy: AccessPolicy): Promise<TaskRef> {
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        deletedAt: null,
        isPersonal: true,
        projectId: null,
        assigneeId: policy.userId,
      },
      select: TASK_REF_SELECT,
    });

    if (!task) {
      throw AppException.notFound('TASK_NOT_FOUND', 'Cette tache est introuvable.');
    }

    return task;
  }

  /**
   * 404 ET NON 403, meme raison que pour les projets : un 403 confirmerait que
   * l'identifiant correspond a une tache existante. Voir
   * `ProjectAccessService.requireReadable`.
   *
   * `OR: [{ project non supprime }, { projectId: null }]` : une tache
   * PERSONNELLE n'a pas de projet, et ne doit pas disparaitre du perimetre pour
   * autant ; une tache de projet dont le projet est supprime, si.
   */
  private async load(taskId: string, scopeWhere: Prisma.TaskWhereInput): Promise<TaskRef> {
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        deletedAt: null,
        OR: [{ project: { deletedAt: null } }, { projectId: null }],
        AND: [scopeWhere],
      },
      select: TASK_REF_SELECT,
    });

    if (!task) {
      throw AppException.notFound('TASK_NOT_FOUND', 'Cette tache est introuvable.');
    }

    return task;
  }
}

/** Ce dont les appelants ont besoin, et rien de plus. */
export interface TaskRef {
  readonly id: string;
  readonly title: string;
  readonly status: TaskStatus;
  /** `null` pour une tache personnelle. */
  readonly projectId: string | null;
  /** Vrai pour une tache personnelle : privee, sans projet ni client. */
  readonly isPersonal: boolean;
  readonly assigneeId: string | null;
  readonly reporterId: string | null;
  readonly milestoneId: string | null;
  readonly isClientVisible: boolean;
  /** `null` pour une tache personnelle. */
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly managerId: string | null;
    readonly clientId: string;
  } | null;
}

const TASK_REF_SELECT = {
  id: true,
  title: true,
  status: true,
  projectId: true,
  isPersonal: true,
  assigneeId: true,
  reporterId: true,
  milestoneId: true,
  isClientVisible: true,
  project: { select: { id: true, name: true, managerId: true, clientId: true } },
} as const;
