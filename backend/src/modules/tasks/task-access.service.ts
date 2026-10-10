import { Injectable } from '@nestjs/common';
import type { AccessPolicy } from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { TaskStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { subjectOf } from '../projects/project-scope.js';
import {
  TASK_READ_ORDER,
  TASK_WRITE_ORDER,
  taskScopeWhere,
  taskWriteScopeWhere,
} from './task-rules.js';

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
    const scope = policy.requireScope('task', 'read', TASK_READ_ORDER);
    return this.load(taskId, taskScopeWhere(scope, subjectOf(policy)));
  }

  /** La tache, si le porteur peut la MODIFIER. Sinon : 404. */
  async requireWritable(taskId: string, policy: AccessPolicy): Promise<TaskRef> {
    const scope = policy.requireScope('task', 'write', TASK_WRITE_ORDER);
    return this.load(taskId, taskWriteScopeWhere(scope, subjectOf(policy)));
  }

  /**
   * 404 ET NON 403, meme raison que pour les projets : un 403 confirmerait que
   * l'identifiant correspond a une tache existante. Voir
   * `ProjectAccessService.requireReadable`.
   */
  private async load(taskId: string, scopeWhere: Prisma.TaskWhereInput): Promise<TaskRef> {
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        deletedAt: null,
        // Une tache d'un projet supprime ne doit plus sortir. Le controle est
        // fait par la relation et non par une seconde requete : une requete
        // separee laisserait une fenetre entre les deux.
        project: { deletedAt: null },
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
  readonly projectId: string;
  readonly assigneeId: string | null;
  readonly reporterId: string | null;
  readonly milestoneId: string | null;
  readonly isClientVisible: boolean;
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly managerId: string | null;
    readonly clientId: string;
  };
}

const TASK_REF_SELECT = {
  id: true,
  title: true,
  status: true,
  projectId: true,
  assigneeId: true,
  reporterId: true,
  milestoneId: true,
  isClientVisible: true,
  project: { select: { id: true, name: true, managerId: true, clientId: true } },
} as const;
