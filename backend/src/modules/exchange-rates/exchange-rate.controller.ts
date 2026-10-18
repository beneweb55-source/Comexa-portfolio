import { Body, Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExchangeRateService } from './exchange-rate.service.js';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import type { ExchangeRate } from '../../generated/prisma/client.js';
import { UrlBuilderService } from '../../common/services/url-builder.service.js';
import { UpsertExchangeRateDto } from './dto/exchange-rate.dto.js';

/**
 * CONTRÔLEUR REST DES TAUX DE CHANGE
 *
 * Routes:
 * - GET /exchange-rates/rate?from=DZD&to=EUR - Taux entre deux devises
 * - GET /exchange-rates/convert?amount=1000&from=DZD&to=EUR - Conversion
 * - GET /exchange-rates/history?from=DZD&to=EUR - Historique
 * - POST /exchange-rates - Ajouter un taux (exchangerate:manage:any)
 * - DELETE /exchange-rates?from=&to=&effectiveDate= - Supprimer (manage)
 *
 * AUCUN TAUX FICTIF N'EST CRÉÉ PAR LE SYSTÈME. Chaque taux porte sa source
 * (« BCA », « ECB », « Manuel ») et sa date d'effet : un taux sans origine
 * vérifiable convertit mal une facture, et l'erreur ne se voit qu'au
 * règlement. C'est pourquoi la création est réservée à l'administrateur, et
 * pourquoi la suppression passe par la paire complète (devises + date) plutôt
 * que par un identifiant — supprimer « le » taux DZD→EUR n'aurait pas de sens
 * quand l'historique en compte plusieurs.
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
  @RequirePermissions('exchangerate:read:any')
  @ApiOperation({ summary: 'Obtenir un taux de change entre deux devises' })
  @ApiOkResponse({ type: String, description: 'Taux de change (1 from = X to)' })
  async getRate(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('date') date: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<string> {
    const rate = await this.exchangeRateService.getRate(
      from,
      to,
      date ? new Date(date) : undefined,
      new AccessPolicy(user),
    );
    // Le taux voyage en CHAÎNE, pas en nombre : un flottant perd la précision
    // d'un taux à 6 décimales, et un front qui recalcule avec lui reporte
    // l'erreur sur chaque montant converti.
    return rate.toString();
  }

  @Get('convert')
  @RequirePermissions('exchangerate:read:any')
  @ApiOperation({ summary: "Convertir un montant d'une devise à une autre" })
  @ApiOkResponse({ type: String, description: 'Montant converti' })
  async convert(
    @Query('amount') amount: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('date') date: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<string> {
    const converted = await this.exchangeRateService.convert(
      amount,
      from,
      to,
      date ? new Date(date) : undefined,
      new AccessPolicy(user),
    );
    return converted.toString();
  }

  @Get('history')
  @RequirePermissions('exchangerate:read:any')
  @ApiOperation({ summary: 'Obtenir l\'historique des taux entre deux devises' })
  async getHistory(
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ExchangeRate[]> {
    return this.exchangeRateService.getRateHistory(from, to, new AccessPolicy(user));
  }

  // ---------------------------------------------------------------------------
  // Gestion (ADMIN)
  // ---------------------------------------------------------------------------

  @Post()
  @RequirePermissions('exchangerate:manage:any')
  @ApiOperation({ summary: 'Ajouter ou mettre à jour un taux de change' })
  async upsertRate(
    // Le DTO porte la validation (`@IsDecimal({ decimal_digits: '19,6' })` sur
    // le taux, `@IsNotEmpty()` sur la source). Le type inline qu'il remplace
    // n'imposait RIEN : un `rate` valant « abc » ou une source vide passaient
    // et finissaient soit en erreur 500 au calcul, soit en taux inutilisable en
    // base. Une route d'écriture sans DTO est une route sans contrat.
    @Body() body: UpsertExchangeRateDto,
    @CurrentUser() user: AuthenticatedUser,
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
      { id: user.id },
      new AccessPolicy(user),
    );

    // AUCUNE redirection forcée : l'ajout se fait depuis l'onglet « Taux de
    // change » des réglages. Renvoyer vers cette même page rechargerait la
    // page et fermerait le formulaire en cours de saisie. La réponse porte le
    // verbe ; la page se rafraîchit d'elle-même.
    return this.urlBuilder.buildResponse(rate, {
      message: 'Taux de change enregistré avec succès',
      resourceType: 'currency',
    });
  }

  @Delete()
  @RequirePermissions('exchangerate:manage:any')
  @ApiOperation({ summary: 'Supprimer un taux de change' })
  async deleteRate(
    @Query('fromCurrency') fromCurrency: string,
    @Query('toCurrency') toCurrency: string,
    @Query('effectiveDate') effectiveDate: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const rate = await this.exchangeRateService.deleteRate(
      fromCurrency,
      toCurrency,
      new Date(effectiveDate),
      { id: user.id },
      new AccessPolicy(user),
    );

    return this.urlBuilder.buildResponse(rate, {
      message: 'Taux de change supprimé avec succès',
      resourceType: 'currency',
    });
  }
}
