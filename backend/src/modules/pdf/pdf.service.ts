import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma, type QuoteItem } from '../../generated/prisma/client.js';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MailService } from '../../common/mail/mail.service.js';
import { AppException } from '../../common/errors/app-error.js';
import { clientPerimeter } from '../invoices/billing-access.js';
import type { AccessPolicy } from '../../common/auth/principal.js';

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
 * - Respect de l'esthétique Comexa (bleu profond, glassmorphism)
 * - Logo Comexa intégré
 * - Toutes les informations légales nécessaires
 * - Utilisation du service Mail existant (SMTP/Mailjet)
 *
 * DEUX CHOIX QUI MÉRITENT D'ÊTRE EXPLIQUÉS, PARCE QU'ILS CORRIGEANT UN ÉTAT
 * QUI NE COMPILAIT PAS ET NE PRODUISAIT PAS DE PDF.
 *
 * 1. PDFKIT, PAS CANVAS. L'ancienne version dessinait la facture sur un canvas
 *    (`node-canvas`) puis appelait `canvas.toBuffer('application/pdf')`. Deux
 *    problèmes, et le second est le plus grave : `node-canvas` ne sait produire
 *    que du PNG et du JPEG. Demander « application/pdf » renvoyait une image PNG
 *    étiquetée PDF — un fichier qu'aucune visionneuse n'ouvre. En plus, `canvas`
 *    n'était déclarée dans aucune dépendance : le build s'arrêtait sur
 *    « Cannot find module 'canvas' ». `pdfkit` écrit un vrai PDF (texte
 *    vectoriel, donc sélectionnable et cherchable), en JavaScript pur — aucune
 *    bibliothèque native à compiler dans l'image Docker, aucun paquet système
 *    à ajouter.
 *
 * 2. L'ENVOI PASSE PAR `MailService`. Le service montait auparavant son propre
 *    transport SMTP. Un déploiement configuré en Mailjet seul — le cas courant
 *    quand l'hébergeur bloque les ports 25/465/587 — voyait donc l'envoi d'une
 *    facture échouer avec « aucun transport », alors que les mots de passe
 *    oubliés partaient très bien. `OutgoingMail` porte maintenant des pièces
 *    jointes, et les deux transports savent les envoyer. Un seul point de vérité
 *    sur le transport, et le repli de développement est hérité au passage.
 */

const ROUND_HALF_UP = Prisma.Decimal.ROUND_HALF_UP;
const CENTS = 2;

/** Palette Comexa, partagée par tout le document. */
const COLORS = {
  primary: '#0b2545', // Bleu profond
  secondary: '#1e86e0', // Bleu Comexa
  accent: '#1568b4', // Bleu accent
  light: '#e3f2fd', // Bleu clair
  background: '#ffffff',
  text: '#0b2545',
  textMuted: '#4a607a',
  border: '#e0e0e0',
  /** Solde dû en retard. Absent de l'ancienne palette, donc illisible. */
  error: '#c62828',
} as const;

/**
 * Gabarits de texte. `pdfkit` connaît cinq polices standard, toujours
 * disponibles dans toute visionneuse PDF : les nommer évite d'embarquer un
 * fichier de police (plusieurs centaines de kilo par graisse).
 */
const FONTS = {
  title: { font: 'Helvetica-Bold', size: 24 },
  heading: { font: 'Helvetica-Bold', size: 13 },
  body: { font: 'Helvetica', size: 10 },
  small: { font: 'Helvetica', size: 8 },
} as const;

/** Langues couvertes par les libellés du document. */
type DocumentLanguage = 'fr' | 'en' | 'ar';

/** Libellés lisibles des moyens de paiement stockés sous forme d'enum. */
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  BANK_TRANSFER: 'Virement bancaire',
  CARD: 'Carte bancaire',
  CASH: 'Espèces',
  CHECK: 'Chèque',
  PAYPAL: 'PayPal',
  CCP: 'CCP (Algérie Poste)',
  BARIDIMOB: 'BaridiMob',
  OTHER: 'Autre moyen',
};

/** Libellés anglais des sections. Les clés sont les libellés français. */
const PDF_LABELS_EN: Record<string, string> = {
  FACTURE: 'INVOICE',
  DEVIS: 'QUOTE',
  'N°': 'No.',
  Date: 'Date',
  "Date d'échéance": 'Due Date',
  "Valable jusqu'au": 'Valid Until',
  Statut: 'Status',
  'FACTURÉ À': 'BILLED TO',
  DESTINATAIRE: 'RECIPIENT',
  Description: 'Description',
  Qté: 'Qty',
  'P.U.': 'Unit Price',
  Montant: 'Amount',
  'Sous-total': 'Subtotal',
  Remise: 'Discount',
  TVA: 'VAT',
  TOTAL: 'TOTAL',
  PAIEMENTS: 'PAYMENTS',
  'Total payé': 'Total Paid',
  'Solde dû': 'Balance Due',
  Notes: 'Notes',
  Conditions: 'Terms',
  Signature: 'Signature',
};

/** Page A4 portrait, en points (1 pt = 1/72 pouce). */
const PAGE: { width: number; height: number; margin: number } = {
  width: 595.28,
  height: 841.89,
  margin: 40,
};

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailService: MailService,
  ) {}

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

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
   * Lit une référence dans le périmètre du porteur, pour fabriquer le nom de
   * fichier sans exposer l'identifiant interne de la ligne.
   */
  async getDocumentReference(
    type: 'invoice' | 'quote',
    documentId: string,
    policy: AccessPolicy,
  ): Promise<string> {
    const ownClientId = clientPerimeter(policy, type, 'read');
    const document =
      type === 'invoice'
        ? await this.prisma.invoice.findFirst({
            where: {
              id: documentId,
              deletedAt: null,
              ...(ownClientId ? { clientId: ownClientId, NOT: { status: 'DRAFT' } } : {}),
            },
            select: { reference: true },
          })
        : await this.prisma.quote.findFirst({
            where: {
              id: documentId,
              deletedAt: null,
              ...(ownClientId ? { clientId: ownClientId, NOT: { status: 'DRAFT' } } : {}),
            },
            select: { reference: true },
          });

    if (!document) {
      throw AppException.notFound(
        type === 'invoice' ? 'INVOICE_NOT_FOUND' : 'QUOTE_NOT_FOUND',
        type === 'invoice' ? "Cette facture n'existe pas." : "Ce devis n'existe pas.",
      );
    }

    return document.reference;
  }

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
    policy?: AccessPolicy,
  ): Promise<Buffer> {
    // Un PDF, c'est la facture : même périmètre qu'une lecture HTTP. Sans ce
    // filtre, un compte de l'espace client qui devine un identifiant lit la
    // facture d'un autre dossier — la route était gardée, la ligne ne l'était
    // pas. `clientPerimeter` renvoie null pour un porteur interne (aucun
    // filtre) et lève pour un compte non rattaché.
    const ownClientId = policy ? clientPerimeter(policy, 'invoice', 'read') : null;

    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        deletedAt: null,
        ...(ownClientId ? { clientId: ownClientId, NOT: { status: 'DRAFT' } } : {}),
      },
      include: {
        client: {
          include: {
            contacts: {
              where: { deletedAt: null },
              orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
              take: 1,
            },
          },
        },
        project: true,
        quote: true,
        items: { orderBy: { position: 'asc' } },
        payments: {
          where: { deletedAt: null, status: 'SUCCEEDED' },
          orderBy: { paidAt: 'asc' },
        },
      },
    });

    if (!invoice) {
      throw AppException.notFound('INVOICE_NOT_FOUND', "Cette facture n'existe pas.");
    }

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
    policy?: AccessPolicy,
  ): Promise<Buffer> {
    const ownClientId = policy ? clientPerimeter(policy, 'quote', 'read') : null;

    const quote = await this.prisma.quote.findFirst({
      where: {
        id: quoteId,
        deletedAt: null,
        ...(ownClientId ? { clientId: ownClientId, NOT: { status: 'DRAFT' } } : {}),
      },
      include: {
        prospect: true,
        client: {
          include: {
            contacts: {
              where: { deletedAt: null },
              orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
              take: 1,
            },
          },
        },
        project: true,
        items: { orderBy: { position: 'asc' } },
      },
    });

    if (!quote) {
      throw AppException.notFound('QUOTE_NOT_FOUND', "Ce devis n'existe pas.");
    }

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    document: any;
    includeSignature?: boolean;
    includeTerms?: boolean;
    language?: DocumentLanguage;
  }): Promise<Buffer> {
    const doc = new PDFDocument({
      size: [PAGE.width, PAGE.height],
      // Les marges sont gérées à la main : le document place des colonnes
      // alignées à droite, ce qu'une marge automatique ne permet pas.
      margin: 0,
      info: {
        Title: `${type === 'invoice' ? 'Facture' : 'Devis'} ${document.reference ?? ''}`,
        Author: this.getCompanyInfo().name,
        Subject: `${type === 'invoice' ? 'Facture' : 'Devis'} ${document.reference ?? ''}`,
      },
    });

    // `pdfkit` écrit par morceaux ; on les rassemble en un seul Buffer, qui est
    // ce que le contrôleur renvoie et ce que le courriel attache.
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    const finished = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    this.drawDocument(doc, {
      type,
      document,
      logoBuffer: this.loadLogo(),
      companyInfo: this.getCompanyInfo(),
      includeSignature,
      includeTerms,
      language,
    });

    doc.end();

    return finished;
  }

  /**
   * Charge le logo, ou `null` s'il est absent.
   *
   * UN LOGO MANQUANT N'EST PAS UNE ERREUR : un document sans logo reste un
   * document valide. C'est pour ça que ce chemin ne lève pas — l'ancienne
   * version avalait déjà le cas, mais en écrivant sur `console.warn`, hors du
   * canal de journalisation du serveur.
   */
  private loadLogo(): Buffer | null {
    const configured = this.config.get<string>('PDF_LOGO_PATH');
    const candidates = [
      ...(configured ? [configured] : []),
      join(process.cwd(), 'assets', 'comexa-logo.png'),
      join(process.cwd(), 'backend', 'assets', 'comexa-logo.png'),
      join(process.cwd(), 'public', 'comexa-logo-horizontal-transparent.png'),
    ];

    for (const candidate of candidates) {
      try {
        return readFileSync(candidate);
      } catch {
        // Essayer le prochain emplacement : local, conteneur ou monorepo.
      }
    }

    this.logger.warn('Logo PDF introuvable, génération sans logo');
    return null;
  }

  // ---------------------------------------------------------------------------
  // Rendu du document
  // ---------------------------------------------------------------------------

  /**
   * Dessine le document de haut en bas.
   *
   * Le rendu est SÉQUENTIEL et volontairement sans retour en arrière : `y`
   * descend de section en section, exactement comme une mise en page imprimée.
   * Chaque helper prend `y` et renvoie le `y` suivant, ce qui empêche une
   * section d'écraser celle d'au-dessus quand une description est plus longue
   * que prévu.
   */
  private drawDocument(
    doc: PDFKit.PDFDocument,
    {
      type,
      document,
      logoBuffer,
      companyInfo,
      includeSignature,
      includeTerms,
      language,
    }: {
      type: 'invoice' | 'quote';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      document: any;
      logoBuffer: Buffer | null;
      companyInfo: ReturnType<PdfService['getCompanyInfo']>;
      includeSignature: boolean;
      includeTerms: boolean;
      language: DocumentLanguage;
    },
  ): void {
    const { width, margin } = PAGE;
    const right = width - margin;

    doc.fillColor(COLORS.background).rect(0, 0, width, PAGE.height).fill();

    let y = margin;

    // -----------------------------------------------------------------------
    // En-tête : logo à gauche, coordonnées à droite
    // -----------------------------------------------------------------------
    const logoWidth = 150;
    if (logoBuffer) {
      try {
        doc.image(logoBuffer, margin, y, { width: logoWidth });
      } catch {
        // Un fichier présent mais illisible (PNG tronqué, permissions) ne doit
        // pas plus empêcher la facture de sortir qu'un fichier absent.
        this.logger.warn('Logo PDF illisible, génération sans logo');
      }
    }

    // Les coordonnées se placent à droite du logo quand il est là, ce qui
    // garde l'alignement sur la marge dans le cas contraire.
    const companyX = logoBuffer ? margin + logoWidth + 20 : margin;

    doc.fillColor(COLORS.primary).font(FONTS.heading.font, FONTS.heading.size);
    doc.text(companyInfo.name, companyX, y + 12);

    doc.fillColor(COLORS.text).font(FONTS.body.font, FONTS.body.size);
    const companyLines = [
      companyInfo.address,
      `${companyInfo.city}${companyInfo.postalCode ? ` ${companyInfo.postalCode}` : ''}`,
      companyInfo.country,
      companyInfo.phone ? `Tél: ${companyInfo.phone}` : null,
      companyInfo.email,
      companyInfo.website,
      companyInfo.registrationNumber ? `RC : ${companyInfo.registrationNumber}` : null,
      companyInfo.taxId ? `NIF/TVA : ${companyInfo.taxId}` : null,
    ].filter(Boolean) as string[];

    let companyY = y + 32;
    for (const line of companyLines) {
      doc.text(line, companyX, companyY);
      companyY += 13;
    }

    y = Math.max(y + (logoBuffer ? 140 : 100), companyY + 10);

    y = this.drawSeparator(doc, y) + 14;

    // -----------------------------------------------------------------------
    // Titre, aligné à droite
    // -----------------------------------------------------------------------
    const title =
      type === 'invoice' ? this.label('FACTURE', language) : this.label('DEVIS', language);

    doc.fillColor(COLORS.secondary).font(FONTS.title.font, FONTS.title.size);
    doc.text(title, margin, y, { width: right - margin, align: 'right' });
    y += 34;

    // -----------------------------------------------------------------------
    // Référence / date / échéance / statut, en deux colonnes
    // -----------------------------------------------------------------------
    const docInfoLeft: Array<[string, string]> = [
      [this.label('N°', language), String(document.reference ?? '')],
      [this.label('Date', language), this.formatDate(document.issueDate)],
    ];
    const expiryLabel = type === 'invoice' ? "Date d'échéance" : "Valable jusqu'au";
    const expiryDate = type === 'invoice' ? document.dueDate : document.validUntil;
    const docInfoRight: Array<[string, string]> = [
      [this.label(expiryLabel, language), this.formatDate(expiryDate)],
      [this.label('Statut', language), this.getStatusLabel(document.status, language)],
    ];

    doc.font(FONTS.body.font, FONTS.body.size);
    docInfoLeft.forEach(([label, value], index) => {
      const lineY = y + index * 16;
      doc.fillColor(COLORS.textMuted).text(`${label}:`, margin, lineY, { width: 80 });
      doc.fillColor(COLORS.text).text(value, margin + 80, lineY);
    });

    docInfoRight.forEach(([label, value], index) => {
      const lineY = y + index * 16;
      doc
        .fillColor(COLORS.textMuted)
        .text(`${label}:`, right - 190, lineY, { width: 110, align: 'right' });
      doc.fillColor(COLORS.text).text(value, right - 80, lineY, { width: 80, align: 'right' });
    });

    y += 48;

    // -----------------------------------------------------------------------
    // Destinataire
    // -----------------------------------------------------------------------
    const client = document.client || document.prospect;
    const contact = client?.contacts?.[0] ?? null;
    const contactFirstName = contact?.firstName ?? client?.contactFirstName ?? '';
    const contactLastName = contact?.lastName ?? client?.contactLastName ?? '';
    const clientName = client
      ? client.companyName ||
        `${contactFirstName} ${contactLastName}`.trim() ||
        contact?.email ||
        client.email ||
        'Client'
      : 'Client';

    doc.fillColor(COLORS.primary).font(FONTS.heading.font, FONTS.heading.size);
    doc.text(this.label(type === 'invoice' ? 'FACTURÉ À' : 'DESTINATAIRE', language), margin, y);
    y += 20;

    doc.fillColor(COLORS.text).font(FONTS.body.font, FONTS.body.size);
    doc.text(clientName, margin, y);
    y += 15;

    if (client) {
      const clientLines = [
        client.legalName,
        client.addressLine1 ?? client.address,
        client.addressLine2,
        `${client.city ?? ''}${client.postalCode ? ` ${client.postalCode}` : ''}`,
        client.region,
        client.country,
        contact?.email ?? client.email,
        contact?.phone ?? client.phone,
        client.registrationNumber ? `RC : ${client.registrationNumber}` : null,
        client.vatNumber ? `NIF/TVA : ${client.vatNumber}` : null,
      ].filter(Boolean) as string[];

      for (const line of clientLines) {
        doc.text(line, margin, y);
        y += 13;
      }
    }

    y += 16;
    y = this.drawSeparator(doc, y) + 14;

    // -----------------------------------------------------------------------
    // Tableau des prestations
    // -----------------------------------------------------------------------
    y = this.drawItemsTable(doc, document, language, y);

    // -----------------------------------------------------------------------
    // Totaux
    // -----------------------------------------------------------------------
    y = this.drawTotals(doc, document, language, y);

    // -----------------------------------------------------------------------
    // Paiements (factures uniquement)
    // -----------------------------------------------------------------------
    if (type === 'invoice') {
      y = this.drawPayments(doc, document, language, y);
    }

    y += 18;

    // -----------------------------------------------------------------------
    // Notes et conditions réelles de la pièce
    // -----------------------------------------------------------------------
    const drawTextSection = (heading: string, content: string) => {
      const lines = this.wrapText(content, right - margin, doc);
      y = this.ensurePageSpace(doc, y, Math.min(46, lines.length * 12 + 24));
      doc.fillColor(COLORS.primary).font(FONTS.heading.font, FONTS.heading.size);
      doc.text(heading, margin, y);
      y += 18;
      doc.fillColor(COLORS.textMuted).font(FONTS.small.font, FONTS.small.size);
      for (const line of lines) {
        if (y + 12 > PAGE.height - margin) {
          doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
          y = margin;
        }
        doc.text(line, margin, y, { width: right - margin });
        y += 11;
      }
      y += 10;
    };

    const notes = typeof document.notes === 'string' ? document.notes.trim() : '';
    if (notes) drawTextSection(this.label('Notes', language), notes);

    const terms = typeof document.terms === 'string' ? document.terms.trim() : '';
    if (includeTerms && terms) {
      drawTextSection(this.label('Conditions', language), terms);
    }

    if (includeSignature) {
      y = this.ensurePageSpace(doc, y, 58);
      doc.fillColor(COLORS.text).font(FONTS.body.font, FONTS.body.size);
      doc.text(this.label('Signature', language), margin, y);
      y += 18;

      doc.strokeColor(COLORS.border).lineWidth(0.8);
      doc
        .moveTo(margin, y)
        .lineTo(margin + 200, y)
        .stroke();
      y += 26;
    }

    // -----------------------------------------------------------------------
    // Pied de page
    // -----------------------------------------------------------------------
    y = this.ensurePageSpace(doc, y, 42);
    doc.strokeColor(COLORS.border).lineWidth(0.8);
    doc.moveTo(margin, y).lineTo(right, y).stroke();
    y += 14;

    doc.fillColor(COLORS.textMuted).font(FONTS.small.font, FONTS.small.size);
    doc.text(companyInfo.website, margin, y, { width: right - margin, align: 'center' });
    y += 11;
    doc.text(
      language === 'fr'
        ? 'Merci pour votre confiance!'
        : language === 'en'
          ? 'Thank you for your trust!'
          : 'شكرًا على ثقتكم!',
      margin,
      y,
      { width: right - margin, align: 'center' },
    );
  }

  /** Ajoute une page A4 si le bloc suivant dépasserait la marge imprimable. */
  private ensurePageSpace(doc: PDFKit.PDFDocument, y: number, required: number): number {
    if (y + required <= PAGE.height - PAGE.margin) return y;
    doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
    return PAGE.margin;
  }

  /**
   * Trait de séparation horizontal. Renvoie la position du trait.
   */
  private drawSeparator(doc: PDFKit.PDFDocument, y: number): number {
    doc.strokeColor(COLORS.border).lineWidth(0.8);
    doc
      .moveTo(PAGE.margin, y)
      .lineTo(PAGE.width - PAGE.margin, y)
      .stroke();
    return y;
  }

  /**
   * Tableau des prestations : description, quantité, prix unitaire, montant.
   */
  private drawItemsTable(
    doc: PDFKit.PDFDocument,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    document: any,
    language: DocumentLanguage,
    startY: number,
  ): number {
    const { margin } = PAGE;
    const right = PAGE.width - margin;
    const colWidths = [235, 55, 100, 125];
    const colX = [margin];
    for (let i = 1; i < colWidths.length; i++) {
      colX.push((colX[i - 1] as number) + (colWidths[i - 1] as number));
    }

    const drawHeader = (headerY: number): number => {
      const headers = [
        this.label('Description', language),
        this.label('Qté', language),
        this.label('P.U.', language),
        this.label('Montant', language),
      ];
      doc.fillColor(COLORS.secondary).font(FONTS.body.font, FONTS.body.size);
      headers.forEach((header, index) => {
        doc.text(header, colX[index] as number, headerY, {
          width: colWidths[index] as number,
          align: index === 0 ? 'left' : 'right',
        });
      });
      const afterHeader = headerY + 22;
      this.drawSeparator(doc, afterHeader);
      return afterHeader + 8;
    };

    let y = this.ensurePageSpace(doc, startY, 64);
    y = drawHeader(y);
    const items = (document.items ?? []) as Array<
      Pick<QuoteItem, 'title' | 'description' | 'quantity' | 'unitPrice' | 'lineTotal'>
    >;
    const pageBottom = PAGE.height - margin;

    items.forEach((item, index) => {
      const titleLines = this.wrapText(String(item.title ?? ''), colWidths[0] as number, doc);
      const descriptionLines = item.description
        ? this.wrapText(String(item.description), colWidths[0] as number, doc)
        : [];
      const textLineCount = Math.max(1, titleLines.length + descriptionLines.length);
      const rowHeight = textLineCount * 13 + 16;

      // Garder une ligne entière sur la même page. Les descriptions sont
      // bornées à 2 000 caractères par le DTO : même la plus longue tient sur
      // une page A4 si elle commence en haut d'une page.
      if (y + rowHeight > pageBottom) {
        doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
        y = drawHeader(margin);
      }

      doc.fillColor(COLORS.text).font(FONTS.body.font, FONTS.body.size);
      titleLines.forEach((line, lineIndex) => {
        doc
          .font(lineIndex === 0 ? 'Helvetica-Bold' : FONTS.body.font, FONTS.body.size)
          .fillColor(COLORS.text)
          .text(line, margin, y + lineIndex * 13, { width: colWidths[0] as number });
      });
      descriptionLines.forEach((line, lineIndex) => {
        doc
          .font(FONTS.small.font, FONTS.small.size)
          .fillColor(COLORS.textMuted)
          .text(line, margin, y + (titleLines.length + lineIndex) * 13, {
            width: colWidths[0] as number,
          });
      });

      doc.font(FONTS.body.font, FONTS.body.size).fillColor(COLORS.text);
      doc.text(String(item.quantity ?? '1'), colX[1] as number, y, {
        width: colWidths[1] as number,
        align: 'right',
      });
      doc.text(this.formatCurrency(item.unitPrice ?? 0, document.currency), colX[2] as number, y, {
        width: colWidths[2] as number,
        align: 'right',
      });
      doc.text(this.formatCurrency(item.lineTotal ?? 0, document.currency), colX[3] as number, y, {
        width: colWidths[3] as number,
        align: 'right',
      });

      y += rowHeight;
      if (index < items.length - 1) {
        doc.strokeColor(COLORS.border).lineWidth(0.5);
        doc.moveTo(margin, y).lineTo(right, y).stroke();
        y += 6;
      }
    });

    return y + 8;
  }

  /**
   * Bloc des totaux, aligné à droite comme sur une facture imprimée.
   */
  private drawTotals(
    doc: PDFKit.PDFDocument,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    document: any,
    language: DocumentLanguage,
    startY: number,
  ): number {
    const { width, margin } = PAGE;
    const right = width - margin;
    let y = startY;
    if (y + 112 > PAGE.height - margin) {
      doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
      y = margin;
    }

    const totals = [
      {
        label: this.label('Sous-total', language),
        value: document.subtotal,
        negative: false,
        bold: false,
      },
      {
        label: this.label('Remise', language),
        value: document.discountAmount,
        negative: true,
        bold: false,
      },
      {
        label: `${this.label('TVA', language)} ${document.taxRate ?? 0}%`,
        value: document.taxAmount,
        negative: false,
        bold: false,
      },
      { label: this.label('TOTAL', language), value: document.total, negative: false, bold: true },
      // Une ligne à zéro n'apporte rien et ferait douter d'un arrondi. Seule la
      // remise est gardée quand elle vaut zéro, parce qu'elle nomme un geste
      // commercial explicite (« pas de remise accordée »).
    ].filter((t) => t.value && (new Prisma.Decimal(String(t.value)).greaterThan(0) || t.negative));

    for (const total of totals) {
      const amount = new Prisma.Decimal(String(total.value ?? 0));
      const value = this.formatCurrency(
        total.negative ? amount.negated() : amount,
        document.currency,
      );

      if (total.bold) {
        doc.font(FONTS.heading.font, FONTS.heading.size).fillColor(COLORS.secondary);
      } else {
        doc.font(FONTS.body.font, FONTS.body.size).fillColor(COLORS.text);
      }

      doc.text(total.label, right - 200, y, { width: 120, align: 'right' });
      doc.text(value, right - 80, y, { width: 80, align: 'right' });

      y += total.bold ? 22 : 16;
    }

    return y;
  }

  /**
   * Bloc des paiements, puis le solde dû.
   */
  private drawPayments(
    doc: PDFKit.PDFDocument,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    document: any,
    language: DocumentLanguage,
    startY: number,
  ): number {
    const payments = (document.payments ?? []) as Array<Record<string, unknown>>;
    const { width, margin } = PAGE;
    const right = width - margin;
    const pageBottom = PAGE.height - margin;
    let y = startY;

    const drawHeading = (headingY: number): number => {
      doc.fillColor(COLORS.primary).font(FONTS.heading.font, FONTS.heading.size);
      doc.text(this.label('PAIEMENTS', language), margin, headingY);
      return headingY + 20;
    };

    if (y + 86 > pageBottom) {
      doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
      y = margin;
    }
    y = drawHeading(y);

    if (payments.length === 0) {
      doc.fillColor(COLORS.textMuted).font(FONTS.body.font, FONTS.body.size);
      doc.text(
        language === 'en' ? 'No payment recorded.' : 'Aucun règlement enregistré.',
        margin,
        y,
      );
      y += 16;
    } else {
      for (const payment of payments) {
        if (y + 22 > pageBottom) {
          doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
          y = drawHeading(margin);
        }
        doc.fillColor(COLORS.text).font(FONTS.body.font, FONTS.body.size);
        const method =
          PAYMENT_METHOD_LABELS[String(payment.method ?? '')] ?? String(payment.method ?? '');
        const reference = String(payment.reference ?? '');
        const date = this.formatDate(payment.paidAt as string | Date | null | undefined);
        const description = [date, method, reference].filter(Boolean).join(' · ');
        doc.text(description, margin, y, { width: right - margin - 140 });
        const amount = new Prisma.Decimal(String(payment.amount ?? '0'));
        doc.text(
          this.formatCurrency(amount, String(payment.currency ?? document.currency)),
          right - 140,
          y,
          {
            width: 140,
            align: 'right',
          },
        );
        y += 18;
      }
    }

    const total = new Prisma.Decimal(String(document.total ?? '0'));
    // `amountPaid` est la somme autoritaire recalculée dans la même transaction
    // que les paiements ; on ne reconstitue pas le total avec des flottants.
    const totalPaid = new Prisma.Decimal(String(document.amountPaid ?? '0'));
    const balance = total.minus(totalPaid);
    if (y + 42 > pageBottom) {
      doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
      y = margin;
    }

    doc.font(FONTS.body.font, FONTS.body.size).fillColor(COLORS.text);
    doc.text(this.label('Total payé', language), margin, y);
    doc.text(this.formatCurrency(totalPaid, document.currency), right - 140, y, {
      width: 140,
      align: 'right',
    });
    y += 18;

    doc.font('Helvetica-Bold', FONTS.body.size);
    doc.fillColor(balance.lessThanOrEqualTo(0) ? COLORS.secondary : COLORS.error);
    doc.text(this.label('Solde dû', language), margin, y);
    doc.text(this.formatCurrency(balance, document.currency), right - 140, y, {
      width: 140,
      align: 'right',
    });
    y += 18;
    doc.fillColor(COLORS.text).font(FONTS.body.font, FONTS.body.size);

    return y;
  }

  // ---------------------------------------------------------------------------
  // Utilitaires
  // ---------------------------------------------------------------------------

  /**
   * Libellé dans la langue du document.
   *
   * LIMITE CONNUE ET ASSUMÉE : les cinq polices standard du PDF n'ont aucun
   * glyphe arabe. Un document demandé en `ar` avec les libellés arabes
   * afficherait des caractères manquants — des rectangles vides à la place des
   * mots, donc une facture illisible. Le repli est donc le FRANÇAIS, choix
   * assumé plutôt qu'un rendu à trous : mieux vaut une facture lisible dans la
   * mauvaise langue qu'une facture incompréhensible dans la bonne.
   *
   * Ce que le support complet de l'arabe demanderait : embarquer une police
   * araque (Noto Naskh Arabic, plusieurs centaines de kilo) et l'enregistrer
   * via `doc.registerFont()`. C'est un arbitrage de poids et de maintenance qui
   * appartient à l'équipe, pas à une correction silencieuse — d'où ce
   * commentaire plutôt qu'une constante de plus.
   */
  private label(fr: string, language: DocumentLanguage): string {
    if (language === 'ar') {
      return fr;
    }
    if (language === 'en') {
      return PDF_LABELS_EN[fr] ?? fr;
    }
    return fr;
  }

  /**
   * Formater une date
   */
  private formatDate(dateString: string | Date | null | undefined): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '';

    // Écrit à la main, et ce n'est pas un détail : `toLocaleDateString('fr-FR')`
    // dépend des données ICU compilées dans Node. Une image « small-icu » (courante
    // sur les images officielles) ne contient pas le français et rendrait
    // silencieusement MM/DD/YYYY sur une facture française.
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${date.getFullYear()}`;
  }

  /**
   * Formater une devise
   */
  private formatCurrency(amount: Prisma.Decimal | string | number, currency: string): string {
    const decimalAmount = amount instanceof Prisma.Decimal ? amount : new Prisma.Decimal(amount);
    // Deux décimales, arrondi commercial. Le regroupement des milliers est
    // ensuite fait sur la CHAÎNE, pas via `Intl.NumberFormat` : ce dernier
    // dépend lui aussi de l'ICU embarquué, et un montant de facture ne doit
    // jamais changer de forme selon l'image qui le calcule.
    const raw = decimalAmount.toDecimalPlaces(CENTS, ROUND_HALF_UP).toString();
    const [whole = '0', fraction = ''] = raw.replace('-', '').split('.');
    const cents = `${fraction}00`.slice(0, 2);
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const sign = raw.startsWith('-') ? '-' : '';
    const formatted = `${sign}${grouped},${cents}`;

    // `د.ج` a disparu au profit de `DA` : les polices standard du PDF n'ont pas
    // de glyphes arabes, donc le suffixe dinar s'affichait en caractères
    // manquants — sur LA devise par défaut du produit, c'est-à-dire sur presque
    // toutes les factures. `DA` est l'abréviation latine usitée en Algérie.
    switch (currency?.toUpperCase()) {
      case 'EUR':
        return `${formatted} €`;
      case 'USD':
        return `${formatted} $`;
      case 'DZD':
        return `${formatted} DA`;
      default:
        return `${formatted} ${currency}`;
    }
  }

  /**
   * Obtenir le libellé du statut
   */
  private getStatusLabel(status: string, language: DocumentLanguage): string {
    const statusMap: Record<string, Record<'fr' | 'en' | 'ar', string>> = {
      DRAFT: { fr: 'Brouillon', en: 'Draft', ar: 'مسودة' },
      SENT: { fr: 'Envoyé', en: 'Sent', ar: 'مرسل' },
      ACCEPTED: { fr: 'Accepté', en: 'Accepted', ar: 'مقبول' },
      REJECTED: { fr: 'Refusé', en: 'Rejected', ar: 'مرفوض' },
      VIEWED: { fr: 'Consulté', en: 'Viewed', ar: 'Consulté' },
      EXPIRED: { fr: 'Expiré', en: 'Expired', ar: 'Expiré' },
      CANCELLED: { fr: 'Annulé', en: 'Cancelled', ar: 'Annulé' },
      PAID: { fr: 'Payé', en: 'Paid', ar: 'Payé' },
      PARTIAL: { fr: 'Partiel', en: 'Partial', ar: 'Partiel' },
      PARTIALLY_PAID: {
        fr: 'Partiellement payée',
        en: 'Partially paid',
        ar: 'Partiellement payée',
      },
      OVERDUE: { fr: 'En retard', en: 'Overdue', ar: 'En retard' },
      REFUNDED: { fr: 'Remboursé', en: 'Refunded', ar: 'Remboursé' },
    };

    const displayLanguage = language === 'ar' ? 'fr' : language;
    return statusMap[status]?.[displayLanguage] || status;
  }

  /**
   * Retour à la ligne pour le texte.
   *
   * `pdfkit` mesure la largeur réelle de la chaîne avec la police ET la taille
   * courantes — d'où les deux paramètres passés explicitement. L'ancienne
   * version mesurait avec `ctx.measureText`, qui dépendait de l'état du canvas ;
   * ici la mesure est toujours celle du rendu final.
   */
  private wrapText(text: string, maxWidth: number, doc: PDFKit.PDFDocument): string[] {
    const lines: string[] = [];
    let currentLine = '';

    for (const word of text.split(/\s+/).filter(Boolean)) {
      let token = word;
      // URL ou chaîne sans espaces : coupe progressivement, sinon la cellule
      // pourrait sortir du format A4 malgré le calcul de hauteur des lignes.
      while (doc.widthOfString(token) > maxWidth && token.length > 1) {
        const characters = [...token];
        let chunk = '';
        let consumed = 0;
        for (const character of characters) {
          if (chunk && doc.widthOfString(`${chunk}${character}`) > maxWidth) break;
          chunk += character;
          consumed += character.length;
        }
        if (!chunk) break;
        if (currentLine) {
          lines.push(currentLine);
          currentLine = '';
        }
        lines.push(chunk);
        token = token.slice(consumed);
      }

      const candidate = currentLine ? `${currentLine} ${token}` : token;
      if (currentLine && doc.widthOfString(candidate) > maxWidth) {
        lines.push(currentLine);
        currentLine = token;
      } else {
        currentLine = candidate;
      }
    }

    if (currentLine) lines.push(currentLine);
    return lines;
  }

  // ---------------------------------------------------------------------------
  // Envoi par email avec pièce jointe PDF
  // ---------------------------------------------------------------------------

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
    policy?: AccessPolicy,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // Récupérer les informations du document.
      //
      // DEUX APPELS SÉPARÉS, et non `this.prisma[documentType]` : indexer le
      // client par une union de clés produit un type UNION de delegates, dont
      // l'argument devrait satisfaire les DEUX signatures à la fois. Le `include`
      // diffère pourtant d'une facture (client seul) à un devis (client et
      // prospect). Deux branches nommées sont lisibles, et chacune est vérifiée
      // contre son propre modèle.
      const ownClientId = policy ? clientPerimeter(policy, documentType, 'read') : null;
      const document =
        documentType === 'invoice'
          ? await this.prisma.invoice.findFirst({
              where: {
                id: documentId,
                deletedAt: null,
                ...(ownClientId ? { clientId: ownClientId, NOT: { status: 'DRAFT' } } : {}),
              },
              include: { client: true },
            })
          : await this.prisma.quote.findFirst({
              where: {
                id: documentId,
                deletedAt: null,
                ...(ownClientId ? { clientId: ownClientId, NOT: { status: 'DRAFT' } } : {}),
              },
              include: { client: true, prospect: true },
            });

      if (!document) {
        throw AppException.notFound(
          documentType === 'invoice' ? 'INVOICE_NOT_FOUND' : 'QUOTE_NOT_FOUND',
          documentType === 'invoice' ? "Cette facture n'existe pas." : "Ce devis n'existe pas.",
        );
      }

      const client = document.client || ('prospect' in document ? document.prospect : null);
      const clientName = client
        ? client.companyName ||
          ('contactFirstName' in client
            ? `${client.contactFirstName} ${client.contactLastName}`.trim() || client.email
            : 'Client')
        : 'Client';
      const currency = document.currency || 'DZD';
      const total = this.formatCurrency(document.total || 0, currency);
      const reference = document.reference;

      // Générer le PDF
      let pdfBuffer: Buffer | null = null;
      let pdfFilename = '';

      if (options.includePdf !== false) {
        const generationOptions = {
          includeSignature: true,
          includeTerms: true,
          language: options.language || 'fr',
        };

        pdfBuffer =
          documentType === 'invoice'
            ? await this.generateInvoicePdf(documentId, generationOptions, policy)
            : await this.generateQuotePdf(documentId, generationOptions, policy);

        pdfFilename = `${documentType === 'invoice' ? 'facture' : 'devis'}-${reference}.pdf`;
      }

      const subject =
        options.subject ||
        (documentType === 'invoice' ? `Facture ${reference}` : `Devis ${reference}`);

      // `document` est une union facture/devis : `dueDate` n'existe que sur la
      // facture, `validUntil` que sur le devis. La lecture passe par une vue
      // commune, et le ternaire garantit qu'on ne va jamais chercher un champ
      // sur le modèle qui ne l'a pas.
      const dates = document as { dueDate?: Date | null; validUntil?: Date | null };
      const dueDate = documentType === 'invoice' ? dates.dueDate : null;
      const validUntil = documentType === 'quote' ? dates.validUntil : null;

      // Message par défaut
      const defaultMessage =
        documentType === 'invoice'
          ? `Bonjour ${clientName},\n\nVeuillez trouver ci-joint la facture ${reference} d'un montant de ${total}.\nDate d'échéance: ${dueDate ? this.formatDate(dueDate) : 'Non spécifiée'}.\n\nCordialement,\nL'équipe Comexa`
          : `Bonjour ${clientName},\n\nVeuillez trouver ci-joint le devis ${reference} d'un montant de ${total}.\n${validUntil ? `Valable jusqu'au: ${this.formatDate(validUntil)}` : ''}\n\nCordialement,\nL'équipe Comexa`;

      const messageText = options.message || defaultMessage;

      // Envoi par le service de courriel unique. `MailService` LÈVE en cas
      // d'échec, et c'est ce `catch` plus bas qui le transforme en réponse —
      // l'appelant décide, il ne découvre pas une exception non attrapée.
      await this.mailService.send({
        to: options.to,
        subject,
        text: messageText,
        // Le même texte en HTML minimal : certains clients de messagerie
        // n'affichent que la version HTML, et une facture envoyée en texte seul
        // y arrive sans mise en forme aucune.
        html: `<p>${messageText.replace(/\n/g, '<br>')}</p>`,
        ...(pdfBuffer && pdfFilename
          ? {
              attachments: [
                { contentType: 'application/pdf', filename: pdfFilename, content: pdfBuffer },
              ],
            }
          : {}),
      });

      // `MailService` ne renvoie pas d'identifiant de message : il ne connaît
      // pas le transport utilisé (Mailjet rend un `MessageID`, SMTP un
      // `messageId`). Renvoyer `undefined` est honnête ; en inventer un serait
      // mentir à l'appelant qui le journaliserait.
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Erreur lors de l'envoi",
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
    policy?: AccessPolicy,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    return this.sendDocumentByEmail(invoiceId, 'invoice', options, policy);
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
    policy?: AccessPolicy,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    return this.sendDocumentByEmail(quoteId, 'quote', options, policy);
  }
}
