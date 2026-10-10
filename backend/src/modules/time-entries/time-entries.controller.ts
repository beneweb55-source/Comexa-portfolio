import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser, RequireAnyPermission } from '../../common/decorators/auth.decorators.js';
import { RequestMeta, type RequestContext } from '../projects/request-meta.decorator.js';
import { CreateTimeEntryDto, TimeEntryQueryDto, UpdateTimeEntryDto } from './dto/time-entry.dto.js';
import { TimeEntriesService } from './time-entries.service.js';

/**
 * ROUTES DU TEMPS SAISI.
 *
 * DEUX SCOPES PAR ROUTE, JAMAIS UN SEUL. `time:write:any` et `time:write:own`
 * ouvrent tous les deux la meme URL mais ne donnent pas le meme droit : le service
 * relit le scope et change de comportement — la tache verifiee, et la personne au
 * nom de qui la saisie est faite. Le garde, lui, ne sait que repondre « cette
 * route est ouverte ».
 *
 * `time:read:any` ET `time:read:own` SONT DISTINCTS ET LE RESTENT. Un developpeur
 * qui detient `time:read:own` ne doit pas lire la feuille de temps de ses
 * collegues : `@RequireAnyPermission` laisse passer la ROUTE, et
 * `timeEntryPerimeter` ramene la REPONSE a ses seules lignes. C'est exactement le
 * partage des deux niveaux d'autorisation decrit dans `projects.controller.ts`.
 */
@ApiTags('Temps')
@Controller()
export class TimeEntriesController {
  constructor(private readonly timeEntries: TimeEntriesService) {}

  @Get('tasks/:taskId/time-entries')
  @RequireAnyPermission('time:read:any', 'time:read:own')
  @ApiOperation({ summary: 'Temps saisi sur une tache (borne au perimetre du porteur).' })
  async listForTask(
    @Param('taskId') taskId: string,
    @Query() query: TimeEntryQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.timeEntries.listForTask(taskId, query, new AccessPolicy(user));
  }

  @Post('tasks/:taskId/time-entries')
  @RequireAnyPermission('time:write:any', 'time:write:own')
  @ApiOperation({ summary: 'Saisir du temps sur une tache (le projet vient de la tache).' })
  async create(
    @Param('taskId') taskId: string,
    @Body() dto: CreateTimeEntryDto,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.timeEntries.create(taskId, dto, new AccessPolicy(user), meta);
  }

  @Get('time-entries')
  @RequireAnyPermission('time:read:any', 'time:read:own')
  @ApiOperation({ summary: 'Feuille de temps : ses lignes, ou celles de ses projets.' })
  async list(@Query() query: TimeEntryQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.timeEntries.list(query, new AccessPolicy(user));
  }

  @Patch('time-entries/:id')
  @RequireAnyPermission('time:write:any', 'time:write:own')
  @ApiOperation({ summary: 'Corriger une saisie (duree, jour, description, facturable).' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTimeEntryDto,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.timeEntries.update(id, dto, new AccessPolicy(user), meta);
  }

  @Delete('time-entries/:id')
  @RequireAnyPermission('time:write:any', 'time:write:own')
  @ApiOperation({ summary: 'Supprimer une saisie.' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.timeEntries.remove(id, new AccessPolicy(user), meta);
  }
}
