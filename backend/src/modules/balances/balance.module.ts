import { Module } from '@nestjs/common';
import { BalanceController } from './balance.controller.js';
import { BalanceService } from './balance.service.js';
import { UrlBuilderModule } from '../../common/services/url-builder.module.js';

/**
 * MODULE DES SOLDES DES MEMBRES
 *
 * Fournit le service de gestion des soldes.
 */
@Module({
  imports: [UrlBuilderModule],
  providers: [BalanceService],
  controllers: [BalanceController],
  exports: [BalanceService],
})
export class BalanceModule {}
