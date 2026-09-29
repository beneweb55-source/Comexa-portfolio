import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import {
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/auth.decorators.js';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import {
  AddProjectMemberDto,
  CreateProjectDto,
  ProjectQueryDto,
  UpdateProjectDto,
  UpdateProjectStatusDto,
} from './dto/project.dto.js';
import { ProjectsService } from './projects.service.js';
import { RequestMeta, type RequestContext } from './request-meta.decorator.js';

/**
 * ROUTES DES PROJETS.
 *
 * DEUX NIVEAUX D'AUTORISATION, ET LES DEUX SONT NECESSAIRES.
 *
 * `@RequireAnyPermission` / `@RequirePermissions` autorise la ROUTE : « ce
 * porteur a le droit d'appeler cette URL ». Le service, lui, appelle
 * `policy.requireScope(...)` puis compose un `where` : « quelles LIGNES ce
 * porteur peut voir ». Une route `project:read` ouverte a `any`, `assigned` et
 * `own` ne dit encore rien des projets a renvoyer, et c'est exactement la que se
 * logent les acces horizontaux.
 *
 * Les codes sont ecrits en clair plutot qu'importes du catalogue : un controleur
 * qui importerait tout le catalogue perdrait sa lisibilite. Le typage est
 * rattrape par la verification qu'ils existent reellement dans
 * `permissions.catalogue.ts` — voir le rapport de livraison.
 */
@ApiTags('Projets')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequireAnyPermission('project:read:any', 'project:read:assigned', 'project:read:own')
  @ApiOperation({ summary: 'Lister les projets visibles par le porteur.' })
  async list(@Query() query: ProjectQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.projects.list(query, new AccessPolicy(user));
  }

  /**
   * Cree un projet.
   *
   * Reserve a `project:write:any` : un projet engage l'agence sur un budget et
   * une echeance, ce n'est pas un geste de collaborateur. `project:write:own`
   * existe au catalogue mais porte sur un projet EXISTANT dont on est
   * responsable — il ne peut donc pas autoriser une creation.
   */
  @Post()
  @RequirePermissions('project:write:any')
  @ApiOperation({ summary: 'Creer un projet rattache a un client existant.' })
  async create(
    @Body() dto: CreateProjectDto,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.projects.create(dto, new AccessPolicy(user), meta);
  }

  @Get(':id')
  @RequireAnyPermission('project:read:any', 'project:read:assigned', 'project:read:own')
  @ApiOperation({ summary: "Detail d'un projet." })
  async getOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.projects.getOne(id, new AccessPolicy(user));
  }

  @Patch(':id')
  @RequirePermissions('project:write:any')
  @ApiOperation({ summary: 'Modifier la fiche du projet (hors statut).' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.projects.update(id, dto, new AccessPolicy(user), meta);
  }

  @Patch(':id/status')
  @RequirePermissions('project:manage:status')
  @ApiOperation({ summary: 'Changer le statut, la sante et l’avancement du projet.' })
  async changeStatus(
    @Param('id') id: string,
    @Body() dto: UpdateProjectStatusDto,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.projects.changeStatus(id, dto, new AccessPolicy(user), meta);
  }

  @Delete(':id')
  @RequirePermissions('project:delete:any')
  @ApiOperation({ summary: 'Supprimer un projet (suppression logique).' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.projects.remove(id, new AccessPolicy(user), meta);
  }

  /**
   * L'equipe du projet.
   *
   * `project:read:own` N'EST PAS dans la liste : c'est la permission du compte
   * client, et la composition d'une equipe interne n'a rien a y faire. Un client
   * qui appelle cette route est refuse par le garde, avant meme d'atteindre le
   * service.
   */
  @Get(':id/members')
  @RequireAnyPermission('project:read:any', 'project:read:assigned')
  @ApiOperation({ summary: "Membres de l'equipe du projet." })
  async listMembers(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.projects.listMembers(id, new AccessPolicy(user));
  }

  @Post(':id/members')
  @RequirePermissions('project:manage:team')
  @ApiOperation({ summary: "Ajouter un membre a l'equipe." })
  async addMember(
    @Param('id') id: string,
    @Body() dto: AddProjectMemberDto,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.projects.addMember(id, dto, new AccessPolicy(user), meta);
  }

  @Delete(':id/members/:userId')
  @RequirePermissions('project:manage:team')
  @ApiOperation({ summary: "Retirer un membre de l'equipe." })
  async removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.projects.removeMember(id, userId, new AccessPolicy(user), meta);
  }

  /**
   * Le fil d'activite du projet.
   *
   * `activity:read:own` figure dans la liste pour les comptes clients : voir le
   * rapport de livraison, ce code n'est aujourd'hui porte par aucun role, donc
   * cette route leur est fermee par le garde. Le service, lui, est deja pret —
   * il delegue a `ActivityService.listForProject(..., { asClient })`.
   */
  @Get(':id/activities')
  @RequireAnyPermission('activity:read:any', 'activity:read:own')
  @ApiOperation({ summary: "Fil d'activite du projet (filtre pour l'espace client)." })
  async listActivities(
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projects.listActivities(id, query, new AccessPolicy(user));
  }
}
