import { AppException } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  DocumentVisibility,
  InvoiceStatus,
  MilestoneStatus,
  ProjectHealth,
  ProjectStatus,
  TaskStatus,
} from '../../generated/prisma/enums.js';
import type { ReportType } from '../../generated/prisma/enums.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { serializePeriod, withinPeriod, type PeriodBounds } from './report-period.js';
import {
  amountSection,
  amountString,
  countOf,
  decimalOf,
  ratioOf,
  shareOf,
  type AmountSection,
  type CollectedSection,
  type MethodAmount,
  type SourceCount,
  type StatusCount,
} from './report-metrics.js';
import type {
  ActivityEntry,
  ActivityReportResult,
  CommercialPipelineResult,
  MilestoneSummary,
  OutstandingInvoicesResult,
  ProjectMinutes,
  ProjectProgressResult,
  ProjectSummary,
  ReportResult,
  RevenueResult,
  TasksResult,
  TimeSpentResult,
  UserMinutes,
} from './report-snapshot.js';

/**
 * CONSTRUCTION DES INSTANTANES.
 *
 * Ce fichier lit les tables des autres domaines en LECTURE SEULE, directement
 * via `PrismaService`. Il n'importe aucun de leurs services : ces modules sont
 * ecrits en parallele, et un rapport ne peut pas attendre qu'ils existent. Ce
 * qui veut dire aussi que leurs tables peuvent etre VIDES — chaque agregat doit
 * donc produire des zeros propres, ce que garantit `report-metrics.ts`.
 *
 * TROIS REGLES APPLIQUEES PARTOUT.
 *
 * 1. `deletedAt: null` partout ou le modele en a un, ET sur les relations
 *    remontees. Un projet supprime qui continuerait de compter dans les projets
 *    actifs rendrait le tableau de bord faux. Une tache dont le projet est
 *    supprime ne compte pas non plus : elle n'est plus dans aucun projet.
 *
 * 2. AUCUN CHARGEMENT DE TABLE ENTIERE. `count`, `groupBy`, `aggregate`, et des
 *    `findMany` systematiquement bornes par `take` avec un `select` restreint.
 *    Un tableau de bord qui charge toute la table marche en developpement et
 *    tombe en production, au moment ou il y a justement quelque chose a lire.
 *
 * 3. LE PERIMETRE EST DANS LA REQUETE, jamais applique apres coup en memoire.
 */

/** Periode resolue + cible eventuelle. Ce que la generation a besoin de savoir. */
export interface ResolvedReportRequest {
  readonly type: ReportType;
  readonly bounds: PeriodBounds;
  readonly projectId: string | null;
  readonly now: Date;
}

/**
 * Statuts de tache qui comptent encore dans la charge.
 *
 * Exporte : le tableau de bord doit compter les memes taches que le rapport.
 * Deux definitions de « tache ouverte » finiraient par diverger, et le dirigeant
 * verrait deux nombres differents pour la meme chose le meme jour.
 */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = [
  TaskStatus.TODO,
  TaskStatus.IN_PROGRESS,
  TaskStatus.BLOCKED,
  TaskStatus.IN_REVIEW,
];

/**
 * Etats TERMINAUX d'un projet, et c'est la seule ligne que l'on trace.
 *
 * Un projet est « actif » tant qu'il n'est pas clos — brouillon et en attente
 * compris : il occupe encore le portefeuille, meme s'il n'avance pas. Definir
 * l'activite par « travail en cours » ferait disparaitre du tableau de bord un
 * projet en attente depuis trois mois, c'est-a-dire exactement celui qu'il faut
 * voir.
 */
export const CLOSED_PROJECT_STATUSES: readonly ProjectStatus[] = [
  ProjectStatus.COMPLETED,
  ProjectStatus.CANCELLED,
  ProjectStatus.ARCHIVED,
];

/**
 * Factures qui representent encore de l'argent attendu.
 *
 * `PARTIALLY_PAID` en fait partie : il reste un solde a encaisser. `DRAFT` et
 * `CANCELLED` non — rien n'a ete reclame. `REFUNDED` non plus : l'argent est
 * reparti.
 */
export const OPEN_INVOICE_STATUSES: readonly InvoiceStatus[] = [
  InvoiceStatus.SENT,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.OVERDUE,
];

/**
 * Affaires tranchees. Tout le reste est encore en negociation.
 *
 * Exporte : le tableau de bord d'agence compte les memes prospects ouverts. Un
 * prospect gagne qui compterait encore dans le pipeline fausserait la relance
 * commerciale.
 */
export const CLOSED_LEAD_STATUSES: readonly string[] = ['WON', 'LOST'];

/** Delai, en jours, a partir duquel une echeance est « proche ». */
export const DUE_SOON_DAYS = 30;

/** Plafond des listes detaillees incluses dans un instantane. */
const DETAIL_LIMIT = 20;

const MS_PER_DAY = 86_400_000;

// -----------------------------------------------------------------------------
// Petits utilitaires de lecture d'agregat
// -----------------------------------------------------------------------------

/**
 * Compteur d'un `groupBy`. Absent ou non numerique vaut zero, jamais `NaN`.
 *
 * Exporte : le tableau de bord lit les memes agregats et doit les lire de la
 * meme facon.
 */
export function groupCount(row: { _count?: { _all?: number | null } | null }): number {
  return countOf(row._count?._all ?? null);
}

/**
 * Encours = facture moins deja paye.
 *
 * Un encours negatif n'a pas de sens comptable : il signalerait une facture
 * partiellement payee dont le cumul depasse le total. Le cas est ramene a zero
 * plutot que propage, car un montant negatif affiche ferait croire a un avoir.
 */
export function outstandingBetween(
  total: Prisma.Decimal | null | undefined,
  paid: Prisma.Decimal | null | undefined,
): Prisma.Decimal {
  const difference = decimalOf(total).minus(decimalOf(paid));
  return difference.isNegative() ? decimalOf(0) : difference;
}

/** Ligne de `groupBy` de factures, telle que Prisma la rend. */
export interface InvoiceDeltaRow {
  readonly currency: string;
  readonly _sum?: { total?: Prisma.Decimal | null; amountPaid?: Prisma.Decimal | null } | null;
  readonly _count?: { _all?: number | null } | null;
}

/**
 * Encours par devise : facture moins encaisse.
 *
 * Exporte, et c'est deliberé : le tableau de bord d'agence affiche le meme
 * encours que le rapport. Deux calculs distincts du « reste a encaisser »
 * finiraient par donner deux chiffres pour la meme question, le meme jour, dans
 * la meme application.
 *
 * L'ecart est calcule PAR DEVISE : additionner un encours en dollars et un
 * encours en euros donnerait un nombre qui ne correspond a rien.
 */
export function outstandingSection(rows: readonly InvoiceDeltaRow[]): AmountSection {
  return amountSection(
    rows.map((row) => ({
      currency: row.currency,
      total: outstandingBetween(row._sum?.total ?? null, row._sum?.amountPaid ?? null),
      count: countOf(row._count?._all ?? null),
    })),
  );
}

/** Ligne de `groupBy` de paiements, par devise. */
export interface PaymentCurrencyRow {
  readonly currency: string;
  readonly _sum?: { amount?: Prisma.Decimal | null } | null;
  readonly _count?: { _all?: number | null } | null;
}

/** Ligne de `groupBy` de paiements, par moyen et par devise. */
export interface PaymentMethodRow extends PaymentCurrencyRow {
  readonly method: string;
}

/**
 * Encaissements d'une periode : total par devise, puis detail par moyen.
 *
 * Exporte pour la meme raison que l'encours : le tableau de bord d'agence et le
 * rapport de revenus doivent afficher le MEME chiffre d'affaires. Une seule
 * definition, ici.
 */
export function collectedSection(
  byCurrency: readonly PaymentCurrencyRow[],
  byMethod: readonly PaymentMethodRow[],
): CollectedSection {
  const methodAmounts: MethodAmount[] = byMethod.map((row) => ({
    method: row.method,
    currency: row.currency,
    total: amountString(row._sum?.amount ?? null),
    count: countOf(row._count?._all ?? null),
  }));

  return {
    ...amountSection(
      byCurrency.map((row) => ({
        currency: row.currency,
        total: row._sum?.amount ?? null,
        count: countOf(row._count?._all ?? null),
      })),
    ),
    // Ordre stable : deux lectures de la meme periode doivent rendre la meme
    // liste dans le meme ordre.
    byMethod: [...methodAmounts].sort(
      (left, right) =>
        left.method.localeCompare(right.method) || left.currency.localeCompare(right.currency),
    ),
  };
}

function baseOf<TType extends ReportType>(
  type: TType,
  request: ResolvedReportRequest,
): { type: TType; periodStart: string; periodEnd: string; asOf: string } {
  const period = serializePeriod(request.bounds);

  return {
    type,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    asOf: request.now.toISOString(),
  };
}

/** Filtre de projet : rien pour un rapport d'agence, le projet vise sinon. */
function projectScope(request: ResolvedReportRequest): { projectId?: string } {
  return request.projectId === null ? {} : { projectId: request.projectId };
}

function nameIndex(
  rows: readonly { id: string; firstName: string; lastName: string }[],
): Map<string, string> {
  const index = new Map<string, string>();
  for (const row of rows) {
    index.set(row.id, `${row.firstName} ${row.lastName}`.trim());
  }
  return index;
}

// -----------------------------------------------------------------------------
// Pipeline commercial
// -----------------------------------------------------------------------------

async function buildCommercialPipeline(
  prisma: PrismaService,
  request: ResolvedReportRequest,
): Promise<CommercialPipelineResult> {
  const window = withinPeriod(request.bounds);
  const alive = { deletedAt: null } as const;

  const [byStatus, created, bySource, won, lost] = await Promise.all([
    prisma.prospect.groupBy({ by: ['status'], where: alive, _count: { _all: true } }),
    prisma.prospect.count({ where: { ...alive, createdAt: window } }),
    prisma.prospect.groupBy({
      by: ['source'],
      where: { ...alive, createdAt: window },
      _count: { _all: true },
    }),
    // Le passage a WON est lu dans l'HISTORIQUE et non dans le statut courant :
    // un prospect gagne en mars puis perdu en juin doit compter une fois dans
    // chaque periode, sinon le pipeline passe d'un mois sur l'autre sans qu'on
    // sache pourquoi.
    prisma.leadStatusHistory.count({
      where: { toStatus: 'WON', createdAt: window, prospect: alive },
    }),
    prisma.leadStatusHistory.count({
      where: { toStatus: 'LOST', createdAt: window, prospect: alive },
    }),
  ]);

  const prospectsByStatus: StatusCount[] = byStatus.map((row) => ({
    status: row.status,
    count: groupCount(row),
  }));

  const bySourceInPeriod: SourceCount[] = bySource.map((row) => ({
    source: row.source,
    count: groupCount(row),
  }));

  const total = prospectsByStatus.reduce((sum, row) => sum + row.count, 0);
  // Ce qui n'est ni gagne ni perdu est encore en jeu : c'est ce nombre-la que
  // l'on met en avant, pas le total du fichier.
  const open = prospectsByStatus
    .filter((row) => !CLOSED_LEAD_STATUSES.includes(row.status))
    .reduce((sum, row) => sum + row.count, 0);

  return {
    ...baseOf('COMMERCIAL_PIPELINE', request),
    prospectsByStatus,
    prospectsTotal: total,
    prospectsOpen: open,
    createdInPeriod: created,
    bySourceInPeriod,
    wonInPeriod: won,
    lostInPeriod: lost,
    // Taux de conversion sur les affaires TRANCHÉES : un prospect encore en
    // negociation n'est ni gagne ni perdu, l'inclure au denominateur ferait
    // baisser le taux a mesure que le pipeline se remplit.
    conversionRate: ratioOf(String(won), String(won + lost)),
  };
}

// -----------------------------------------------------------------------------
// Revenus
// -----------------------------------------------------------------------------

async function buildRevenue(
  prisma: PrismaService,
  request: ResolvedReportRequest,
): Promise<RevenueResult> {
  const window = withinPeriod(request.bounds);

  // LE FILTRE QUI COMPTE : paiement ENCAISSE (`SUCCEEDED`), non supprime, dont
  // la date d'encaissement tombe dans la periode. Ni les factures emises, ni
  // les devis acceptes, ni les paiements en attente ou rembourses.
  const collectedWhere = {
    deletedAt: null,
    status: 'SUCCEEDED',
    paidAt: window,
  } as const;

  const [collectedByCurrency, collectedByMethod, billedByCurrency] = await Promise.all([
    prisma.payment.groupBy({
      by: ['currency'],
      where: collectedWhere,
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.payment.groupBy({
      by: ['method', 'currency'],
      where: collectedWhere,
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.invoice.groupBy({
      by: ['currency'],
      where: {
        deletedAt: null,
        // Brouillons et annulees ne sont pas de la facturation emise.
        status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED] },
        issueDate: window,
      },
      _sum: { total: true },
      _count: { _all: true },
    }),
  ]);

  const collected = collectedSection(collectedByCurrency, collectedByMethod);

  const billed = amountSection(
    billedByCurrency.map((row) => ({
      currency: row.currency,
      total: row._sum.total,
      count: groupCount(row),
    })),
  );

  return {
    ...baseOf('REVENUE', request),
    collected,
    billed,
    collectionRate: ratioOf(collected.total, billed.total),
  };
}

// -----------------------------------------------------------------------------
// Encours
// -----------------------------------------------------------------------------

async function buildOutstandingInvoices(
  prisma: PrismaService,
  request: ResolvedReportRequest,
): Promise<OutstandingInvoicesResult> {
  const window = withinPeriod(request.bounds);
  const dueSoonEnd = new Date(request.now.getTime() + DUE_SOON_DAYS * MS_PER_DAY);

  const openInvoice = {
    deletedAt: null,
    status: { in: [...OPEN_INVOICE_STATUSES] },
  };

  const [issued, open, overdue, dueSoon] = await Promise.all([
    prisma.invoice.groupBy({
      by: ['currency'],
      where: { ...openInvoice, issueDate: window },
      _sum: { total: true, amountPaid: true },
      _count: { _all: true },
    }),
    prisma.invoice.groupBy({
      by: ['currency'],
      where: openInvoice,
      _sum: { total: true, amountPaid: true },
      _count: { _all: true },
    }),
    prisma.invoice.groupBy({
      by: ['currency'],
      where: { ...openInvoice, dueDate: { lt: request.now } },
      _sum: { total: true, amountPaid: true },
      _count: { _all: true },
    }),
    prisma.invoice.groupBy({
      by: ['currency'],
      where: { ...openInvoice, dueDate: { gte: request.now, lte: dueSoonEnd } },
      _sum: { total: true, amountPaid: true },
      _count: { _all: true },
    }),
  ]);

  return {
    ...baseOf('OUTSTANDING_INVOICES', request),
    issuedInPeriod: outstandingSection(issued),
    totalOpen: outstandingSection(open),
    overdue: outstandingSection(overdue),
    dueSoon: outstandingSection(dueSoon),
    dueSoonDays: DUE_SOON_DAYS,
  };
}

// -----------------------------------------------------------------------------
// Taches
// -----------------------------------------------------------------------------

async function buildTasks(
  prisma: PrismaService,
  request: ResolvedReportRequest,
): Promise<TasksResult> {
  const window = withinPeriod(request.bounds);

  // Une tache dont le projet est supprime logiquement ne compte plus : elle
  // n'appartient plus a aucun projet actif.
  const tasksWhere = {
    deletedAt: null,
    project: { deletedAt: null },
    ...projectScope(request),
  };

  const [byStatus, byPriority, total, created, completed, overdue] = await Promise.all([
    prisma.task.groupBy({ by: ['status'], where: tasksWhere, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['priority'], where: tasksWhere, _count: { _all: true } }),
    prisma.task.count({ where: tasksWhere }),
    prisma.task.count({ where: { ...tasksWhere, createdAt: window } }),
    prisma.task.count({ where: { ...tasksWhere, completedAt: window } }),
    prisma.task.count({
      where: {
        ...tasksWhere,
        status: { in: [...OPEN_TASK_STATUSES] },
        dueDate: { lt: request.now },
      },
    }),
  ]);

  const statusCounts: StatusCount[] = byStatus.map((row) => ({
    status: row.status,
    count: groupCount(row),
  }));

  const open = statusCounts
    .filter((row) => (OPEN_TASK_STATUSES as readonly string[]).includes(row.status))
    .reduce((sum, row) => sum + row.count, 0);

  return {
    ...baseOf('TASKS', request),
    projectId: request.projectId,
    byStatus: statusCounts,
    byPriority: byPriority.map((row) => ({ status: row.priority, count: groupCount(row) })),
    total,
    open,
    overdue,
    createdInPeriod: created,
    completedInPeriod: completed,
  };
}

// -----------------------------------------------------------------------------
// Temps passe
// -----------------------------------------------------------------------------

async function buildTimeSpent(
  prisma: PrismaService,
  request: ResolvedReportRequest,
): Promise<TimeSpentResult> {
  const where = {
    spentOn: withinPeriod(request.bounds),
    project: { deletedAt: null },
    ...projectScope(request),
  };

  const [totals, byBillable, byUserRows, byProjectRows] = await Promise.all([
    prisma.timeEntry.aggregate({ where, _sum: { minutes: true }, _count: { _all: true } }),
    prisma.timeEntry.groupBy({
      by: ['billable'],
      where,
      _sum: { minutes: true },
      _count: { _all: true },
    }),
    prisma.timeEntry.groupBy({
      by: ['userId'],
      where,
      _sum: { minutes: true },
      _count: { _all: true },
      orderBy: { _sum: { minutes: 'desc' } },
      take: DETAIL_LIMIT,
    }),
    prisma.timeEntry.groupBy({
      by: ['projectId'],
      where,
      _sum: { minutes: true },
      _count: { _all: true },
      orderBy: { _sum: { minutes: 'desc' } },
      take: DETAIL_LIMIT,
    }),
  ]);

  // Les noms sont resolus par une seconde requete BORNEE sur les identifiants
  // deja retournes : on ne charge jamais la table des utilisateurs.
  const [users, projects] = await Promise.all([
    byUserRows.length > 0
      ? prisma.user.findMany({
          where: { id: { in: byUserRows.map((row) => row.userId) } },
          select: { id: true, firstName: true, lastName: true },
        })
      : Promise.resolve([]),
    byProjectRows.length > 0
      ? prisma.project.findMany({
          where: { id: { in: byProjectRows.map((row) => row.projectId) } },
          select: { id: true, reference: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const userNames = nameIndex(users);
  const projectNames = new Map<string, { reference: string; name: string }>();
  for (const project of projects) {
    projectNames.set(project.id, { reference: project.reference, name: project.name });
  }

  const byUser: UserMinutes[] = byUserRows.map((row) => ({
    userId: row.userId,
    name: userNames.get(row.userId) ?? 'Compte supprime',
    minutes: countOf(row._sum.minutes),
    entries: groupCount(row),
  }));

  const byProject: ProjectMinutes[] = byProjectRows.map((row) => {
    const project = projectNames.get(row.projectId);
    return {
      projectId: row.projectId,
      reference: project?.reference ?? '',
      name: project?.name ?? 'Projet supprime',
      minutes: countOf(row._sum.minutes),
      entries: groupCount(row),
    };
  });

  const billableMinutes = byBillable
    .filter((row) => row.billable)
    .reduce((sum, row) => sum + countOf(row._sum.minutes), 0);

  const nonBillableMinutes = byBillable
    .filter((row) => !row.billable)
    .reduce((sum, row) => sum + countOf(row._sum.minutes), 0);

  const totalMinutes = countOf(totals._sum.minutes);

  return {
    ...baseOf('TIME_SPENT', request),
    projectId: request.projectId,
    totalMinutes,
    billableMinutes,
    nonBillableMinutes,
    entries: countOf(totals._count._all),
    billableShare: shareOf(billableMinutes, totalMinutes),
    byUser,
    byProject,
  };
}

// -----------------------------------------------------------------------------
// Avancement des projets
// -----------------------------------------------------------------------------

const PROJECT_SUMMARY_SELECT = {
  id: true,
  reference: true,
  name: true,
  status: true,
  health: true,
  progressPercent: true,
  dueDate: true,
  client: { select: { companyName: true } },
} as const;

type ProjectSummaryRow = {
  id: string;
  reference: string;
  name: string;
  status: string;
  health: string;
  progressPercent: number;
  dueDate: Date | null;
  client: { companyName: string } | null;
};

function projectSummary(row: ProjectSummaryRow): ProjectSummary {
  return {
    id: row.id,
    reference: row.reference,
    name: row.name,
    status: row.status,
    health: row.health,
    progressPercent: row.progressPercent,
    dueDate: row.dueDate === null ? null : row.dueDate.toISOString(),
    clientName: row.client?.companyName ?? null,
  };
}

async function buildProjectProgress(
  prisma: PrismaService,
  request: ResolvedReportRequest,
): Promise<ProjectProgressResult> {
  const window = withinPeriod(request.bounds);
  const projectsWhere = {
    deletedAt: null,
    ...(request.projectId === null ? {} : { id: request.projectId }),
  };

  const [byStatus, byHealth, totals, average, overdue, created, completed, atRiskRows] =
    await Promise.all([
      prisma.project.groupBy({ by: ['status'], where: projectsWhere, _count: { _all: true } }),
      prisma.project.groupBy({ by: ['health'], where: projectsWhere, _count: { _all: true } }),
      prisma.project.count({ where: projectsWhere }),
      prisma.project.aggregate({ where: projectsWhere, _avg: { progressPercent: true } }),
      prisma.project.count({
        where: {
          ...projectsWhere,
          dueDate: { lt: request.now },
          status: { notIn: [...CLOSED_PROJECT_STATUSES] },
        },
      }),
      prisma.project.count({ where: { ...projectsWhere, createdAt: window } }),
      prisma.project.count({ where: { ...projectsWhere, completedAt: window } }),
      // Dix projets au maximum : l'instantane doit rester lisible, et une liste
      // non bornee redeviendrait un export.
      prisma.project.findMany({
        where: { ...projectsWhere, health: { not: ProjectHealth.ON_TRACK } },
        select: PROJECT_SUMMARY_SELECT,
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { reference: 'asc' }],
        take: 10,
      }),
    ]);

  const statusCounts: StatusCount[] = byStatus.map((row) => ({
    status: row.status,
    count: groupCount(row),
  }));

  // Deduit des compteurs par statut deja lus : une requete de moins, et surtout
  // une seule definition de ce qu'est un projet clos.
  const active = statusCounts
    .filter((row) => !(CLOSED_PROJECT_STATUSES as readonly string[]).includes(row.status))
    .reduce((sum, row) => sum + row.count, 0);

  // Detail d'un projet unique : demandé par un rapport cible.
  let project: ProjectSummary | null = null;
  let milestones: MilestoneSummary | null = null;
  let tasksByStatus: StatusCount[] | null = null;

  if (request.projectId !== null) {
    const [projectRow, milestoneRows, milestoneOverdue, milestoneTotal, taskRows] =
      await Promise.all([
        prisma.project.findFirst({ where: projectsWhere, select: PROJECT_SUMMARY_SELECT }),
        prisma.milestone.groupBy({
          by: ['status'],
          where: { projectId: request.projectId },
          _count: { _all: true },
        }),
        prisma.milestone.count({
          where: {
            projectId: request.projectId,
            status: { in: [MilestoneStatus.PENDING, MilestoneStatus.IN_PROGRESS] },
            dueDate: { lt: request.now },
          },
        }),
        prisma.milestone.count({ where: { projectId: request.projectId } }),
        prisma.task.groupBy({
          by: ['status'],
          where: { deletedAt: null, projectId: request.projectId },
          _count: { _all: true },
        }),
      ]);

    project = projectRow === null ? null : projectSummary(projectRow);

    const milestoneCounts: StatusCount[] = milestoneRows.map((row) => ({
      status: row.status,
      count: groupCount(row),
    }));

    milestones = {
      total: milestoneTotal,
      reached: milestoneCounts
        .filter((row) => row.status === MilestoneStatus.REACHED)
        .reduce((sum, row) => sum + row.count, 0),
      overdue: milestoneOverdue,
      byStatus: milestoneCounts,
    };

    tasksByStatus = taskRows.map((row) => ({ status: row.status, count: groupCount(row) }));
  }

  return {
    ...baseOf('PROJECT_PROGRESS', request),
    scope: request.projectId === null ? 'agency' : 'project',
    total: totals,
    active,
    overdue,
    // `countOf` ramene deja null et NaN a zero : un projet sans avancement
    // renseigne ne doit pas produire « NaN % » sur la ligne du rapport.
    averageProgress: Math.round(countOf(average._avg.progressPercent)),
    byStatus: statusCounts,
    byHealth: byHealth.map((row) => ({ status: row.health, count: groupCount(row) })),
    createdInPeriod: created,
    completedInPeriod: completed,
    atRisk: atRiskRows.map(projectSummary),
    project,
    milestones,
    tasksByStatus,
  };
}

// -----------------------------------------------------------------------------
// Journal d'activite
// -----------------------------------------------------------------------------

async function buildActivity(
  prisma: PrismaService,
  request: ResolvedReportRequest,
): Promise<ActivityReportResult> {
  const window = withinPeriod(request.bounds);

  // Les entrees rattachees a aucun projet restent visibles (activite client) ;
  // celles d'un projet supprime logiquement disparaissent.
  const where = {
    createdAt: window,
    ...(request.projectId === null
      ? { OR: [{ projectId: null }, { project: { deletedAt: null } }] }
      : { projectId: request.projectId }),
  };

  const [byType, total, recent] = await Promise.all([
    prisma.activity.groupBy({ by: ['type'], where, _count: { _all: true } }),
    prisma.activity.count({ where }),
    prisma.activity.findMany({
      where,
      select: {
        id: true,
        type: true,
        message: true,
        createdAt: true,
        project: { select: { name: true } },
        actor: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: DETAIL_LIMIT,
    }),
  ]);

  const entries: ActivityEntry[] = recent.map((row) => ({
    id: row.id,
    type: row.type,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
    projectName: row.project?.name ?? null,
    actorName: row.actor === null ? null : `${row.actor.firstName} ${row.actor.lastName}`.trim(),
  }));

  return {
    ...baseOf('ACTIVITY', request),
    total,
    byType: byType.map((row) => ({ status: row.type, count: groupCount(row) })),
    recent: entries,
  };
}

// -----------------------------------------------------------------------------
// Repartition
// -----------------------------------------------------------------------------

/**
 * Construit l'instantane du type demande.
 *
 * Le `switch` est exhaustif : ajouter une valeur a `ReportType` sans ecrire son
 * constructeur ne compile pas, grace au controle `never` en fin de fonction.
 * C'est preferable a un `default` silencieux qui renverrait un rapport vide.
 */
export async function buildReportResult(
  prisma: PrismaService,
  request: ResolvedReportRequest,
): Promise<ReportResult> {
  switch (request.type) {
    case 'COMMERCIAL_PIPELINE':
      return buildCommercialPipeline(prisma, request);
    case 'REVENUE':
      return buildRevenue(prisma, request);
    case 'OUTSTANDING_INVOICES':
      return buildOutstandingInvoices(prisma, request);
    case 'TASKS':
      return buildTasks(prisma, request);
    case 'TIME_SPENT':
      return buildTimeSpent(prisma, request);
    case 'PROJECT_PROGRESS':
      return buildProjectProgress(prisma, request);
    case 'ACTIVITY':
      return buildActivity(prisma, request);
    default: {
      const unreachable: never = request.type;
      throw AppException.unprocessable(
        'REPORT_TYPE_UNSUPPORTED',
        `Type de rapport non pris en charge : ${String(unreachable)}`,
      );
    }
  }
}

// -----------------------------------------------------------------------------
// Portee des projets, partagee avec le tableau de bord
// -----------------------------------------------------------------------------

/** Documents visibles par un client : tout sauf `INTERNAL`. */
export const CLIENT_VISIBLE_DOCUMENT_VISIBILITY = {
  not: DocumentVisibility.INTERNAL,
} as const;
