import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import {
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/auth.decorators.js';
import { RequestMeta, type RequestContext } from '../projects/request-meta.decorator.js';
import { CalendarService } from './calendar.service.js';
import {
  CalendarRangeQueryDto,
  CreateCalendarEventDto,
  ReplaceParticipantsDto,
  UpdateCalendarEventDto,
} from './dto/calendar.dto.js';

/**
 * ROUTES DU CALENDRIER.
 *
 * DEUX ESPACES, DEUX PREFIXES — le meme decoupage que les taches :
 *
 *  - `me/calendar/*` : le calendrier PERSONNEL de l'appelant. Lecture de ses
 *    propres evenements (et de ceux auxquels il est invite), ecriture
 *    UNIQUEMENT sur les siens (verifie au service, ligne par ligne) ;
 *  - `calendar/events` : la vue d'EQUIPE, uniquement les evenements PARTAGES.
 *
 * Les gardes de route ouvrent la porte ; le service reperimetre chaque ligne
 * (proprietaire, participant, visibilite). Les deux niveaux, comme partout dans
 * l'API : un garde seul laisserait un invite supprimer l'evenement d'autrui.
 */
@ApiTags('Calendrier')
@Controller()
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  // -------------------------------------------------------------------------
  // Calendrier personnel
  // -------------------------------------------------------------------------

  @Get('me/calendar/events')
  @RequirePermissions('calendar:read:own')
  @ApiOperation({ summary: 'Mes événements (et ceux où je suis invité) sur une période.' })
  async listMine(@Query() query: CalendarRangeQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.calendar.listMine(new AccessPolicy(user), query);
  }

  @Get('me/calendar/events/:id')
  @RequireAnyPermission('calendar:read:own', 'calendar:read:team', 'calendar:manage:any')
  @ApiOperation({ summary: 'Un événement visible par le porteur (404 sinon).' })
  async getOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.calendar.getOne(new AccessPolicy(user), id);
  }

  @Post('me/calendar/events')
  @RequirePermissions('calendar:write:own')
  @ApiOperation({ summary: 'Créer un événement personnel (privé par défaut).' })
  async create(
    @Body() dto: CreateCalendarEventDto,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.calendar.create(new AccessPolicy(user), dto, meta);
  }

  @Patch('me/calendar/events/:id')
  @RequirePermissions('calendar:write:own')
  @ApiOperation({ summary: 'Modifier son événement (le propriétaire uniquement).' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCalendarEventDto,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.calendar.update(new AccessPolicy(user), id, dto, meta);
  }

  @Delete('me/calendar/events/:id')
  @RequirePermissions('calendar:write:own')
  @ApiOperation({ summary: 'Supprimer son événement (le propriétaire uniquement).' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.calendar.remove(new AccessPolicy(user), id, meta);
  }

  @Put('me/calendar/events/:id/participants')
  @RequirePermissions('calendar:write:own')
  @ApiOperation({ summary: 'Poser la liste complète des invités (événements partagés).' })
  async replaceParticipants(
    @Param('id') id: string,
    @Body() dto: ReplaceParticipantsDto,
    @CurrentUser() user: AuthenticatedUser,
    @RequestMeta() meta: RequestContext,
  ) {
    return this.calendar.replaceParticipants(new AccessPolicy(user), id, dto.userIds, meta);
  }

  // -------------------------------------------------------------------------
  // Vue d'équipe
  // -------------------------------------------------------------------------

  @Get('calendar/events')
  @RequirePermissions('calendar:read:team')
  @ApiOperation({ summary: "Les événements partagés de l'équipe sur une période." })
  async listTeam(@Query() query: CalendarRangeQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.calendar.listTeam(new AccessPolicy(user), query);
  }
}
