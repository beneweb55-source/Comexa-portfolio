import { Module } from '@nestjs/common';
import { PdfController } from './pdf.controller.js';
import { ConfigModule } from '@nestjs/config';
import { PdfService } from './pdf.service.js';
import { UrlBuilderModule } from '../../common/services/url-builder.module.js';
import { MailModule } from '../../common/mail/mail.module.js';

/**
 * MODULE DE GÉNÉRATION PDF
 *
 * Fournit le service de génération de PDF pour les factures et devis.
 * Utilise le service Mail existant pour l'envoi par email.
 *
 * `MailModule` N'ÉTAIT PAS IMPORTÉ, ET CE N'ÉTAIT PAS UN OUBLI SANS
 * CONSÉQUENCE : `PdfService` injecte `MailService` pour envoyer une facture ou
 * un devis par courriel. Sans cet import, l'application refusait de démarrer —
 * « Nest can't resolve dependencies of the PdfService (PrismaService,
 * ConfigService, ?) ». C'est la seconde moitié du défaut qui rendait `/api/pdf`
 * invisible : le module n'était monté nulle part (donc jamais instancié), et il
 * n'aurait de toute façon pas pu l'être. La documentation de `MailModule`
 * annonce précisément ce cas — « l'envoi d'un devis et d'un envoi de facture
 * passent aussi par là » — avec l'avertissement contre la duplication du
 * provider : deux instances, deux transports SMTP. On l'importe, on ne le
 * redéclare pas.
 */
@Module({
  imports: [ConfigModule, UrlBuilderModule, MailModule],
  providers: [PdfService],
  controllers: [PdfController],
  exports: [PdfService],
})
export class PdfModule {}
