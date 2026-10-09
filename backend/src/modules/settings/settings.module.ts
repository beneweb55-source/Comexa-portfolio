import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

/**
 * MODULE DES PARAMETRES.
 *
 * Aucun import de module applicatif : `PrismaModule` et `AuditModule` sont
 * declares `@Global()`, et ce module ne depend d'aucun autre domaine metier — il
 * est le seul proprietaire de la table `settings`.
 *
 * A monter dans `app.module.ts`, qui n'appartient pas a ce module.
 */
@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
