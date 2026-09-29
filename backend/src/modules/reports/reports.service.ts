import { Injectable } from '@nestjs/common';
import {
  AccessPolicy,
  SCOPE_ANY,
  SCOPE_OWN,
  type AuthenticatedUser,
} from '../../common/auth/principal.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { paginated, resolvePagination } from '../../common/dto/pagination.dto.js';
import { AppException } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ReportStatus } from '../../generated/prisma/enums.js';
import type { ReportType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { buildReportResult } from './report-builders.js';
import { resolvePeriod, serializePeriod, type PeriodBounds } from './report-period.js';
import {
  buildReportSnapshot,
  readReportSnapshot,
  snapshotToJson,
  type ReportResult,
  type ReportSnapshot,
} from './report-snapshot.js';
import { GenerateReportDto, REPORT_TYPE_LABELS, ReportListQueryDto } from './dto/reports.dto.js';

/**
 * SERVICE DES RAPPORTS.
 *
 * Un rapport n'est pas une vue : c'est une PIECE DATEE. La generation calcule
 * l'instantane UNE fois et l'ecrit en base ; la lecture relit ce qui a ete
 * ecrit. Consequence assumee : un rapport de mars relu en septembre montre mars,
 * meme si les donnees ont change depuis. C'est ce qu'on attend d'une piece —
 * un document qui se recalculerait a chaque ouverture montrerait l'etat
 * d'aujourd'hui sous une date passee, sans que personne puisse le voir.
 */

/** Champs d'une ligne de rapport, sans l'instantane : ce qui s'affiche en liste. */
const REPORT_SUMMARY_SELECT = {
  id: true,
  type: true,
  title: true,
  status: true,
  format: true,
  periodStart: true,
  periodEnd: true,
  projectId: true,
  generatedById: true,
  error: true,
  createdAt: true,
  completedAt: true,
  generatedBy: { select: { firstName: true, lastName: true } },
} as const;

export interface ReportSummary {
  readonly id: string;
  readonly type: ReportType;
  readonly title: string;
  readonly status: ReportStatus;
  readonly format: string;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly projectId: string | null;
  readonly generatedById: string | null;
  readonly generatedByName: string | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export interface ReportDetail extends ReportSummary {
  /**
   * Resultat fige a la date de generation, ou `null` si la ligne n'en porte pas
   * d'exploitable. `null` n'est pas « periode vide » : c'est « cette piece n'a
   * pas de resultat lisible », et le champ `status` dit pourquoi. Servir des
   * zeros a la place laisserait croire a un trimestre sans activite.
   */
  readonly result: ReportResult | null;
  readonly snapshot: ReportSnapshot | null;
}

interface ReportRow extends Omit<
  ReportSummary,
  'periodStart' | 'periodEnd' | 'generatedByName' | 'createdAt' | 'completedAt'
> {
  periodStart: Date | null;
  periodEnd: Date | null;
  createdAt: Date;
  completedAt: Date | null;
  generatedBy: { firstName: string; lastName: string } | null;
}

function toSummary(row: ReportRow): ReportSummary {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    status: row.status,
    format: row.format,
    periodStart: row.periodStart === null ? null : row.periodStart.toISOString(),
    periodEnd: row.periodEnd === null ? null : row.periodEnd.toISOString(),
    projectId: row.projectId,
    generatedById: row.generatedById,
    generatedByName:
      row.generatedBy === null
        ? null
        : `${row.generatedBy.firstName} ${row.generatedBy.lastName}`.trim(),
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
  };
}

/**
 * Un titre lisible quand l'appelant n'en fournit pas.
 *
 * La date est tiree de la forme LOCALE (`YYYY-MM-DD`), pas de l'ISO UTC : un
 * rapport du 1er mai a 00h30 heure locale porte la date du 1er mai, pas celle
 * du 30 avril. Le format est fixe volontairement — `toLocaleDateString`
 * dependrait de la locale du serveur et changerait d'un environnement a l'autre.
 */
function defaultTitle(type: ReportType, bounds: PeriodBounds): string {
  const period = serializePeriod(bounds);
  return `${REPORT_TYPE_LABELS[type]} du ${period.startLocal.slice(0, 10)} au ${period.endLocal.slice(0, 10)}`;
}

/** Convertit une borne ISO du DTO en `Date`, ou `undefined` si absente. */
function parseBound(value: string | undefined): Date | undefined {
  return value === undefined ? undefined : new Date(value);
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Liste paginee.
   *
   * `report:read:any` voit tout ; `report:read:own` ne voit que ce qu'il a
   * lui-meme produit. Le second niveau (le scope) est ce qui rend la
   * distinction reelle : le garde de la route autorise l'URL, il ne dit rien
   * des lignes a renvoyer.
   */
  async list(user: AuthenticatedUser, query: ReportListQueryDto) {
    const policy = new AccessPolicy(user);
    const scope = policy.requireScope('report', 'read', [SCOPE_ANY, SCOPE_OWN]);

    const where: Prisma.ReportWhereInput = {
      ...(scope === SCOPE_ANY ? {} : { generatedById: policy.userId }),
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.projectId === undefined ? {} : { projectId: query.projectId }),
    };

    const pagination = resolvePagination(query);

    const [rows, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        select: REPORT_SUMMARY_SELECT,
        // Plus recent d'abord : un rapport se consulte peu apres sa production.
        // `id` departage a la seconde pres, sinon deux rapports crees dans la
        // meme seconde pourraient s'echanger d'une page a l'autre.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.report.count({ where }),
    ]);

    return paginated(rows.map(toSummary), total, pagination);
  }

  /** Une piece par son identifiant, avec son resultat fige. */
  async findOne(user: AuthenticatedUser, id: string): Promise<ReportDetail> {
    const policy = new AccessPolicy(user);
    const scope = policy.requireScope('report', 'read', [SCOPE_ANY, SCOPE_OWN]);

    const row = await this.prisma.report.findUnique({
      where: { id },
      select: { ...REPORT_SUMMARY_SELECT, params: true },
    });

    if (row === null) {
      throw AppException.notFound('REPORT_NOT_FOUND', 'Rapport introuvable.');
    }

    // Un rapport produit par quelqu'un d'autre n'est pas a soi : on refuse, on
    // ne renvoie pas un 404 qui ferait croire a une erreur de saisie.
    if (scope !== SCOPE_ANY) {
      policy.assertOwnership(row.generatedById === policy.userId);
    }

    const snapshot = readReportSnapshot(row.params);

    return {
      ...toSummary(row),
      snapshot,
      result: snapshot === null ? null : snapshot.result,
    };
  }

  /**
   * Genere un rapport et l'ECRIT.
   *
   * L'ordre est : valider, calculer, ecrire. Le calcul vient avant l'ecriture
   * pour qu'un echec ne laisse pas derriere lui une ligne `PENDING` que le
   * frontend devrait apprendre a ignorer. La ligne creee est donc toujours
   * complete — un instantane et son resultat.
   *
   * Le statut `PENDING` et la colonne `error` du schema restent disponibles pour
   * une generation asynchrone (file d'attente, rendu PDF) ; ils ne sont pas
   * utilises ici parce que la generation est synchrone et rapide : quelques
   * agregats, pas un export.
   */
  async generate(user: AuthenticatedUser, dto: GenerateReportDto): Promise<ReportDetail> {
    const policy = new AccessPolicy(user);
    policy.requireScope('report', 'generate', [SCOPE_ANY]);

    const now = new Date();
    const bounds = resolvePeriod(
      {
        preset: dto.preset,
        periodStart: parseBound(dto.periodStart),
        periodEnd: parseBound(dto.periodEnd),
      },
      now,
    );

    // Un rapport qui vise un projet inexistant produirait des zeros qui se
    // liraient comme « projet sans activite ». On refuse, et on le dit.
    if (dto.projectId !== undefined) {
      const project = await this.prisma.project.findFirst({
        where: { id: dto.projectId, deletedAt: null },
        select: { id: true },
      });
      if (project === null) {
        throw AppException.notFound('REPORT_PROJECT_NOT_FOUND', 'Projet introuvable.');
      }
    }

    const result = await buildReportResult(this.prisma, {
      type: dto.type,
      bounds,
      projectId: dto.projectId ?? null,
      now,
    });

    const snapshot = buildReportSnapshot({
      request: {
        type: dto.type,
        projectId: dto.projectId ?? null,
        preset: dto.preset ?? null,
      },
      result,
      generatedAt: now,
    });

    const created = await this.prisma.report.create({
      data: {
        type: dto.type,
        // Un instantane est de la donnee. Un PDF demanderait une ligne
        // `Document`, qui appartient au domaine des documents : tant que ce
        // rendu n'existe pas, on n'annonce pas un format qu'on ne produit pas.
        format: 'JSON',
        title: dto.title ?? defaultTitle(dto.type, bounds),
        status: ReportStatus.GENERATED,
        // Periode en colonnes dediees en plus de l'instantane : c'est ce qui
        // permet de filtrer et de comparer des rapports sans lire le JSON.
        periodStart: bounds.start,
        periodEnd: bounds.end,
        projectId: dto.projectId ?? null,
        generatedById: policy.userId,
        params: snapshotToJson(snapshot),
        completedAt: now,
      },
      select: { ...REPORT_SUMMARY_SELECT, params: true },
    });

    // Trace de qui a produit quelle piece, et quand. Un rapport est une piece
    // comptable : sa production doit etre attribuable.
    await this.audit.record({
      actorId: policy.userId,
      action: 'REPORT_GENERATED',
      entityType: 'Report',
      entityId: created.id,
      after: {
        type: dto.type,
        periodStart: bounds.start.toISOString(),
        periodEnd: bounds.end.toISOString(),
        projectId: dto.projectId ?? null,
      },
    });

    return {
      ...toSummary(created),
      snapshot,
      result: snapshot.result,
    };
  }
}
