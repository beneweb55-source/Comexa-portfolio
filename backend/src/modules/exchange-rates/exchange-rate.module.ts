import { Module } from '@nestjs/common';
import { ExchangeRateService } from './exchange-rate.service.js';
import { CurrencyModule } from '../currencies/currency.module.js';
import { UrlBuilderModule } from '../../common/services/url-builder.module.js';

/**
 * MODULE DES TAUX DE CHANGE
 *
 * Fournit le service de gestion des taux de change.
 */
@Module({
  imports: [CurrencyModule, UrlBuilderModule],
  providers: [ExchangeRateService],
  controllers: [ExchangeRateController],
  exports: [ExchangeRateService],
})
export class ExchangeRateModule {}
