import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { RequestMeta, type RequestContext } from '../projects/request-meta.decorator.js';
import { CreateMilestoneDto, UpdateMilestoneDto } from './dto/milestone.dto.js';
import { MilestonesService } from './milestones.service.js';

/**
 * ROUTES DES JALONS.
 *
 * DEUX PREFIXES, COMME LES TACHES : les jalons se lisent et se creent sous leur
 * projet, puis se modifient par identifiant depuis une frise qui n'affiche pas
 * forcement le projet.
 *
 * `milestone:read:any` N'EST PAS UNE OUVERTURE. Le role CLIENT le detient : la
 * frise d'un projet est faite pour lui. C'est le PERIMETRE DU PROJET, compose dans
 * le `where` du service, qui decide quels jalons existent pour ce porteur. Sans
 * lui, ce code afficherait les jalons de toute l'agence — c'est exactement le
 * genre de fuite qu'un nom de permission ne laisse pas deviner.
 *
 * `@RequirePermissions` et non `@RequireAnyPermission` : il n'existe qu'un seul
 * scope pour les jalons (voir `MILESTONE_READ_ORDER`). Ecrire une liste a un seul
 * element laisserait croire qu'un second scope est attendu.
 */
@ApiTags('Jalons')
@Controller()
export class MilestonesController {
  constructor(private readonly milestones: MilestonesService) {}

  @Get('projects/:projectId/milestones')
  @RequirePermissions('milestone:read:any')
  @ApiOperation({ summary: "Frise des jalons d'un projet, avec l'avancement des taches." })
  async list(
    @Param('projectId') projectId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.milestones.list(projectId, query, new AccessPolicy(user));
  }

  @Post('projects/:projectId/milestones')
  @RequirePermissions('milestone:write:any')
  @ApiOperation({ summary: 'Ajouter un jalon au planning (cree PENDING).' })
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateMilestoneDto,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.milestones.create(projectId, dto, new AccessPolicy(user), meta);
  }

  @Patch('milestones/:id')
  @RequirePermissions('milestone:write:any')
  @ApiOperation({ summary: 'Modifier un jalon, statut compris (transitions controlees).' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateMilestoneDto,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.milestones.update(id, dto, new AccessPolicy(user), meta);
  }

  @Delete('milestones/:id')
  @RequirePermissions('milestone:write:any')
  @ApiOperation({ summary: 'Retirer un jalon du planning (refuse si atteint ou porteur de taches).' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.milestones.remove(id, new AccessPolicy(user), meta);
  }
}
