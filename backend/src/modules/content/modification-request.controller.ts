import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { ModificationRequestService } from './modification-request.service.js';
import {
  CreateModificationRequestDto,
  DecideModificationRequestDto,
  ListModificationRequestsQueryDto,
} from './dto/modification-request.dto.js';

/**
 * DEMANDES DE MODIFICATION — un seul controleur pour deux publics.
 *
 * LES ROUTES DE LECTURE SONT PARTAGEES, et le garde le dit :
 * `@RequireAnyPermission('...:read:any', '...:read:own')`. Le role CLIENT detient
 * `read:own`, l'agence detient `read:any` ; les deux ouvrent la meme route, et
 * c'est le SERVICE qui decide de ce que chacun voit — la portee est lue sur le
 * jeton, jamais dans la requete. Un `@RequirePermissions('read:any')` unique
 * aurait l'air plus strict tout en fermant la route au client, qui doit pouvoir
 * suivre ses propres demandes.
 *
 * LA DECISION EST UNE ROUTE A PART, AVEC SON PROPRE DROIT.
 * `PATCH /api/modification-requests/:id` demande `modificationrequest:decide:any`
 * et NON `write:own`. La difference est tout l'interet du catalogue : un client
 * detient `write:own` — il depose ses demandes — et s'il pouvait atteindre cette
 * route, il approuverait les siennes. Le garde l'arrete avant le service, et le
 * service verifie en plus la portee `decide` pour que la regle tienne meme si la
 * route etait un jour montee ailleurs.
 *
 * La creation ne prend ni `clientId` ni `projectId` comme autorite : le service
 * derive le client du porteur et verifie que le projet lui appartient. Voir
 * `modification-request.service.ts`.
 */
@ApiTags('Demandes de modification')
@Controller('modification-requests')
export class ModificationRequestController {
  constructor(private readonly modificationRequests: ModificationRequestService) {}

  @Get()
  @RequireAnyPermission('modificationrequest:read:any', 'modificationrequest:read:own')
  @ApiOperation({ summary: 'Lister les demandes de modification visibles par le porteur' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListModificationRequestsQueryDto,
  ) {
    return this.modificationRequests.list(user, query);
  }

  @Get(':id')
  @RequireAnyPermission('modificationrequest:read:any', 'modificationrequest:read:own')
  @ApiOperation({ summary: 'Consulter une demande de modification' })
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.modificationRequests.findOne(user, id);
  }

  /**
   * Deposer une demande pour un de ses projets.
   *
   * `write:own` seulement : une demande de modification est, par definition,
   * formulee par le client du projet. Aucun role interne ne detient ce code, donc
   * l'agence ne peut pas deposer une demande au nom d'un client par cette route.
   */
  @Post()
  @RequirePermissions('modificationrequest:write:own')
  @ApiOperation({ summary: 'Deposer une demande de modification' })
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateModificationRequestDto) {
    return this.modificationRequests.create(user, dto);
  }

  /**
   * Approuver ou refuser.
   *
   * `decide:any` et jamais `write:own` : approuver sa propre demande serait
   * s'accorder ce qu'on demande. Le corps ne peut porter que `APPROVED` ou
   * `REJECTED` — l'avancement du travail (`IN_PROGRESS`, `DONE`) appartient au
   * module projets.
   */
  @Patch(':id')
  @RequirePermissions('modificationrequest:decide:any')
  @ApiOperation({
    summary: 'Approuver ou refuser une demande',
    description:
      'Une demande deja decidee ne se redecide pas ; le meme avis renvoye est sans effet.',
  })
  async decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DecideModificationRequestDto,
  ) {
    return this.modificationRequests.decide(user, id, dto);
  }
}
