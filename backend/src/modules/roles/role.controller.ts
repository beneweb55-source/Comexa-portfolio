import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { Session } from '../auth/auth.controller.js';
import type { SessionMeta } from '../auth/session.js';
import { ReplaceRolePermissionsDto } from './dto/role.dto.js';
import { RoleService } from './role.service.js';
import type { PermissionView, RoleDetailView, RoleView } from './role.presenter.js';

/**
 * ROLES ET CATALOGUE DE PERMISSIONS.
 *
 * UN SEUL CONTROLEUR POUR DEUX CHEMINS, et non deux controleurs.
 *
 * `@Controller()` sans prefixe, chaque methode portant son chemin complet. La
 * raison n'est pas esthetique : Nest construit les routes en concatenant le
 * prefixe du controleur et celui de la methode. Un `PermissionController`
 * declarerait `@Controller()` de son cote et ne pourrait donc rien changer au
 * prefixe global `/api` ; mais surtout, il faudrait lui donner un service —
 * alors que la lecture du catalogue n'a aucune logique propre, elle consiste a
 * lire une table. Deux controleurs, deux modules et un service bidon pour une
 * requete `findMany`, au nom d'une symetrie qui n'apprend rien a personne.
 *
 * Ce qui n'est PAS expose : la creation d'un role, et les permissions elles-memes
 * en ecriture. Voir l'en-tete de `RoleService` pour la raison — le code d'un role
 * est une valeur d'enumeration, gele dans le schema.
 */
@ApiTags('Roles et permissions')
@Controller()
export class RoleController {
  constructor(private readonly roles: RoleService) {}

  @Get('roles')
  @RequirePermissions('role:read:any')
  @ApiOperation({ summary: 'Lister les roles (sans leurs permissions).' })
  async list(@CurrentUser() actor: AuthenticatedUser): Promise<RoleView[]> {
    return this.roles.list(actor);
  }

  /**
   * Le detail d'un role.
   *
   * `:code` est le code de l'enumeration (`ADMIN`, `DEVELOPER`...), pas un
   * identifiant interne : il se lit dans l'URL et se journalise tel quel. Un code
   * inconnu rend un 404, jamais une erreur de validation Prisma — voir
   * `RoleService.getByCode`.
   */
  @Get('roles/:code')
  @RequirePermissions('role:read:any')
  @ApiOperation({ summary: "Detail d'un role et ses permissions." })
  async getByCode(
    @Param('code') code: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<RoleDetailView> {
    return this.roles.getByCode(code, actor);
  }

  @Patch('roles/:code/permissions')
  @RequirePermissions('role:manage:any')
  @ApiOperation({ summary: "Remplacer les permissions d'un role (ADMIN exclu)." })
  async replacePermissions(
    @Param('code') code: string,
    @Body() dto: ReplaceRolePermissionsDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Session() meta: SessionMeta,
  ): Promise<RoleDetailView> {
    return this.roles.replacePermissions(code, dto, actor, meta);
  }

  /**
   * Le catalogue tel qu'il est EN BASE.
   *
   * Reponse en tableau simple, sans enveloppe `{items, meta}` : le catalogue est
   * un ensemble borne (une centaine de codes), il n'a pas de page 2. Le paginer
   * obligerait l'ecran qui dessine les cases a cocher a enchainer les appels pour
   * afficher la totalite, ce qui n'apporterait rien qu'une latence.
   */
  @Get('permissions')
  @RequirePermissions('permission:read:any')
  @ApiOperation({ summary: "Le catalogue des permissions tel qu'il existe en base." })
  async listPermissions(@CurrentUser() actor: AuthenticatedUser): Promise<PermissionView[]> {
    return this.roles.listPermissions(actor);
  }
}
