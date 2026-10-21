import { Module } from '@nestjs/common';
import { GuideController } from './guide.controller.js';
import { GuideService } from './guide.service.js';

/**
 * MODULE GUIDE DE DÉMARRAGE.
 *
 * Volontairement minimal : un contrôleur, un service, un catalogue de données
 * pures (`guide.catalog.ts`) et des règles pures (`guide.rules.ts`). Aucune
 * base d'entraînement, aucun jeton dédié, aucune fixture : le guide parle du
 * travail réel et se contente de compter ce qui existe.
 */
@Module({
  controllers: [GuideController],
  providers: [GuideService],
})
export class GuideModule {}
