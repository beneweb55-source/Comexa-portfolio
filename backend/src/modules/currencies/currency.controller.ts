import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrencyService } from './currency.service.js';
import {
  CreateCurrencyDto,
  ListCurrenciesQueryDto,
  UpdateCurrencyDto,
} from './dto/currency.dto.js';
import { paginated, resolvePagination, type Paginated } from '../../common/dto/pagination.dto.js';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import type { Currency } from '../../generated/prisma/client.js';
import { UrlBuilderService } from '../../common/services/url-builder.service.js';

/**
 * CONTRÔLEUR REST DES DEVISES
 *
 * Routes:
 * - GET /currencies - Lister les devises
 * - GET /currencies/default - Obtenir la devise par défaut
 * - GET /currencies/:code - Obtenir une devise par son code
 * - POST /currencies - Créer une nouvelle devise (currency:manage:any)
 * - PATCH /currencies/:id - Mettre à jour une devise (currency:manage:any)
 * - DELETE /currencies/:id - Désactiver une devise (currency:manage:any)
 *
 * La lecture est ouverte à tout compte authentifié porteur de
 * `currency:read:any` (les devises alimentent les formulaires de devis et de
 * factures, pas seulement l'administration). L'écriture est réservée à
 * l'administrateur : la liste des devises est une donnée de RÉFÉRENCE — en
 * ajouter une à la légère multiplie les conversions possibles sans taux
 * vérifiable derrière.
 */

@ApiTags('Currencies')
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
  @RequirePermissions('currency:read:any')
  @ApiOperation({ summary: 'Lister toutes les devises' })
  async list(
    @Query() query: ListCurrenciesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<Currency>> {
    const policy = new AccessPolicy(user);
    const currencies = query.activeOnly
      ? await this.currencyService.getAllActive(policy)
      : await this.currencyService.getAll(policy);

    // La liste est courte par nature (une poignée de devises) : on la rend
    // malgré tout paginée, avec la taille réelle, pour que le contrat de
    // réponse soit le même partout dans l'API — un client qui lit `meta.total`
    // n'a pas à savoir que cette collection est particulière.
    return paginated(
      currencies,
      currencies.length,
      resolvePagination({ page: 1, perPage: currencies.length }),
    );
  }

  @Get('default')
  @RequirePermissions('currency:read:any')
  @ApiOperation({ summary: 'Obtenir la devise par défaut' })
  async getDefault(@CurrentUser() user: AuthenticatedUser): Promise<Currency> {
    return this.currencyService.getDefault(new AccessPolicy(user));
  }

  @Get(':code')
  @RequirePermissions('currency:read:any')
  @ApiOperation({ summary: 'Obtenir une devise par son code' })
  async getByCode(
    @Param('code') code: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Currency | null> {
    return this.currencyService.getByCode(code, new AccessPolicy(user));
  }

  // ---------------------------------------------------------------------------
  // Gestion (ADMIN)
  // ---------------------------------------------------------------------------

  @Post()
  @RequirePermissions('currency:manage:any')
  @ApiOperation({ summary: 'Créer une nouvelle devise' })
  async create(@Body() dto: CreateCurrencyDto, @CurrentUser() user: AuthenticatedUser) {
    const currency = await this.currencyService.create(
      {
        code: dto.code,
        name: dto.name,
        symbol: dto.symbol,
        isDefault: dto.isDefault,
      },
      { id: user.id },
      new AccessPolicy(user),
    );

    return this.urlBuilder.buildResponse(currency, {
      message: 'Devise créée avec succès',
      resourceType: 'currency',
    });
  }

  @Patch(':id')
  @RequirePermissions('currency:manage:any')
  @ApiOperation({ summary: 'Mettre à jour une devise' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCurrencyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const currency = await this.currencyService.update(
      id,
      dto,
      { id: user.id },
      new AccessPolicy(user),
    );

    return this.urlBuilder.buildResponse(currency, {
      message: 'Devise mise à jour avec succès',
      resourceType: 'currency',
    });
  }

  @Delete(':id')
  @RequirePermissions('currency:manage:any')
  @ApiOperation({ summary: 'Désactiver une devise' })
  async deactivate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const currency = await this.currencyService.deactivate(
      id,
      { id: user.id },
      new AccessPolicy(user),
    );

    return this.urlBuilder.buildResponse(currency, {
      message: 'Devise désactivée avec succès',
      resourceType: 'currency',
    });
  }
}
