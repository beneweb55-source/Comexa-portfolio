import type { Prisma } from '../../generated/prisma/client.js';
import type { ReportType } from '../../generated/prisma/enums.js';
import type { PeriodPreset } from './report-period.js';
import type {
  AmountSection,
  CollectedSection,
  SourceCount,
  StatusCount,
} from './report-metrics.js';

/**
 * L'INSTANTANE D'UN RAPPORT.
 *
 * Un rapport est une PIECE DATEE, pas une vue calculee. Consequence directe :
 * les chiffres sont figes a la generation et relus tels quels, meme six mois
 * plus tard. Un rapport qui se recalculerait a chaque lecture ne vaudrait rien
 * comme piece — il montrerait l'etat d'aujourd'hui sous la date d'hier, et
 * personne ne pourrait le savoir en le lisant.
 *
 * OU VIT L'INSTANTANE. Le modele `Report` porte `params Json?` et rien d'autre
 * de libre : `prisma/schema.prisma` n'appartient pas a ce module, et une colonne
 * `result Json?` dediee serait la forme propre. En attendant, l'instantane est
 * range dans `params` sous un schema NOMME ET VERSIONNE (`schema`), avec deux
 * sections separees : `request` (ce qui a ete demande) et `result` (ce qui a ete
 * calcule). Le nom de la cle de version permet de faire evoluer la forme sans
 * confondre un ancien rapport avec un nouveau : `readReportSnapshot` renvoie
 * `null` sur une forme qu'il ne reconnait pas, et l'appelant le DIT, au lieu de
 * servir des zeros en laissant croire a un rapport vide.
 */

export const REPORT_SNAPSHOT_SCHEMA = 'comexa.report.v1';

/** Champs presents dans TOUS les instantanes. `asOf` est la date de calcul. */
export interface ReportResultBase {
  readonly type: ReportType;
  readonly periodStart: string;
  readonly periodEnd: string;
  /** Instant de generation. Un encours n'a de sens qu'a une date donnee. */
  readonly asOf: string;
}

// -----------------------------------------------------------------------------
// Pipeline commercial
// -----------------------------------------------------------------------------

export interface CommercialPipelineResult extends ReportResultBase {
  readonly type: 'COMMERCIAL_PIPELINE';
  /** Etat COURANT du pipeline (prospects non supprimes), tous statuts. */
  readonly prospectsByStatus: readonly StatusCount[];
  readonly prospectsTotal: number;
  /** Prospects non encore gagnes ni perdus. */
  readonly prospectsOpen: number;
  readonly createdInPeriod: number;
  readonly bySourceInPeriod: readonly SourceCount[];
  readonly wonInPeriod: number;
  readonly lostInPeriod: number;
  /** Gagnes / (gagnes + perdus) sur la periode. Zero si aucune decision. */
  readonly conversionRate: number;
}

// -----------------------------------------------------------------------------
// Revenus
// -----------------------------------------------------------------------------

export interface RevenueResult extends ReportResultBase {
  readonly type: 'REVENUE';
  /**
   * LE CHIFFRE D'AFFAIRES. Uniquement les paiements au statut `SUCCEEDED`,
   * non supprimes, dont la date d'encaissement tombe dans la periode. Jamais le
   * total des factures emises, jamais des devis acceptes : un devis signe n'est
   * pas de l'argent, une facture emise non plus.
   */
  readonly collected: CollectedSection;
  /**
   * Factures emises sur la periode, hors brouillons et annulees. Cette section
   * existe pour le RAPPROCHEMENT (comparee a `collected`, elle donne le reste a
   * encaisser) et ne doit jamais etre presentee comme le chiffre d'affaires.
   */
  readonly billed: AmountSection;
  /** `collected / billed`. Zero quand rien n'a ete facture. */
  readonly collectionRate: number;
}

// -----------------------------------------------------------------------------
// Encours client
// -----------------------------------------------------------------------------

export interface OutstandingInvoicesResult extends ReportResultBase {
  readonly type: 'OUTSTANDING_INVOICES';
  /** Factures emises dans la periode et non soldees a la date de generation. */
  readonly issuedInPeriod: AmountSection;
  /** Tout l'encours, quelle que soit la date d'emission. */
  readonly totalOpen: AmountSection;
  /** Part de l'encours dont l'echeance est depassee. */
  readonly overdue: AmountSection;
  /** Part de l'encours qui arrive a echeance dans les `dueSoonDays` jours. */
  readonly dueSoon: AmountSection;
  readonly dueSoonDays: number;
}

// -----------------------------------------------------------------------------
// Taches
// -----------------------------------------------------------------------------

export interface TasksResult extends ReportResultBase {
  readonly type: 'TASKS';
  readonly projectId: string | null;
  readonly byStatus: readonly StatusCount[];
  readonly byPriority: readonly StatusCount[];
  readonly total: number;
  /** Ni terminees ni annulees. */
  readonly open: number;
  /** Ouvertes dont l'echeance est passee. */
  readonly overdue: number;
  readonly createdInPeriod: number;
  readonly completedInPeriod: number;
}

// -----------------------------------------------------------------------------
// Temps passe
// -----------------------------------------------------------------------------

export interface UserMinutes {
  readonly userId: string;
  readonly name: string;
  readonly minutes: number;
  readonly entries: number;
}

export interface ProjectMinutes {
  readonly projectId: string;
  readonly reference: string;
  readonly name: string;
  readonly minutes: number;
  readonly entries: number;
}

export interface TimeSpentResult extends ReportResultBase {
  readonly type: 'TIME_SPENT';
  readonly projectId: string | null;
  readonly totalMinutes: number;
  readonly billableMinutes: number;
  readonly nonBillableMinutes: number;
  readonly entries: number;
  /** Part facturable, en fraction. Zero si aucune saisie. */
  readonly billableShare: number;
  readonly byUser: readonly UserMinutes[];
  readonly byProject: readonly ProjectMinutes[];
}

// -----------------------------------------------------------------------------
// Avancement des projets
// -----------------------------------------------------------------------------

export interface ProjectSummary {
  readonly id: string;
  readonly reference: string;
  readonly name: string;
  readonly status: string;
  readonly health: string;
  readonly progressPercent: number;
  readonly dueDate: string | null;
  readonly clientName: string | null;
}

export interface MilestoneSummary {
  readonly total: number;
  readonly reached: number;
  readonly overdue: number;
  readonly byStatus: readonly StatusCount[];
}

export interface ProjectProgressResult extends ReportResultBase {
  readonly type: 'PROJECT_PROGRESS';
  readonly scope: 'agency' | 'project';
  readonly total: number;
  readonly active: number;
  readonly overdue: number;
  readonly averageProgress: number;
  readonly byStatus: readonly StatusCount[];
  readonly byHealth: readonly StatusCount[];
  readonly createdInPeriod: number;
  readonly completedInPeriod: number;
  /** Projets en risque ou hors trajectoire. Dix au maximum. */
  readonly atRisk: readonly ProjectSummary[];
  /** Renseigne uniquement quand le rapport vise un projet precis. */
  readonly project: ProjectSummary | null;
  readonly milestones: MilestoneSummary | null;
  readonly tasksByStatus: readonly StatusCount[] | null;
}

// -----------------------------------------------------------------------------
// Journal d'activite
// -----------------------------------------------------------------------------

export interface ActivityEntry {
  readonly id: string;
  readonly type: string;
  readonly message: string;
  readonly createdAt: string;
  readonly projectName: string | null;
  readonly actorName: string | null;
}

export interface ActivityReportResult extends ReportResultBase {
  readonly type: 'ACTIVITY';
  readonly total: number;
  readonly byType: readonly StatusCount[];
  /** Vingt dernieres entrees. Une liste bornee, pas un export. */
  readonly recent: readonly ActivityEntry[];
}

/** Resultat calcule, selon le type de rapport demande. */
export type ReportResult =
  | CommercialPipelineResult
  | RevenueResult
  | OutstandingInvoicesResult
  | TasksResult
  | TimeSpentResult
  | ProjectProgressResult
  | ActivityReportResult;

/** Ce qui a ete demande, conserve avec le resultat. */
export interface ReportRequestSnapshot {
  readonly type: ReportType;
  readonly projectId: string | null;
  readonly preset: PeriodPreset | null;
}

export interface ReportSnapshot {
  readonly schema: string;
  readonly request: ReportRequestSnapshot;
  readonly result: ReportResult;
  readonly generatedAt: string;
}

/** Assemble l'objet range dans `Report.params`. */
export function buildReportSnapshot(input: {
  request: ReportRequestSnapshot;
  result: ReportResult;
  generatedAt: Date;
}): ReportSnapshot {
  return {
    schema: REPORT_SNAPSHOT_SCHEMA,
    request: input.request,
    result: input.result,
    generatedAt: input.generatedAt.toISOString(),
  };
}

/**
 * Le seul endroit ou l'instantane est converti pour Prisma.
 *
 * `Report.params` est un `Json` : Prisma n'accepte pas une interface TypeScript
 * telle quelle, il lui faut `InputJsonValue`. Concentrer le cast ici evite qu'il
 * se disperse dans le service, ou il finirait par masquer autre chose.
 */
export function snapshotToJson(snapshot: ReportSnapshot): Prisma.InputJsonValue {
  return snapshot as unknown as Prisma.InputJsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Relit un instantane range en base, ou renvoie `null`.
 *
 * `null` n'est PAS une erreur : c'est le cas d'une ligne `Report` creee avant
 * que la forme n'existe, ou d'une ligne dont la generation a echoue. L'appelant
 * doit alors le dire explicitement (`snapshot: null`), jamais servir des zeros
 * qui se liraient comme « periode sans activite ».
 */
export function readReportSnapshot(value: unknown): ReportSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value['schema'] !== REPORT_SNAPSHOT_SCHEMA) {
    return null;
  }
  if (typeof value['generatedAt'] !== 'string') {
    return null;
  }
  if (!isRecord(value['request']) || !isRecord(value['result'])) {
    return null;
  }

  const request = value['request'];
  if (typeof request['type'] !== 'string') {
    return null;
  }

  return {
    schema: REPORT_SNAPSHOT_SCHEMA,
    request: {
      type: request['type'] as ReportType,
      projectId: typeof request['projectId'] === 'string' ? request['projectId'] : null,
      preset: typeof request['preset'] === 'string' ? (request['preset'] as PeriodPreset) : null,
    },
    result: value['result'] as unknown as ReportResult,
    generatedAt: value['generatedAt'],
  };
}
