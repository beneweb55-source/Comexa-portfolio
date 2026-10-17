import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PdfService } from './pdf.service.js';
import { UrlBuilderModule } from '../../common/services/url-builder.module.js';

/**
 * MODULE DE GÉNÉRATION PDF
 *
 * Fournit le service de génération de PDF pour les factures et devis.
 * Utilise le service Mail existant pour l'envoi par email.
 */
@Module({
  imports: [ConfigModule, UrlBuilderModule],
  providers: [PdfService],
  controllers: [PdfController],
  exports: [PdfService],
})
export class PdfModule {}
