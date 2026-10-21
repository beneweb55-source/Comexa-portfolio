import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { RequestMeta, type RequestContext } from '../projects/request-meta.decorator.js';
import { CreateGoalDto, GoalQueryDto, UpdateGoalDto } from './dto/goal.dto.js';
import { GoalsService } from './goals.service.js';

/**
 * ROUTES DES OBJECTIFS PERSONNELS — toutes sous `me/`, parce qu'il n'existe
 * pas d'objectif « des autres » a consulter.
 *
 * PERMISSIONS REPRISES DE L'ESPACE PERSONNEL : `task:read:personal` pour lire,
 * `task:write:personal` pour ecrire. Un objectif organise des taches privees ;
 * il suit donc exactement les memes droits, sans code nouveau a distribuer. Les
 * deux codes etant retires de l'espace equipe (`space-policy.ts`), les
 * objectifs n'en sortent jamais.
 */
@ApiTags('Objectifs personnels')
@Controller()
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get('me/goals')
  @RequirePermissions('task:read:personal')
  @ApiOperation({ summary: 'Mes objectifs, avec leurs taches et leur avancement.' })
  async list(@Query() query: GoalQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.goals.list(query, new AccessPolicy(user));
  }

  @Get('me/goals/:id')
  @RequirePermissions('task:read:personal')
  @ApiOperation({ summary: 'Un de mes objectifs.' })
  async getOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.goals.getOne(id, new AccessPolicy(user));
  }

  @Post('me/goals')
  @RequirePermissions('task:write:personal')
  @ApiOperation({ summary: 'Definir un objectif.' })
  async create(
    @Body() dto: CreateGoalDto,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.goals.create(dto, new AccessPolicy(user), meta);
  }

  @Patch('me/goals/:id')
  @RequirePermissions('task:write:personal')
  @ApiOperation({ summary: 'Modifier un objectif (titre, date cible, teinte, statut).' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateGoalDto,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.goals.update(id, dto, new AccessPolicy(user), meta);
  }

  @Delete('me/goals/:id')
  @RequirePermissions('task:write:personal')
  @ApiOperation({ summary: 'Supprimer un objectif (ses taches sont conservees).' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.goals.remove(id, new AccessPolicy(user), meta);
  }

  @Put('me/goals/:id/tasks/:taskId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('task:write:personal')
  @ApiOperation({ summary: "Rattacher une de mes taches a l'objectif." })
  async linkTask(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.goals.linkTask(id, taskId, new AccessPolicy(user), meta);
  }

  @Delete('me/goals/:id/tasks/:taskId')
  @RequirePermissions('task:write:personal')
  @ApiOperation({ summary: "Retirer une tache de l'objectif (la tache est conservee)." })
  async unlinkTask(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.goals.unlinkTask(id, taskId, new AccessPolicy(user), meta);
  }
}
