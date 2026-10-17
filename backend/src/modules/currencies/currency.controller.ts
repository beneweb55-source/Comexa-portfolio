import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrencyService } from './currency.service.js';
import { CreateCurrencyDto, ListCurrenciesQueryDto, UpdateCurrencyDto } from './dto/currency.dto.js';
import { PaginatedResponse } from '../../common/dto/pagination.dto.js';
import { AccessPolicy, Policy, SCOPE_ANY } from '../../common/auth/principal.js';
import { CurrentActor, RequiresPolicy } from '../../common/auth/guards.js';
import { CurrentUser } from '../../common/auth/decorators.js';
import { Currency } from '../../generated/prisma/client.js';
import { UrlBuilderService } from '../../../common/services/url-builder.service.js';

/**
 * CONTRÔLEUR REST DES DEVISES
 *
 * Routes:
 * - GET /currencies - Lister les devises
 * - GET /currencies/default - Obtenir la devise par défaut
 * - GET /currencies/:code - Obtenir une devise par son code
 * - POST /currencies - Créer une nouvelle devise (ADMIN)
 * - PATCH /currencies/:id - Mettre à jour une devise (ADMIN)
 * - DELETE /currencies/:id - Désactiver une devise (ADMIN)
 *
 * Toutes les réponses incluent des URLs de redirection vers Comexa
 */

@ApiTags('Currencies')
@ApiBearerAuth()
@Controller('currencies')
export class CurrencyController {
  constructor(
    private readonly currencyService: CurrencyService,
    private readonly urlBuilder: UrlBuilderService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lecture
  // ---------------------------------------------------------------------------

  @Get()
  @ApiOperation({ summary: 'Lister toutes les devises' })
  @ApiOkResponse({ type: [Currency] })
  async list(
    @Query() query: ListCurrenciesQueryDto,
    @Policy() policy: AccessPolicy,
  ): Promise<PaginatedResponse<Currency>> {
    const currencies = query.activeOnly
      ? await this.currencyService.getAllActive(policy)
      : await this.currencyService.getAll(policy);

    return PaginatedResponse.of(currencies, currencies.length, { page: 1, perPage: currencies.length });
  }

  @Get('default')
  @ApiOperation({ summary: 'Obtenir la devise par défaut' })
  @ApiOkResponse({ type: Currency })
  async getDefault(@Policy() policy: AccessPolicy): Promise<Currency> {
    return this.currencyService.getDefault(policy);
  }

  @Get(':code')
  @ApiOperation({ summary: 'Obtenir une devise par son code' })
  @ApiOkResponse({ type: Currency })
  async getByCode(
    @Param('code') code: string,
    @Policy() policy: AccessPolicy,
  ): Promise<Currency | null> {
    return this.currencyService.getByCode(code, policy);
  }

  // ---------------------------------------------------------------------------
  // Gestion (ADMIN)
  // ---------------------------------------------------------------------------

  @Post()
  @RequiresPolicy('currency', 'manage')
  @ApiOperation({ summary: 'Créer une nouvelle devise' })
  @ApiOkResponse({ type: Currency })
  async create(
    @Body() dto: CreateCurrencyDto,
    @CurrentActor() actor: { id: string },
    @Policy() policy: AccessPolicy,
  ) {
    const currency = await this.currencyService.create(
      {
        code: dto.code,
        name: dto.name,
        symbol: dto.symbol,
        isDefault: dto.isDefault,
      },
      actor,
      policy,
    );

    return this.urlBuilder.buildResponse(currency, {
      message: 'Devise créée avec succès',
      redirectTo: 'settings',
      resourceType: 'currency',
      openInNewTab: true,
    });
  }

  @Patch(':id')
  @RequiresPolicy('currency', 'manage')
  @ApiOperation({ summary: 'Mettre à jour une devise' })
  @ApiOkResponse({ type: Currency })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCurrencyDto,
    @CurrentActor() actor: { id: string },
    @Policy() policy: AccessPolicy,
  ) {
    const currency = await this.currencyService.update(id, dto, actor, policy);

    return this.urlBuilder.buildResponse(currency, {
      message: 'Devise mise à jour avec succès',
      redirectTo: 'settings',
      resourceType: 'currency',
      openInNewTab: true,
    });
  }

  @Delete(':id')
  @RequiresPolicy('currency', 'manage')
  @ApiOperation({ summary: 'Désactiver une devise' })
  @ApiOkResponse({ type: Currency })
  async deactivate(
    @Param('id') id: string,
    @CurrentActor() actor: { id: string },
    @Policy() policy: AccessPolicy,
  ) {
    const currency = await this.currencyService.deactivate(id, actor, policy);

    return this.urlBuilder.buildResponse(currency, {
      message: 'Devise désactivée avec succès',
      redirectTo: 'settings',
      resourceType: 'currency',
      openInNewTab: true,
    });
  }
}
