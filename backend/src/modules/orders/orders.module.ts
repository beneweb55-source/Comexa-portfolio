import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module.js';
import { CountersModule } from '../counters/counters.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { PackageRatesController } from './package-rates.controller.js';
import { PackageRatesService } from './package-rates.service.js';

/**
 * Module des COMMANDES et des TARIFS PAR PACK.
 *
 * `ActivityModule` : la validation d'une commande ecrit le fil du projet cree,
 * dans la meme transaction. `CountersModule` : references commande, client et
 * projet. Prisma et audit sont globaux.
 */
@Module({
  imports: [ActivityModule, CountersModule],
  controllers: [OrdersController, PackageRatesController],
  providers: [OrdersService, PackageRatesService],
  exports: [OrdersService],
})
export class OrdersModule {}
