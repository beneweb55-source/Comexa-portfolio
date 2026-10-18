import { Module } from '@nestjs/common';
import { DistributionController } from './distribution.controller.js';
import { DistributionService } from './distribution.service.js';
import { BalanceModule } from '../balances/balance.module.js';
import { UrlBuilderModule } from '../../common/services/url-builder.module.js';

/**
 * MODULE DE RÉPARTITION DES GAINS
 *
 * Fournit le service de calcul et d'application des répartitions.
 */
@Module({
  imports: [BalanceModule, UrlBuilderModule],
  providers: [DistributionService],
  controllers: [DistributionController],
  exports: [DistributionService],
})
export class DistributionModule {}
