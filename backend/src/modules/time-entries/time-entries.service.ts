import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { SCOPE_ANY, type AccessPolicy } from '../../common/auth/principal.js';
import { paginated, resolvePagination } from '../../common/dto/pagination.dto.js';
import { AppException } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ActivityType, RoleCode, UserStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { PROJECT_READ_ORDER, projectScopeWhere, subjectOf } from '../projects/project-scope.js';
import type { RequestContext } from '../projects/request-meta.decorator.js';
import { TaskAccessService } from '../tasks/task-access.service.js';
import { CreateTimeEntryDto, TimeEntryQueryDto, UpdateTimeEntryDto } from './dto/time-entry.dto.js';
import {
  TIME_READ_ORDER,
  TIME_WRITE_ORDER,
  isFutureWorkDay,
  minutesViolation,
  normalizeWorkDay,
  timeEntryPerimeter,
} from './time-rules.js';

/**
 * TEMPS SAISI.
 *
 * LE PROJET D'UNE SAISIE N'EST JAMAIS LU DANS LA REQUETE. Il est ecrit a partir
 * de la tache, dans le service. C'est la defense la plus solide contre le scenario
 * du brief — « un client qui change un identifiant pour atteindre les donnees d'un
 * autre » : la valeur falsifiable n'existe pas dans le contrat d'entree. Une
 * validation a posteriori aurait suffi a un seul oubli pour laisser passer une
 * saisie dans le projet d'un autre.
 *
 * LE PERIMETRE D'ECRITURE PASSE PAR LA TACHE, PAS PAR LE TEMPS. Sous
 * `time:write:own`, la tache doit etre une tache que le porteur peut MODIFIER
 * (`task:write:own`, donc : assignee a lui). Saisir deux heures sur la tache d'un
 * collegue est refuse, meme en son propre nom : le temps d'un projet qu'on ne
 * traite pas n'est pas le sien a declarer, et une feuille de temps qui accepte
 * n'importe quelle tache ne veut plus rien dire.
 *
 * LE TEMPS EST INTERNE. Aucune saisie ne remonte dans l'espace client, aucune
 * entree de fil n'est publiee pour le client : ce que l'agence facture est une
 * affaire d'agence. Voir `refuseClientSpace` et `isClientVisible: false`.
 */

const TIME_ENTRY_SELECT = {
  id: true,
  projectId: true,
  taskId: true,
  userId: true,
  spentOn: true,
  minutes: true,
  description: true,
  billable: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, firstName: true, lastName: true } },
  project: { select: { id: true, reference: true, name: true } },
  task: { select: { id: true, title: true } },
} as const;

/** Ce qu'un ecrivain de saisie doit connaitre de sa ligne. */
interface TimeEntryRef {
  readonly id: string;
  readonly userId: string;
  readonly taskId: string | null;
  /** `null` pour une saisie sur tache PERSONNELLE : elle ne releve d'aucun projet. */
  readonly projectId: string | null;
  readonly minutes: number;
  readonly spentOn: Date;
  readonly description: string | null;
  readonly billable: boolean;
}

@Injectable()
export class TimeEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TaskAccessService,
    private readonly activity: ActivityService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lecture
  // ---------------------------------------------------------------------------

  /** Saisies d'une tache. Le porteur doit pouvoir lire la tache. */
  async listForTask(taskId: string, query: TimeEntryQueryDto, policy: AccessPolicy) {
    this.refuseClientSpace(policy);
    await this.tasks.requireReadable(taskId, policy);
    const p = resolvePagination(query);

    const where: Prisma.TimeEntryWhereInput = {
      taskId,
      AND: [this.perimeter(policy, 'read'), buildTimeFilters(query)],
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.timeEntry.findMany({
        where,
        orderBy: [{ spentOn: 'desc' }, { createdAt: 'desc' }],
        skip: p.skip,
        take: p.take,
        select: TIME_ENTRY_SELECT,
      }),
      this.prisma.timeEntry.count({ where }),
    ]);

    return paginated(items, total, p);
  }

  /**
   * Feuille de temps globale.
   *
   * C'EST LA ROUTE D'UN CHEF DE PROJET OU D'UN DEVELOPPEUR QUI REMPLIT SA SEMAINE.
   * Les deux passent par le meme filtre et obtiennent des listes differentes :
   * `time:read:any` voit les projets qu'il peut atteindre, `time:read:own` ne voit
   * que ses propres lignes. Aucun des deux ne voit « tout le temps de l'agence »,
   * qui n'est une reponse utile pour personne.
   */
  async list(query: TimeEntryQueryDto, policy: AccessPolicy) {
    this.refuseClientSpace(policy);
    const p = resolvePagination(query);

    const where: Prisma.TimeEntryWhereInput = {
      AND: [this.perimeter(policy, 'read'), buildTimeFilters(query)],
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.timeEntry.findMany({
        where,
        orderBy: [{ spentOn: 'desc' }, { createdAt: 'desc' }],
        skip: p.skip,
        take: p.take,
        select: TIME_ENTRY_SELECT,
      }),
      this.prisma.timeEntry.count({ where }),
    ]);

    return paginated(items, total, p);
  }

  // ---------------------------------------------------------------------------
  // Ecriture
  // ---------------------------------------------------------------------------

  /**
   * Saisie de temps sur une tache.
   *
   * DEUX NIVEAUX DE DROIT D'ECRITURE, ET LA TACHE EST VERIFIEE AVEC LE BON.
   * `time:write:own` exige que la tache soit MODIFIABLE par le porteur : une
   * feuille de temps personnelle ne se remplit pas sur le travail des autres.
   * `time:write:any` se contente de la LIRE : un responsable corrige le temps la ou
   * il passe, sans devoir etre assigne a la tache.
   */
  async create(
    taskId: string,
    dto: CreateTimeEntryDto,
    policy: AccessPolicy,
    meta: RequestContext,
  ) {
    const perimeter = this.perimeter(policy, 'write');
    this.refuseClientSpace(policy);

    const writeScope = policy.requireScope('time', 'write', TIME_WRITE_ORDER);

    const task =
      writeScope === SCOPE_ANY
        ? await this.tasks.requireReadable(taskId, policy)
        : await this.tasks.requireWritable(taskId, policy);

    const userId = await this.resolveAuthor(writeScope, dto.userId, policy);

    const violation = minutesViolation(dto.minutes);
    if (violation) {
      throw AppException.unprocessable('TIME_INVALID_MINUTES', violation, { minutes: dto.minutes });
    }

    const spentOn = normalizeWorkDay(dto.spentOn ? new Date(dto.spentOn) : new Date());
    this.refuseFutureDay(spentOn);

    // Le temps d'une tache PERSONNELLE n'est JAMAIS facturable : il n'y a ni
    // projet ni client a facturer. Le forcer ici — plutot que de faire confiance
    // a l'appelant — evite qu'une saisie personnelle gonfle un jour un total
    // facturable.
    const billable = task.isPersonal ? false : (dto.billable ?? true);
    const projectOfTask = task.project;

    const created = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.timeEntry.create({
        data: {
          // LE PROJET VIENT DE LA TACHE. Voir l'en-tete du fichier. `null` pour
          // une tache personnelle : la saisie existe, hors de tout projet.
          projectId: task.projectId,
          taskId: task.id,
          userId,
          spentOn,
          minutes: dto.minutes,
          description: dto.description ?? null,
          billable,
        },
        select: { id: true },
      });

      // Pas de projet, pas de fil : une saisie personnelle ne s'annonce nulle
      // part (meme raison que pour les taches personnelles — voir
      // `TasksService.changeStatus`).
      if (projectOfTask && task.projectId) {
        await this.activity.record(
          {
            type: ActivityType.TIME_LOGGED,
            message: `${formatMinutes(dto.minutes)} saisi(s) sur « ${task.title} ».`,
            projectId: task.projectId,
            taskId: task.id,
            clientId: projectOfTask.clientId,
            actorId: policy.userId,
            metadata: {
              timeEntryId: entry.id,
              minutes: dto.minutes,
              spentOn: spentOn.toISOString(),
            },
            // INTERNE. Le temps saisi alimente la facturation : c'est une donnee
            // d'agence. La publier dans l'espace client reviendrait a montrer le
            // cout du travail en meme temps que son avancement.
            isClientVisible: false,
          },
          tx,
        );
      }

      return entry;
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'TIME_LOGGED',
      entityType: 'TimeEntry',
      entityId: created.id,
      after: {
        projectId: task.projectId,
        taskId: task.id,
        userId,
        minutes: dto.minutes,
        spentOn: spentOn.toISOString(),
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.detail(created.id, perimeter);
  }

  /**
   * Correction d'une saisie.
   *
   * PAS D'ENTREE DANS LE FIL D'ACTIVITE, SEULEMENT DANS LE JOURNAL D'AUDIT. Le fil
   * raconte ce qui s'est passe dans le projet ; corriger 90 en 60 minutes est une
   * operation comptable, et l'y ecrire trois fois par semaine le rendrait illisible
   * pour ce qu'il est cense raconter. Le journal d'audit, lui, garde l'avant et
   * l'apres : c'est la qu'on va chercher qui a change quoi.
   */
  async update(
    entryId: string,
    dto: UpdateTimeEntryDto,
    policy: AccessPolicy,
    meta: RequestContext,
  ) {
    this.refuseClientSpace(policy);
    const perimeter = this.perimeter(policy, 'write');
    const before = await this.load(entryId, perimeter);

    if (dto.minutes !== undefined) {
      const violation = minutesViolation(dto.minutes);
      if (violation) {
        throw AppException.unprocessable('TIME_INVALID_MINUTES', violation, {
          minutes: dto.minutes,
        });
      }
    }

    let spentOn: Date | undefined;
    if (dto.spentOn !== undefined) {
      spentOn = normalizeWorkDay(new Date(dto.spentOn));
      this.refuseFutureDay(spentOn);
    }

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.timeEntry.updateMany({
        // `userId` dans le `where` en plus de l'identifiant : la ligne doit
        // toujours appartenir a la meme personne. Ce n'est pas une precaution
        // inutile — cela ferme la fenetre pendant laquelle la propriete de la
        // ligne aurait change.
        where: { id: entryId, userId: before.userId },
        data: {
          ...(dto.minutes === undefined ? {} : { minutes: dto.minutes }),
          ...(spentOn === undefined ? {} : { spentOn }),
          ...(dto.description === undefined ? {} : { description: dto.description }),
          ...(dto.billable === undefined ? {} : { billable: dto.billable }),
        },
      });

      if (updated.count !== 1) {
        throw AppException.conflict(
          'TIME_ENTRY_EDIT_CONFLICT',
          'La saisie a change entre-temps. Rechargez-la avant de reessayer.',
        );
      }
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'TIME_ENTRY_UPDATED',
      entityType: 'TimeEntry',
      entityId: entryId,
      before: {
        minutes: before.minutes,
        spentOn: before.spentOn,
        description: before.description,
        billable: before.billable,
      },
      after: dto,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.detail(entryId, perimeter);
  }

  async remove(entryId: string, policy: AccessPolicy, meta: RequestContext) {
    this.refuseClientSpace(policy);
    const perimeter = this.perimeter(policy, 'write');
    const before = await this.load(entryId, perimeter);

    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.timeEntry.deleteMany({
        where: { id: entryId, userId: before.userId },
      });

      if (deleted.count !== 1) {
        throw AppException.conflict(
          'TIME_ENTRY_DELETE_CONFLICT',
          'La saisie a change entre-temps. Rechargez-la avant de reessayer.',
        );
      }
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'TIME_ENTRY_DELETED',
      entityType: 'TimeEntry',
      entityId: entryId,
      before: {
        projectId: before.projectId,
        taskId: before.taskId,
        userId: before.userId,
        minutes: before.minutes,
        spentOn: before.spentOn,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { deleted: true as const };
  }

  // ---------------------------------------------------------------------------
  // Perimetre et chargement
  // ---------------------------------------------------------------------------

  /**
   * Perimetre d'une saisie, resolu UNE fois puis reutilise.
   *
   * Le detail relu apres une ecriture emploie EXACTEMENT le meme filtre que
   * l'ecriture : si l'ecriture a pu atteindre la ligne, la relecture le peut
   * aussi. Recalculer un perimetre de LECTURE apres avoir ecrit aurait pu produire
   * une ecriture reussie suivie d'un 403 — le pire des etats, celui ou l'appelant
   * ne sait pas si son geste a porte.
   *
   * `timeEntryPerimeter` recoit un filtre de projet DEJA construit, ce qui la rend
   * testable sans base ni faux `AccessPolicy` ; c'est ici, et ici seulement, qu'on
   * va le chercher.
   */
  private perimeter(policy: AccessPolicy, action: 'read' | 'write'): Prisma.TimeEntryWhereInput {
    const scope = policy.requireScope(
      'time',
      action,
      action === 'write' ? TIME_WRITE_ORDER : TIME_READ_ORDER,
    );

    if (scope !== SCOPE_ANY) {
      return timeEntryPerimeter(scope, subjectOf(policy), null);
    }

    const projectScope = policy.requireScope('project', 'read', PROJECT_READ_ORDER);
    return timeEntryPerimeter(
      scope,
      subjectOf(policy),
      projectScopeWhere(projectScope, subjectOf(policy)),
    );
  }

  private async load(
    entryId: string,
    perimeter: Prisma.TimeEntryWhereInput,
  ): Promise<TimeEntryRef> {
    const entry = await this.prisma.timeEntry.findFirst({
      where: { id: entryId, AND: [perimeter] },
      select: {
        id: true,
        userId: true,
        taskId: true,
        projectId: true,
        minutes: true,
        spentOn: true,
        description: true,
        billable: true,
      },
    });

    if (!entry) {
      // 404 et non 403, comme partout ailleurs : un 403 confirmerait que la ligne
      // existe et appartient a quelqu'un d'autre.
      throw AppException.notFound('TIME_ENTRY_NOT_FOUND', 'Cette saisie est introuvable.');
    }

    return entry;
  }

  private async detail(entryId: string, perimeter: Prisma.TimeEntryWhereInput) {
    const entry = await this.prisma.timeEntry.findFirst({
      where: { id: entryId, AND: [perimeter] },
      select: TIME_ENTRY_SELECT,
    });

    if (!entry) {
      throw AppException.notFound('TIME_ENTRY_NOT_FOUND', 'Cette saisie est introuvable.');
    }

    return entry;
  }

  /**
   * Un compte client ne saisit ni ne lit de temps, quelles que soient les
   * permissions qu'on lui ajouterait un jour.
   */
  private refuseClientSpace(policy: AccessPolicy): void {
    if (policy.isClient()) {
      throw AppException.forbidden("Le temps saisi n'est pas accessible depuis l'espace client.");
    }
  }

  private refuseFutureDay(spentOn: Date): void {
    if (isFutureWorkDay(spentOn, new Date())) {
      throw AppException.unprocessable(
        'TIME_ENTRY_FUTURE_DAY',
        "On ne saisit pas de temps sur une journee qui n'est pas encore arrivee.",
        { spentOn: spentOn.toISOString() },
      );
    }
  }

  /**
   * Pour le compte de qui la saisie est-elle faite.
   *
   * Sous `time:write:own`, la reponse est TOUJOURS le porteur : un `userId` qui
   * designe quelqu'un d'autre est refuse en 403, pas ignore. L'ignorer aurait
   * ecrit la saisie au nom du porteur alors qu'il visait un collegue — une donnee
   * fausse, silencieusement. Mieux vaut un refus explicite.
   */
  private async resolveAuthor(
    scope: string,
    requested: string | undefined,
    policy: AccessPolicy,
  ): Promise<string> {
    if (scope !== SCOPE_ANY) {
      if (requested && requested !== policy.userId) {
        throw AppException.forbidden(
          'Vous ne pouvez saisir du temps que pour vous-meme (time:write:own).',
        );
      }
      return policy.userId;
    }

    const userId = requested ?? policy.userId;

    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, status: UserStatus.ACTIVE },
      select: { id: true, roles: { select: { role: { select: { code: true } } } } },
    });

    if (!user) {
      throw AppException.unprocessable(
        'TIME_ENTRY_AUTHOR_NOT_FOUND',
        "La personne indiquee n'existe pas, est inactive, ou a ete supprimee.",
      );
    }

    if (user.roles.some((entry) => entry.role.code === RoleCode.CLIENT)) {
      throw AppException.unprocessable(
        'TIME_ENTRY_AUTHOR_IS_CLIENT',
        'On ne saisit pas de temps pour un compte client.',
      );
    }

    return user.id;
  }
}

/** Filtres de recherche, toujours combines en `AND` avec le perimetre. */
function buildTimeFilters(query: TimeEntryQueryDto): Prisma.TimeEntryWhereInput {
  const filters: Prisma.TimeEntryWhereInput = {};

  // `userId` est un filtre COMME UN AUTRE : sous `time:read:own`, le perimetre
  // impose deja le porteur, et la combinaison en `AND` fait que `?userId=<autre>`
  // ne peut pas l'elargir. C'est la meme regle que `?clientId=` cote projets.
  if (query.userId) filters.userId = query.userId;
  if (query.projectId) filters.projectId = query.projectId;
  if (query.taskId) filters.taskId = query.taskId;
  if (query.billable !== undefined) filters.billable = query.billable;

  if (query.from || query.to) {
    filters.spentOn = {
      ...(query.from ? { gte: normalizeWorkDay(new Date(query.from)) } : {}),
      // Borne haute INCLUSIVE : `to` est une journee, et un `lte` sur minuit UTC
      // exclurait tout ce qui a ete saisi ce jour-la. La borne est donc le
      // dernier instant de la journee.
      ...(query.to ? { lte: endOfUtcDay(new Date(query.to)) } : {}),
    };
  }

  return filters;
}

function endOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999),
  );
}

/** « 90 » devient « 1 h 30 », pour un fil d'activite lisible. */
function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest}`;
}
