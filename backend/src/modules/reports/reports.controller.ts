import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import {
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/auth.decorators.js';
import { GenerateReportDto, ReportListQueryDto } from './dto/reports.dto.js';
import { ReportsService } from './reports.service.js';

/**
 * ROUTES DES RAPPORTS.
 *
 * Deux niveaux d'autorisation, et les deux sont necessaires :
 *
 *  - le garde de la route (`@RequireAnyPermission`) dit qui a le droit
 *    d'appeler l'URL ;
 *  - le service (`AccessPolicy.requireScope`) dit QUELLE PART des donnees est
 *    renvoyee.
 *
 * Une route ouverte a `any` et `own` ne dit encore rien des lignes a servir :
 * c'est exactement la que se logent les fuites d'acces horizontal.
 *
 * La lecture est ouverte aux deux scopes parce que le catalogue leur donne un
 * sens distinct : un chef de projet, un commercial et un gerant communication
 * lisent tous les rapports (`report:read:any`), un developpeur ou un designer ne
 * lisent que les leurs (`report:read:own`). La generation, elle, reste reservee
 * a `report:generate:any`.
 */
@ApiTags('Rapports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @RequireAnyPermission('report:read:any', 'report:read:own')
  @ApiOperation({ summary: 'Lister les rapports accessibles au porteur' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ReportListQueryDto) {
    return this.reports.list(user, query);
  }

  @Post()
  @RequirePermissions('report:generate:any')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generer un rapport et enregistrer son resultat' })
  generate(@CurrentUser() user: AuthenticatedUser, @Body() dto: GenerateReportDto) {
    return this.reports.generate(user, dto);
  }

  @Get(':id')
  @RequireAnyPermission('report:read:any', 'report:read:own')
  @ApiOperation({ summary: 'Consulter un rapport et le resultat fige a sa date' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.reports.findOne(user, id);
  }
}
