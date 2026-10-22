import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import {
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/auth.decorators.js';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import type { Paginated } from '../../common/interceptors/transform.interceptor.js';
import type { Client, Contact } from '../../generated/prisma/client.js';
import { ClientsService } from './clients.service.js';
import {
  CreateClientDto,
  CreateContactDto,
  ListClientsQueryDto,
  UpdateClientDto,
} from './dto/client.dto.js';

/**
 * ROUTES DES DOSSIERS CLIENTS.
 *
 * QUI VOIT QUOI. Un compte de l'espace client detient `client:read:own` : il
 * atteint SON dossier, et rien d'autre. Le perimetre n'est pas lu dans l'URL —
 * `policy.clientId` vient du jeton et remplace l'identifiant demande (voir
 * `client-scope.ts`). C'est la reponse directe a l'exigence du cahier des
 * charges : « un client ne doit jamais pouvoir modifier l'ID d'un autre client
 * dans une requete pour acceder a ses donnees ». Un dossier vise qui n'est pas
 * le sien n'existe pas DANS SON PERIMETRE : 404, jamais 403 — un refus distinct
 * confirmerait l'existence de la ligne.
 *
 * `GET /clients` et `POST /clients` sont reservees a `client:read:any` /
 * `client:write:any` : l'espace client n'a pas a lister le portefeuille de
 * l'agence. Il lit son dossier par `GET /clients/:id`.
 *
 * `GET|POST /clients/:id/contacts` portent `client:read:own` dans leur
 * `@RequireAnyPermission` parce que le catalogue n'a PAS de `contact:read:own` :
 * sans ce code, la route serait fermee a l'espace client, qui doit pourtant
 * pouvoir lire les interlocuteurs de son propre dossier. Le service restreint
 * ensuite les lignes a `clientId = policy.clientId`, donc l'ouverture de la
 * route ne donne acces a aucun contact d'un autre client.
 */
@ApiTags('Clients')
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @RequirePermissions('client:read:any')
  @ApiOperation({ summary: 'Lister les dossiers clients (filtres et pagination).' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListClientsQueryDto,
  ): Promise<Paginated<Client>> {
    return this.clients.list(user, query);
  }

  @Post()
  @RequirePermissions('client:write:any')
  @ApiOperation({ summary: 'Creer un dossier client (saisie manuelle).' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateClientDto,
  ): Promise<Client> {
    return this.clients.create(user, dto);
  }

  @Get(':id')
  @RequireAnyPermission('client:read:any', 'client:read:own')
  @ApiOperation({ summary: "Lire un dossier client (le sien pour l'espace client)." })
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<Client> {
    return this.clients.findOne(user, id);
  }

  @Patch(':id')
  @RequirePermissions('client:write:any')
  @ApiOperation({ summary: 'Modifier un dossier client.' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateClientDto,
  ): Promise<Client> {
    return this.clients.update(user, id, dto);
  }

  /**
   * Suppression LOGIQUE d'un dossier (`deletedAt`).
   *
   * Un client porte des devis, des factures et des paiements : la ligne reste,
   * elle quitte seulement les listes. Le service refuse tant qu'un projet est
   * encore en cours — supprimer le dossier ne doit pas faire disparaitre un
   * travail que l'equipe mene encore.
   */
  @Delete(':id')
  @RequirePermissions('client:delete:any')
  @ApiOperation({ summary: 'Supprimer logiquement un dossier client.' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ deleted: true }> {
    return this.clients.remove(user, id);
  }

  @Get(':id/contacts')
  @RequireAnyPermission('contact:read:any', 'client:read:own')
  @ApiOperation({ summary: "Interlocuteurs d'un dossier, le principal en tete." })
  async listContacts(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<Contact>> {
    return this.clients.listContacts(user, id, query);
  }

  @Post(':id/contacts')
  @RequirePermissions('contact:write:any')
  @ApiOperation({
    summary: 'Ajouter un interlocuteur. Le premier principal retire le drapeau aux autres.',
  })
  async createContact(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateContactDto,
  ): Promise<Contact> {
    return this.clients.createContact(user, id, dto);
  }
}
