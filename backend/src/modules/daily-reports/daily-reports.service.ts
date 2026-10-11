import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { UpsertDailyReportDto, DailyReportQueryDto } from './dto/daily-report.dto.js';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Plafond de taille du document (≈ 100 Ko) : un récapitulatif ne dépasse pas cela. */
const MAX_CONTENT_CHARS = 100_000;
const MAX_ROWS = 500;

export interface DailyReportView {
  id: string;
  reportDate: string;
  summary: string | null;
  contentJson: Record<string, unknown>;
  updatedAt: Date;
  user?: { id: string; firstName: string; lastName: string };
}

/**
 * Récapitulatifs journaliers. Règle : un membre n'écrit que le sien (l'identifiant vient du jeton) ;
 * la vue d'équipe exige `time:read:any` côté contrôleur.
 */
@Injectable()
export class DailyReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private parseDay(value: string): Date {
    if (!ISO_DAY.test(value)) throw new BadRequestException('Date invalide (AAAA-MM-JJ).');
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException('Date invalide (AAAA-MM-JJ).');
    }
    return date;
  }

  private range(query: DailyReportQueryDto): { gte?: Date; lte?: Date } {
    const out: { gte?: Date; lte?: Date } = {};
    if (query.from) out.gte = this.parseDay(query.from);
    if (query.to) out.lte = this.parseDay(query.to);
    return out;
  }

  private toView(row: {
    id: string;
    reportDate: Date;
    summary: string | null;
    contentJson: unknown;
    updatedAt: Date;
    user?: { id: string; firstName: string; lastName: string };
  }): DailyReportView {
    return {
      id: row.id,
      reportDate: row.reportDate.toISOString().slice(0, 10),
      summary: row.summary,
      contentJson: (row.contentJson ?? {}) as Record<string, unknown>,
      updatedAt: row.updatedAt,
      ...(row.user ? { user: row.user } : {}),
    };
  }

  /** Mes rapports, sur une période (le plus récent d'abord). */
  async listMine(userId: string, query: DailyReportQueryDto): Promise<DailyReportView[]> {
    const rows = await this.prisma.dailyReport.findMany({
      where: { userId, reportDate: this.range(query) },
      orderBy: { reportDate: 'desc' },
      take: MAX_ROWS,
    });
    return rows.map((row) => this.toView(row));
  }

  /** Vue d'équipe (résumés et contenus, avec l'auteur). */
  async listTeam(query: DailyReportQueryDto): Promise<DailyReportView[]> {
    const rows = await this.prisma.dailyReport.findMany({
      where: {
        reportDate: this.range(query),
        ...(query.userId ? { userId: query.userId } : {}),
      },
      orderBy: [{ reportDate: 'desc' }, { updatedAt: 'desc' }],
      take: MAX_ROWS,
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });
    return rows.map((row) => this.toView(row));
  }

  /** Crée ou remplace mon rapport du jour. */
  async upsertMine(
    userId: string,
    day: string,
    body: UpsertDailyReportDto,
  ): Promise<DailyReportView> {
    const reportDate = this.parseDay(day);
    if (JSON.stringify(body.contentJson).length > MAX_CONTENT_CHARS) {
      throw new BadRequestException('Le rapport dépasse la taille maximale autorisée.');
    }
    const summary = body.summary?.trim() || null;
    const row = await this.prisma.dailyReport.upsert({
      where: { userId_reportDate: { userId, reportDate } },
      create: { userId, reportDate, contentJson: body.contentJson as object, summary },
      update: { contentJson: body.contentJson as object, summary },
    });
    return this.toView(row);
  }

  /** Supprime mon rapport d'un jour. */
  async removeMine(userId: string, day: string): Promise<{ deleted: true }> {
    const reportDate = this.parseDay(day);
    const result = await this.prisma.dailyReport.deleteMany({ where: { userId, reportDate } });
    if (result.count === 0) throw new NotFoundException('Aucun rapport pour ce jour.');
    return { deleted: true };
  }
}
