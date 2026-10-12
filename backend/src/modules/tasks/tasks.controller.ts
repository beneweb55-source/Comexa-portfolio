import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import {
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/auth.decorators.js';
import { RequestMeta, type RequestContext } from '../projects/request-meta.decorator.js';
import {
  AssignTaskDto,
  CreatePersonalTaskDto,
  CreateTaskDto,
  TaskQueryDto,
  UpdateTaskDto,
  UpdateTaskStatusDto,
} from './dto/task.dto.js';
import { TasksService } from './tasks.service.js';

/**
 * ROUTES DES TACHES.
 *
 * UN SEUL CONTROLEUR POUR DEUX PREFIXES, ET C'EST VOULU.
 *
 * Les taches se lisent et se creent SOUS LE PROJET (`/projects/:id/tasks`) mais se
 * manipulent PAR IDENTIFIANT (`/tasks/:id`) : une tache appartient a un projet,
 * alors qu'on la deplace, l'assigne et la ferme depuis un tableau qui n'affiche
 * pas forcement le projet. Le controleur n'a donc pas d'`@Controller('...')` et
 * chaque route porte son chemin complet. L'alternative — deux controleurs — aurait
 * duplique les decorations de permission et les commentaires.
 *
 * `GET /me/tasks` vit ici et non dans un module « moi » : c'est la meme requete
 * que la liste, avec `assigneeId` force au porteur. Voir `TasksService.listMine`,
 * qui l'impose MEME a un chef de projet detenant `task:read:any`.
 */
@ApiTags('Taches')
@Controller()
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get('projects/:projectId/tasks')
  @RequireAnyPermission('task:read:any', 'task:read:assigned', 'task:read:own')
  @ApiOperation({ summary: "Taches d'un projet, filtrees par le perimetre du porteur." })
  async listForProject(
    @Param('projectId') projectId: string,
    @Query() query: TaskQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasks.listForProject(projectId, query, new AccessPolicy(user));
  }

  @Post('projects/:projectId/tasks')
  @RequireAnyPermission('task:write:any', 'task:write:own')
  @ApiOperation({ summary: 'Creer une tache (ou une sous-tache) dans un projet.' })
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateTaskDto,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.tasks.create(projectId, dto, new AccessPolicy(user), meta);
  }

  /**
   * « Mes taches », tous projets confondus.
   *
   * Declaree AVANT `GET /tasks/:id` : Nest apparie les routes dans l'ordre de
   * declaration, et un `:id` place avant capterait le mot `me`. Les deux chemins
   * n'ont pourtant pas la meme forme ici (`me/tasks` contre `tasks/:id`), mais
   * l'ordre reste la precaution qui evite de le decouvrir a l'execution.
   */
  @Get('me/tasks')
  @RequireAnyPermission(
    'task:read:any',
    'task:read:assigned',
    'task:read:own',
    'task:read:personal',
  )
  @ApiOperation({ summary: 'Taches assignees au porteur, tous projets confondus.' })
  async listMine(@Query() query: TaskQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tasks.listMine(query, new AccessPolicy(user));
  }

  /**
   * Cree une tache PERSONNELLE : espace prive, sans projet ni client.
   *
   * `task:write:personal` SEUL ouvre cette route, et le service le re-verifie.
   * Les scopes classiques d'ecriture (`own`, `any`) parlent des taches DE
   * PROJET : ils ne donnent aucun droit ici, et cette route ne donne aucun
   * droit sur elles — la separation des deux espaces tient des deux cotes.
   */
  @Post('me/tasks')
  @RequirePermissions('task:write:personal')
  @ApiOperation({ summary: 'Creer une tache personnelle (sans projet ni client).' })
  async createPersonal(
    @Body() dto: CreatePersonalTaskDto,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.tasks.createPersonal(dto, new AccessPolicy(user), meta);
  }

  @Get('tasks/:id')
  @RequireAnyPermission(
    'task:read:any',
    'task:read:assigned',
    'task:read:own',
    'task:read:personal',
  )
  @ApiOperation({ summary: "Detail d'une tache, sous-taches et temps saisi compris." })
  async getOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tasks.getOne(id, new AccessPolicy(user));
  }

  @Patch('tasks/:id')
  @RequireAnyPermission('task:write:any', 'task:write:own', 'task:write:personal')
  @ApiOperation({ summary: 'Modifier une tache (titre, echeance, estimation, visibilite).' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.tasks.update(id, dto, new AccessPolicy(user), meta);
  }

  @Patch('tasks/:id/status')
  @RequireAnyPermission('task:write:any', 'task:write:own', 'task:write:personal')
  @ApiOperation({ summary: 'Changer le statut (transitions controlees, sous-taches verifiees).' })
  async changeStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTaskStatusDto,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.tasks.changeStatus(id, dto, new AccessPolicy(user), meta);
  }

  /**
   * Assignation.
   *
   * `task:assign:any` SEUL, et ce n'est pas une ligne de plus : sans lui,
   * `task:write:any` aurait permis de reattribuer le travail de quelqu'un d'autre.
   * Un developpeur ne peut pas s'auto-assigner une tache qu'il ne peut pas lire —
   * il ne connait pas son identifiant — et cette route lui est de toute facon
   * fermee par le garde.
   */
  @Patch('tasks/:id/assign')
  @RequirePermissions('task:assign:any')
  @ApiOperation({ summary: 'Assigner ou desassigner une tache.' })
  async assign(
    @Param('id') id: string,
    @Body() dto: AssignTaskDto,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.tasks.assign(id, dto, new AccessPolicy(user), meta);
  }

  /**
   * Suppression. `task:delete:any` pour les taches de projet ; a defaut,
   * `task:write:personal` ouvre la route UNIQUEMENT pour les taches
   * personnelles du porteur — le service (`TasksService.remove`) trie.
   */
  @Delete('tasks/:id')
  @RequireAnyPermission('task:delete:any', 'task:write:personal')
  @ApiOperation({ summary: 'Supprimer une tache (suppression logique).' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.tasks.remove(id, new AccessPolicy(user), meta);
  }
}
