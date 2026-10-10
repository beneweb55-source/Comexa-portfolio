import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { CreatePackageRateDto } from './dto/package-rate.dto.js';
import { PackageRatesService } from './package-rates.service.js';

/**
 * Tarifs d'un pack, geres depuis l'espace equipe. Routes sous `content/packages`
 * pour rester avec les autres routes des packs.
 */
@ApiTags('Packs — tarifs')
@Controller('content/packages/:packageId/rates')
export class PackageRatesController {
  constructor(private readonly rates: PackageRatesService) {}

  @Get()
  @RequirePermissions('package:read:any')
  @ApiOperation({ summary: "Lister les tarifs d'un pack, toutes devises et dates confondues." })
  list(@Param('packageId') packageId: string) {
    return this.rates.list(packageId);
  }

  @Post()
  @RequirePermissions('package:write:any')
  @ApiOperation({ summary: 'Ajouter un tarif (nouvelle ligne, jamais une modification).' })
  create(
    @Param('packageId') packageId: string,
    @Body() dto: CreatePackageRateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rates.create(packageId, dto, user);
  }

  @Patch(':rateId/deactivate')
  @RequirePermissions('package:write:any')
  @ApiOperation({ summary: 'Retirer un tarif de la vente. La ligne reste pour l historique.' })
  deactivate(
    @Param('packageId') packageId: string,
    @Param('rateId') rateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rates.deactivate(packageId, rateId, user);
  }
}
