import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { RequestContext, type RequestMetadata } from '../invoices/request-meta.js';
import {
  CreateProjectRequestDto,
  ListProjectRequestsQueryDto,
  UpdateProjectRequestDto,
} from './dto/project-request.dto.js';
import { ProjectRequestsService } from './project-requests.service.js';

/**
 * Demandes de projet. `POST` et `GET /mine` sont ouverts a tout compte verifie et
 * non interne (le service refuse le reste). La liste d'equipe et le traitement
 * exigent leurs permissions.
 */
@ApiTags('Demandes de projet')
@Controller('project-requests')
export class ProjectRequestsController {
  constructor(private readonly requests: ProjectRequestsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Enregistrer une demande de projet.' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProjectRequestDto,
    @RequestContext() meta: RequestMetadata,
  ) {
    return this.requests.create(user, dto, meta);
  }

  @Get('mine')
  @ApiOperation({ summary: 'Mes demandes de projet.' })
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.requests.listMine(user);
  }

  @Get()
  @RequirePermissions('project_request:read:any')
  @ApiOperation({ summary: 'Toutes les demandes de projet (equipe).' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListProjectRequestsQueryDto) {
    return this.requests.list(query, new AccessPolicy(user));
  }

  @Patch(':id')
  @RequirePermissions('project_request:manage:any')
  @ApiOperation({ summary: 'Traiter une demande : statut et note interne.' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateProjectRequestDto,
  ) {
    return this.requests.update(id, dto, user);
  }
}
