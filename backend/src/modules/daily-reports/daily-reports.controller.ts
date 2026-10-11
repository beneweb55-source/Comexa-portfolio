import { Body, Controller, Delete, Get, Param, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import {
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/auth.decorators.js';
import { DailyReportQueryDto, UpsertDailyReportDto } from './dto/daily-report.dto.js';
import { DailyReportsService, type DailyReportView } from './daily-reports.service.js';

/**
 * ROUTES DES RECAPITULATIFS JOURNALIERS.
 *  - `mine` et `:date` : uniquement le porteur (identifiant tire du jeton, jamais du chemin).
 *  - `GET /daily-reports` : vue d'equipe, reservee a `time:read:any`.
 */
@ApiTags('Rapports journaliers')
@Controller('daily-reports')
export class DailyReportsController {
  constructor(private readonly reports: DailyReportsService) {}

  @Get('mine')
  @RequireAnyPermission('time:write:own', 'time:read:own')
  @ApiOperation({ summary: 'Lister mes récapitulatifs journaliers' })
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DailyReportQueryDto,
  ): Promise<DailyReportView[]> {
    return this.reports.listMine(user.id, query);
  }

  @Get()
  @RequirePermissions('time:read:any')
  @ApiOperation({ summary: 'Lister les récapitulatifs de l’équipe' })
  listTeam(@Query() query: DailyReportQueryDto): Promise<DailyReportView[]> {
    return this.reports.listTeam(query);
  }

  @Put(':date')
  @RequirePermissions('time:write:own')
  @ApiOperation({ summary: 'Enregistrer mon récapitulatif d’un jour (crée ou remplace)' })
  upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('date') date: string,
    @Body() body: UpsertDailyReportDto,
  ): Promise<DailyReportView> {
    return this.reports.upsertMine(user.id, date, body);
  }

  @Delete(':date')
  @RequirePermissions('time:write:own')
  @ApiOperation({ summary: 'Supprimer mon récapitulatif d’un jour' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('date') date: string,
  ): Promise<{ deleted: true }> {
    return this.reports.removeMine(user.id, date);
  }
}
