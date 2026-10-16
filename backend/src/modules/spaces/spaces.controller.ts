import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser, IgnoreSpace } from '../../common/decorators/auth.decorators.js';
import {
  SPACES,
  accessibleSpaces,
  effectivePermissions,
  type SpaceId,
} from '../../common/spaces/space-policy.js';

export interface SpaceView {
  id: SpaceId;
  label: string;
  description: string;
  /** Droits EFFECTIFS dans cet espace : ceux que l'API appliquera. */
  permissions: string[];
}

export interface SpacesView {
  spaces: SpaceView[];
  /** Espace proposé par défaut (équipe, sinon personnel, sinon Comexa). */
  defaultSpace: SpaceId | null;
}

/**
 * LES ESPACES ACCESSIBLES AU MEMBRE CONNECTÉ.
 *
 * Le sélecteur d'espace du frontend se construit sur cette réponse, calculée
 * par la même politique que celle que le garde applique à chaque requête :
 * l'interface ne propose jamais un espace que l'API refuserait, et les droits
 * qu'elle affiche sont exactement ceux que l'API appliquera.
 */
@ApiTags('Espaces')
@Controller('me/spaces')
export class SpacesController {
  @Get()
  @IgnoreSpace()
  @ApiOperation({ summary: 'Espaces de travail accessibles et droits effectifs dans chacun.' })
  list(@CurrentUser() user: AuthenticatedUser): SpacesView {
    const rolePermissions = user.rolePermissions ?? user.permissions;
    const principal = { ...user, permissions: rolePermissions };
    const ids = accessibleSpaces(principal);
    return {
      spaces: ids.map((id) => ({
        id,
        label: SPACES[id].label,
        description: SPACES[id].description,
        permissions: [...effectivePermissions(id, rolePermissions)].sort(),
      })),
      defaultSpace: ids.includes('team') ? 'team' : (ids[0] ?? null),
    };
  }
}
