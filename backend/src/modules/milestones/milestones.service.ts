import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { type AccessPolicy } from '../../common/auth/principal.js';
import {
  paginated,
  resolvePagination,
  type PaginationQueryDto,
} from '../../common/dto/pagination.dto.js';
import { AppException } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  ActivityType,
  MilestoneStatus,
  NotificationType,
  TaskStatus,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { PROJECT_READ_ORDER, projectScopeWhere, subjectOf } from '../projects/project-scope.js';
import type { RequestContext } from '../projects/request-meta.decorator.js';
import { CreateMilestoneDto, UpdateMilestoneDto } from './dto/milestone.dto.js';
import {
  MILESTONE_READ_ORDER,
  MILESTONE_WRITE_ORDER,
  canTransitionMilestone,
  isMilestoneDeletable,
} from './milestone-rules.js';

/**
 * JALONS.
 *
 * PAS DE PERIMETRE PROPRE, ET C'EST LA DIFFERENCE AVEC LES TACHES. Un jalon
 * appartient a un projet et se lit a travers lui : le filtre applique est celui
 * du PROJET (`projectScopeWhere`), compose directement dans la requete. C'est ce
 * qui rend `milestone:read:any` sur le role CLIENT correct — « any » veut dire
 * « tous les jalons des projets que je peux atteindre », et le perimetre du projet
 * ramene cette phrase a ce que le client a le droit de regarder.
 *
 * LE CONTROLE EST FAIT DANS LE `where`, PAS APRES. Une lecture-puis-verification
 * laisserait une fenetre entre les deux, et surtout un oubli possible a chaque
 * nouvelle route. Ici un jalon hors perimetre n'est jamais charge : la reponse est
 * 404, ce qui n'apprend meme pas qu'il existe.
 */

const MILESTONE_SELECT = {
  id: true,
  projectId: true,
  title: true,
  description: true,
  dueDate: true,
  status: true,
  reachedAt: true,
  order: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class MilestonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lecture
  // ---------------------------------------------------------------------------

  /**
   * Frise d'un projet.
   *
   * L'AVANCEMENT EST CALCULE EN UNE REQUETE, PAS UNE PAR JALON. `groupBy`
   * (`milestoneId`, `status`) ramene le compte de taches par statut pour tous les
   * jalons de la page ; une boucle aurait fait N requetes pour un ecran qui en
   * affiche une dizaine. Le regroupement en memoire est trivial.
   */
  async list(projectId: string, query: PaginationQueryDto, policy: AccessPolicy) {
    policy.requireScope('milestone', 'read', MILESTONE_READ_ORDER);
    const scope = policy.requireScope('project', 'read', PROJECT_READ_ORDER);
    const p = resolvePagination(query);

    const where: Prisma.MilestoneWhereInput = {
      projectId,
      project: { deletedAt: null, AND: [projectScopeWhere(scope, subjectOf(policy))] },
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.milestone.findMany({
        where,
        orderBy: [{ order: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }],
        skip: p.skip,
        take: p.take,
        select: MILESTONE_SELECT,
      }),
      this.prisma.milestone.count({ where }),
    ]);

    const progress = await this.progressOf(items.map((item) => item.id));

    return paginated(
      items.map((item) => ({ ...item, ...progress.get(item.id) })),
      total,
      p,
    );
  }

  /**
   * Avancement par jalon : `{ taskCount, doneCount }`.
   *
   * Les taches SUPPRIMEES sont exclues. Compter une tache supprimee ferait
   * baisser l'avancement d'un jalon sans que rien n'ait change dans le travail
   * reel, ce qui est exactement le genre d'ecart qu'un client remarque.
   */
  private async progressOf(
    milestoneIds: readonly string[],
  ): Promise<Map<string, { taskCount: number; doneCount: number }>> {
    const progress = new Map<string, { taskCount: number; doneCount: number }>();

    if (milestoneIds.length === 0) {
      return progress;
    }

    for (const id of milestoneIds) {
      progress.set(id, { taskCount: 0, doneCount: 0 });
    }

    const rows = await this.prisma.task.groupBy({
      by: ['milestoneId', 'status'],
      where: { milestoneId: { in: [...milestoneIds] }, deletedAt: null },
      _count: { _all: true },
    });

    for (const row of rows) {
      if (!row.milestoneId) {
        continue;
      }
      const bucket = progress.get(row.milestoneId);
      if (!bucket) {
        continue;
      }
      bucket.taskCount += row._count._all;
      if (row.status === TaskStatus.DONE) {
        bucket.doneCount += row._count._all;
      }
    }

    return progress;
  }

  // ---------------------------------------------------------------------------
  // Ecriture
  // ---------------------------------------------------------------------------

  async create(
    projectId: string,
    dto: CreateMilestoneDto,
    policy: AccessPolicy,
    meta: RequestContext,
  ) {
    policy.requireScope('milestone', 'write', MILESTONE_WRITE_ORDER);
    const project = await this.project(projectId, policy);

    const created = await this.prisma.$transaction(async (tx) => {
      const milestone = await tx.milestone.create({
        data: {
          projectId: project.id,
          title: dto.title,
          description: dto.description ?? null,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          order: dto.order ?? 0,
          // `PENDING` est le defaut du schema et il est ecrit ici pour que la
          // decision soit visible dans le code, pas seulement dans la base.
          status: MilestoneStatus.PENDING,
        },
        select: { id: true, title: true },
      });

      await this.activity.record(
        {
          type: ActivityType.NOTE,
          message: `Jalon « ${milestone.title} » ajoute au planning.`,
          projectId: project.id,
          clientId: project.clientId,
          actorId: policy.userId,
          metadata: { milestoneId: milestone.id, status: MilestoneStatus.PENDING },
          // LES JALONS SONT LA COUCHE QUE LE CLIENT REGARDE. Son perimetre inclut
          // deja `milestone:read:any` : la frise est faite pour lui. Une entree
          // interne ici produirait un planning ou l'ajout d'une etape ne se voit
          // pas, alors que son deplacement se verrait.
          isClientVisible: true,
        },
        tx,
      );

      return milestone;
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'MILESTONE_CREATED',
      entityType: 'Milestone',
      entityId: created.id,
      after: { projectId: project.id, title: created.title },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.detail(created.id, policy);
  }

  /**
   * Modification, statut compris.
   *
   * LES CHANGEMENTS DE STATUT SONT CONTROLES PAR LA TABLE DE TRANSITIONS. Un
   * `PATCH` qui accepterait n'importe quel statut de l'enum ferait passer un jalon
   * de `CANCELLED` a `REACHED` sans jamais le reprendre : le client lirait
   * « atteint » sur un jalon qui n'a jamais ete rouvert, et `reachedAt` serait une
   * date inventee.
   */
  async update(
    milestoneId: string,
    dto: UpdateMilestoneDto,
    policy: AccessPolicy,
    meta: RequestContext,
  ) {
    policy.requireScope('milestone', 'write', MILESTONE_WRITE_ORDER);
    const before = await this.load(milestoneId, policy);

    const statusChanged = dto.status !== undefined && dto.status !== before.status;

    if (statusChanged && dto.status !== undefined) {
      if (!canTransitionMilestone(before.status, dto.status)) {
        throw AppException.unprocessable(
          'MILESTONE_STATUS_TRANSITION_REFUSED',
          `Passer de ${before.status} a ${dto.status} n'est pas une transition autorisee.`,
          { from: before.status, to: dto.status },
        );
      }
    }

    const reaching =
      dto.status === MilestoneStatus.REACHED && before.status !== MilestoneStatus.REACHED;
    // Quitter REACHED n'est autorise que vers IN_PROGRESS (voir la table) : la
    // date d'atteinte doit alors disparaitre, sinon le jalon resterait date dans
    // les rapports tout en etant de nouveau en cours.
    const reopening =
      before.status === MilestoneStatus.REACHED && dto.status !== undefined && !reaching;

    await this.prisma.$transaction(async (tx) => {
      // Compare-and-swap sur le statut : deux personnes qui declarent le meme
      // jalon atteint en meme temps ne peuvent pas aboutir toutes les deux.
      const updated = await tx.milestone.updateMany({
        where: { id: milestoneId, status: before.status },
        data: {
          ...(dto.title === undefined ? {} : { title: dto.title }),
          ...(dto.description === undefined ? {} : { description: dto.description }),
          ...(dto.dueDate === undefined ? {} : { dueDate: toDateOrNull(dto.dueDate) }),
          ...(dto.order === undefined ? {} : { order: dto.order }),
          ...(dto.status === undefined ? {} : { status: dto.status }),
          ...(reaching ? { reachedAt: new Date() } : {}),
          ...(reopening ? { reachedAt: null } : {}),
        },
      });

      if (updated.count !== 1) {
        throw AppException.conflict(
          'MILESTONE_EDIT_CONFLICT',
          'Le jalon a change entre-temps. Rechargez-le avant de reessayer.',
        );
      }

      if (statusChanged && dto.status !== undefined) {
        await this.activity.record(
          {
            type: reaching ? ActivityType.MILESTONE_REACHED : ActivityType.STATUS_CHANGE,
            message: reaching
              ? `Jalon atteint : « ${before.title} ».`
              : `Jalon « ${before.title} » : ${before.status} → ${dto.status}.`,
            projectId: before.projectId,
            clientId: before.project.clientId,
            actorId: policy.userId,
            metadata: { milestoneId, from: before.status, to: dto.status },
            // Voir `create` : la frise est faite pour le client, une etape qui
            // change d'etat est une information qui le concerne.
            isClientVisible: true,
          },
          tx,
        );
      }

      if (reaching && before.project.managerId && before.project.managerId !== policy.userId) {
        await this.notifications.notify(
          before.project.managerId,
          {
            type: NotificationType.SYSTEM,
            title: `Jalon atteint : ${before.title}`,
            body: `Projet « ${before.project.name} »`,
            link: `/projets/${before.projectId}`,
            entityType: 'Milestone',
            entityId: milestoneId,
          },
          tx,
        );
      }
    });

    await this.audit.record({
      actorId: policy.userId,
      action: statusChanged ? 'MILESTONE_STATUS_CHANGED' : 'MILESTONE_UPDATED',
      entityType: 'Milestone',
      entityId: milestoneId,
      before: { title: before.title, status: before.status, reachedAt: before.reachedAt },
      after: dto,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.detail(milestoneId, policy);
  }

  /**
   * Suppression PHYSIQUE — le schema ne prevoit pas de `deletedAt` sur un jalon,
   * et c'est coherent : un jalon supprime n'a pas a etre conserve pour les
   * rapports, contrairement a une tache dont le temps saisi doit rester lisible.
   *
   * DEUX REFUS, ET ILS SONT TOUS LES DEUX NECESSAIRES.
   *
   *  - Un jalon ATTEINT ne se supprime pas : c'est un fait date, annonce au
   *    client. L'effacer reviendrait a effacer l'annonce. `CANCELLED` est la
   *    sortie legitime, et elle laisse la ligne en place.
   *  - Un jalon qui PORTE DES TACHES ne se supprime pas non plus. La relation est
   *    en `SetNull` : la base detacherait les taches en silence, et des taches
   *    disparaitraient d'une frise sans que personne ne l'ait demande. On refuse
   *    en disant combien.
   */
  async remove(milestoneId: string, policy: AccessPolicy, meta: RequestContext) {
    policy.requireScope('milestone', 'write', MILESTONE_WRITE_ORDER);
    const before = await this.load(milestoneId, policy);

    if (!isMilestoneDeletable(before.status)) {
      throw AppException.unprocessable(
        'MILESTONE_REACHED_NOT_DELETABLE',
        'Un jalon atteint ne se supprime pas : il est date et annonce. Annulez-le si necessaire.',
        { status: before.status },
      );
    }

    const tasks = await this.prisma.task.count({
      where: { milestoneId, deletedAt: null },
    });

    if (tasks > 0) {
      throw AppException.unprocessable(
        'MILESTONE_HAS_TASKS',
        `Ce jalon porte ${tasks} tache(s). Detachez-les d'abord.`,
        { tasks },
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.milestone.delete({ where: { id: milestoneId } });

      await this.activity.record(
        {
          type: ActivityType.NOTE,
          message: `Jalon « ${before.title} » retire du planning.`,
          projectId: before.projectId,
          clientId: before.project.clientId,
          actorId: policy.userId,
          metadata: { milestoneId },
          // INTERNE, alors que la creation et le changement de statut sont
          // visibles. Ce n'est pas une incoherence : le client ne doit pas voir
          // l'agence effacer une etape de son planning. Annuler le jalon
          // (`CANCELLED`) est la maniere visible de dire la meme chose.
          isClientVisible: false,
        },
        tx,
      );
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'MILESTONE_DELETED',
      entityType: 'Milestone',
      entityId: milestoneId,
      before: { title: before.title, status: before.status, projectId: before.projectId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { deleted: true as const };
  }

  // ---------------------------------------------------------------------------
  // Chargement
  // ---------------------------------------------------------------------------

  /** Le projet, si le porteur peut le lire. Sinon 404. */
  private async project(projectId: string, policy: AccessPolicy) {
    const scope = policy.requireScope('project', 'read', PROJECT_READ_ORDER);
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null, AND: [projectScopeWhere(scope, subjectOf(policy))] },
      select: { id: true, name: true, clientId: true, managerId: true },
    });

    if (!project) {
      throw AppException.notFound('PROJECT_NOT_FOUND', 'Ce projet est introuvable.');
    }

    return project;
  }

  /**
   * Le jalon, si son PROJET est dans le perimetre du porteur.
   *
   * Le filtre de projet est compose DANS la requete du jalon plutot que verifie
   * apres coup : il n'y a donc pas d'instant ou le jalon est en memoire sans que
   * son acces ait ete tranche.
   */
  private async load(milestoneId: string, policy: AccessPolicy): Promise<MilestoneRef> {
    const scope = policy.requireScope('project', 'read', PROJECT_READ_ORDER);

    const milestone = await this.prisma.milestone.findFirst({
      where: {
        id: milestoneId,
        project: { deletedAt: null, AND: [projectScopeWhere(scope, subjectOf(policy))] },
      },
      select: {
        id: true,
        projectId: true,
        title: true,
        status: true,
        reachedAt: true,
        project: { select: { id: true, name: true, clientId: true, managerId: true } },
      },
    });

    if (!milestone) {
      throw AppException.notFound('MILESTONE_NOT_FOUND', 'Ce jalon est introuvable.');
    }

    return milestone;
  }

  /** Le jalon relu apres ecriture. Le porteur vient d'ecrire : il peut le lire. */
  private async detail(milestoneId: string, policy: AccessPolicy) {
    const scope = policy.requireScope('project', 'read', PROJECT_READ_ORDER);

    const milestone = await this.prisma.milestone.findFirst({
      where: {
        id: milestoneId,
        project: { deletedAt: null, AND: [projectScopeWhere(scope, subjectOf(policy))] },
      },
      select: {
        ...MILESTONE_SELECT,
        project: { select: { id: true, reference: true, name: true, status: true } },
      },
    });

    if (!milestone) {
      throw AppException.notFound('MILESTONE_NOT_FOUND', 'Ce jalon est introuvable.');
    }

    const progress = await this.progressOf([milestone.id]);

    return { ...milestone, ...(progress.get(milestone.id) ?? { taskCount: 0, doneCount: 0 }) };
  }
}

/** Ce qu'un ecrivain de jalon doit connaitre de sa ligne. */
interface MilestoneRef {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly status: MilestoneStatus;
  readonly reachedAt: Date | null;
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly clientId: string;
    readonly managerId: string | null;
  };
}

function toDateOrNull(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}
