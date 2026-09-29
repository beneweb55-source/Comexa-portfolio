import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import {
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/auth.decorators.js';
import { DashboardService } from './dashboard.service.js';
import {
  AgencyDashboardQueryDto,
  ClientDashboardQueryDto,
  PersonalDashboardQueryDto,
} from './dto/dashboard.dto.js';

/**
 * ROUTES DU TABLEAU DE BORD.
 *
 * Trois vues, trois publics, et une frontiere qui ne doit jamais se deplacer :
 *
 *  - `/dashboard` : l'agence. Un porteur de l'espace client y est refuse, ici
 *    par le garde, et de toute facon par le service.
 *  - `/dashboard/me` : la vue personnelle, ouverte a l'equipe COMME a un client
 *    — les sections se deduisent alors des droits du porteur, donc un client n'y
 *    voit que ses notifications.
 *  - `/dashboard/client` : l'espace client, strictement reserve aux comptes
 *    clients, et borne par `policy.clientId`.
 *
 * Aucun de ces trois DTO n'accepte d'identifiant : le perimetre vient du jeton.
 * C'est la reponse a « un client ne doit jamais pouvoir modifier l'ID d'un autre
 * client dans une requete pour acceder a ses donnees » — il n'y a rien a
 * modifier, tout parametre est refuse en 400 avant d'atteindre le service.
 */
@ApiTags('Tableau de bord')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @RequirePermissions('dashboard:read:any')
  @ApiOperation({ summary: "Vue d'agence : portefeuille, activite, encours, encaissements" })
  agency(@CurrentUser() user: AuthenticatedUser, @Query() query: AgencyDashboardQueryDto) {
    return this.dashboard.agency(user, query);
  }

  @Get('me')
  @RequireAnyPermission('dashboard:read:any', 'dashboard:read:own')
  @ApiOperation({ summary: 'Vue personnelle : mes taches, mes echeances, mes notifications' })
  me(@CurrentUser() user: AuthenticatedUser, @Query() _query: PersonalDashboardQueryDto) {
    return this.dashboard.me(user);
  }

  @Get('client')
  @RequirePermissions('dashboard:read:own')
  @ApiOperation({ summary: "Espace client : mes projets, mes factures, mes documents" })
  client(@CurrentUser() user: AuthenticatedUser, @Query() _query: ClientDashboardQueryDto) {
    return this.dashboard.client(user);
  }
}
