import { Module } from '@nestjs/common';
import { CurrencyService } from './currency.service.js';
import { UrlBuilderModule } from '../../common/services/url-builder.module.js';

/**
 * MODULE DES DEVISES
 *
 * Fournit le service de gestion des devises pour l'ensemble de l'application.
 */
@Module({
  imports: [UrlBuilderModule],
  providers: [CurrencyService],
  controllers: [CurrencyController],
  exports: [CurrencyService],
})
export class CurrencyModule {}
