import { Injectable } from '@nestjs/common';
import {
  AccessPolicy,
  SCOPE_ANY,
  SCOPE_OWN,
  type AuthenticatedUser,
} from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';
import {
  DocumentVisibility,
  InvoiceStatus,
  MilestoneStatus,
  PaymentStatus,
  QuoteStatus,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  CLOSED_LEAD_STATUSES,
  CLOSED_PROJECT_STATUSES,
  OPEN_INVOICE_STATUSES,
  OPEN_TASK_STATUSES,
  collectedSection,
  groupCount,
  outstandingBetween,
  outstandingSection,
} from '../reports/report-builders.js';
import {
  amountSection,
  amountString,
  countOf,
  ratioOf,
  type AmountSection,
  type CollectedSection,
  type StatusCount,
} from '../reports/report-metrics.js';
import {
  resolvePeriod,
  serializePeriod,
  withinPeriod,
  type SerializedPeriod,
} from '../reports/report-period.js';
import {
  DASHBOARD_READ_ANY,
  DASHBOARD_READ_OWN,
  clientSectionsFor,
  personalSectionsFor,
  resolvePerimeter,
  type ClientSections,
  type DashboardPerimeter,
  type PersonalSections,
} from './dashboard-scope.js';
import type { AgencyDashboardQueryDto } from './dto/dashboard.dto.js';

/**
 * SERVICE DES TABLEAUX DE BORD.
 *
 * Trois vues, trois perimetres, et une seule regle qui les separe : le
 * perimetre vient du PORTEUR DU JETON, jamais de la requete. Un client ne peut
 * donc pas designer un autre client — il n'y a nulle part ou l'ecrire, et les
 * DTO de ces routes sont vides pour que le garde de validation refuse le
 * moindre parametre.
 *
 * Les agregats sont lus directement dans les tables des autres domaines. Ils
 * sont volontairement calcules avec les MEMES definitions que les rapports
 * (`OPEN_INVOICE_STATUSES`, `CLOSED_PROJECT_STATUSES`, `collectedSection`...) :
 * si le tableau de bord et le rapport de revenus ne comptaient pas les memes
 * factures, le dirigeant verrait deux chiffres differents pour la meme question
 * le meme jour, et ne saurait plus lequel croire.
 */

/** Nombre d'elements mis en avant dans une vue d'accueil. */
const HIGHLIGHT_LIMIT = 5;

/** Nombre d'elements listes dans l'espace client. */
const CLIENT_ITEM_LIMIT = 10;

// -----------------------------------------------------------------------------
// Formes de reponse
// -----------------------------------------------------------------------------

export interface UpcomingTask {
  readonly id: string;
  readonly title: string;
  /** Non nulle par construction : la requete exclut les taches sans echeance. */
  readonly dueDate: string | null;
  readonly priority: string;
  readonly status: string;
  readonly projectName: string | null;
  readonly assigneeName: string | null;
}

export interface UpcomingInvoice {
  readonly id: string;
  readonly reference: string;
  readonly dueDate: string | null;
  readonly status: string;
  readonly currency: string;
  /** Ce qui RESTE a encaisser, pas le montant facture. */
  readonly outstanding: string;
  readonly clientName: string | null;
}

export interface AgencyDashboard {
  readonly asOf: string;
  readonly period: SerializedPeriod;
  readonly prospects: {
    readonly total: number;
    readonly open: number;
    readonly createdInPeriod: number;
    readonly byStatus: readonly StatusCount[];
  };
  readonly projects: {
    readonly total: number;
    readonly active: number;
    readonly overdue: number;
    readonly createdInPeriod: number;
    readonly averageProgress: number;
    readonly byStatus: readonly StatusCount[];
    readonly byHealth: readonly StatusCount[];
  };
  readonly tasks: {
    readonly total: number;
    readonly open: number;
    readonly overdue: number;
  };
  readonly invoices: {
    readonly open: AmountSection;
    readonly overdue: AmountSection;
    readonly issuedInPeriod: AmountSection;
  };
  /** Encaissements reels de la periode. Jamais le total des factures emises. */
  readonly collected: CollectedSection;
  readonly collectionRate: number;
  readonly upcoming: {
    readonly tasks: readonly UpcomingTask[];
    readonly invoices: readonly UpcomingInvoice[];
  };
}

export interface PersonalNotification {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly link: string | null;
  readonly createdAt: string;
}

export interface PersonalDashboard {
  readonly asOf: string;
  /** Sections reellement ouvertes par les droits du porteur. */
  readonly sections: PersonalSections;
  readonly tasks: {
    readonly total: number;
    readonly open: number;
    readonly overdue: number;
    readonly byStatus: readonly StatusCount[];
  } | null;
  readonly upcoming: readonly UpcomingTask[] | null;
  readonly timeEntries: {
    readonly todayMinutes: number;
    readonly monthMinutes: number;
    readonly monthEntries: number;
  } | null;
  readonly notifications: {
    readonly unread: number;
    readonly recent: readonly PersonalNotification[];
  } | null;
}

export interface ClientProjectItem {
  readonly id: string;
  readonly reference: string;
  readonly name: string;
  readonly status: string;
  readonly progressPercent: number;
  readonly dueDate: string | null;
}

export interface ClientInvoiceItem {
  readonly id: string;
  readonly reference: string;
  readonly status: string;
  readonly currency: string;
  readonly total: string;
  readonly outstanding: string;
  readonly issueDate: string;
  readonly dueDate: string;
}

export interface ClientDocumentItem {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly visibility: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
}

export interface ClientDashboard {
  readonly asOf: string;
  readonly client: {
    readonly id: string;
    readonly reference: string;
    readonly companyName: string;
  };
  readonly sections: ClientSections;
  readonly projects: {
    readonly total: number;
    readonly active: number;
    readonly averageProgress: number;
    readonly items: readonly ClientProjectItem[];
  } | null;
  readonly milestones: {
    readonly total: number;
    readonly reached: number;
    readonly overdue: number;
    readonly byStatus: readonly StatusCount[];
  } | null;
  readonly invoices: {
    readonly open: AmountSection;
    readonly overdue: AmountSection;
    readonly paid: AmountSection;
    readonly items: readonly ClientInvoiceItem[];
  } | null;
  readonly quotes: {
    readonly total: number;
    readonly pending: number;
    readonly accepted: number;
    readonly byStatus: readonly StatusCount[];
  } | null;
  readonly documents: {
    readonly total: number;
    readonly items: readonly ClientDocumentItem[];
  } | null;
  readonly notifications: { readonly unread: number } | null;
}

// -----------------------------------------------------------------------------
// Lecture des lignes
// -----------------------------------------------------------------------------

interface UpcomingTaskRow {
  id: string;
  title: string;
  dueDate: Date | null;
  priority: string;
  status: string;
  project: { name: string } | null;
  assignee: { firstName: string; lastName: string } | null;
}

function toUpcomingTask(row: UpcomingTaskRow): UpcomingTask {
  return {
    id: row.id,
    title: row.title,
    dueDate: row.dueDate === null ? null : row.dueDate.toISOString(),
    priority: row.priority,
    status: row.status,
    projectName: row.project?.name ?? null,
    assigneeName:
      row.assignee === null ? null : `${row.assignee.firstName} ${row.assignee.lastName}`.trim(),
  };
}

/** Somme des compteurs d'un `groupBy` par statut. */
function totalOf(counts: readonly StatusCount[]): number {
  return counts.reduce((sum, row) => sum + row.count, 0);
}

/** Somme des statuts qui ne sont PAS dans la liste donnee. */
function totalExcluding(counts: readonly StatusCount[], excluded: readonly string[]): number {
  return counts
    .filter((row) => !excluded.includes(row.status))
    .reduce((sum, row) => sum + row.count, 0);
}

/** Somme des statuts qui SONT dans la liste donnee. */
function totalIncluding(counts: readonly StatusCount[], included: readonly string[]): number {
  return counts
    .filter((row) => included.includes(row.status))
    .reduce((sum, row) => sum + row.count, 0);
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Vue d'agence
  // ---------------------------------------------------------------------------

  /**
   * Vue interne complete. Reservee aux comptes de l'agence.
   *
   * Un porteur de l'espace client qui appellerait cette route est refuse, et
   * c'est `resolvePerimeter` qui le refuse — pas un `if` ajoute ici. La regle
   * vit a un seul endroit, et elle est testee.
   */
  async agency(
    user: AuthenticatedUser,
    query: AgencyDashboardQueryDto,
  ): Promise<AgencyDashboard> {
    this.requirePerimeter(user, 'agency');

    const now = new Date();
    const bounds = resolvePeriod({ preset: query.preset }, now);
    const window = withinPeriod(bounds);

    const alive = { deletedAt: null };
    const tasksAlive = { deletedAt: null, project: { deletedAt: null } };
    const openInvoices = { deletedAt: null, status: { in: [...OPEN_INVOICE_STATUSES] } };
    // Encaissements reels : un paiement REUSSI, date d'encaissement dans la
    // periode, sur une facture non supprimee. Ni les paiements en attente, ni
    // les echoues, ni les rembourses n'y entrent.
    const collected = {
      deletedAt: null,
      status: PaymentStatus.SUCCEEDED,
      paidAt: window,
    };

    const [
      prospectsByStatus,
      prospectsCreated,
      projectsByStatus,
      projectsByHealth,
      projectsCreated,
      projectsOverdue,
      projectAverage,
      tasksByStatus,
      tasksOverdue,
      invoicesOpen,
      invoicesOverdue,
      invoicesIssued,
      collectedByCurrency,
      collectedByMethod,
      upcomingTaskRows,
      upcomingInvoiceRows,
    ] = await Promise.all([
      this.prisma.prospect.groupBy({ by: ['status'], where: alive, _count: { _all: true } }),
      this.prisma.prospect.count({ where: { ...alive, createdAt: window } }),
      this.prisma.project.groupBy({ by: ['status'], where: alive, _count: { _all: true } }),
      this.prisma.project.groupBy({ by: ['health'], where: alive, _count: { _all: true } }),
      this.prisma.project.count({ where: { ...alive, createdAt: window } }),
      this.prisma.project.count({
        where: {
          ...alive,
          dueDate: { lt: now },
          status: { notIn: [...CLOSED_PROJECT_STATUSES] },
        },
      }),
      this.prisma.project.aggregate({ where: alive, _avg: { progressPercent: true } }),
      this.prisma.task.groupBy({ by: ['status'], where: tasksAlive, _count: { _all: true } }),
      this.prisma.task.count({
        where: {
          ...tasksAlive,
          status: { in: [...OPEN_TASK_STATUSES] },
          dueDate: { lt: now },
        },
      }),
      this.prisma.invoice.groupBy({
        by: ['currency'],
        where: openInvoices,
        _sum: { total: true, amountPaid: true },
        _count: { _all: true },
      }),
      this.prisma.invoice.groupBy({
        by: ['currency'],
        where: { ...openInvoices, dueDate: { lt: now } },
        _sum: { total: true, amountPaid: true },
        _count: { _all: true },
      }),
      this.prisma.invoice.groupBy({
        by: ['currency'],
        where: {
          deletedAt: null,
          status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED] },
          issueDate: window,
        },
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.prisma.payment.groupBy({
        by: ['currency'],
        where: collected,
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.payment.groupBy({
        by: ['method', 'currency'],
        where: collected,
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.task.findMany({
        where: {
          ...tasksAlive,
          status: { in: [...OPEN_TASK_STATUSES] },
          dueDate: { gte: now },
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          priority: true,
          status: true,
          project: { select: { name: true } },
          assignee: { select: { firstName: true, lastName: true } },
        },
        // `id` en second critere : deux taches a la meme echeance doivent sortir
        // dans le meme ordre a chaque appel, sinon la liste « bouge » toute
        // seule d'un rafraichissement a l'autre.
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        take: HIGHLIGHT_LIMIT,
      }),
      this.prisma.invoice.findMany({
        where: { ...openInvoices, dueDate: { gte: now } },
        select: {
          id: true,
          reference: true,
          dueDate: true,
          status: true,
          currency: true,
          total: true,
          amountPaid: true,
          client: { select: { companyName: true } },
        },
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        take: HIGHLIGHT_LIMIT,
      }),
    ]);

    const prospectStatusCounts: StatusCount[] = prospectsByStatus.map((row) => ({
      status: row.status,
      count: groupCount(row),
    }));

    const projectStatusCounts: StatusCount[] = projectsByStatus.map((row) => ({
      status: row.status,
      count: groupCount(row),
    }));

    const taskStatusCounts: StatusCount[] = tasksByStatus.map((row) => ({
      status: row.status,
      count: groupCount(row),
    }));

    const collectedTotals = collectedSection(collectedByCurrency, collectedByMethod);

    const issuedInPeriod = amountSection(
      invoicesIssued.map((row) => ({
        currency: row.currency,
        total: row._sum.total,
        count: groupCount(row),
      })),
    );

    return {
      asOf: now.toISOString(),
      period: serializePeriod(bounds),
      prospects: {
        total: totalOf(prospectStatusCounts),
        open: totalExcluding(prospectStatusCounts, CLOSED_LEAD_STATUSES),
        createdInPeriod: prospectsCreated,
        byStatus: prospectStatusCounts,
      },
      projects: {
        total: totalOf(projectStatusCounts),
        active: totalExcluding(projectStatusCounts, CLOSED_PROJECT_STATUSES),
        overdue: projectsOverdue,
        createdInPeriod: projectsCreated,
        averageProgress: Math.round(countOf(projectAverage._avg.progressPercent)),
        byStatus: projectStatusCounts,
        byHealth: projectsByHealth.map((row) => ({ status: row.health, count: groupCount(row) })),
      },
      tasks: {
        total: totalOf(taskStatusCounts),
        open: totalIncluding(taskStatusCounts, OPEN_TASK_STATUSES),
        overdue: tasksOverdue,
      },
      invoices: {
        open: outstandingSection(invoicesOpen),
        overdue: outstandingSection(invoicesOverdue),
        issuedInPeriod,
      },
      collected: collectedTotals,
      // Rapport encaisse / facture sur la periode. Zero quand rien n'a ete
      // facture, jamais une division par zero.
      collectionRate: ratioOf(collectedTotals.total, issuedInPeriod.total),
      upcoming: {
        tasks: upcomingTaskRows.map(toUpcomingTask),
        invoices: upcomingInvoiceRows.map((row) => ({
          id: row.id,
          reference: row.reference,
          dueDate: row.dueDate === null ? null : row.dueDate.toISOString(),
          status: row.status,
          currency: row.currency,
          outstanding: amountString(outstandingBetween(row.total, row.amountPaid)),
          clientName: row.client?.companyName ?? null,
        })),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Vue personnelle
  // ---------------------------------------------------------------------------

  /**
   * Vue personnelle : mes taches, mes echeances, mes notifications.
   *
   * Ouverte a l'equipe COMME a un porteur de l'espace client — le catalogue
   * donne `dashboard:read:own` aux deux. C'est pourquoi les sections se deduisent
   * des DROITS et non du role : un client n'a aucune permission `task:*`, donc sa
   * vue personnelle se reduit a ses notifications, et aucun ecran ne peut lui
   * faire afficher une tache interne.
   *
   * Toutes les requetes filtrent sur `policy.userId`, y compris quand le porteur
   * detient un scope plus large : « mon tableau de bord » veut dire le mien.
   */
  async me(user: AuthenticatedUser): Promise<PersonalDashboard> {
    const policy = new AccessPolicy(user);
    policy.requireScope('dashboard', 'read', [SCOPE_ANY, SCOPE_OWN]);

    const sections = personalSectionsFor((code) => policy.has(code));
    const now = new Date();

    const [tasks, upcoming, timeEntries, notifications] = await Promise.all([
      sections.tasks ? this.personalTasks(policy.userId, now) : null,
      sections.tasks ? this.personalUpcoming(policy.userId, now) : null,
      sections.timeEntries ? this.personalTime(policy.userId, now) : null,
      sections.notifications ? this.personalNotifications(policy.userId) : null,
    ]);

    return { asOf: now.toISOString(), sections, tasks, upcoming, timeEntries, notifications };
  }

  private async personalTasks(userId: string, now: Date): Promise<PersonalDashboard['tasks']> {
    // « Mes taches » = celles qui me sont assignees. Le catalogue distingue
    // `task:read:own` de `task:read:assigned`, mais la reponse a la question
    // « qu'est-ce que je dois faire » est la meme dans les deux cas.
    const where = { deletedAt: null, project: { deletedAt: null }, assigneeId: userId };

    const [byStatus, overdue] = await Promise.all([
      this.prisma.task.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.task.count({
        where: { ...where, status: { in: [...OPEN_TASK_STATUSES] }, dueDate: { lt: now } },
      }),
    ]);

    const statusCounts: StatusCount[] = byStatus.map((row) => ({
      status: row.status,
      count: groupCount(row),
    }));

    return {
      total: totalOf(statusCounts),
      open: totalIncluding(statusCounts, OPEN_TASK_STATUSES),
      overdue,
      byStatus: statusCounts,
    };
  }

  private async personalUpcoming(userId: string, now: Date): Promise<UpcomingTask[]> {
    const rows = await this.prisma.task.findMany({
      where: {
        deletedAt: null,
        project: { deletedAt: null },
        assigneeId: userId,
        status: { in: [...OPEN_TASK_STATUSES] },
        dueDate: { gte: now },
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
        priority: true,
        status: true,
        project: { select: { name: true } },
        assignee: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      take: HIGHLIGHT_LIMIT,
    });

    return rows.map(toUpcomingTask);
  }

  private async personalTime(userId: string, now: Date): Promise<PersonalDashboard['timeEntries']> {
    const today = withinPeriod(resolvePeriod({ preset: 'TODAY' }, now));
    const month = withinPeriod(resolvePeriod({ preset: 'THIS_MONTH' }, now));

    // Le temps saisi sur un projet supprime logiquement est exclu, comme dans le
    // rapport de temps passe : les deux vues doivent compter les memes heures.
    const [todayTotals, monthTotals] = await Promise.all([
      this.prisma.timeEntry.aggregate({
        where: { userId, spentOn: today, project: { deletedAt: null } },
        _sum: { minutes: true },
      }),
      this.prisma.timeEntry.aggregate({
        where: { userId, spentOn: month, project: { deletedAt: null } },
        _sum: { minutes: true },
        _count: { _all: true },
      }),
    ]);

    return {
      todayMinutes: countOf(todayTotals._sum.minutes),
      monthMinutes: countOf(monthTotals._sum.minutes),
      monthEntries: countOf(monthTotals._count._all),
    };
  }

  private async personalNotifications(
    userId: string,
  ): Promise<PersonalDashboard['notifications']> {
    const [unread, recent] = await Promise.all([
      this.prisma.notification.count({ where: { userId, readAt: null } }),
      this.prisma.notification.findMany({
        where: { userId, readAt: null },
        select: { id: true, type: true, title: true, link: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: HIGHLIGHT_LIMIT,
      }),
    ]);

    return {
      unread,
      recent: recent.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        link: row.link,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Espace client
  // ---------------------------------------------------------------------------

  /**
   * Espace client : SES projets, SES factures, SES documents.
   *
   * Le perimetre est `policy.clientId`, lu sur le compte, et il n'existe aucun
   * chemin par lequel un identifiant de requete pourrait le remplacer : le DTO
   * est vide, donc tout parametre est refuse en 400 avant d'arriver ici.
   *
   * Un compte interne est refuse sur cette route, et un compte client dont la
   * fiche est introuvable ou supprimee aussi — on ne degrade jamais vers un
   * perimetre plus large.
   */
  async client(user: AuthenticatedUser): Promise<ClientDashboard> {
    const policy = new AccessPolicy(user);
    const clientId = policy.clientId;

    const perimeter = resolvePerimeter({
      isClient: policy.isClient(),
      clientId,
      hasAgencyScope: policy.has(DASHBOARD_READ_ANY),
      hasOwnScope: policy.has(DASHBOARD_READ_OWN),
    });

    // Une seule condition de refus, et elle couvre les deux cas : pas un espace
    // client, ou pas de fiche client. Le `clientId === null` est redondant avec
    // `resolvePerimeter`, mais c'est lui qui garantit au compilateur que
    // l'identifiant n'est pas nul ensuite — et un garde redondant sur un
    // perimetre n'est jamais du code mort.
    if (perimeter !== 'client' || clientId === null) {
      throw AppException.forbidden('Espace client reserve aux comptes clients.');
    }

    const sections = clientSectionsFor((code) => policy.has(code));
    const now = new Date();

    const [clientRow, projects, milestones, invoices, quotes, documents, unread] =
      await Promise.all([
        this.prisma.client.findFirst({
          where: { id: clientId, deletedAt: null },
          select: { id: true, reference: true, companyName: true },
        }),
        sections.projects ? this.clientProjects(clientId) : null,
        sections.projects ? this.clientMilestones(clientId, now) : null,
        sections.invoices ? this.clientInvoices(clientId, now) : null,
        sections.quotes ? this.clientQuotes(clientId) : null,
        sections.documents ? this.clientDocuments(clientId) : null,
        sections.notifications
          ? this.prisma.notification.count({ where: { userId: policy.userId, readAt: null } })
          : null,
      ]);

    if (clientRow === null) {
      // Fiche supprimee ou desactivee : l'acces est retire, il n'est pas
      // transforme en acces plus large.
      throw AppException.forbidden('Fiche client introuvable ou inactive.');
    }

    return {
      asOf: now.toISOString(),
      client: clientRow,
      sections,
      projects,
      milestones,
      invoices,
      quotes,
      documents,
      notifications: unread === null ? null : { unread },
    };
  }

  private async clientProjects(clientId: string): Promise<ClientDashboard['projects']> {
    const where = { clientId, deletedAt: null };

    const [byStatus, average, rows] = await Promise.all([
      this.prisma.project.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.project.aggregate({ where, _avg: { progressPercent: true } }),
      this.prisma.project.findMany({
        where,
        // `health` n'est PAS expose : c'est un signal de pilotage interne
        // (« hors trajectoire »), qui n'a pas sa place dans un espace client.
        select: {
          id: true,
          reference: true,
          name: true,
          status: true,
          progressPercent: true,
          dueDate: true,
        },
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { reference: 'asc' }],
        take: CLIENT_ITEM_LIMIT,
      }),
    ]);

    const statusCounts: StatusCount[] = byStatus.map((row) => ({
      status: row.status,
      count: groupCount(row),
    }));

    return {
      total: totalOf(statusCounts),
      active: totalExcluding(statusCounts, CLOSED_PROJECT_STATUSES),
      averageProgress: Math.round(countOf(average._avg.progressPercent)),
      items: rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        name: row.name,
        status: row.status,
        progressPercent: row.progressPercent,
        dueDate: row.dueDate === null ? null : row.dueDate.toISOString(),
      })),
    };
  }

  private async clientMilestones(
    clientId: string,
    now: Date,
  ): Promise<ClientDashboard['milestones']> {
    // Les jalons n'ont pas de `deletedAt` : leur sort est celui de leur projet.
    const where = { project: { clientId, deletedAt: null } };

    const [byStatus, total, overdue] = await Promise.all([
      this.prisma.milestone.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.milestone.count({ where }),
      this.prisma.milestone.count({
        where: {
          ...where,
          status: { in: [MilestoneStatus.PENDING, MilestoneStatus.IN_PROGRESS] },
          dueDate: { lt: now },
        },
      }),
    ]);

    const statusCounts: StatusCount[] = byStatus.map((row) => ({
      status: row.status,
      count: groupCount(row),
    }));

    return {
      total,
      reached: totalIncluding(statusCounts, [MilestoneStatus.REACHED]),
      overdue,
      byStatus: statusCounts,
    };
  }

  private async clientInvoices(
    clientId: string,
    now: Date,
  ): Promise<ClientDashboard['invoices']> {
    const alive = { clientId, deletedAt: null };
    const open = { ...alive, status: { in: [...OPEN_INVOICE_STATUSES] } };

    const [openRows, overdueRows, paidRows, rows] = await Promise.all([
      this.prisma.invoice.groupBy({
        by: ['currency'],
        where: open,
        _sum: { total: true, amountPaid: true },
        _count: { _all: true },
      }),
      this.prisma.invoice.groupBy({
        by: ['currency'],
        where: { ...open, dueDate: { lt: now } },
        _sum: { total: true, amountPaid: true },
        _count: { _all: true },
      }),
      this.prisma.invoice.groupBy({
        by: ['currency'],
        where: { ...alive, status: InvoiceStatus.PAID },
        // Regroupe sur ce qui a ete REELLEMENT paye : pour un client, « deja
        // regle » est un encaissement, pas un montant facture.
        _sum: { amountPaid: true },
        _count: { _all: true },
      }),
      this.prisma.invoice.findMany({
        where: open,
        select: {
          id: true,
          reference: true,
          status: true,
          currency: true,
          total: true,
          amountPaid: true,
          issueDate: true,
          dueDate: true,
        },
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        take: CLIENT_ITEM_LIMIT,
      }),
    ]);

    return {
      open: outstandingSection(openRows),
      overdue: outstandingSection(overdueRows),
      paid: amountSection(
        paidRows.map((row) => ({
          currency: row.currency,
          total: row._sum.amountPaid,
          count: groupCount(row),
        })),
      ),
      items: rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        status: row.status,
        currency: row.currency,
        total: amountString(row.total),
        outstanding: amountString(outstandingBetween(row.total, row.amountPaid)),
        issueDate: row.issueDate.toISOString(),
        dueDate: row.dueDate.toISOString(),
      })),
    };
  }

  private async clientQuotes(clientId: string): Promise<ClientDashboard['quotes']> {
    const where = { clientId, deletedAt: null };

    const [byStatus, total] = await Promise.all([
      this.prisma.quote.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.quote.count({ where }),
    ]);

    const statusCounts: StatusCount[] = byStatus.map((row) => ({
      status: row.status,
      count: groupCount(row),
    }));

    return {
      total,
      // « En attente » = envoye ou consulte, c'est-a-dire une decision qui
      // appartient au client. Brouillons et devis annules ne l'attendent pas.
      pending: totalIncluding(statusCounts, [QuoteStatus.SENT, QuoteStatus.VIEWED]),
      accepted: totalIncluding(statusCounts, [QuoteStatus.ACCEPTED]),
      byStatus: statusCounts,
    };
  }

  private async clientDocuments(clientId: string): Promise<ClientDashboard['documents']> {
    /**
     * DEUX BARRIERES, et les deux sont necessaires.
     *
     *  - la visibilite en base : un document `INTERNAL` ne sort jamais, quel que
     *    soit son rattachement ;
     *  - le rattachement : le document appartient au client, ou a l'un de ses
     *    projets. Le rattachement par projet est cherche cote PROJET, ce qui
     *    couvre un document depose sur le projet sans `clientId` renseigne.
     */
    const where = {
      deletedAt: null,
      visibility: { not: DocumentVisibility.INTERNAL },
      OR: [{ clientId }, { project: { clientId, deletedAt: null } }],
    };

    const [total, rows] = await Promise.all([
      this.prisma.document.count({ where }),
      this.prisma.document.findMany({
        where,
        select: {
          id: true,
          name: true,
          category: true,
          visibility: true,
          sizeBytes: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: CLIENT_ITEM_LIMIT,
      }),
    ]);

    return {
      total,
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        visibility: row.visibility,
        sizeBytes: row.sizeBytes,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Perimetre
  // ---------------------------------------------------------------------------

  /**
   * Verifie que le porteur a bien la vue demandee, et refuse sinon.
   *
   * Le controle est refait ici alors que le garde de la route a deja verifie la
   * permission : le garde autorise une URL, il ne dit rien de l'espace auquel le
   * porteur appartient. Un compte client a qui l'on aurait accorde
   * `dashboard:read:any` par erreur passerait le garde et serait arrete ici.
   */
  private requirePerimeter(user: AuthenticatedUser, expected: DashboardPerimeter): void {
    const policy = new AccessPolicy(user);

    const perimeter = resolvePerimeter({
      isClient: policy.isClient(),
      clientId: policy.clientId,
      hasAgencyScope: policy.has(DASHBOARD_READ_ANY),
      hasOwnScope: policy.has(DASHBOARD_READ_OWN),
    });

    if (perimeter !== expected) {
      throw AppException.forbidden('Cette vue ne correspond pas a votre espace.');
    }
  }
}
