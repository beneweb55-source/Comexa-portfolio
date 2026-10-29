import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AccessPolicy } from '../../common/auth/principal.js';
import {
  paginated,
  resolvePagination,
  type PaginationQueryDto,
} from '../../common/dto/pagination.dto.js';
import { AppException } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ActivityType, NotificationType, ProjectStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { CounterService } from '../counters/counter.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import {
  AddProjectMemberDto,
  CreateProjectDto,
  ProjectQueryDto,
  UpdateProjectDto,
  UpdateProjectStatusDto,
} from './dto/project.dto.js';
import { ProjectAccessService } from './project-access.service.js';
import { projectProgressFromTaskStatuses } from './project-progress.js';
import {
  PROJECT_READ_ORDER,
  PROJECT_WRITE_ORDER,
  canTransitionProject,
  projectScopeWhere,
  subjectOf,
} from './project-scope.js';
import type { RequestContext } from './request-meta.decorator.js';

/**
 * PROJETS, EQUIPE ET FIL D'ACTIVITE.
 *
 * Trois principes parcourent ce service, et ils viennent tous d'exigences
 * explicites du cahier des charges.
 *
 * 1. LE PERIMETRE EST DANS LE `where`, PAS DANS UN `if`.
 *
 * Chaque lecture compose son filtre a partir de `projectScopeWhere(scope)`. Il
 * n'y a jamais de « je charge la ligne puis je verifie si j'ai le droit » : entre
 * le chargement et la verification, il y a un oubli possible, et cet oubli
 * n'apparait dans aucun test ecrit apres coup.
 *
 * 2. LE PERIMETRE ET LE FILTRE DEMANDE NE SE MARCHENT PAS DESSUS.
 *
 * `clientId` est a la fois un filtre de recherche et, pour un compte client, le
 * filtre de perimetre. Les fusionner dans un meme objet laisserait le second
 * ecraser le premier — et un client qui demande `?clientId=<un autre>` obtiendrait
 * les projets d'un autre. Les deux sont donc combines en `AND`, ou l'ordre des
 * cles ne peut plus rien changer.
 *
 * 3. UN ECHEANCE QUI BOUGE EST UNE INFORMATION DU PROJET. Le reste est de
 * l'intendance : cela va au journal d'audit, pas au fil que le client lit.
 */

/** Selecteur du detail d'un projet. Commun a la creation, la lecture et la modification. */
const PROJECT_DETAIL_SELECT = {
  id: true,
  reference: true,
  name: true,
  code: true,
  description: true,
  status: true,
  health: true,
  priority: true,
  startDate: true,
  dueDate: true,
  completedAt: true,
  budget: true,
  currency: true,
  progressPercent: true,
  createdAt: true,
  updatedAt: true,
  client: { select: { id: true, reference: true, companyName: true } },
  manager: { select: { id: true, firstName: true, lastName: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} as const;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationService,
    private readonly counters: CounterService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lecture
  // ---------------------------------------------------------------------------

  async list(query: ProjectQueryDto, policy: AccessPolicy) {
    const p = resolvePagination(query);
    // Aucun droit de lecture (ex. visiteur sans commande) : page vide, pas 403.
    // La route est ouverte a tout compte authentifie (`@ScopedByService`).
    const scope = policy.widestScope('project', 'read', PROJECT_READ_ORDER);
    if (!scope) return paginated([], 0, p);

    const where: Prisma.ProjectWhereInput = {
      deletedAt: null,
      // Voir le point 2 de l'entete : `AND` et non un etalement.
      AND: [projectScopeWhere(scope, subjectOf(policy)), buildProjectFilters(query)],
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: p.skip,
        take: p.take,
        select: {
          id: true,
          reference: true,
          name: true,
          code: true,
          status: true,
          health: true,
          priority: true,
          dueDate: true,
          progressPercent: true,
          createdAt: true,
          client: { select: { id: true, companyName: true } },
          manager: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.project.count({ where }),
    ]);

    return paginated(items, total, p);
  }

  /**
   * Detail d'un projet.
   *
   * Les compteurs sont interroges a part, et pas via `_count` de Prisma : ce
   * dernier compte les taches SUPPRIMEES elles aussi, puisqu'elles sont toujours
   * en base. Afficher « 12 taches » dont 3 effacees est exactement le genre
   * d'ecart que personne ne sait expliquer six mois plus tard.
   */
  async getOne(projectId: string, policy: AccessPolicy) {
    await this.access.requireReadable(projectId, policy);
    return this.detailById(projectId);
  }

  private async detailById(projectId: string) {
    const [project, tasks, milestones, members] = await Promise.all([
      this.prisma.project.findFirst({
        where: { id: projectId, deletedAt: null },
        select: PROJECT_DETAIL_SELECT,
      }),
      this.prisma.task.count({ where: { projectId, deletedAt: null } }),
      this.prisma.milestone.count({ where: { projectId } }),
      this.prisma.projectMember.count({ where: { projectId, leftAt: null } }),
    ]);

    if (!project) {
      throw AppException.notFound('PROJECT_NOT_FOUND', 'Ce projet est introuvable.');
    }

    return { ...project, counts: { tasks, milestones, members } };
  }

  // ---------------------------------------------------------------------------
  // Ecriture
  // ---------------------------------------------------------------------------

  /**
   * Cree un projet.
   *
   * UN PROJET PART TOUJOURS D'UN CLIENT. Le rattachement est obligatoire et
   * verifie : un projet orphelin ne remonterait dans aucun dossier client, ne
   * pourrait etre facture a personne, et resterait invisible de l'espace client
   * sans que rien ne le signale.
   *
   * LE RESPONSABLE DEVIENT MEMBRE, DANS LA MEME TRANSACTION. Sans cette ligne,
   * un chef de projet designe comme responsable ne verrait pas son propre projet
   * avec `project:read:assigned`, ce qui est exactement le genre d'incoherence
   * qui pousse a elargir un scope « juste pour que ca marche ».
   */
  async create(dto: CreateProjectDto, policy: AccessPolicy, meta: RequestContext) {
    policy.requireScope('project', 'write', PROJECT_WRITE_ORDER);

    await this.requireUsableClient(dto.clientId);
    if (dto.managerId) {
      await this.requireUsableUser(dto.managerId, 'responsable');
    }
    if (dto.code) {
      await this.requireFreeCode(dto.code, null);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      // `CounterService` et non un compteur local : trois domaines numerotent des
      // documents (client, projet, facture) et un compteur par domaine finirait
      // par produire deux fois le meme numero le jour ou deux d'entre eux
      // partagent une portee. L'increment se fait EN BASE (`{ increment: 1 }`),
      // dans la transaction courante : une lecture-puis-ecriture donnerait le
      // meme numero a deux creations simultanees.
      //
      // ON NE PASSE QUE LA PORTEE. Le prefixe (`PRJ`) et le format
      // (`PRJ-2026-0001`) vivent dans `CounterService` et nulle part ailleurs :
      // deux appelants qui passeraient chacun leur prefixe finiraient par
      // produire deux formats pour la meme entite.
      //
      // La portee s'ecrit EN MAJUSCULES et la casse fait partie de la cle :
      // `Counter` a une cle primaire composee `@@id([scope, year])`, et le seed
      // cree deja `PROSPECT` et `CLIENT` en majuscules. `'project'` ouvrirait
      // une deuxieme ligne pour la meme entite.
      const reference = await this.counters.reference({ scope: 'PROJECT' }, tx);

      const project = await tx.project.create({
        data: {
          reference,
          name: dto.name,
          code: dto.code ?? null,
          description: dto.description ?? null,
          clientId: dto.clientId,
          managerId: dto.managerId ?? null,
          createdById: policy.userId,
          priority: dto.priority,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          budget: dto.budget ?? null,
          currency: dto.currency ?? 'DZD',
        },
        select: { id: true, name: true, reference: true },
      });

      if (dto.managerId) {
        await tx.projectMember.create({
          data: {
            projectId: project.id,
            userId: dto.managerId,
            // Libelle de role SUR CE PROJET : c'est un intitule metier, pas le
            // role global du compte.
            projectRole: 'Responsable',
          },
        });
      }

      await this.activity.record(
        {
          type: ActivityType.NOTE,
          message: `Projet « ${project.name} » (${project.reference}) cree.`,
          projectId: project.id,
          clientId: dto.clientId,
          actorId: policy.userId,
          // Un projet qui nait est une information du client : il doit le voir
          // apparaitre dans son espace, c'est meme tout l'interet.
          metadata: { reference: project.reference },
          isClientVisible: true,
        },
        tx,
      );

      return project;
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'PROJECT_CREATED',
      entityType: 'Project',
      entityId: created.id,
      after: { reference: created.reference, name: created.name, clientId: dto.clientId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.detailById(created.id);
  }

  /** Modification des champs de fiche. Le statut a sa propre route, voir le DTO. */
  async update(
    projectId: string,
    dto: UpdateProjectDto,
    policy: AccessPolicy,
    meta: RequestContext,
  ) {
    policy.requireScope('project', 'write', PROJECT_WRITE_ORDER);
    const before = await this.access.requireWritable(projectId, policy);

    if (dto.clientId && dto.clientId !== before.clientId) {
      await this.requireUsableClient(dto.clientId);
    }
    if (dto.managerId) {
      await this.requireUsableUser(dto.managerId, 'responsable');
    }
    if (dto.code) {
      await this.requireFreeCode(dto.code, projectId);
    }

    const dueDateChanged = dto.dueDate !== undefined;

    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: projectId },
        data: {
          ...(dto.name === undefined ? {} : { name: dto.name }),
          ...(dto.code === undefined ? {} : { code: dto.code }),
          ...(dto.description === undefined ? {} : { description: dto.description }),
          ...(dto.clientId === undefined ? {} : { clientId: dto.clientId }),
          ...(dto.managerId === undefined ? {} : { managerId: dto.managerId }),
          ...(dto.priority === undefined ? {} : { priority: dto.priority }),
          ...(dto.startDate === undefined ? {} : { startDate: toDateOrNull(dto.startDate) }),
          ...(dto.dueDate === undefined ? {} : { dueDate: toDateOrNull(dto.dueDate) }),
          ...(dto.budget === undefined ? {} : { budget: dto.budget }),
          ...(dto.currency === undefined ? {} : { currency: dto.currency }),
        },
      });

      // Le nouveau responsable rejoint l'equipe. L'ANCIEN N'EST PAS RETIRE : il
      // travaille peut-etre toujours sur le projet, et lui couper l'acces parce
      // qu'une ligne a change serait une revocation silencieuse. Retirer
      // quelqu'un se fait par la route dediee, avec `project:manage:team`.
      if (dto.managerId) {
        await tx.projectMember.upsert({
          where: { projectId_userId: { projectId, userId: dto.managerId } },
          create: {
            projectId,
            userId: dto.managerId,
            projectRole: 'Responsable',
          },
          update: { leftAt: null },
        });
      }

      // Seule l'echeance merite une ligne dans le fil : c'est la seule
      // information de cette route qui interesse le client. Le reste (budget,
      // description, code) est de l'intendance interne, et le journal d'audit
      // en garde la trace complete.
      if (dueDateChanged) {
        await this.activity.record(
          {
            type: ActivityType.NOTE,
            message: dto.dueDate
              ? `Nouvelle echeance : ${new Date(dto.dueDate).toISOString().slice(0, 10)}.`
              : "L'echeance du projet a ete retiree.",
            projectId,
            clientId: before.clientId,
            actorId: policy.userId,
            metadata: { field: 'dueDate', value: dto.dueDate ?? null },
            isClientVisible: true,
          },
          tx,
        );
      }
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'PROJECT_UPDATED',
      entityType: 'Project',
      entityId: projectId,
      before,
      after: dto,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.detailById(projectId);
  }

  /**
   * Change le statut (et, au passage, la sante et l'avancement declare).
   *
   * La transition est verifiee contre la machine a etats : un projet ne saute pas
   * de `DRAFT` a `COMPLETED`. `completedAt` suit le statut — le poser sans le
   * statut, ou l'inverse, produirait un projet « termine » sans date de fin, et
   * un rapport d'activite incapable de dire quand le travail s'est arrete.
   */
  async changeStatus(
    projectId: string,
    dto: UpdateProjectStatusDto,
    policy: AccessPolicy,
    meta: RequestContext,
  ) {
    policy.requireScope('project', 'manage', ['status']);
    const before = await this.access.requireReadable(projectId, policy);

    if (before.status === dto.status) {
      throw AppException.conflict(
        'PROJECT_STATUS_UNCHANGED',
        `Le projet est deja au statut ${before.status}.`,
      );
    }

    if (!canTransitionProject(before.status, dto.status)) {
      throw AppException.unprocessable(
        'PROJECT_STATUS_TRANSITION_REFUSED',
        `Passer de ${before.status} a ${dto.status} n'est pas une transition autorisee.`,
        { from: before.status, to: dto.status },
      );
    }

    const reachingCompletion = dto.status === ProjectStatus.COMPLETED;
    // Rouvrir un projet termine laissait son avancement declare a 100 % : le
    // statut redevenait `IN_PROGRESS` mais la barre, le tableau de bord et le
    // client continuaient de lire « 100 % ». On recalcule depuis les taches au
    // moment precis ou la declaration cesse d'etre vraie. Une valeur explicite
    // dans le DTO garde la priorite (correction manuelle d'un gestionnaire).
    const leavingCompletion = before.status === ProjectStatus.COMPLETED && !reachingCompletion;
    let reopenedProgress: number | null = null;
    if (leavingCompletion && dto.progressPercent === undefined) {
      const tasks = await this.prisma.task.findMany({
        where: { projectId, deletedAt: null },
        select: { status: true },
      });
      reopenedProgress = projectProgressFromTaskStatuses(tasks.map((task) => task.status));
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: projectId },
        data: {
          status: dto.status,
          ...(dto.health === undefined ? {} : { health: dto.health }),
          // Ordre voulu : recalcul a la reouverture < valeur explicite du DTO <
          // 100 % impose par la cloture.
          ...(reopenedProgress === null ? {} : { progressPercent: reopenedProgress }),
          ...(dto.progressPercent === undefined ? {} : { progressPercent: dto.progressPercent }),
          // Quitter `COMPLETED` efface la date : un projet rouvert n'est plus
          // termine, et garder la date ferait croire a un retour en arriere.
          completedAt: reachingCompletion ? new Date() : null,
          // Un projet termine est a 100 % par definition ; laisser un
          // pourcentage inferieur contredirait le statut dans le tableau de bord.
          ...(reachingCompletion ? { progressPercent: 100 } : {}),
        },
      });

      await this.activity.record(
        {
          type: ActivityType.STATUS_CHANGE,
          message: `Statut du projet : ${before.status} → ${dto.status}.`,
          projectId,
          clientId: before.clientId,
          actorId: policy.userId,
          metadata: { from: before.status, to: dto.status },
          // L'avancement d'un projet est precisement ce que le client suit.
          isClientVisible: true,
        },
        tx,
      );

      const managerId = before.managerId;
      if (managerId && managerId !== policy.userId) {
        await this.notifications.notify(
          managerId,
          {
            type: NotificationType.PROJECT_STATUS_CHANGED,
            title: `Le projet « ${before.name} » est passe au statut ${dto.status}.`,
            link: `/projets/${projectId}`,
            entityType: 'Project',
            entityId: projectId,
          },
          tx,
        );
      }
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'PROJECT_STATUS_CHANGED',
      entityType: 'Project',
      entityId: projectId,
      before: { status: before.status },
      after: { status: dto.status, health: dto.health ?? null },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.detailById(projectId);
  }

  /**
   * Suppression LOGIQUE.
   *
   * La ligne reste, cachee par `deletedAt: null` dans toutes les lectures. C'est
   * la seule suppression acceptable ici : un projet porte des taches, du temps
   * facturable et un fil d'activite, et l'effacer reellement emporterait la
   * tracabilite de tout ce qui s'y est passe — y compris les heures qui ont ete
   * payees.
   */
  async remove(projectId: string, policy: AccessPolicy, meta: RequestContext) {
    policy.requireScope('project', 'delete', ['any']);
    const before = await this.access.requireWritable(projectId, policy);

    await this.prisma.project.update({
      where: { id: projectId },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'PROJECT_DELETED',
      entityType: 'Project',
      entityId: projectId,
      before: { reference: before.reference, name: before.name, deletedAt: null },
      after: { deletedAt: new Date().toISOString() },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { deleted: true as const };
  }

  // ---------------------------------------------------------------------------
  // Equipe
  // ---------------------------------------------------------------------------

  /**
   * L'equipe d'un projet.
   *
   * FERMEE AUX COMPTES CLIENTS, ET DEUX FOIS PLUTOT QU'UNE. La route exige
   * `project:read:any` ou `project:read:assigned` ; un compte client ne detient
   * que `project:read:own`, donc il est deja arrete par le garde. La verification
   * ci-dessous est la seconde barriere : le jour ou une permission serait ajoutee
   * par erreur au role CLIENT, l'equipe interne ne deviendrait pas visible pour
   * autant. Cacher un onglet n'a jamais protege une donnee ; deux controles
   * serveur, si.
   */
  async listMembers(projectId: string, policy: AccessPolicy) {
    policy.requireScope('project', 'read', PROJECT_READ_ORDER);
    this.refuseClientSpace(policy, "L'equipe interne d'un projet");
    await this.access.requireReadable(projectId, policy);

    const members = await this.prisma.projectMember.findMany({
      where: { projectId, leftAt: null },
      orderBy: { joinedAt: 'asc' },
      select: {
        id: true,
        projectRole: true,
        allocationPercent: true,
        joinedAt: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            roles: { select: { role: { select: { code: true } } } },
          },
        },
      },
    });

    return members.map((member) => ({
      id: member.id,
      projectRole: member.projectRole,
      allocationPercent: member.allocationPercent,
      joinedAt: member.joinedAt,
      user: {
        id: member.user.id,
        firstName: member.user.firstName,
        lastName: member.user.lastName,
        email: member.user.email,
        roles: member.user.roles.map((r) => r.role.code),
      },
    }));
  }

  /**
   * Ajoute un membre (ou remet en activite quelqu'un qui avait quitte l'equipe).
   *
   * `upsert` et non `create` : `ProjectMember` a un `leftAt`, donc un depart est
   * une desactivation et non une suppression. Recreer la ligne ferait exploser la
   * contrainte `@@unique([projectId, userId])` au premier retour d'un membre —
   * precisement le cas le plus courant.
   */
  async addMember(
    projectId: string,
    dto: AddProjectMemberDto,
    policy: AccessPolicy,
    meta: RequestContext,
  ) {
    policy.requireScope('project', 'manage', ['team']);
    const project = await this.access.requireReadable(projectId, policy);
    await this.requireUsableUser(dto.userId, 'membre');

    const member = await this.prisma.$transaction(async (tx) => {
      const row = await tx.projectMember.upsert({
        where: { projectId_userId: { projectId, userId: dto.userId } },
        create: {
          projectId,
          userId: dto.userId,
          projectRole: dto.projectRole ?? null,
          allocationPercent: dto.allocationPercent ?? null,
        },
        update: {
          leftAt: null,
          projectRole: dto.projectRole ?? null,
          allocationPercent: dto.allocationPercent ?? null,
        },
        select: { id: true, joinedAt: true },
      });

      await this.activity.record(
        {
          type: ActivityType.NOTE,
          message: 'Un membre a rejoint le projet.',
          projectId,
          clientId: project.clientId,
          actorId: policy.userId,
          // Les identifiants restent dans `metadata` mais le fil n'est PAS
          // visible du client : la composition d'une equipe interne n'a pas a
          // sortir du dossier de l'agence.
          metadata: { userId: dto.userId, projectRole: dto.projectRole ?? null },
          isClientVisible: false,
        },
        tx,
      );

      await this.notifications.notify(
        dto.userId,
        {
          // `SYSTEM` faute de mieux : le catalogue ne contient pas de type
          // « ajout a un projet ». Voir le rapport de livraison — un
          // `PROJECT_MEMBER_ADDED` serait le bon ajout.
          type: NotificationType.SYSTEM,
          title: `Vous avez ete ajoute au projet « ${project.name} ».`,
          link: `/projets/${projectId}`,
          entityType: 'Project',
          entityId: projectId,
        },
        tx,
      );

      return row;
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'PROJECT_MEMBER_ADDED',
      entityType: 'ProjectMember',
      entityId: member.id,
      after: { projectId, userId: dto.userId, projectRole: dto.projectRole ?? null },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.listMembers(projectId, policy);
  }

  /**
   * Retire un membre — en le desactivant (`leftAt`), pas en le supprimant.
   *
   * Le responsable du projet ne peut pas quitter l'equipe par cette route :
   * `managerId` continuerait de le designer comme responsable, mais il perdrait
   * son acces et personne ne pourrait plus tenir le projet. Le retirer vraiment
   * demande de changer d'abord de responsable.
   */
  async removeMember(
    projectId: string,
    userId: string,
    policy: AccessPolicy,
    meta: RequestContext,
  ) {
    policy.requireScope('project', 'manage', ['team']);
    const project = await this.access.requireReadable(projectId, policy);

    const member = await this.prisma.projectMember.findFirst({
      where: { projectId, userId, leftAt: null },
      select: { id: true },
    });

    if (!member) {
      throw AppException.notFound(
        'PROJECT_MEMBER_NOT_FOUND',
        "Cette personne ne fait pas partie de l'equipe du projet.",
      );
    }

    if (project.managerId === userId) {
      throw AppException.unprocessable(
        'PROJECT_MANAGER_MUST_BE_MEMBER',
        'Le responsable du projet ne peut pas etre retire de son equipe. Designez un autre responsable auparavant.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.projectMember.update({ where: { id: member.id }, data: { leftAt: new Date() } });

      await this.activity.record(
        {
          type: ActivityType.NOTE,
          message: 'Un membre a quitte le projet.',
          projectId,
          clientId: project.clientId,
          actorId: policy.userId,
          metadata: { userId },
          isClientVisible: false,
        },
        tx,
      );
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'PROJECT_MEMBER_REMOVED',
      entityType: 'ProjectMember',
      entityId: member.id,
      before: { projectId, userId, leftAt: null },
      after: { leftAt: new Date().toISOString() },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.listMembers(projectId, policy);
  }

  // ---------------------------------------------------------------------------
  // Fil d'activite du projet
  // ---------------------------------------------------------------------------

  /**
   * Le fil d'activite d'un projet.
   *
   * CE SERVICE NE FILTRE RIEN LUI-MEME. Il delegue a
   * `ActivityService.listForProject(..., { asClient })`, qui applique
   * `isClientVisible: true` cote serveur quand le porteur est un compte client.
   * Ecrire ce filtre ici aurait duplique la regle, et une regle de visibilite
   * dupliquee finit toujours par diverger d'un cote.
   */
  async listActivities(projectId: string, query: PaginationQueryDto, policy: AccessPolicy) {
    policy.requireScope('activity', 'read', ['any', 'own']);
    const project = await this.access.requireReadable(projectId, policy);

    return this.activity.listForProject(project.id, query, { asClient: policy.isClient() });
  }

  // ---------------------------------------------------------------------------
  // Garde-fous communs
  // ---------------------------------------------------------------------------

  private refuseClientSpace(policy: AccessPolicy, what: string): void {
    if (policy.isClient()) {
      throw AppException.forbidden(`${what} n'est pas accessible depuis l'espace client.`);
    }
  }

  private async requireUsableClient(clientId: string): Promise<void> {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, deletedAt: null },
      select: { id: true },
    });

    if (!client) {
      throw AppException.unprocessable(
        'PROJECT_CLIENT_NOT_FOUND',
        "Le client indique n'existe pas ou a ete supprime.",
      );
    }
  }

  private async requireUsableUser(userId: string, role: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    });

    if (!user) {
      throw AppException.unprocessable(
        'PROJECT_USER_NOT_FOUND',
        `Le ${role} indique n'existe pas ou a ete supprime.`,
      );
    }
  }

  private async requireFreeCode(code: string, exceptProjectId: string | null): Promise<void> {
    const existing = await this.prisma.project.findFirst({
      where: { code, ...(exceptProjectId ? { id: { not: exceptProjectId } } : {}) },
      select: { id: true },
    });

    if (existing) {
      throw AppException.conflict('PROJECT_CODE_TAKEN', `Le code « ${code} » est deja utilise.`);
    }
  }
}

/** Filtres de recherche de la liste. Toujours combines en `AND` avec le perimetre. */
function buildProjectFilters(query: ProjectQueryDto): Prisma.ProjectWhereInput {
  const filters: Prisma.ProjectWhereInput = {};

  if (query.status) filters.status = query.status;
  if (query.clientId) filters.clientId = query.clientId;
  if (query.managerId) filters.managerId = query.managerId;

  if (query.search) {
    filters.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { reference: { contains: query.search, mode: 'insensitive' } },
      { code: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  return filters;
}

function toDateOrNull(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}
