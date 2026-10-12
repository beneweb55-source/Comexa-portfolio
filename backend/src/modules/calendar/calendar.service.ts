import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AccessPolicy } from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';
import type { CalendarEventKind, CalendarVisibility } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ProjectAccessService } from '../projects/project-access.service.js';
import type { RequestContext } from '../projects/request-meta.decorator.js';
import { TaskAccessService } from '../tasks/task-access.service.js';
import type {
  CalendarRangeQueryDto,
  CreateCalendarEventDto,
  UpdateCalendarEventDto,
} from './dto/calendar.dto.js';

/**
 * CALENDRIERS — PERSONNEL ET EQUIPE.
 *
 * =====================================================================
 * SOURCE DE VERITE
 * =====================================================================
 * `calendar_events` porte les RENDEZ-VOUS, RAPPELS et EVENEMENTS. Les
 * echeances de taches et de projets n'y sont JAMAIS recopiees : elles restent
 * dans `Task.dueDate` / `Project.dueDate` et sont affichees par l'interface a
 * cote des evenements. Une date n'existe donc jamais deux fois dans deux
 * tables, et une echeance deplacee dans une tache bouge partout.
 *
 * =====================================================================
 * REGLES DE VISIBILITE (testees en e2e)
 * =====================================================================
 *  - `PRIVATE` : proprietaire UNIQUEMENT. Pas de participants, absent de la
 *    vue equipe, meme pour un administrateur — « les evenements prives doivent
 *    rester prives » est une exigence, pas une convenance d'affichage ;
 *  - `SHARED` : proprietaire + participants, et visible dans la vue equipe par
 *    tout porteur de `calendar:read:team` ;
 *  - modification/suppression : proprietaire. `calendar:manage:any` ne
 *    modere que les evenements PARTAGES — un evenement prive reste prive,
 *    meme face a un administrateur ;
 *  - les participants se posent sur un evenement SHARED uniquement.
 *
 * =====================================================================
 * HORAIRES
 * =====================================================================
 * Tout est stocke en UTC. L'entree accepte l'ISO 8601 avec decalage ; le
 * service normalise des l'ecriture. `endsAt >= startsAt` est verifie au
 * service ET par la contrainte `calendar_events_range_check` en base : deux
 * barrieres, la seconde tenant meme face a une requete directe.
 *
 * =====================================================================
 * FENETRE DE LECTURE
 * =====================================================================
 * Une vue (jour/semaine/mois) demande sa fenetre (`from`, `to`). La fenetre
 * est bornee a `MAX_RANGE_DAYS` : au-dela, ce n'est plus une vue. Sans
 * parametres, la fenetre par defaut couvre six mois autour du jour.
 */

/** Largeur maximale d'une fenetre de lecture, en jours. */
export const MAX_RANGE_DAYS = 400;

/** Fenetre par defaut : 180 jours avant / 180 jours apres maintenant. */
const DEFAULT_RANGE_BACK_DAYS = 180;
const DEFAULT_RANGE_FORWARD_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

const EVENT_SELECT = {
  id: true,
  ownerId: true,
  title: true,
  description: true,
  kind: true,
  visibility: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  location: true,
  taskId: true,
  projectId: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { id: true, firstName: true, lastName: true } },
  task: { select: { id: true, title: true } },
  project: { select: { id: true, name: true, reference: true } },
  participants: {
    select: {
      userId: true,
      addedAt: true,
      user: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { addedAt: 'asc' as const },
  },
} satisfies Record<string, unknown>;

type EventRow = {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  kind: string;
  visibility: string;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  location: string | null;
  taskId: string | null;
  projectId: string | null;
  createdAt: Date;
  updatedAt: Date;
  owner: { id: string; firstName: string; lastName: string };
  task: { id: string; title: string } | null;
  project: { id: string; name: string; reference: string | null } | null;
  participants: {
    userId: string;
    addedAt: Date;
    user: { id: string; firstName: string; lastName: string };
  }[];
};

interface ResolvedRange {
  from: Date;
  to: Date;
}

/**
 * Resout la fenetre demandee, ou la fenetre par defaut.
 * Renvoie 400 plutot que de deviner quand la demande est contradictoire.
 */
export function resolveRange(query: CalendarRangeQueryDto): ResolvedRange {
  const now = Date.now();
  const from = query.from ? new Date(query.from) : new Date(now - DEFAULT_RANGE_BACK_DAYS * DAY_MS);
  const to = query.to ? new Date(query.to) : new Date(now + DEFAULT_RANGE_FORWARD_DAYS * DAY_MS);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw AppException.badRequest(
      'CALENDAR_RANGE_INVALID',
      'Les bornes de la période doivent être des dates ISO 8601 valides.',
    );
  }
  if (from.getTime() > to.getTime()) {
    throw AppException.badRequest(
      'CALENDAR_RANGE_INVALID',
      'Le début de la période doit précéder sa fin.',
    );
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw AppException.badRequest(
      'CALENDAR_RANGE_TOO_WIDE',
      `Une vue couvre au plus ${MAX_RANGE_DAYS} jours : resserrez la période demandée.`,
    );
  }
  return { from, to };
}

/**
 * Verifie `endsAt >= startsAt` sur les valeurs FUSIONNEES (creation ou mise a
 * jour). Exporte pour le test unitaire : c'est une REGLE metier, elle se teste
 * sans base ni conteneur.
 */
export function assertChronology(startsAt: Date, endsAt: Date | null): void {
  if (endsAt && endsAt.getTime() < startsAt.getTime()) {
    throw AppException.unprocessable(
      'CALENDAR_RANGE_INVALID',
      "La fin d'un événement ne peut pas précéder son début.",
    );
  }
}

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TaskAccessService,
    private readonly projects: ProjectAccessService,
    private readonly audit: AuditService,
  ) {}

  /** Espace client ferme : un client a son portail, pas le calendrier interne. */
  private refuseClientSpace(policy: AccessPolicy): void {
    if (policy.isClient()) {
      throw AppException.forbidden("Le calendrier n'est pas accessible depuis l'espace client.");
    }
  }

  /** Calendrier PERSONNEL : mes evenements + ceux auxquels je suis invite. */
  async listMine(policy: AccessPolicy, query: CalendarRangeQueryDto) {
    this.refuseClientSpace(policy);
    const range = resolveRange(query);
    const events = await this.prisma.calendarEvent.findMany({
      where: {
        AND: [
          { startsAt: { lt: range.to } },
          { OR: [{ endsAt: null }, { endsAt: { gte: range.from } }] },
          {
            OR: [{ ownerId: policy.userId }, { participants: { some: { userId: policy.userId } } }],
          },
        ],
      },
      select: EVENT_SELECT,
      orderBy: { startsAt: 'asc' },
    });
    return events.map((event) => this.present(event as EventRow, policy));
  }

  /**
   * Calendrier D'EQUIPE : uniquement les evenements SHARED.
   * Un evenement PRIVATE n'apparait jamais ici, quel que soit le lecteur.
   */
  async listTeam(policy: AccessPolicy, query: CalendarRangeQueryDto) {
    this.refuseClientSpace(policy);
    const range = resolveRange(query);
    const events = await this.prisma.calendarEvent.findMany({
      where: {
        AND: [
          { visibility: 'SHARED' },
          { startsAt: { lt: range.to } },
          { OR: [{ endsAt: null }, { endsAt: { gte: range.from } }] },
        ],
      },
      select: EVENT_SELECT,
      orderBy: { startsAt: 'asc' },
    });
    return events.map((event) => this.present(event as EventRow, policy));
  }

  /**
   * Lecture d'un evenement par identifiant.
   *
   * Invisible => 404 (pas 403 : un 403 confirmerait que la ligne existe).
   * Visible mais non modifiable => 403 explicite.
   */
  async getOne(policy: AccessPolicy, eventId: string) {
    this.refuseClientSpace(policy);
    const event = await this.findOrHide(policy, eventId);
    return this.present(event, policy);
  }

  async create(policy: AccessPolicy, dto: CreateCalendarEventDto, meta: RequestContext) {
    this.refuseClientSpace(policy);
    const startsAt = new Date(dto.startsAt);
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (Number.isNaN(startsAt.getTime()) || (endsAt && Number.isNaN(endsAt.getTime()))) {
      throw AppException.badRequest(
        'CALENDAR_RANGE_INVALID',
        'Les horaires doivent être des dates ISO 8601 valides.',
      );
    }
    assertChronology(startsAt, endsAt);

    const links = await this.resolveLinks(policy, dto.taskId, dto.projectId);

    const created = await this.prisma.calendarEvent.create({
      data: {
        ownerId: policy.userId,
        title: dto.title,
        description: dto.description ?? null,
        kind: dto.kind ?? 'EVENT',
        visibility: dto.visibility ?? 'PRIVATE',
        startsAt,
        endsAt,
        allDay: dto.allDay ?? false,
        location: dto.location ?? null,
        taskId: links.taskId,
        projectId: links.projectId,
      },
      select: EVENT_SELECT,
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'CALENDAR_EVENT_CREATED',
      entityType: 'CalendarEvent',
      entityId: created.id,
      after: { title: created.title, visibility: created.visibility, startsAt: created.startsAt },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.present(created as EventRow, policy);
  }

  async update(
    policy: AccessPolicy,
    eventId: string,
    dto: UpdateCalendarEventDto,
    meta: RequestContext,
  ) {
    this.refuseClientSpace(policy);
    if (Object.keys(dto).length === 0) {
      throw AppException.badRequest(
        'VALIDATION_FAILED',
        'La mise à jour doit contenir au moins un champ.',
      );
    }

    const before = await this.requireEditable(policy, eventId);

    const startsAt = dto.startsAt ? new Date(dto.startsAt) : before.startsAt;
    const endsAt =
      dto.endsAt !== undefined ? (dto.endsAt ? new Date(dto.endsAt) : null) : before.endsAt;
    if (Number.isNaN(startsAt.getTime()) || (endsAt && Number.isNaN(endsAt.getTime()))) {
      throw AppException.badRequest(
        'CALENDAR_RANGE_INVALID',
        'Les horaires doivent être des dates ISO 8601 valides.',
      );
    }
    assertChronology(startsAt, endsAt);

    // Fermer un evenement participant sur PRIVATE exige d'abord de retirer les
    // invites : la regle « PRIVATE = personne d'autre » vaut aussi dans le temps.
    const nextVisibility = dto.visibility ?? (before.visibility as CalendarVisibility);
    if (nextVisibility === 'PRIVATE' && before.participants.length > 0) {
      throw AppException.unprocessable(
        'CALENDAR_PRIVATE_WITH_PARTICIPANTS',
        'Retirez d’abord les participants : un événement privé ne peut pas en avoir.',
      );
    }

    const links = await this.resolveLinks(
      policy,
      dto.taskId !== undefined ? dto.taskId : before.taskId,
      dto.projectId !== undefined ? dto.projectId : before.projectId,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.calendarEvent.update({
        where: { id: eventId },
        data: {
          ...(dto.title === undefined ? {} : { title: dto.title }),
          ...(dto.description === undefined ? {} : { description: dto.description }),
          ...(dto.kind === undefined ? {} : { kind: dto.kind }),
          ...(dto.visibility === undefined ? {} : { visibility: dto.visibility }),
          startsAt,
          endsAt,
          ...(dto.allDay === undefined ? {} : { allDay: dto.allDay }),
          ...(dto.location === undefined ? {} : { location: dto.location }),
          taskId: links.taskId,
          projectId: links.projectId,
        },
        select: EVENT_SELECT,
      });
      return row;
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'CALENDAR_EVENT_UPDATED',
      entityType: 'CalendarEvent',
      entityId: eventId,
      before: { title: before.title, startsAt: before.startsAt, visibility: before.visibility },
      after: { title: updated.title, startsAt: updated.startsAt, visibility: updated.visibility },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.present(updated as EventRow, policy);
  }

  async remove(policy: AccessPolicy, eventId: string, meta: RequestContext) {
    this.refuseClientSpace(policy);
    const before = await this.requireEditable(policy, eventId);
    await this.prisma.calendarEvent.delete({ where: { id: eventId } });
    await this.audit.record({
      actorId: policy.userId,
      action: 'CALENDAR_EVENT_DELETED',
      entityType: 'CalendarEvent',
      entityId: eventId,
      before: { title: before.title, startsAt: before.startsAt, visibility: before.visibility },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { deleted: true };
  }

  /**
   * Remplacement complet des invites (PUT : la liste transmise est l'etat
   * souhaite, pas un delta — un delta se perd silencieusement en cas de
   * requetes croisees, une liste entiere se relit).
   */
  async replaceParticipants(
    policy: AccessPolicy,
    eventId: string,
    userIds: string[],
    meta: RequestContext,
  ) {
    this.refuseClientSpace(policy);
    const before = await this.requireEditable(policy, eventId);

    if (before.visibility === 'PRIVATE') {
      throw AppException.unprocessable(
        'CALENDAR_PRIVATE_NO_PARTICIPANTS',
        'Un événement privé ne peut pas avoir de participants : passez-le en partagé d’abord.',
      );
    }

    const unique = [...new Set(userIds)];
    const owners = unique.filter((id) => id === before.ownerId);
    if (owners.length > 0) {
      throw AppException.badRequest(
        'CALENDAR_PARTICIPANT_INVALID',
        'Le propriétaire est déjà le premier concerné : ne le mettez pas dans les participants.',
      );
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: unique }, deletedAt: null, status: 'ACTIVE' },
      select: { id: true },
    });
    if (users.length !== unique.length) {
      throw AppException.badRequest(
        'CALENDAR_PARTICIPANT_INVALID',
        'Un ou plusieurs participants sont inconnus ou inactifs.',
      );
    }

    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.calendarEventParticipant.deleteMany({ where: { eventId } });
      if (unique.length > 0) {
        await tx.calendarEventParticipant.createMany({
          data: unique.map((userId) => ({ eventId, userId })),
        });
      }
      return tx.calendarEvent.findUniqueOrThrow({ where: { id: eventId }, select: EVENT_SELECT });
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'CALENDAR_EVENT_PARTICIPANTS_SET',
      entityType: 'CalendarEvent',
      entityId: eventId,
      after: { participants: unique },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.present(rows as EventRow, policy);
  }

  // -------------------------------------------------------------------------
  // Garde-fois internes
  // -------------------------------------------------------------------------

  /**
   * Charge l'evenement, ou le fait disparaitre (404) pour qui ne le voit pas.
   * Un evenement PRIVATE reste prive : seul son proprietaire — ou un porteur de
   * `calendar:manage:any` pour moderation — le sert par identifiant.
   */
  private async findOrHide(policy: AccessPolicy, eventId: string): Promise<EventRow> {
    const event = (await this.prisma.calendarEvent.findUnique({
      where: { id: eventId },
      select: EVENT_SELECT,
    })) as EventRow | null;
    if (!event) {
      throw AppException.notFound('CALENDAR_EVENT_NOT_FOUND', "Cet événement n'existe pas.");
    }
    // SHARED : visible a quiconque passe le garde de route (lecture equipe).
    // PRIVATE : proprietaire UNIQUEMENT — un evenement prive reste prive, meme
    // pour un administrateur. C'est l'exigence du cahier des charges (« aucun
    // utilisateur ne doit pouvoir lire les evenements prives d'un autre en
    // modifiant un identifiant »), et elle prime sur la moderation : le
    // `calendar:manage:any` s'exerce sur les evenements PARTAGES seuls.
    const isOwner = event.ownerId === policy.userId;
    const visible = event.visibility === 'SHARED' || isOwner;
    if (!visible) {
      throw AppException.notFound('CALENDAR_EVENT_NOT_FOUND', "Cet événement n'existe pas.");
    }
    return event;
  }

  /**
   * Visible (sinon 404) ET modifiable (sinon 403).
   * Proprietaire toujours ; un moderateur (`calendar:manage:any`) seulement
   * sur les evenements PARTAGES — voir `findOrHide` pour le pourquoi.
   */
  private async requireEditable(policy: AccessPolicy, eventId: string): Promise<EventRow> {
    const event = await this.findOrHide(policy, eventId);
    const isOwner = event.ownerId === policy.userId;
    const isSharedModerator = event.visibility === 'SHARED' && policy.has('calendar:manage:any');
    if (!isOwner && !isSharedModerator) {
      throw AppException.forbidden("Seul le propriétaire d'un événement peut le modifier.");
    }
    return event;
  }

  /**
   * Liens optionnels tache/projet — valides ou absents.
   *
   * Une tache liee impose la coherence du projet : si la tache appartient a un
   * projet, l'evenement la reprend (et un projet contradictoire est refuse).
   * C'est la garantie que « le temps et les echeances suivent la bonne tache »
   * sans jamais recopier une date en deux tables.
   */
  private async resolveLinks(
    policy: AccessPolicy,
    taskId: string | null | undefined,
    projectId: string | null | undefined,
  ): Promise<{ taskId: string | null; projectId: string | null }> {
    const resolvedTaskId: string | null = taskId ?? null;
    let resolvedProjectId: string | null = projectId ?? null;

    if (resolvedTaskId) {
      const task = await this.tasks.requireReadable(resolvedTaskId, policy);
      const taskProjectId = task.projectId ?? null;
      if (resolvedProjectId && taskProjectId && resolvedProjectId !== taskProjectId) {
        throw AppException.unprocessable(
          'CALENDAR_LINK_CONFLICT',
          'La tâche liée appartient à un autre projet que celui demandé.',
        );
      }
      if (!resolvedProjectId && taskProjectId) {
        resolvedProjectId = taskProjectId;
      }
    }

    if (resolvedProjectId) {
      await this.projects.requireReadable(resolvedProjectId, policy);
    }

    return { taskId: resolvedTaskId, projectId: resolvedProjectId };
  }

  /** Forme de presentation — champs affichables, jamais de SQL brut. */
  private present(event: EventRow, policy: AccessPolicy) {
    return {
      id: event.id,
      title: event.title,
      description: event.description,
      kind: event.kind as CalendarEventKind,
      visibility: event.visibility as CalendarVisibility,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt ? event.endsAt.toISOString() : null,
      allDay: event.allDay,
      location: event.location,
      taskId: event.taskId,
      taskTitle: event.task?.title ?? null,
      projectId: event.projectId,
      projectName: event.project?.name ?? null,
      projectReference: event.project?.reference ?? null,
      owner: event.owner,
      isOwn: event.ownerId === policy.userId,
      canEdit:
        event.ownerId === policy.userId ||
        (event.visibility === 'SHARED' && policy.has('calendar:manage:any')),
      participants: event.participants.map((p) => ({
        userId: p.user.id,
        firstName: p.user.firstName,
        lastName: p.user.lastName,
        addedAt: p.addedAt.toISOString(),
      })),
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
    };
  }
}
