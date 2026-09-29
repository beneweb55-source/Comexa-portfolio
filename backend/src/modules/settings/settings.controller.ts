import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { SettingsQueryDto, UpdateSettingsDto } from './dto/settings.dto.js';
import { SettingsService } from './settings.service.js';

/**
 * ROUTES DES PARAMETRES.
 *
 * Les parametres de l'application ne sont pas des donnees comme les autres :
 * ils decident du comportement de tous les autres modules (prefixe de
 * numerotation, devise par defaut, mentions legales, coordonnees de la societe).
 * Une modification ici se voit partout ailleurs.
 *
 * D'ou deux exigences, portees par le service et pas seulement par ces
 * decorateurs :
 *
 *  - la lecture des parametres internes demande le droit de MODIFICATION. Un
 *    lecteur de parametres consulte la configuration, il n'a pas a voir passer
 *    une cle d'API ;
 *  - une modification est journalisee, avec qui l'a faite et ce qui a change —
 *    mais jamais la valeur d'un secret, qui resterait alors lisible dans le
 *    journal pour toujours.
 */
@ApiTags('Parametres')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions('setting:read:any')
  @ApiOperation({ summary: "Lister les parametres (les parametres internes sont masques)" })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: SettingsQueryDto) {
    return this.settings.list(user, query);
  }

  @Patch()
  @RequirePermissions('setting:write:any')
  @ApiOperation({ summary: 'Creer ou modifier un lot de parametres, en une seule transaction' })
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateSettingsDto) {
    return this.settings.update(user, dto);
  }
}
