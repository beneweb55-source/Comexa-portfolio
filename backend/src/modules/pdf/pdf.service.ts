import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCanvas, loadImage } from 'canvas';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { createTransport, type Transporter } from 'nodemailer';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppException } from '../../common/errors/app-error.js';
import { MailService } from '../../common/mail/mail.service.js';

/**
 * SERVICE DE GÉNÉRATION PDF POUR FACTURES ET DEVIS
 *
 * Ce service permet de:
 * - Générer des PDF professionnels pour les factures et devis
 * - Utiliser l'identité visuelle Comexa (logo, couleurs, police)
 * - Produire des documents prêts à l'impression
 * - Envoyer les documents par email via le service Mail existant
 *
 * RÈGLES MÉTIER:
 * - Design épuré et professionnel
 * - Respect de l'aesthetic Comexa (bleu profond, glassmorphism)
 * - Logo Comexa intégré
 * - Toutes les informations légales nécessaires
 * - Utilisation du service Mail existant (SMTP/Mailjet)
 */

const ROUND_HALF_UP = Prisma.Decimal.ROUND_HALF_UP;
const CENTS = 2;

@Injectable()
export class PdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailService: MailService,
  ) {}

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  /**
   * Chemin vers le logo Comexa
   */
  private getLogoPath(): string {
    const logoPath = this.config.get<string>('PDF_LOGO_PATH') || 
      join(process.cwd(), 'public', 'images', 'comexa-logo.png');
    return logoPath;
  }

  /**
   * Informations de l'entreprise Comexa
   */
  private getCompanyInfo() {
    return {
      name: this.config.get<string>('PDF_COMPANY_NAME') || 'Comexa',
      address: this.config.get<string>('PDF_COMPANY_ADDRESS') || 'Algérie',
      city: this.config.get<string>('PDF_COMPANY_CITY') || 'Algiers',
      postalCode: this.config.get<string>('PDF_COMPANY_POSTAL') || '',
      country: this.config.get<string>('PDF_COMPANY_COUNTRY') || 'Algérie',
      phone: this.config.get<string>('PDF_COMPANY_PHONE') || '',
      email: this.config.get<string>('PDF_COMPANY_EMAIL') || 'contact@comexa.dz',
      website: this.config.get<string>('PDF_COMPANY_WEBSITE') || 'https://comexa.dz',
      taxId: this.config.get<string>('PDF_COMPANY_TAX_ID') || '',
      registrationNumber: this.config.get<string>('PDF_COMPANY_REGISTRATION') || '',
    };
  }

  // ---------------------------------------------------------------------------
  // Génération PDF - Facture
  // ---------------------------------------------------------------------------

  /**
   * Générer un PDF pour une facture
   */
  async generateInvoicePdf(
    invoiceId: string,
    options: {
      includeSignature?: boolean;
      includeTerms?: boolean;
      language?: 'fr' | 'en' | 'ar';
    } = {},
  ): Promise<Buffer> {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId, deletedAt: null },
      include: {
        client: true,
        project: true,
        quote: true,
        items: {
          orderBy: { position: 'asc' },
        },
        payments: {
          where: { deletedAt: null },
          orderBy: { paidAt: 'asc' },
        },
      },
    });

    return this.generatePdf({
      type: 'invoice',
      document: invoice,
      ...options,
    });
  }

  /**
   * Générer un PDF pour un devis
   */
  async generateQuotePdf(
    quoteId: string,
    options: {
      includeSignature?: boolean;
      includeTerms?: boolean;
      language?: 'fr' | 'en' | 'ar';
    } = {},
  ): Promise<Buffer> {
    const quote = await this.prisma.quote.findUniqueOrThrow({
      where: { id: quoteId, deletedAt: null },
      include: {
        prospect: true,
        client: true,
        project: true,
        items: {
          orderBy: { position: 'asc' },
        },
      },
    });

    return this.generatePdf({
      type: 'quote',
      document: quote,
      ...options,
    });
  }

  // ---------------------------------------------------------------------------
  // Génération PDF - Méthode principale
  // ---------------------------------------------------------------------------

  /**
   * Générer un PDF pour un document (facture ou devis)
   */
  private async generatePdf({
    type,
    document,
    includeSignature = true,
    includeTerms = true,
    language = 'fr',
  }: {
    type: 'invoice' | 'quote';
    document: any;
    includeSignature?: boolean;
    includeTerms?: boolean;
    language?: 'fr' | 'en' | 'ar';
  }): Promise<Buffer> {
    // Charger le logo
    let logoBuffer: Buffer | null = null;
    try {
      logoBuffer = readFileSync(this.getLogoPath());
    } catch (err) {
      console.warn('⚠️ Logo non trouvé, génération sans logo');
    }

    // Créer le canvas
    const canvasWidth = 800; // A5 en portrait (210mm x 148mm)
    const canvasHeight = 1131;
    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');

    // Charger le logo si disponible
    let logoImage = null;
    if (logoBuffer) {
      try {
        logoImage = await loadImage(logoBuffer);
      } catch (err) {
        console.warn('⚠️ Impossible de charger le logo');
      }
    }

    // Dessiner le PDF
    this.drawDocument(ctx, {
      type,
      document,
      logoImage,
      companyInfo: this.getCompanyInfo(),
      includeSignature,
      includeTerms,
      language,
      width: canvasWidth,
      height: canvasHeight,
    });

    // Retourner le buffer
    return canvas.toBuffer('application/pdf');
  }

  /**
   * Dessiner le document sur le canvas
   */
  private drawDocument(
    ctx: any,
    {
      type,
      document,
      logoImage,
      companyInfo,
      includeSignature,
      includeTerms,
      language,
      width,
      height,
    }: {
      type: 'invoice' | 'quote';
      document: any;
      logoImage: any;
      companyInfo: ReturnType<typeof this.getCompanyInfo>;
      includeSignature: boolean;
      includeTerms: boolean;
      language: 'fr' | 'en' | 'ar';
      width: number;
      height: number;
    },
  ): void {
    // Couleurs Comexa
    const colors = {
      primary: '#0b2545',      // Bleu profond
      secondary: '#1e86e0',    // Bleu Comexa
      accent: '#1568b4',       // Bleu accent
      light: '#e3f2fd',        // Bleu clair
      background: '#ffffff',
      text: '#0b2545',
      textMuted: '#4a607a',
      border: '#e0e0e0',
    };

    // Police (simulée avec fonts disponibles)
    const fonts = {
      title: { family: 'Helvetica', size: 24, weight: 'bold' },
      heading: { family: 'Helvetica', size: 18, weight: 'bold' },
      body: { family: 'Helvetica', size: 12, weight: 'normal' },
      small: { family: 'Helvetica', size: 10, weight: 'normal' },
    };

    // Effacer le canvas
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, width, height);

    // Marge
    const margin = 40;
    let y = margin;

    // -----------------------------------------------------------------------
    // En-tête
    // -----------------------------------------------------------------------

    // Logo et informations entreprise
    if (logoImage) {
      const logoWidth = 150;
      const logoHeight = (logoImage.height / logoImage.width) * logoWidth;
      ctx.drawImage(logoImage, margin, y, logoWidth, logoHeight);
    }

    // Informations entreprise à droite du logo
    const companyX = logoImage ? margin + 170 : margin;
    ctx.fillStyle = colors.primary;
    ctx.font = `${fonts.heading.size}px ${fonts.heading.family}`;
    ctx.fillText(companyInfo.name, companyX, y + 30);

    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.body.size}px ${fonts.body.family}`;
    const companyLines = [
      companyInfo.address,
      companyInfo.city + (companyInfo.postalCode ? ` ${companyInfo.postalCode}` : ''),
      companyInfo.country,
      companyInfo.phone ? `Tel: ${companyInfo.phone}` : null,
      companyInfo.email,
      companyInfo.website,
    ].filter(Boolean);

    companyLines.forEach((line, index) => {
      ctx.fillText(line, companyX, y + 50 + index * 18);
    });

    y += logoImage ? 140 : 100;

    // Ligne de séparation
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin, y);
    ctx.lineTo(width - margin, y);
    ctx.stroke();
    y += 20;

    // -----------------------------------------------------------------------
    // Titre du document
    // -----------------------------------------------------------------------

    const title = type === 'invoice' ? 
      (language === 'fr' ? 'FACTURE' : language === 'en' ? 'INVOICE' : 'فاتورة') :
      (language === 'fr' ? 'DEVIS' : language === 'en' ? 'QUOTE' : 'عرض سعر');

    ctx.fillStyle = colors.secondary;
    ctx.font = `${fonts.title.size}px ${fonts.title.family}`;
    ctx.textAlign = 'right';
    ctx.fillText(title, width - margin, y + 20);
    ctx.textAlign = 'left';
    y += 50;

    // -----------------------------------------------------------------------
    // Informations du document
    // -----------------------------------------------------------------------

    const docInfoLeft = [
      { label: language === 'fr' ? 'N°' : language === 'en' ? 'No.' : 'رقم', value: document.reference },
      { label: language === 'fr' ? 'Date' : language === 'en' ? 'Date' : 'تاريخ', value: this.formatDate(document.issueDate) },
    ];

    const docInfoRight = [
      { label: language === 'fr' ? 'Date échéance' : language === 'en' ? 'Due Date' : 'تاريخ الاستحقاق', value: this.formatDate(document.dueDate) },
      { label: language === 'fr' ? 'Statut' : language === 'en' ? 'Status' : 'الحالة', value: this.getStatusLabel(document.status, type, language) },
    ];

    // Colonne de gauche
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.body.size}px ${fonts.body.family}`;
    
    docInfoLeft.forEach((item, index) => {
      ctx.fillText(`${item.label}:`, margin, y + index * 20);
      ctx.fillStyle = colors.text;
      ctx.fillText(item.value, margin + 80, y + index * 20);
      ctx.fillStyle = colors.textMuted;
    });

    // Colonne de droite
    ctx.textAlign = 'right';
    docInfoRight.forEach((item, index) => {
      ctx.fillText(`${item.label}:`, width - margin - 80, y + index * 20);
      ctx.fillStyle = colors.text;
      ctx.fillText(item.value, width - margin, y + index * 20);
      ctx.fillStyle = colors.textMuted;
    });
    ctx.textAlign = 'left';

    y += 60;

    // -----------------------------------------------------------------------
    // Informations client
    // -----------------------------------------------------------------------

    const client = document.client || document.prospect;
    const clientName = client ? `${client.firstName || ''} ${client.lastName || ''}`.trim() || client.companyName || client.email : 'Client';

    ctx.fillStyle = colors.primary;
    ctx.font = `${fonts.heading.size}px ${fonts.heading.family}`;
    ctx.fillText(language === 'fr' ? 'FACTURÉ À' : language === 'en' ? 'BILLED TO' : 'المستفيد', margin, y);
    y += 25;

    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.body.size}px ${fonts.body.family}`;
    ctx.fillText(clientName, margin, y);
    y += 20;

    if (client) {
      const clientLines = [
        client.companyName,
        client.address,
        client.city + (client.postalCode ? ` ${client.postalCode}` : ''),
        client.country,
        client.email,
        client.phone,
      ].filter(Boolean);

      clientLines.forEach((line) => {
        ctx.fillText(line, margin, y);
        y += 16;
      });
    }

    y += 20;

    // -----------------------------------------------------------------------
    // Ligne de séparation
    // -----------------------------------------------------------------------
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin, y);
    ctx.lineTo(width - margin, y);
    ctx.stroke();
    y += 20;

    // -----------------------------------------------------------------------
    // Tableau des prestations
    // -----------------------------------------------------------------------

    // En-têtes du tableau
    const tableHeaders = [
      language === 'fr' ? 'Description' : language === 'en' ? 'Description' : 'الوصف',
      language === 'fr' ? 'Qté' : language === 'en' ? 'Qty' : 'كمية',
      language === 'fr' ? 'P.U.' : language === 'en' ? 'Unit Price' : 'السعر',
      language === 'fr' ? 'Montant' : language === 'en' ? 'Amount' : 'المبلغ',
    ];

    const colWidths = [width - margin * 2 - 180, 60, 80, 100];

    ctx.fillStyle = colors.secondary;
    ctx.font = `${fonts.body.size}px ${fonts.body.family}`;
    
    tableHeaders.forEach((header, index) => {
      let x = margin;
      for (let i = 0; i < index; i++) {
        x += colWidths[i];
      }
      ctx.fillText(header, x, y);
    });
    y += 20;

    // Ligne sous les en-têtes
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin, y);
    ctx.lineTo(width - margin, y);
    ctx.stroke();
    y += 5;

    // Lignes du tableau
    const items = document.items || [];
    items.forEach((item, index) => {
      ctx.fillStyle = colors.text;
      ctx.font = `${fonts.body.size}px ${fonts.body.family}`;
      
      // Description (peut être sur plusieurs lignes)
      const descLines = this.wrapText(item.description || '', colWidths[0], ctx);
      descLines.forEach((line, lineIndex) => {
        if (lineIndex === 0) {
          ctx.fillText(line, margin, y + lineIndex * 16);
        } else {
          ctx.fillText(line, margin + 20, y + lineIndex * 16);
        }
      });

      // Quantité
      ctx.textAlign = 'right';
      ctx.fillText(item.quantity || '1', margin + colWidths[0] + 10, y);
      
      // Prix unitaire
      ctx.fillText(this.formatCurrency(item.unitPrice || 0, document.currency), 
        margin + colWidths[0] + colWidths[1] + 10, y);
      
      // Montant
      ctx.fillText(this.formatCurrency(item.lineTotal || 0, document.currency), 
        width - margin - 10, y);
      ctx.textAlign = 'left';

      y += Math.max(16, descLines.length * 16) + 5;

      // Ligne de séparation (sauf pour le dernier item)
      if (index < items.length - 1) {
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(margin, y);
        ctx.lineTo(width - margin, y);
        ctx.stroke();
        y += 5;
      }
    });

    y += 10;

    // -----------------------------------------------------------------------
    // Totaux
    // -----------------------------------------------------------------------

    const totals = [
      { label: language === 'fr' ? 'Sous-total' : language === 'en' ? 'Subtotal' : 'المجموع الفرعي', value: document.subtotal },
      { label: language === 'fr' ? 'Remise' : language === 'en' ? 'Discount' : 'خصم', value: document.discountAmount, negative: true },
      { label: `${language === 'fr' ? 'TVA' : language === 'en' ? 'VAT' : 'ضريبة'} ${document.taxRate}%`, value: document.taxAmount },
      { label: language === 'fr' ? 'TOTAL' : language === 'en' ? 'TOTAL' : 'الإجمالي', value: document.total, bold: true },
    ].filter(t => t.value && (t.value > 0 || t.negative));

    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.body.size}px ${fonts.body.family}`;
    
    totals.forEach((total, index) => {
      const label = total.label;
      const value = this.formatCurrency(total.value || 0, document.currency);
      
      ctx.textAlign = 'right';
      if (total.bold) {
        ctx.font = `bold ${fonts.heading.size}px ${fonts.heading.family}`;
        ctx.fillStyle = colors.secondary;
      }
      
      ctx.fillText(label, width - margin - 200, y);
      ctx.fillText(value, width - margin, y);
      
      if (total.bold) {
        ctx.font = `${fonts.body.size}px ${fonts.body.family}`;
        ctx.fillStyle = colors.text;
      }
      
      ctx.textAlign = 'left';
      y += 20;
    });

    // -----------------------------------------------------------------------
    // Paiements (pour les factures)
    // -----------------------------------------------------------------------

    if (type === 'invoice' && document.payments?.length > 0) {
      y += 20;
      
      ctx.fillStyle = colors.primary;
      ctx.font = `${fonts.heading.size}px ${fonts.heading.family}`;
      ctx.fillText(language === 'fr' ? 'PAIEMENTS' : language === 'en' ? 'PAYMENTS' : 'المدفوعات', margin, y);
      y += 25;

      document.payments.forEach((payment, index) => {
        ctx.fillStyle = colors.text;
        ctx.font = `${fonts.body.size}px ${fonts.body.family}`;
        
        ctx.fillText(this.formatDate(payment.paidAt), margin, y);
        ctx.textAlign = 'right';
        ctx.fillText(this.formatCurrency(payment.amount, payment.currency), width - margin, y);
        ctx.textAlign = 'left';
        
        y += 16;
      });

      // Total payé
      y += 10;
      const totalPaid = document.payments.reduce((sum, p) => sum + (p.amount || 0), 0);
      ctx.fillStyle = colors.text;
      ctx.font = `${fonts.body.size}px ${fonts.body.family}`;
      ctx.fillText(language === 'fr' ? 'Total payé' : language === 'en' ? 'Total Paid' : 'المبلغ المدفوع', margin, y);
      ctx.textAlign = 'right';
      ctx.fillText(this.formatCurrency(totalPaid, document.currency), width - margin, y);
      ctx.textAlign = 'left';
      
      // Solde
      y += 20;
      const balance = (document.total || 0) - totalPaid;
      ctx.font = `bold ${fonts.body.size}px ${fonts.body.family}`;
      ctx.fillStyle = balance <= 0 ? colors.secondary : colors.error;
      ctx.fillText(language === 'fr' ? 'Solde dû' : language === 'en' ? 'Balance Due' : 'الرصيد المستحق', margin, y);
      ctx.textAlign = 'right';
      ctx.fillText(this.formatCurrency(balance, document.currency), width - margin, y);
      ctx.textAlign = 'left';
      ctx.fillStyle = colors.text;
      ctx.font = `${fonts.body.size}px ${fonts.body.family}`;
    }

    y += 30;

    // -----------------------------------------------------------------------
    // Conditions de paiement et signature
    // -----------------------------------------------------------------------

    if (includeTerms) {
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(margin, y);
      ctx.lineTo(width - margin, y);
      ctx.stroke();
      y += 20;

      ctx.fillStyle = colors.textMuted;
      ctx.font = `${fonts.small.size}px ${fonts.small.family}`;
      
      const terms = language === 'fr' 
        ? 'Paiement à réception de facture. Délai de paiement: 30 jours.'
        : language === 'en' 
          ? 'Payment due upon receipt. Payment terms: 30 days.'
          : 'الدفع عند الاستلام. فترة الدفع: 30 يوم.';
      
      const termsLines = this.wrapText(terms, width - margin * 2, ctx);
      termsLines.forEach((line) => {
        ctx.fillText(line, margin, y);
        y += 12;
      });
      
      y += 20;
    }

    // Signature
    if (includeSignature) {
      ctx.fillStyle = colors.text;
      ctx.font = `${fonts.body.size}px ${fonts.body.family}`;
      ctx.fillText(language === 'fr' ? 'Signature' : language === 'en' ? 'Signature' : 'التوقيع', margin, y);
      y += 20;
      
      // Ligne de signature
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(margin, y);
      ctx.lineTo(margin + 200, y);
      ctx.stroke();
      y += 30;
    }

    // -----------------------------------------------------------------------
    // Pied de page
    // -----------------------------------------------------------------------

    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin, y);
    ctx.lineTo(width - margin, y);
    ctx.stroke();
    y += 20;

    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.small.size}px ${fonts.small.family}`;
    ctx.textAlign = 'center';
    ctx.fillText(companyInfo.website, width / 2, y);
    y += 12;
    ctx.fillText(language === 'fr' ? 'Merci pour votre confiance!' : 
      language === 'en' ? 'Thank you for your trust!' : 
      'شكرا على ثقتكم!', width / 2, y);
    ctx.textAlign = 'left';
  }

  // ---------------------------------------------------------------------------
  // Utilitaires
  // ---------------------------------------------------------------------------

  /**
   * Formater une date
   */
  private formatDate(dateString: string | Date): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  /**
   * Formater une devise
   */
  private formatCurrency(amount: Prisma.Decimal | string | number, currency: string): string {
    const decimalAmount = amount instanceof Prisma.Decimal ? amount : new Prisma.Decimal(amount);
    const formatted = decimalAmount.toDecimalPlaces(CENTS, ROUND_HALF_UP).toString();
    
    switch (currency.toUpperCase()) {
      case 'EUR':
        return `${formatted} €`;
      case 'USD':
        return `$${formatted}`;
      case 'DZD':
        return `${formatted} د.ج`;
      default:
        return `${formatted} ${currency}`;
    }
  }

  /**
   * Obtenir le libellé du statut
   */
  private getStatusLabel(status: string, type: 'invoice' | 'quote', language: 'fr' | 'en' | 'ar'): string {
    const statusMap: Record<string, Record<'fr' | 'en' | 'ar', string>> = {
      DRAFT: { fr: 'Brouillon', en: 'Draft', ar: 'مسودة' },
      SENT: { fr: 'Envoyé', en: 'Sent', ar: 'مرسل' },
      ACCEPTED: { fr: 'Accepté', en: 'Accepted', ar: 'مقبول' },
      REJECTED: { fr: 'Refusé', en: 'Rejected', ar: 'مرفوض' },
      PAID: { fr: 'Payé', en: 'Paid', ar: 'مدفوع' },
      PARTIAL: { fr: 'Partiel', en: 'Partial', ar: 'جزئي' },
      OVERDUE: { fr: 'En retard', en: 'Overdue', ar: 'متأخر' },
    };

    return statusMap[status]?.[language] || status;
  }

  /**
   * Retour à la ligne pour le texte
   */
  private wrapText(text: string, maxWidth: number, ctx: any): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = words[0] || '';

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const width = ctx.measureText(currentLine + ' ' + word).width;
      
      if (width < maxWidth) {
        currentLine += ' ' + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    
    if (currentLine) {
      lines.push(currentLine);
    }
    
    return lines;
  }

  // ---------------------------------------------------------------------------
  // Envoi par email avec pièce jointe PDF
  // ---------------------------------------------------------------------------

  /**
   * Créer un transporter SMTP pour l'envoi avec pièces jointes
   * Réutilise la configuration du service Mail existant
   */
  private createTransporter(): Transporter | null {
    const host = this.config.get<string>('SMTP_HOST');
    const port = this.config.get<number>('SMTP_PORT');
    const user = this.config.get<string>('SMTP_USER');
    const password = this.config.get<string>('SMTP_PASSWORD');
    const from = this.config.get<string>('SMTP_FROM') || 'Comexa <no-reply@comexa.dz>';

    if (!host || !port) {
      return null;
    }

    return createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && password ? { user, pass: password } : undefined,
      // Note: L'expéditeur est défini par message
    });
  }

  /**
   * Envoyer un document (facture ou devis) par email avec PDF en pièce jointe
   */
  async sendDocumentByEmail(
    documentId: string,
    documentType: 'invoice' | 'quote',
    options: {
      to: string;
      subject?: string;
      message?: string;
      includePdf?: boolean;
      language?: 'fr' | 'en' | 'ar';
    },
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // Récupérer les informations du document
      const document = await this.prisma[documentType].findUniqueOrThrow({
        where: { id: documentId, deletedAt: null },
        include: documentType === 'invoice' ? { client: true } : { client: true, prospect: true },
      });

      const client = document.client || document.prospect;
      const clientName = client ? `${client.firstName || ''} ${client.lastName || ''}`.trim() : 'Client';
      const currency = document.currency || 'DZD';
      const total = this.formatCurrency(document.total || 0, currency);
      const reference = document.reference;

      // Générer le PDF
      let pdfBuffer: Buffer | null = null;
      let pdfFilename = '';
      
      if (options.includePdf !== false) {
        pdfBuffer = documentType === 'invoice'
          ? await this.generateInvoicePdf(documentId, {
              includeSignature: true,
              includeTerms: true,
              language: options.language || 'fr',
            })
          : await this.generateQuotePdf(documentId, {
              includeSignature: true,
              includeTerms: true,
              language: options.language || 'fr',
            });
        
        pdfFilename = `${documentType === 'invoice' ? 'facture' : 'devis'}-${reference}.pdf`;
      }

      // Créer le transporter
      const transporter = this.createTransporter();
      if (!transporter) {
        throw new Error('Configuration SMTP manquante pour l\'envoi avec pièce jointe');
      }

      // Préparer l'email
      const subject = options.subject || 
        (documentType === 'invoice' ? `Facture ${reference}` : `Devis ${reference}`);
      
      const dueDate = documentType === 'invoice' ? document.dueDate : null;
      const validUntil = documentType === 'quote' ? document.validUntil : null;

      // Message par défaut
      const defaultMessage = documentType === 'invoice'
        ? `Bonjour ${clientName},\n\nVeuillez trouver ci-joint la facture ${reference} d'un montant de ${total}.\nDate d'échéance: ${dueDate ? this.formatDate(dueDate) : 'Non spécifiée'}.\n\nCordialement,\nL'équipe Comexa`
        : `Bonjour ${clientName},\n\nVeuillez trouver ci-joint le devis ${reference} d'un montant de ${total}.\n${validUntil ? `Valable jusqu'au: ${this.formatDate(validUntil)}` : ''}\n\nCordialement,\nL'équipe Comexa`;

      const messageText = options.message || defaultMessage;

      // Envoyer l'email
      const info = await transporter.sendMail({
        from: this.config.get<string>('SMTP_FROM') || 'Comexa <no-reply@comexa.dz>',
        to: options.to,
        subject,
        text: messageText,
        attachments: pdfBuffer ? [
          {
            filename: pdfFilename,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ] : [],
      });

      return { success: true, messageId: info.messageId };
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Erreur lors de l\'envoi',
      };
    }
  }

  /**
   * Envoyer une facture par email (alias pour sendDocumentByEmail)
   */
  async sendInvoiceByEmail(
    invoiceId: string,
    options: {
      to: string;
      subject?: string;
      message?: string;
      includePdf?: boolean;
      language?: 'fr' | 'en' | 'ar';
    },
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    return this.sendDocumentByEmail(invoiceId, 'invoice', options);
  }

  /**
   * Envoyer un devis par email (alias pour sendDocumentByEmail)
   */
  async sendQuoteByEmail(
    quoteId: string,
    options: {
      to: string;
      subject?: string;
      message?: string;
      includePdf?: boolean;
      language?: 'fr' | 'en' | 'ar';
    },
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    return this.sendDocumentByEmail(quoteId, 'quote', options);
  }
}
