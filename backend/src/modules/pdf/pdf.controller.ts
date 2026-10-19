import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PdfService } from './pdf.service.js';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import {
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/auth.decorators.js';
import { SendDocumentEmailDto } from './dto/invoice-email.dto.js';
import { UrlBuilderService } from '../../common/services/url-builder.service.js';
import { AppException } from '../../common/errors/app-error.js';

/**
 * CONTRÔLEUR REST POUR LA GÉNÉRATION PDF
 *
 * Routes:
 * - GET /pdf/invoices/:id - Télécharger PDF d'une facture
 * - GET /pdf/invoices/:id/preview - Aperçu inline d'une facture
 * - GET /pdf/quotes/:id - Télécharger PDF d'un devis
 * - GET /pdf/quotes/:id/preview - Aperçu inline d'un devis
 * - POST /pdf/invoices/:id/email - Envoyer une facture par email
 * - POST /pdf/quotes/:id/email - Envoyer un devis par email
 *
 * LES MÊMES PORTES QUE LES RESSOURCES ELLES-MÊMES, ET POUR LA MÊME RAISON :
 * lire un PDF, c'est lire la facture. Un portail client qui peut consulter SA
 * facture doit pouvoir la télécharger — d'où `RequireAnyPermission` avec les
 * deux portées, exactement comme `GET /invoices/:id`. En revanche l'ENVOI
 * part de chez nous vers le client : il est réservé à l'équipe
 * (`invoice:send:any` / `quote:send:any`), comme sur les contrôleurs
 * factures et devis. Un compte client ne déclenche donc pas l'envoi de son
 * propre document.
 *
 * `AccessPolicy` est construit ici puis transmis : le service PDF lit la
 * facture AVANT de la rendre, et cette lecture doit obéir au même périmètre
 * que la lecture HTTP — sinon un PDF deviendrait un contournement du
 * contrôle d'accès de la ressource.
 */

@ApiTags('PDF')
@Controller('pdf')
export class PdfController {
  constructor(
    private readonly pdfService: PdfService,
    private readonly urlBuilder: UrlBuilderService,
  ) {}

  // ---------------------------------------------------------------------------
  // Génération PDF - Factures
  // ---------------------------------------------------------------------------

  @Get('invoices/:id')
  @RequireAnyPermission('invoice:read:any', 'invoice:read:own')
  @ApiOperation({ summary: 'Télécharger un PDF de facture' })
  async downloadInvoicePdf(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const policy = new AccessPolicy(user);
    const reference = await this.pdfService.getDocumentReference('invoice', id, policy);
    const pdfBuffer = await this.pdfService.generateInvoicePdf(
      id,
      { includeSignature: true, includeTerms: true, language: 'fr' },
      policy,
    );
    this.sendPdf(res, pdfBuffer, 'FACTURE', reference, false);
  }

  @Get('invoices/:id/preview')
  @RequireAnyPermission('invoice:read:any', 'invoice:read:own')
  @ApiOperation({ summary: "Aperçu inline d'une facture en PDF" })
  async previewInvoicePdf(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const policy = new AccessPolicy(user);
    const reference = await this.pdfService.getDocumentReference('invoice', id, policy);
    const pdfBuffer = await this.pdfService.generateInvoicePdf(
      id,
      { includeSignature: true, includeTerms: true, language: 'fr' },
      policy,
    );
    this.sendPdf(res, pdfBuffer, 'FACTURE', reference, true);
  }

  // ---------------------------------------------------------------------------
  // Génération PDF - Devis
  // ---------------------------------------------------------------------------

  @Get('quotes/:id')
  @RequireAnyPermission('quote:read:any', 'quote:read:own')
  @ApiOperation({ summary: 'Télécharger un PDF de devis' })
  async downloadQuotePdf(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const policy = new AccessPolicy(user);
    const reference = await this.pdfService.getDocumentReference('quote', id, policy);
    const pdfBuffer = await this.pdfService.generateQuotePdf(
      id,
      { includeSignature: true, includeTerms: true, language: 'fr' },
      policy,
    );
    this.sendPdf(res, pdfBuffer, 'DEVIS', reference, false);
  }

  @Get('quotes/:id/preview')
  @RequireAnyPermission('quote:read:any', 'quote:read:own')
  @ApiOperation({ summary: "Aperçu inline d'un devis en PDF" })
  async previewQuotePdf(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const policy = new AccessPolicy(user);
    const reference = await this.pdfService.getDocumentReference('quote', id, policy);
    const pdfBuffer = await this.pdfService.generateQuotePdf(
      id,
      { includeSignature: true, includeTerms: true, language: 'fr' },
      policy,
    );
    this.sendPdf(res, pdfBuffer, 'DEVIS', reference, true);
  }

  /** Réponse PDF privée, typée et non mise en cache par un proxy partagé. */
  private sendPdf(
    response: Response,
    buffer: Buffer,
    documentType: 'FACTURE' | 'DEVIS',
    reference: string,
    inline: boolean,
  ): void {
    if (buffer.length < 8 || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw AppException.internal(
        'PDF_GENERATION_FAILED',
        'La génération du document n’a pas produit un PDF valide.',
      );
    }
    const safeReference = reference.replace(/[^A-Za-z0-9._-]/g, '-');
    const filename = `COMEXA-${documentType}-${safeReference}.pdf`;
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Length', String(buffer.length));
    response.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
    );
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(buffer);
  }

  // ---------------------------------------------------------------------------
  // Envoi par email avec redirections
  // ---------------------------------------------------------------------------

  @Post('invoices/:id/email')
  @RequirePermissions('invoice:send:any')
  @ApiOperation({
    summary: 'Envoyer une facture par email avec PDF en pièce jointe',
    description:
      'Nécessite la configuration SMTP. Retourne une URL de redirection vers la facture.',
  })
  async emailInvoice(
    @Param('id') id: string,
    @Body() body: SendDocumentEmailDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // La politique est transmise au service : c'est elle qui décide si CE
    // porteur a le droit de voir CETTE facture, pas seulement d'envoyer des factures en
    // général. Le document est relu avec ce périmètre avant mise en pièce jointe.
    const result = await this.pdfService.sendInvoiceByEmail(
      id,
      {
        to: body.to,
        subject: body.subject,
        message: body.message,
        includePdf: body.includePdf !== false,
        language: body.language || 'fr',
      },
      new AccessPolicy(user),
    );

    if (result.success) {
      return this.urlBuilder.buildResponse(result, {
        message: 'Facture envoyée par email avec succès',
        redirectTo: 'detail',
        resourceType: 'invoice',
        resourceId: id,
        openInNewTab: false,
      });
    }

    return this.urlBuilder.buildErrorResponse(result.error || "Erreur lors de l'envoi");
  }

  @Post('quotes/:id/email')
  @RequirePermissions('quote:send:any')
  @ApiOperation({
    summary: 'Envoyer un devis par email avec PDF en pièce jointe',
    description: 'Nécessite la configuration SMTP. Retourne une URL de redirection vers le devis.',
  })
  async emailQuote(
    @Param('id') id: string,
    @Body() body: SendDocumentEmailDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // La politique est transmise au service : c'est elle qui décide si CE
    // porteur a le droit de voir CETTE devis, pas seulement d'envoyer des devis en
    // général. Le document est relu avec ce périmètre avant mise en pièce jointe.
    const result = await this.pdfService.sendQuoteByEmail(
      id,
      {
        to: body.to,
        subject: body.subject,
        message: body.message,
        includePdf: body.includePdf !== false,
        language: body.language || 'fr',
      },
      new AccessPolicy(user),
    );

    if (result.success) {
      return this.urlBuilder.buildResponse(result, {
        message: 'Devis envoyé par email avec succès',
        redirectTo: 'detail',
        resourceType: 'quote',
        resourceId: id,
        openInNewTab: false,
      });
    }

    return this.urlBuilder.buildErrorResponse(result.error || "Erreur lors de l'envoi");
  }
}
