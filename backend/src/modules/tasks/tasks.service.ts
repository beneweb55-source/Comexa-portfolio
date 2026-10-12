import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { type AccessPolicy, type ScopeName } from '../../common/auth/principal.js';
import { paginated, resolvePagination } from '../../common/dto/pagination.dto.js';
import { AppException } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  ActivityType,
  NotificationType,
  RoleCode,
  TaskStatus,
  UserStatus,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { ProjectAccessService } from '../projects/project-access.service.js';
import { subjectOf } from '../projects/project-scope.js';
import type { RequestContext } from '../projects/request-meta.decorator.js';
import {
  AssignTaskDto,
  CreatePersonalTaskDto,
  CreateTaskDto,
  TaskQueryDto,
  UpdateTaskDto,
  UpdateTaskStatusDto,
} from './dto/task.dto.js';
import { TaskAccessService, type TaskRef } from './task-access.service.js';
import {
  CLOSED_TASK_STATUSES,
  PERSONAL_TASK_WRITE_CODE,
  TASK_READ_ORDER,
  TASK_WRITE_ORDER,
  canAttachSubTask,
  canTransitionTask,
  hasOpenSubTasks,
  isClosedTaskStatus,
  isTaskEditable,
  personalTaskShapeViolation,
  taskReadWhereFor,
  taskScopeWhere,
} from './task-rules.js';

/**
 * TACHES, SOUS-TACHES ET ASSIGNATION.
 *
 * TROIS REGLES DURES, ET ELLES SONT APPLIQUEES DANS LE `where`, PAS APRES.
 *
 * 1. UN DEVELOPPEUR OU UN DESIGNER NE MODIFIE QUE CE QUI LUI EST ASSIGNE.
 *    `task:write:own` se traduit par `assigneeId: <porteur>` dans le filtre de
 *    `TaskAccessService.requireWritable`. La ligne n'est donc jamais chargee si
 *    elle n'est pas a lui : il n'y a pas de « je lis puis je verifie », qui
 *    laisserait une fenetre et un oubli possible.
 *
 * 2. UN COMPTE CLIENT NE VOIT AUCUNE TACHE. Le role CLIENT ne detient aucune
 *    permission `task:*`, donc le garde arrete la requete avant ce service. La
 *    verification ci-dessous est la seconde barriere, explicite : elle ne
 *    depend pas du catalogue de permissions, qui peut changer.
 *
 * 3. UNE TACHE TERMINEE NE SE MODIFIE PLUS, SAUF `task:write:any`. Un `DONE`
 *    qui bouge encore ne vaut rien dans un rapport d'avancement. La regle est
 *    reprise dans le `where` de l'ecriture (`status: { notIn: [...] }`), donc
 *    elle resiste meme a un changement concurrent.
 */

/** Detail d'une tache. Commun a la lecture et aux retours d'ecriture. */
const TASK_DETAIL_SELECT = {
  id: true,
  projectId: true,
  isPersonal: true,
  milestoneId: true,
  parentTaskId: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  assigneeId: true,
  reporterId: true,
  estimateMinutes: true,
  startDate: true,
  dueDate: true,
  completedAt: true,
  isClientVisible: true,
  order: true,
  createdAt: true,
  updatedAt: true,
  project: { select: { id: true, reference: true, name: true, status: true } },
  milestone: { select: { id: true, title: true, status: true } },
  assignee: { select: { id: true, firstName: true, lastName: true } },
  reporter: { select: { id: true, firstName: true, lastName: true } },
  subTasks: {
    where: { deletedAt: null },
    orderBy: { order: 'asc' },
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      assigneeId: true,
      dueDate: true,
    },
  },
} as const;

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TaskAccessService,
    private readonly projects: ProjectAccessService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lecture
  // ---------------------------------------------------------------------------

  async listForProject(projectId: string, query: TaskQueryDto, policy: AccessPolicy) {
    this.refuseClientSpace(policy);
    // Perimetre du PROJET d'abord : `GET /projects/:id/tasks` sur un projet hors
    // perimetre doit repondre 404, pas « liste vide ». Une liste vide dirait
    // « ce projet existe et n'a pas de taches », ce qui est deja une information.
    const project = await this.projects.requireReadable(projectId, policy);
    const p = resolvePagination(query);

    const where: Prisma.TaskWhereInput = {
      projectId: project.id,
      deletedAt: null,
      AND: [this.readWhere(policy), buildTaskFilters(query)],
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        // `order` d'abord (l'ordre choisi a la main dans un tableau), puis la
        // date : deux taches sans ordre explicite restent stables d'un appel a
        // l'autre, ce qu'une pagination exige.
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        skip: p.skip,
        take: p.take,
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          assigneeId: true,
          parentTaskId: true,
          milestoneId: true,
          dueDate: true,
          completedAt: true,
          estimateMinutes: true,
          isClientVisible: true,
          order: true,
          assignee: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.task.count({ where }),
    ]);

    return paginated(items, total, p);
  }

  /**
   * « Mes taches », tous projets confondus.
   *
   * C'EST LA ROUTE QU'UN DEVELOPPEUR OU UN DESIGNER OUVRE LE MATIN. Elle force
   * `assigneeId: <porteur>` — y compris pour un chef de projet qui detient
   * `task:read:any`, sans quoi l'ecran « mes taches » afficherait le travail de
   * toute l'agence et ne servirait plus a rien.
   *
   * Le tri par echeance croissante met en haut ce qui presse ; PostgreSQL place
   * les `NULL` (taches sans echeance) en dernier sur un tri ascendant, ce qui est
   * le comportement voulu : ce qui n'a pas de date n'est pas urgent.
   */
  async listMine(query: TaskQueryDto, policy: AccessPolicy) {
    this.refuseClientSpace(policy);
    const p = resolvePagination(query);

    const where: Prisma.TaskWhereInput = {
      deletedAt: null,
      // Une tache personnelle n'a pas de projet : le perimetre accepte soit un
      // projet non supprime, soit l'absence de projet — et rien d'autre (une
      // tache de projet supprime reste invisible).
      OR: [{ project: { deletedAt: null } }, { projectId: null }],
      AND: [{ assigneeId: policy.userId }, taskReadWhereFor(policy), buildTaskFilters(query)],
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
        skip: p.skip,
        take: p.take,
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          dueDate: true,
          completedAt: true,
          estimateMinutes: true,
          projectId: true,
          isPersonal: true,
          parentTaskId: true,
          project: { select: { id: true, reference: true, name: true } },
          milestone: { select: { id: true, title: true } },
        },
      }),
      this.prisma.task.count({ where }),
    ]);

    return paginated(items, total, p);
  }

  async getOne(taskId: string, policy: AccessPolicy) {
    this.refuseClientSpace(policy);
    await this.access.requireReadable(taskId, policy);
    return this.detail(taskId);
  }

  private async detail(taskId: string) {
    const [task, time] = await Promise.all([
      this.prisma.task.findFirst({
        where: { id: taskId, deletedAt: null },
        select: TASK_DETAIL_SELECT,
      }),
      // Somme du temps saisi, interrogee a part : `_count` ne saurait pas
      // additionner, et une tache sans temps saisi doit rendre 0, pas `null`.
      this.prisma.timeEntry.aggregate({ where: { taskId }, _sum: { minutes: true } }),
    ]);

    if (!task) {
      throw AppException.notFound('TASK_NOT_FOUND', 'Cette tache est introuvable.');
    }

    return { ...task, loggedMinutes: time._sum.minutes ?? 0 };
  }

  // ---------------------------------------------------------------------------
  // Ecriture
  // ---------------------------------------------------------------------------

  /**
   * Cree une tache dans un projet.
   *
   * DEUX SCOPES D'ECRITURE, DEUX COMPORTEMENTS DIFFERENTS POUR L'ASSIGNATION.
   *
   *  - `task:write:own` (developpeur, designer) : la tache creee est
   *    NECESSAIREMENT a soi. Assigner a quelqu'un d'autre est refuse, et
   *    l'omission du champ vaut auto-assignation — un developpeur qui note une
   *    tache a faire la note pour lui.
   *  - `task:write:any` (chef de projet) : l'assignation est libre, mais
   *    designer quelqu'un d'autre exige `task:assign:any`. Sans ce controle,
   *    `project:write:any` aurait suffi a distribuer le travail, et la permission
   *    `task:assign:any` n'aurait rien protege.
   */
  async create(projectId: string, dto: CreateTaskDto, policy: AccessPolicy, meta: RequestContext) {
    const scope = this.writeScope(policy);
    this.refuseClientSpace(policy);
    const project = await this.projects.requireReadable(projectId, policy);

    const assigneeId = this.resolveAssignee(scope, dto.assigneeId, policy);
    if (assigneeId) {
      await this.requireAssignableUser(assigneeId);
    }
    if (dto.milestoneId) {
      await this.requireMilestoneOfProject(dto.milestoneId, project.id);
    }
    if (dto.parentTaskId) {
      await this.requireAttachableParent(dto.parentTaskId, project.id);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          projectId: project.id,
          isPersonal: false,
          milestoneId: dto.milestoneId ?? null,
          parentTaskId: dto.parentTaskId ?? null,
          title: dto.title,
          description: dto.description ?? null,
          priority: dto.priority,
          assigneeId,
          reporterId: policy.userId,
          estimateMinutes: dto.estimateMinutes ?? null,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          isClientVisible: dto.isClientVisible ?? false,
          order: dto.order ?? 0,
        },
        select: { id: true, title: true },
      });

      if (assigneeId) {
        await ensureTeamMember(tx, project.id, assigneeId);
      }

      await this.activity.record(
        {
          type: ActivityType.TASK_CREATED,
          message: `Tache « ${task.title} » creee.`,
          projectId: project.id,
          taskId: task.id,
          clientId: project.clientId,
          actorId: policy.userId,
          metadata: { status: TaskStatus.TODO, priority: dto.priority ?? null },
          // La visibilite du fil SUIT celle de la tache. Une tache interne dont
          // la creation serait annoncee au client revelerait precisement ce que
          // `isClientVisible: false` sert a cacher.
          isClientVisible: dto.isClientVisible ?? false,
        },
        tx,
      );

      if (assigneeId && assigneeId !== policy.userId) {
        await this.notifications.notify(
          assigneeId,
          {
            type: NotificationType.TASK_ASSIGNED,
            title: `Nouvelle tache : ${task.title}`,
            body: `Projet « ${project.name} »`,
            link: `/taches/${task.id}`,
            entityType: 'Task',
            entityId: task.id,
          },
          tx,
        );
      }

      return task;
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'TASK_CREATED',
      entityType: 'Task',
      entityId: created.id,
      after: { projectId: project.id, title: created.title, assigneeId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.detail(created.id);
  }

  /**
   * Cree une TACHE PERSONNELLE : une liste de travail privee, sans projet ni
   * client. `POST /me/tasks`.
   *
   * TROIS CHOIX, TOUS SECURITAIRES :
   *
   *  - ASSIGNE = RAPPORTEUR = PORTEUR. Une tache personnelle ne s'assigne a
   *    personne d'autre, sans quoi elle retomberait dans le perimetre d'un
   *    tiers sans que `personalTaskWhere` puisse la distinguer.
   *  - PAS DE JALON, PAS DE PARENT, `isClientVisible: false` — et ce n'est pas
   *    seulement une convention : `CreatePersonalTaskDto` ne porte MEME PAS ces
   *    champs, donc rien ne peut les renseigner, fut-ce par erreur.
   *  - AUCUNE ENTREE DE FIL D'ACTIVITE, AUCUNE NOTIFICATION. Le fil exige un
   *    projet, et annoncer « X a cree une tache » revelerait l'existence d'un
   *    espace qui se definit justement par sa discretion. L'audit, lui, trace
   *    le geste : c'est une journalisation interne, invisible des autres
   *    ecrans, et elle reste due.
   */
  async createPersonal(dto: CreatePersonalTaskDto, policy: AccessPolicy, meta: RequestContext) {
    this.refuseClientSpace(policy);

    // Le garde de route exige deja `task:write:personal` ; cette verification
    // est la seconde barriere, comme `refuseClientSpace` : elle ne depend pas
    // du decorateur, qui peut changer.
    if (!policy.has(PERSONAL_TASK_WRITE_CODE)) {
      throw AppException.forbidden(
        'Creer une tache personnelle exige la permission task:write:personal.',
      );
    }

    const created = await this.prisma.task.create({
      data: {
        projectId: null,
        isPersonal: true,
        milestoneId: null,
        parentTaskId: null,
        title: dto.title,
        description: dto.description ?? null,
        priority: dto.priority,
        assigneeId: policy.userId,
        reporterId: policy.userId,
        estimateMinutes: dto.estimateMinutes ?? null,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        isClientVisible: false,
        order: 0,
      },
      select: { id: true },
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'TASK_CREATED',
      entityType: 'Task',
      entityId: created.id,
      after: { isPersonal: true, title: dto.title, assigneeId: policy.userId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.detail(created.id);
  }

  async update(taskId: string, dto: UpdateTaskDto, policy: AccessPolicy, meta: RequestContext) {
    this.refuseClientSpace(policy);
    const before = await this.access.requireWritable(taskId, policy);
    const wide = policy.has('task:write:any');
    // Une tache PERSONNELLE reste modifiable par son proprietaire, meme close :
    // c'est son carnet de travail prive, personne d'autre n'a de confiance a y
    // accorder. La regle « un DONE ne bouge plus » protege la FIABILITE d'un
    // rapport de projet — elle n'a aucun sens sur une note personnelle que son
    // seul lecteur decide de corriger.
    const editable = wide || before.isPersonal;

    if (!isTaskEditable(before.status, editable)) {
      throw AppException.unprocessable(
        'TASK_CLOSED_NOT_EDITABLE',
        `Cette tache est ${before.status} : seul un porteur de task:write:any peut encore la modifier.`,
        { status: before.status },
      );
    }

    // Une tache personnelle refuse tout ce qui la rattacherait au collectif :
    // jalon, visibilite client. `wide` n'y change rien — c'est une question de
    // perimetre, pas de grade.
    if (before.isPersonal) {
      const shapeError = personalTaskShapeViolation(dto);
      if (shapeError) {
        throw AppException.unprocessable('PERSONAL_TASK_SHAPE_REFUSED', shapeError, { taskId });
      }
    }

    if (dto.milestoneId !== undefined && dto.milestoneId !== null && before.projectId) {
      await this.requireMilestoneOfProject(dto.milestoneId, before.projectId);
    }

    const visibilityChanged =
      dto.isClientVisible !== undefined && dto.isClientVisible !== before.isClientVisible;
    // Apres la garde ci-dessus, une tache personnelle ne peut plus porter de
    // changement de visibilite : la variable locale ne sert qu'a le dire au
    // compilateur (le `project` d'une tache personnelle est `null`).
    const projectOfTask = before.project;

    await this.prisma.$transaction(async (tx) => {
      // Le statut clos est repris dans le `where` en plus du controle ci-dessus :
      // il ferme la fenetre entre la lecture et l'ecriture, pendant laquelle un
      // autre porteur a pu terminer la tache.
      const updated = await tx.task.updateMany({
        where: {
          id: taskId,
          deletedAt: null,
          ...(editable ? {} : { status: { notIn: [...CLOSED_TASK_STATUSES] } }),
        },
        data: {
          ...(dto.title === undefined ? {} : { title: dto.title }),
          ...(dto.description === undefined ? {} : { description: dto.description }),
          ...(dto.milestoneId === undefined ? {} : { milestoneId: dto.milestoneId }),
          ...(dto.priority === undefined ? {} : { priority: dto.priority }),
          ...(dto.estimateMinutes === undefined ? {} : { estimateMinutes: dto.estimateMinutes }),
          ...(dto.startDate === undefined ? {} : { startDate: toDateOrNull(dto.startDate) }),
          ...(dto.dueDate === undefined ? {} : { dueDate: toDateOrNull(dto.dueDate) }),
          ...(dto.isClientVisible === undefined ? {} : { isClientVisible: dto.isClientVisible }),
          ...(dto.order === undefined ? {} : { order: dto.order }),
        },
      });

      if (updated.count !== 1) {
        throw AppException.conflict(
          'TASK_EDIT_CONFLICT',
          'La tache a change entre-temps (statut ou suppression). Rechargez-la avant de reessayer.',
        );
      }

      if (visibilityChanged && projectOfTask) {
        await this.activity.record(
          {
            type: ActivityType.NOTE,
            message: dto.isClientVisible
              ? `La tache « ${before.title} » est desormais partagee avec le client.`
              : `La tache « ${before.title} » n'est plus partagee avec le client.`,
            projectId: projectOfTask.id,
            taskId,
            clientId: projectOfTask.clientId,
            actorId: policy.userId,
            metadata: { field: 'isClientVisible', value: dto.isClientVisible ?? false },
            // TOUJOURS INTERNE, dans les deux sens. Quand on RETIRE une tache de
            // la vue client, une entree visible annoncerait au client ce qu'on
            // vient justement de lui cacher.
            isClientVisible: false,
          },
          tx,
        );
      }
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'TASK_UPDATED',
      entityType: 'Task',
      entityId: taskId,
      before: { status: before.status, title: before.title },
      after: dto,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.detail(taskId);
  }

  /**
   * Transitions de statut — le coeur du domaine.
   *
   * L'ECRITURE DU STATUT EST UN COMPARE-AND-SWAP. Le `where` de l'`updateMany`
   * porte `status: <ancien>` : deux personnes qui deplacent la meme tache en
   * meme temps ne peuvent pas aboutir toutes les deux. La seconde recoit un 409,
   * ce qui est la seule reponse honnete — sans cela, la seconde ecraserait la
   * premiere et le fil d'activite raconterait une transition qui n'a jamais eu
   * lieu.
   */
  async changeStatus(
    taskId: string,
    dto: UpdateTaskStatusDto,
    policy: AccessPolicy,
    meta: RequestContext,
  ) {
    this.refuseClientSpace(policy);
    const before = await this.access.requireWritable(taskId, policy);

    if (before.status === dto.status) {
      throw AppException.conflict(
        'TASK_STATUS_UNCHANGED',
        `Cette tache est deja au statut ${before.status}.`,
      );
    }

    if (!canTransitionTask(before.status, dto.status)) {
      throw AppException.unprocessable(
        'TASK_STATUS_TRANSITION_REFUSED',
        `Passer de ${before.status} a ${dto.status} n'est pas une transition autorisee.`,
        { from: before.status, to: dto.status },
      );
    }

    // LA REGLE DES SOUS-TACHES. Voir `task-rules.ts` pour la justification
    // complete : un parent clos affirme que le travail est fini, donc ses
    // enfants doivent l'etre aussi.
    if (isClosedTaskStatus(dto.status)) {
      const children = await this.prisma.task.findMany({
        where: { parentTaskId: taskId, deletedAt: null },
        select: { status: true },
      });

      if (hasOpenSubTasks(children.map((child) => child.status))) {
        const open = children.filter((child) => !isClosedTaskStatus(child.status)).length;
        throw AppException.unprocessable(
          'TASK_HAS_OPEN_SUBTASKS',
          `Cette tache a ${open} sous-tache(s) encore ouverte(s). Terminez-les ou annulez-les avant de fermer le parent.`,
          { openSubTasks: open },
        );
      }
    }

    // Une tache personnelle ne previent PERSONNE : son existence meme est une
    // information privee. `projectOfTask` vaut alors `null` et coupe le fil.
    const recipients = before.isPersonal ? [] : this.recipientsOf(before, policy.userId);
    const projectOfTask = before.project;
    const completing = dto.status === TaskStatus.DONE;

    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.task.updateMany({
        where: { id: taskId, deletedAt: null, status: before.status },
        data: {
          status: dto.status,
          // `completedAt` suit le statut dans les deux sens : le remettre a
          // `null` en quittant DONE evite qu'une tache rouverte garde une date
          // d'achevement qui la ferait compter comme terminee dans un rapport.
          completedAt: completing ? new Date() : null,
        },
      });

      if (moved.count !== 1) {
        throw AppException.conflict(
          'TASK_STATUS_CONFLICT',
          'Le statut a change entre-temps. Rechargez la tache avant de reessayer.',
        );
      }

      // Une tache personnelle n'ecrit dans AUCUN fil de projet : l'entree
      // exigerait un projet, et son existence est une information privee.
      if (!before.isPersonal && projectOfTask) {
        await this.activity.record(
          {
            type: completing ? ActivityType.TASK_COMPLETED : ActivityType.STATUS_CHANGE,
            message: `Tache « ${before.title} » : ${before.status} → ${dto.status}.`,
            projectId: projectOfTask.id,
            taskId,
            clientId: projectOfTask.clientId,
            actorId: policy.userId,
            metadata: { from: before.status, to: dto.status },
            // La visibilite de l'entree SUIT celle de la tache, et c'est un choix
            // conscient : une tache partagee avec le client voit son avancement
            // partage aussi (c'est l'interet), une tache interne reste interne.
            isClientVisible: before.isClientVisible,
          },
          tx,
        );
      }

      if (recipients.length > 0) {
        await this.notifications.notifyMany(
          recipients,
          {
            type: completing ? NotificationType.TASK_COMPLETED : NotificationType.SYSTEM,
            title: completing
              ? `Tache terminee : ${before.title}`
              : `Tache « ${before.title} » : statut ${dto.status}`,
            // Pour une tache personnelle, `recipients` est vide : cette branche
            // ne s'atteint jamais et le repli ne sert qu'au typage.
            body: projectOfTask ? `Projet « ${projectOfTask.name} »` : 'Tache personnelle',
            link: `/taches/${taskId}`,
            entityType: 'Task',
            entityId: taskId,
          },
          tx,
        );
      }
    });

    await this.audit.record({
      actorId: policy.userId,
      action: completing ? 'TASK_COMPLETED' : 'TASK_STATUS_CHANGED',
      entityType: 'Task',
      entityId: taskId,
      before: { status: before.status },
      after: { status: dto.status },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.detail(taskId);
  }

  /**
   * Assigne ou desassigne.
   *
   * L'ASSIGNE REJOINT L'EQUIPE DU PROJET, SAUF S'IL EN A ETE RETIRE. La nuance
   * compte : ajouter automatiquement quelqu'un qui n'a jamais ete membre est la
   * consequence normale de lui confier du travail, mais ressusciter une ligne que
   * le chef de projet a volontairement desactivee serait defaire sa decision sans
   * le lui dire. Un retrait explicite ne se defait que par un geste explicite
   * (`POST /projects/:id/members`).
   */
  async assign(taskId: string, dto: AssignTaskDto, policy: AccessPolicy, meta: RequestContext) {
    policy.requireScope('task', 'assign', ['any']);
    this.refuseClientSpace(policy);
    const before = await this.access.requireReadable(taskId, policy);

    // Une tache personnelle ne s'assigne PAS, meme par un porteur de
    // `task:assign:any` : changer son assigne la ferait apparaitre dans
    // l'espace personnel d'un tiers (ou l'en ferait sortir), ce que
    // `personalTaskWhere` est justement cense rendre impossible.
    if (before.isPersonal) {
      throw AppException.unprocessable(
        'PERSONAL_TASK_NOT_ASSIGNABLE',
        "Une tache personnelle appartient a son createur : elle ne s'assigne pas.",
        { taskId },
      );
    }

    if (dto.assigneeId === before.assigneeId) {
      throw AppException.conflict(
        'TASK_ASSIGNEE_UNCHANGED',
        "Cette tache est deja dans cet etat d'assignation.",
      );
    }

    if (dto.assigneeId) {
      await this.requireAssignableUser(dto.assigneeId);
    }

    // Apres la garde ci-dessus, une tache personnelle ne passe pas : `project`
    // est toujours present. La variable locale ne sert qu'a le prouver.
    const projectOfTask = before.project;

    await this.prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: taskId },
        data: { assigneeId: dto.assigneeId },
      });

      if (dto.assigneeId && projectOfTask) {
        await ensureTeamMember(tx, projectOfTask.id, dto.assigneeId);
      }

      if (projectOfTask) {
        await this.activity.record(
          {
            type: ActivityType.NOTE,
            message: dto.assigneeId
              ? `Tache « ${before.title} » assignee.`
              : `Tache « ${before.title} » desassignee.`,
            projectId: projectOfTask.id,
            taskId,
            clientId: projectOfTask.clientId,
            actorId: policy.userId,
            metadata: { from: before.assigneeId, to: dto.assigneeId },
            // Qui travaille sur quoi est de l'organisation interne. Une tache
            // partageable reste partageable : c'est sa VISIBILITE qui est suivie,
            // pas celle des personnes qui la traitent.
            isClientVisible: false,
          },
          tx,
        );
      }

      if (dto.assigneeId && dto.assigneeId !== policy.userId) {
        await this.notifications.notify(
          dto.assigneeId,
          {
            type: NotificationType.TASK_ASSIGNED,
            title: `Nouvelle tache : ${before.title}`,
            body: projectOfTask ? `Projet « ${projectOfTask.name} »` : 'Tache',
            link: `/taches/${taskId}`,
            entityType: 'Task',
            entityId: taskId,
          },
          tx,
        );
      }
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'TASK_ASSIGNED',
      entityType: 'Task',
      entityId: taskId,
      before: { assigneeId: before.assigneeId },
      after: { assigneeId: dto.assigneeId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.detail(taskId);
  }

  /**
   * Suppression LOGIQUE.
   *
   * REFUSEE SI LA TACHE A DES SOUS-TACHES, meme closes. Une tache parente est un
   * noeud de structure : la retirer laisserait des enfants dont le parent
   * n'existe plus, invisibles dans une arborescence et impossibles a rattacher
   * autre part (le parent d'une tache ne se modifie pas). Le message dit quoi
   * faire plutot que de laisser l'appelant deviner.
   */
  async remove(taskId: string, policy: AccessPolicy, meta: RequestContext) {
    this.refuseClientSpace(policy);

    // SANS `task:delete:any`, la seule chose que cette route ouvre est la tache
    // PERSONNELLE du porteur, via `task:write:personal` (declare sur le garde).
    // Un chef de projet garde le circuit classique ; un membre sans droit de
    // suppression sur les projets peut tout de meme nettoyer son espace prive.
    const personalOnly = !policy.has('task:delete:any');
    let before: TaskRef;

    if (personalOnly) {
      if (!policy.has(PERSONAL_TASK_WRITE_CODE)) {
        throw AppException.forbidden(
          'Supprimer une tache exige la permission task:delete:any, ou task:write:personal pour vos propres taches personnelles.',
        );
      }
      before = await this.access.requireOwnPersonal(taskId, policy);
    } else {
      policy.requireScope('task', 'delete', ['any']);
      before = await this.access.requireReadable(taskId, policy);
    }

    const projectOfTask = before.project;

    const children = await this.prisma.task.count({
      where: { parentTaskId: taskId, deletedAt: null },
    });

    if (children > 0) {
      throw AppException.unprocessable(
        'TASK_HAS_SUBTASKS',
        `Cette tache porte ${children} sous-tache(s). Supprimez-les d'abord.`,
        { subTasks: children },
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.task.update({ where: { id: taskId }, data: { deletedAt: new Date() } });

      // Une tache personnelle n'ecrit dans aucun fil de projet : voir
      // `changeStatus` pour la raison complete.
      if (!before.isPersonal && projectOfTask) {
        await this.activity.record(
          {
            type: ActivityType.NOTE,
            message: `Tache « ${before.title} » supprimee.`,
            projectId: projectOfTask.id,
            clientId: projectOfTask.clientId,
            actorId: policy.userId,
            metadata: { taskId },
            // Une suppression est une operation interne : l'annoncer au client
            // reviendrait a lui apprendre l'existence d'une tache qu'il ne voyait
            // peut-etre pas.
            isClientVisible: false,
          },
          tx,
        );
      }
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'TASK_DELETED',
      entityType: 'Task',
      entityId: taskId,
      before: { title: before.title, status: before.status, projectId: before.projectId },
      after: { deletedAt: new Date().toISOString() },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { deleted: true as const };
  }

  // ---------------------------------------------------------------------------
  // Garde-fous communs
  // ---------------------------------------------------------------------------

  /** Filtre de lecture du porteur. Voir `task-rules.ts` pour le sens des scopes. */
  private readWhere(policy: AccessPolicy): Prisma.TaskWhereInput {
    const scope = policy.requireScope('task', 'read', TASK_READ_ORDER);
    return taskScopeWhere(scope, subjectOf(policy));
  }

  private writeScope(policy: AccessPolicy): ScopeName {
    return policy.requireScope('task', 'write', TASK_WRITE_ORDER);
  }

  /**
   * Un compte client ne touche pas aux taches, quelles que soient les
   * permissions qu'on lui ajouterait un jour. C'est une exigence explicite du
   * client (« Le client ne doit pas voir les taches internes »), et elle est
   * verifiee ici en plus du catalogue.
   */
  private refuseClientSpace(policy: AccessPolicy): void {
    if (policy.isClient()) {
      throw AppException.forbidden("Les taches ne sont pas accessibles depuis l'espace client.");
    }
  }

  /** Qui doit etre prevenu d'un changement de statut : l'assigne, le rapporteur, le responsable. */
  private recipientsOf(task: TaskRef, actorId: string): string[] {
    const candidates = [task.assigneeId, task.reporterId, task.project?.managerId ?? null];
    return [...new Set(candidates.filter((id): id is string => Boolean(id) && id !== actorId))];
  }

  private resolveAssignee(
    scope: ScopeName,
    requested: string | undefined,
    policy: AccessPolicy,
  ): string | null {
    if (scope === 'own') {
      if (requested && requested !== policy.userId) {
        throw AppException.forbidden(
          'Vous ne pouvez creer que des taches qui vous sont assignees.',
        );
      }
      return policy.userId;
    }

    if (!requested) {
      return null;
    }

    if (requested !== policy.userId && !policy.has('task:assign:any')) {
      throw AppException.forbidden(
        "Assigner une tache a quelqu'un d'autre exige la permission task:assign:any.",
      );
    }

    return requested;
  }

  /**
   * L'assigne doit etre un compte ACTIF et non supprime, ET NE PAS ETRE UN COMPTE
   * CLIENT. Ce dernier point est le plus important : assigner une tache interne a
   * un compte client la ferait entrer dans le perimetre de quelqu'un qui ne doit
   * jamais en voir une seule, et la faute serait invisible a l'ecran.
   */
  private async requireAssignableUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, status: UserStatus.ACTIVE },
      select: { id: true, roles: { select: { role: { select: { code: true } } } } },
    });

    if (!user) {
      throw AppException.unprocessable(
        'TASK_ASSIGNEE_NOT_FOUND',
        "L'assigne indique n'existe pas, est inactif, ou a ete supprime.",
      );
    }

    if (user.roles.some((entry) => entry.role.code === RoleCode.CLIENT)) {
      throw AppException.unprocessable(
        'TASK_ASSIGNEE_IS_CLIENT',
        'Une tache ne peut pas etre assignee a un compte client.',
      );
    }
  }

  private async requireMilestoneOfProject(milestoneId: string, projectId: string): Promise<void> {
    const milestone = await this.prisma.milestone.findFirst({
      where: { id: milestoneId, projectId },
      select: { id: true },
    });

    if (!milestone) {
      throw AppException.unprocessable(
        'TASK_MILESTONE_NOT_FOUND',
        "Le jalon indique n'existe pas dans ce projet.",
      );
    }
  }

  /**
   * Le parent d'une sous-tache doit etre dans le MEME projet, vivant, et NON CLOS.
   *
   * L'appartenance au meme projet n'est pas une precaution de confort : elle
   * empeche de rattacher une sous-tache a une tache d'un autre projet, ce qui
   * ferait apparaitre une tache dans un projet sans qu'aucune regle de perimetre
   * ne l'ait autorise. Le parent non clos, lui, est le second volet de la regle
   * des sous-taches.
   */
  private async requireAttachableParent(parentTaskId: string, projectId: string): Promise<void> {
    const parent = await this.prisma.task.findFirst({
      where: { id: parentTaskId, deletedAt: null },
      select: { id: true, status: true, projectId: true },
    });

    if (!parent || parent.projectId !== projectId) {
      throw AppException.unprocessable(
        'TASK_PARENT_NOT_FOUND',
        "La tache parente n'existe pas dans ce projet.",
      );
    }

    if (!canAttachSubTask(parent.status)) {
      throw AppException.unprocessable(
        'TASK_PARENT_CLOSED',
        `La tache parente est ${parent.status} : on n'ajoute pas de sous-tache a une tache fermee.`,
        { parentStatus: parent.status },
      );
    }
  }
}

/** Filtres de recherche. Toujours combines en `AND` avec le perimetre. */
function buildTaskFilters(query: TaskQueryDto): Prisma.TaskWhereInput {
  const filters: Prisma.TaskWhereInput = {};

  if (query.status) filters.status = query.status;
  if (query.priority) filters.priority = query.priority;
  if (query.assigneeId) filters.assigneeId = query.assigneeId;
  if (query.milestoneId) filters.milestoneId = query.milestoneId;
  // `null` en Prisma signifie « IS NULL » : uniquement les taches sans parent.
  if (query.rootOnly) filters.parentTaskId = null;
  // `?personalOnly=true` : l'espace personnel du porteur (voir `listMine`).
  if (query.personalOnly) filters.isPersonal = true;
  if (query.search) filters.title = { contains: query.search, mode: 'insensitive' };

  return filters;
}

function toDateOrNull(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

/**
 * Ajoute un membre a l'equipe S'IL N'Y A JAMAIS FIGURE.
 *
 * La ligne existante n'est pas touchee, meme si `leftAt` est renseigne : voir le
 * commentaire de `assign`. Reactiver quelqu'un est un geste explicite.
 */
async function ensureTeamMember(
  tx: Prisma.TransactionClient,
  projectId: string,
  userId: string,
): Promise<void> {
  const existing = await tx.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { id: true },
  });

  if (!existing) {
    await tx.projectMember.create({ data: { projectId, userId } });
  }
}
