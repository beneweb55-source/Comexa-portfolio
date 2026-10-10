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
import type { Paginated } from '../../common/interceptors/transform.interceptor.js';
import { Session } from '../auth/auth.controller.js';
import type { SessionMeta } from '../auth/session.js';
import {
  CreateUserDto,
  ListUsersQueryDto,
  SetUserRolesDto,
  UpdateUserDto,
} from './dto/user.dto.js';
import { UserService, type CreatedAccount } from './user.service.js';
import type { UserView } from './user.presenter.js';

/**
 * ROUTES D'ADMINISTRATION DES COMPTES.
 *
 * DEUX NIVEAUX, ET LES DEUX SONT NECESSAIRES.
 *
 * Le `@RequirePermissions` de chaque route repond a « ce porteur a-t-il le droit
 * d'appeler cette adresse ? ». Le `new AccessPolicy(...)` du service repond a
 * « quelles lignes ce porteur peut-il voir ? ». Le garde seul laisserait un
 * porteur de `user:read:own` lire l'annuaire entier ; le service seul laisserait
 * un porteur sans aucun droit atteindre le code et dependre d'un oubli. Les deux
 * sont donc ecrits, et aucune route ci-dessous n'en dispense.
 *
 * LES QUATRE ROUTES `POST` QUI AGISSENT SUR UN COMPTE EXISTANT SONT EN 200, PAS
 * EN 201. Elles ne creent rien : elles changent un etat. Repondre 201 ferait
 * croire a un client qu'une ressource vient de naitre, et un `Location` serait
 * attendu la ou il n'y a rien a pointer. Seule la creation d'un compte rend 201
 * — le defaut de Nest pour un `POST`, qu'on laisse tel quel.
 */
@ApiTags('Utilisateurs')
@Controller('users')
export class UserController {
  constructor(private readonly users: UserService) {}

  @Get()
  @RequirePermissions('user:read:any')
  @ApiOperation({ summary: 'Lister les comptes (filtres : statut, role, recherche).' })
  async list(
    @Query() query: ListUsersQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Paginated<UserView>> {
    return this.users.list(query, actor);
  }

  /**
   * Cree un compte et rend son mot de passe initial.
   *
   * C'est la SEULE reponse de toute l'API qui contient un mot de passe en clair,
   * et elle ne peut pas etre rejouee : ni `GET /users/:id`, ni un nouvel appel a
   * cette route ne le rendront. Si l'administrateur ferme l'ecran avant de le
   * transmettre, la seule issue est `POST /users/:id/reset-password` — ce qui est
   * le comportement voulu, parce qu'un mot de passe relisible serait un mot de
   * passe stocke quelque part.
   */
  @Post()
  @RequirePermissions('user:manage:any')
  @ApiOperation({ summary: "Creer un compte. Le mot de passe genere n'est renvoye qu'ici." })
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Session() meta: SessionMeta,
  ): Promise<CreatedAccount> {
    return this.users.create(dto, actor, meta);
  }

  /**
   * Profil d'un compte.
   *
   * DEUX CODES POUR UNE SEULE ROUTE, ET LE SERVICE TRANCHE ENSUITE. `user:read:own`
   * ouvre l'acces au compte du porteur ; `user:read:any` a tous les autres. Le
   * perimetre n'est pas lu dans l'URL — il est applique par le service, qui rend
   * un compte hors perimetre INTROUVABLE (404 `USER_NOT_FOUND`) et non interdit
   * (403). Un 403 distinct confirmerait l'existence du compte vise : c'est
   * exactement ce que l'exigence du cahier des charges cherche a empecher.
   *
   * Un porteur de `user:read:own` ne peut PAS lister l'annuaire : `GET /users`
   * reste ferme a `user:read:any`, et le garde y repond 403 avant que le service
   * soit appele.
   */
  @Get(':id')
  @RequireAnyPermission('user:read:any', 'user:read:own')
  @ApiOperation({ summary: "Profil d'un compte et ses roles (le sien pour un porteur `own`)." })
  async getById(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<UserView> {
    return this.users.getById(id, actor);
  }

  /**
   * Met a jour un profil.
   *
   * Ni le statut ni les roles ne passent par ici : voir `UpdateUserDto`. Un
   * `PATCH` ordinaire ne doit pas pouvoir suspendre un compte ni accorder un
   * role, sans quoi les regles portees par les routes dediees seraient
   * contournables.
   *
   * `clientId` en revanche passe par ici, et c'est le seul champ de cette route
   * qui deplace un PERIMETRE : il faut donc, en plus de `user:write:any`, que le
   * porteur puisse lire le dossier vise (`client:read:any`) et que le compte
   * porte le role CLIENT. Les deux refus sont prononces par le service.
   */
  @Patch(':id')
  @RequirePermissions('user:write:any')
  @ApiOperation({
    summary:
      "Modifier l'identite d'un compte (nom, prenom, e-mail, telephone, rattachement client).",
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Session() meta: SessionMeta,
  ): Promise<UserView> {
    return this.users.update(id, dto, actor, meta);
  }

  @Delete(':id')
  @RequirePermissions('user:manage:any')
  @ApiOperation({ summary: 'Supprimer un compte (suppression logique) et fermer ses sessions.' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Session() meta: SessionMeta,
  ): Promise<{ deleted: true; sessionsRevoked: number }> {
    return this.users.remove(id, actor, meta);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('user:manage:any')
  @ApiOperation({ summary: 'Suspendre un compte et fermer ses sessions.' })
  async suspend(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Session() meta: SessionMeta,
  ): Promise<{ user: UserView; sessionsRevoked: number }> {
    return this.users.suspend(id, actor, meta);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('user:manage:any')
  @ApiOperation({ summary: 'Remettre en service un compte suspendu.' })
  async reactivate(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Session() meta: SessionMeta,
  ): Promise<{ user: UserView }> {
    return this.users.reactivate(id, actor, meta);
  }

  @Post(':id/roles')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('user:manage:any')
  @ApiOperation({ summary: "Remplacer les roles d'un compte." })
  async setRoles(
    @Param('id') id: string,
    @Body() dto: SetUserRolesDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Session() meta: SessionMeta,
  ): Promise<UserView> {
    return this.users.setRoles(id, dto, actor, meta);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('user:manage:any')
  @ApiOperation({
    summary:
      "Reinitialiser le mot de passe d'un compte. Le nouveau mot de passe n'est renvoye qu'ici.",
  })
  async resetPassword(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Session() meta: SessionMeta,
  ): Promise<CreatedAccount> {
    return this.users.resetPassword(id, actor, meta);
  }
}
