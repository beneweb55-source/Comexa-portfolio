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
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import {
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/auth.decorators.js';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import type { Paginated } from '../../common/interceptors/transform.interceptor.js';
import type { Prospect } from '../../generated/prisma/client.js';
import {
  ChangeProspectStatusDto,
  CreateProspectDto,
  ListProspectsQueryDto,
  UpdateProspectDto,
} from './dto/prospect.dto.js';
import {
  ProspectsService,
  type ProspectConversion,
  type ProspectHistoryEntry,
} from './prospects.service.js';

/**
 * ROUTES DU PIPELINE COMMERCIAL.
 *
 * DEUX NIVEAUX D'AUTORISATION, ET ILS NE DISENT PAS LA MEME CHOSE.
 *
 * `@RequireAnyPermission` autorise l'APPEL : le porteur detient au moins un des
 * codes, la route s'ouvre. Il ne dit rien des LIGNES. C'est le service qui les
 * restreint, en posant le perimetre dans le `where` Prisma (voir
 * `prospect-scope.ts`). Une route ouverte a `prospect:read:any` ET
 * `prospect:read:own` ne dit donc pas encore quels prospects reviennent — les
 * deux verrous sont necessaires, et c'est le second qui empeche un commercial de
 * lire le portefeuille d'un collegue.
 *
 * LES CODES SONT ECRITS EN CLAIR. Les importer depuis le catalogue obligerait a
 * l'importer en entier ici. Le typage est rattrape par
 * `permissions.catalogue.spec.ts`, qui verifie que tout code cite dans un
 * controleur existe bien : une faute de frappe fait echouer la suite de tests
 * plutot que de refuser un acces legitime en production.
 *
 * AUCUN CODE DEDIE AU CHANGEMENT D'ETAPE. Le catalogue n'a pas de
 * `prospect:status:*` : deployer l'etape est un ecrit sur la fiche, donc
 * `prospect:write:*`. Un code distinct serait preferable le jour ou l'on voudra
 * distinguer « corriger une fiche » de « deplacer une affaire » — a signaler au
 * coordonnateur, ce n'est pas une decision de ce module.
 */
@ApiTags('Prospects')
@Controller('prospects')
export class ProspectsController {
  constructor(private readonly prospects: ProspectsService) {}

  @Get()
  @RequireAnyPermission('prospect:read:any', 'prospect:read:own')
  @ApiOperation({ summary: 'Lister les prospects accessibles (filtres et pagination).' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListProspectsQueryDto,
  ): Promise<Paginated<Prospect>> {
    return this.prospects.list(user, query);
  }

  @Post()
  @RequireAnyPermission('prospect:write:any', 'prospect:write:own')
  @ApiOperation({ summary: 'Creer un prospect. Le statut initial est NEW.' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProspectDto,
  ): Promise<Prospect> {
    return this.prospects.create(user, dto);
  }

  @Get(':id')
  @RequireAnyPermission('prospect:read:any', 'prospect:read:own')
  @ApiOperation({ summary: 'Lire une fiche prospect.' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<Prospect> {
    return this.prospects.findOne(user, id);
  }

  @Patch(':id')
  @RequireAnyPermission('prospect:write:any', 'prospect:write:own')
  @ApiOperation({ summary: 'Modifier une fiche. Le statut ne se change pas ici.' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateProspectDto,
  ): Promise<Prospect> {
    return this.prospects.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('prospect:delete:any')
  @ApiOperation({ summary: 'Supprimer logiquement un prospect (refuse si deja converti).' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ deleted: true }> {
    return this.prospects.remove(user, id);
  }

  /**
   * `@HttpCode(HttpStatus.OK)` parce que la route MODIFIE une ressource
   * existante sans en creer : un 201 annoncerait une creation qui n'a pas eu
   * lieu, et la reponse contient la fiche a jour, pas une localisation.
   */
  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @RequireAnyPermission('prospect:write:any', 'prospect:write:own')
  @ApiOperation({ summary: "Deplacer la fiche dans le pipeline (ecrit l'historique)." })
  async changeStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ChangeProspectStatusDto,
  ): Promise<Prospect> {
    return this.prospects.changeStatus(user, id, dto);
  }

  @Get(':id/history')
  @RequireAnyPermission('prospect:read:any', 'prospect:read:own')
  @ApiOperation({ summary: 'Journal des etapes, du plus ancien au plus recent.' })
  async history(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<ProspectHistoryEntry>> {
    return this.prospects.history(user, id, query);
  }

  @Post(':id/convert')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('prospect:convert:any')
  @ApiOperation({
    summary: 'Convertir en client : ouvre le dossier client. Refuse si deja converti.',
  })
  async convert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ProspectConversion> {
    return this.prospects.convert(user, id);
  }
}
