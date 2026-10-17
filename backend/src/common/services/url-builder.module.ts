import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UrlBuilderService } from './url-builder.service.js';

/**
 * MODULE URL BUILDER
 *
 * Fournit le service de construction d'URLs pour les redirections.
 */
@Module({
  imports: [ConfigModule],
  providers: [UrlBuilderService],
  exports: [UrlBuilderService],
})
export class UrlBuilderModule {}
