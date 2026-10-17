import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExchangeRateService } from './exchange-rate.service.js';
import { PaginatedResponse } from '../../common/dto/pagination.dto.js';
import { AccessPolicy, Policy } from '../../common/auth/principal.js';
import { CurrentActor } from '../../common/auth/decorators.js';
import { RequiresPolicy } from '../../common/auth/guards.js';
import { ExchangeRate } from '../../generated/prisma/client.js';
import { UrlBuilderService } from '../../../common/services/url-builder.service.js';

/**
 * CONTRÔLEUR REST DES TAUX DE CHANGE
 *
 * Routes:
 * - GET /exchange-rates/rate - Obtenir un taux entre deux devises
 * - GET /exchange-rates/convert - Convertir un montant
 * - GET /exchange-rates/history - Historique des taux
 * - POST /exchange-rates - Ajouter un taux (ADMIN)
 * - DELETE /exchange-rates - Supprimer un taux (ADMIN)
 *
 * Toutes les réponses incluent des URLs de redirection vers Comexa
 */

@ApiTags('Exchange Rates')
@ApiBearerAuth()
@Controller('exchange-rates')
export class ExchangeRateController {
  constructor(
    private readonly exchangeRateService: ExchangeRateService,
    private readonly urlBuilder: UrlBuilderService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lecture
  // ---------------------------------------------------------------------------

  @Get('rate')
  @ApiOperation({ summary: 'Obtenir un taux de change entre deux devises' })
  @ApiOkResponse({ type: String, description: 'Taux de change (1 from = X to)' })
  async getRate(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('date') date?: string,
    @Policy() policy: AccessPolicy,
  ): Promise<string> {
    const rate = await this.exchangeRateService.getRate(
      from,
      to,
      date ? new Date(date) : undefined,
      policy,
    );
    return rate.toString();
  }

  @Get('convert')
  @ApiOperation({ summary: 'Convertir un montant d\'une devise à une autre' })
  @ApiOkResponse({ type: String, description: 'Montant converti' })
  async convert(
    @Query('amount') amount: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('date') date?: string,
    @Policy() policy: AccessPolicy,
  ): Promise<string> {
    const converted = await this.exchangeRateService.convert(
      amount,
      from,
      to,
      date ? new Date(date) : undefined,
      policy,
    );
    return converted.toString();
  }

  @Get('history')
  @ApiOperation({ summary: 'Obtenir l\'historique des taux entre deux devises' })
  @ApiOkResponse({ type: [ExchangeRate] })
  async getHistory(
    @Query('from') from: string,
    @Query('to') to: string,
    @Policy() policy: AccessPolicy,
  ): Promise<ExchangeRate[]> {
    return this.exchangeRateService.getRateHistory(from, to, policy);
  }

  // ---------------------------------------------------------------------------
  // Gestion (ADMIN)
  // ---------------------------------------------------------------------------

  @Post()
  @RequiresPolicy('exchangerate', 'manage')
  @ApiOperation({ summary: 'Ajouter ou mettre à jour un taux de change' })
  @ApiOkResponse({ type: ExchangeRate })
  async upsertRate(
    @Body() body: {
      fromCurrency: string;
      toCurrency: string;
      rate: string;
      effectiveDate?: string;
      source: string;
      reference?: string;
    },
    @CurrentActor() actor: { id: string },
    @Policy() policy: AccessPolicy,
  ) {
    const rate = await this.exchangeRateService.upsertRate(
      {
        fromCurrency: body.fromCurrency,
        toCurrency: body.toCurrency,
        rate: body.rate,
        effectiveDate: body.effectiveDate ? new Date(body.effectiveDate) : undefined,
        source: body.source,
        reference: body.reference,
      },
      actor,
      policy,
    );

    return this.urlBuilder.buildResponse(rate, {
      message: 'Taux de change ajouté avec succès',
      redirectTo: 'settings',
      resourceType: 'currency',
      openInNewTab: true,
    });
  }

  @Delete()
  @RequiresPolicy('exchangerate', 'manage')
  @ApiOperation({ summary: 'Supprimer un taux de change' })
  @ApiOkResponse({ type: ExchangeRate })
  async deleteRate(
    @Query('fromCurrency') fromCurrency: string,
    @Query('toCurrency') toCurrency: string,
    @Query('effectiveDate') effectiveDate: string,
    @CurrentActor() actor: { id: string },
    @Policy() policy: AccessPolicy,
  ) {
    const rate = await this.exchangeRateService.deleteRate(
      fromCurrency,
      toCurrency,
      new Date(effectiveDate),
      actor,
      policy,
    );

    return this.urlBuilder.buildResponse(rate, {
      message: 'Taux de change supprimé avec succès',
      redirectTo: 'settings',
      resourceType: 'currency',
      openInNewTab: true,
    });
  }
}
