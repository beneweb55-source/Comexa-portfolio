import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PdfService } from './pdf.service.js';
import { AccessPolicy, Policy } from '../../common/auth/principal.js';
import { RequiresPolicy } from '../../common/auth/guards.js';
import { SendDocumentEmailDto } from './dto/invoice-email.dto.js';
import { UrlBuilderService } from '../../../common/services/url-builder.service.js';

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
 * Toutes les réponses incluent des URLs de redirection vers Comexa
 */

@ApiTags('PDF')
@ApiBearerAuth()
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
  @RequiresPolicy('invoice', 'read')
  @ApiOperation({ summary: 'Télécharger un PDF de facture' })
  async downloadInvoicePdf(
    @Param('id') id: string,
    @Policy() policy: AccessPolicy,
    @Res() res: Response,
  ): Promise<void> {
    const pdfBuffer = await this.pdfService.generateInvoicePdf(id, {
      includeSignature: true,
      includeTerms: true,
      language: 'fr',
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="facture-${id}.pdf"`,
    );
    res.send(pdfBuffer);
  }

  @Get('invoices/:id/preview')
  @RequiresPolicy('invoice', 'read')
  @ApiOperation({ summary: 'Aperçu inline d\'une facture en PDF' })
  async previewInvoicePdf(
    @Param('id') id: string,
    @Policy() policy: AccessPolicy,
    @Res() res: Response,
  ): Promise<void> {
    const pdfBuffer = await this.pdfService.generateInvoicePdf(id, {
      includeSignature: true,
      includeTerms: true,
      language: 'fr',
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="facture-${id}.pdf"`,
    );
    res.send(pdfBuffer);
  }

  // ---------------------------------------------------------------------------
  // Génération PDF - Devis
  // ---------------------------------------------------------------------------

  @Get('quotes/:id')
  @RequiresPolicy('quote', 'read')
  @ApiOperation({ summary: 'Télécharger un PDF de devis' })
  async downloadQuotePdf(
    @Param('id') id: string,
    @Policy() policy: AccessPolicy,
    @Res() res: Response,
  ): Promise<void> {
    const pdfBuffer = await this.pdfService.generateQuotePdf(id, {
      includeSignature: true,
      includeTerms: true,
      language: 'fr',
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="devis-${id}.pdf"`);
    res.send(pdfBuffer);
  }

  @Get('quotes/:id/preview')
  @RequiresPolicy('quote', 'read')
  @ApiOperation({ summary: 'Aperçu inline d\'un devis en PDF' })
  async previewQuotePdf(
    @Param('id') id: string,
    @Policy() policy: AccessPolicy,
    @Res() res: Response,
  ): Promise<void> {
    const pdfBuffer = await this.pdfService.generateQuotePdf(id, {
      includeSignature: true,
      includeTerms: true,
      language: 'fr',
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="devis-${id}.pdf"`);
    res.send(pdfBuffer);
  }

  // ---------------------------------------------------------------------------
  // Envoi par email avec redirections
  // ---------------------------------------------------------------------------

  @Post('invoices/:id/email')
  @RequiresPolicy('invoice', 'read')
  @ApiOperation({
    summary: 'Envoyer une facture par email avec PDF en pièce jointe',
    description:
      'Nécessite la configuration SMTP. Retourne une URL de redirection vers la facture.',
  })
  async emailInvoice(
    @Param('id') id: string,
    @Body() body: SendDocumentEmailDto,
    @Policy() policy: AccessPolicy,
  ) {
    const result = await this.pdfService.sendInvoiceByEmail(id, {
      to: body.to,
      subject: body.subject,
      message: body.message,
      includePdf: body.includePdf !== false,
      language: body.language || 'fr',
    });

    if (result.success) {
      return this.urlBuilder.buildResponse(
        result,
        {
          message: 'Facture envoyée par email avec succès',
          redirectTo: 'detail',
          resourceType: 'invoice',
          resourceId: id,
          openInNewTab: true,
        },
      );
    }

    return this.urlBuilder.buildErrorResponse(result.error || 'Erreur lors de l\'envoi');
  }

  @Post('quotes/:id/email')
  @RequiresPolicy('quote', 'read')
  @ApiOperation({
    summary: 'Envoyer un devis par email avec PDF en pièce jointe',
    description:
      'Nécessite la configuration SMTP. Retourne une URL de redirection vers le devis.',
  })
  async emailQuote(
    @Param('id') id: string,
    @Body() body: SendDocumentEmailDto,
    @Policy() policy: AccessPolicy,
  ) {
    const result = await this.pdfService.sendQuoteByEmail(id, {
      to: body.to,
      subject: body.subject,
      message: body.message,
      includePdf: body.includePdf !== false,
      language: body.language || 'fr',
    });

    if (result.success) {
      return this.urlBuilder.buildResponse(
        result,
        {
          message: 'Devis envoyé par email avec succès',
          redirectTo: 'detail',
          resourceType: 'quote',
          resourceId: id,
          openInNewTab: true,
        },
      );
    }

    return this.urlBuilder.buildErrorResponse(result.error || 'Erreur lors de l\'envoi');
  }
}
