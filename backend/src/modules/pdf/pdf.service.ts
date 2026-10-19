import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MailService } from '../../common/mail/mail.service.js';
import { AppException } from '../../common/errors/app-error.js';
import { clientPerimeter } from '../invoices/billing-access.js';
import type { AccessPolicy } from '../../common/auth/principal.js';
import {
  renderDocument,
  type DocumentKeyValue,
  type DocumentModel,
  type DocumentParty,
  type DocumentTone,
} from './document-layout.js';
import { buildAddressLines, inlineAddress, postalLine } from './address-lines.js';

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

/** Langues couvertes par les libellés du document. */
type DocumentLanguage = 'fr' | 'en' | 'ar';

/**
 * Écarte les morceaux vides d'une liste de textes.
 *
 * `filter(Boolean)` ne suffit pas : TypeScript y conserve le type
 * `(string | undefined)[]`, et un tableau de lignes d'adresse doit être un
 * tableau de chaînes — sinon un `undefined` finirait écrit tel quel dans le PDF.
 */
function compact(values: Array<string | null | undefined>): string[] {
  return values.filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
}

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
  Référence: 'Reference',
  Signature: 'Signature',
  'Émise le': 'Issued on',
  'Émis le': 'Issued on',
  'Rattaché à': 'Related to',
  suite: 'continued',
  Projet: 'Project',
  Devis: 'Quote',
  'Règlements encaissés': 'Payments received',
  'Aucun règlement enregistré.': 'No payment recorded.',
  'Aucune prestation sur ce document.': 'No line item on this document.',
  'Payée le': 'Paid on',
  'Signature et cachet': 'Signature and stamp',
  'Merci pour votre confiance.': 'Thank you for your trust.',
};

/**
 * Tonalité d'un statut, pour la pastille de l'encadré de références.
 *
 * Le statut est la première chose qu'un comptable cherche sur une facture : le
 * couleur le donne avant la lecture. Les tons reprennent ceux de l'interface
 * (info, succès, alerte, danger) dans leur version imprimable.
 */
const STATUS_TONES: Record<string, DocumentTone> = {
  DRAFT: 'neutral',
  SENT: 'info',
  VIEWED: 'info',
  ACCEPTED: 'success',
  PAID: 'success',
  PARTIAL: 'warning',
  PARTIALLY_PAID: 'warning',
  OVERDUE: 'danger',
  REJECTED: 'danger',
  EXPIRED: 'warning',
  CANCELLED: 'neutral',
  REFUNDED: 'neutral',
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
   * Informations de l'entreprise Comexa.
   *
   * DEUX VALEURS PAR DÉFAUT ONT CHANGÉ, et ce n'est pas cosmétique.
   * L'adresse valait « Algérie » et la ville « Algiers » : avec le pays, lui
   * aussi « Algérie », l'en-tête de chaque facture affichait
   *
   *     Algérie
   *     Algiers
   *     Algérie
   *
   * soit le pays deux fois et la ville dans sa graphie anglaise, sur un document
   * français. L'adresse par défaut est désormais vide — une rue ne s'invente
   * pas, et `buildAddressLines` écarte les champs vides — et la ville reprend la
   * graphie française. Les doublons restants (une variable d'environnement qui
   * remettrait le pays dans la rue) sont éliminés à la construction des lignes.
   */
  private getCompanyInfo() {
    return {
      name: this.config.get<string>('PDF_COMPANY_NAME') || 'Comexa',
      address: this.config.get<string>('PDF_COMPANY_ADDRESS') || '',
      city: this.config.get<string>('PDF_COMPANY_CITY') || 'Alger',
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
   * Générer un PDF pour un document (facture ou devis).
   *
   * Le service ne dessine plus rien : il TRADUIT la pièce Prisma en
   * `DocumentModel` (que des chaînes déjà formatées) et laisse
   * `document-layout.ts` décider de la mise en page et de la pagination. C'est
   * ce découplage qui permet de tester la pagination — le bug de la « deuxième
   * page presque vide » — sans base de données ni client Prisma généré.
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
    const companyInfo = this.getCompanyInfo();
    const model = this.buildModel({
      type,
      document,
      companyInfo,
      logo: this.loadLogo(),
      includeSignature,
      includeTerms,
      language,
    });

    const title = `${type === 'invoice' ? 'Facture' : 'Devis'} ${document.reference ?? ''}`;
    const { buffer, pageCount, density } = await renderDocument(model, {
      info: { Title: title, Author: companyInfo.name, Subject: title },
    });

    // Trace de pagination : c'est ce qui manquait pour diagnostiquer un document
    // qui déborde sans avoir à rouvrir le PDF produit.
    if (pageCount > 1) {
      this.logger.debug(
        `PDF ${document.reference ?? '(sans référence)'} : ${pageCount} pages, densité ${density}`,
      );
    }

    return buffer;
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
  // Construction du modèle de document
  // ---------------------------------------------------------------------------

  /**
   * Traduit une pièce Prisma (facture ou devis) en `DocumentModel`.
   *
   * ICI, TOUT EST FORMATÉ : montants, dates, quantités, libellés traduits. La
   * mise en page (`document-layout.ts`) ne reçoit que des chaînes, ce qui la
   * rend testable sans base de données. Réciproquement, ce module-ci ne dessine
   * rien : aucune coordonnée, aucune couleur, aucune police n'y apparaît.
   *
   * Les doublons d'identité signalés sur les factures réelles sont traités à ce
   * niveau, parce que c'est ici que les champs sont lus :
   *  - une adresse dont un morceau en répète un autre (pays recopié dans la
   *    rue) ne produit qu'une ligne — `buildAddressLines` ;
   *  - un nom légal qui contient le nom commercial (« Maison Vasseur » /
   *    « Maison Vasseur SARL ») remplace ce dernier au lieu de s'y ajouter ;
   *  - un champ vide (région, second téléphone, TVA d'un particulier) ne laisse
   *    ni trou ni ligne orpheline.
   */
  private buildModel({
    type,
    document,
    companyInfo,
    logo,
    includeSignature,
    includeTerms,
    language,
  }: {
    type: 'invoice' | 'quote';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    document: any;
    companyInfo: ReturnType<PdfService['getCompanyInfo']>;
    logo: Buffer | null;
    includeSignature: boolean;
    includeTerms: boolean;
    language: DocumentLanguage;
  }): DocumentModel {
    const currency = String(document.currency ?? 'DZD');
    const isInvoice = type === 'invoice';
    // Un devis peut viser un prospect (pas encore client) : les deux portent les
    // mêmes champs d'identité utiles ici.
    const client = document.client ?? document.prospect ?? null;
    const contact = client?.contacts?.[0] ?? null;
    const title = this.label(isInvoice ? 'FACTURE' : 'DEVIS', language);

    return {
      kind: type,
      title,
      reference: String(document.reference ?? ''),
      referenceLabel: this.label('N°', language),
      issuedLine: this.issuedLine(document.issueDate, isInvoice, language),
      company: { name: companyInfo.name, lines: this.companyLines(companyInfo, language) },
      logo,
      meta: this.metaRows(type, document, language),
      recipient: this.recipientParty(type, client, contact, language),
      context: this.contextParty(type, document, language),
      items: {
        headers: [
          this.label('Description', language),
          this.label('Qté', language),
          this.label('P.U.', language),
          this.label('Montant', language),
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rows: ((document.items ?? []) as any[]).map((item) => ({
          title: String(item.title ?? ''),
          description: item.description ? String(item.description) : undefined,
          quantity: this.formatQuantity(item.quantity),
          unitPrice: this.formatCurrency(item.unitPrice ?? 0, currency),
          amount: this.formatCurrency(item.lineTotal ?? 0, currency),
        })),
        empty: this.label('Aucune prestation sur ce document.', language),
      },
      totals: this.totalRows(type, document, currency, language),
      payments: isInvoice ? this.paymentBlock(document, currency, language) : null,
      sections: this.textSections(document, includeTerms, language),
      signature: includeSignature
        ? {
            heading: this.label('Signature', language),
            caption: this.label('Signature et cachet', language),
          }
        : null,
      thanks: this.label('Merci pour votre confiance.', language),
      footer: this.footerLines(companyInfo),
      continuation: `${title} ${document.reference ?? ''} — ${this.label('suite', language)}`,
    };
  }

  /** « Émise le 10/09/2026 » — vide si la date est absente ou invalide. */
  private issuedLine(
    issueDate: Date | string | null | undefined,
    isInvoice: boolean,
    language: DocumentLanguage,
  ): string {
    const date = this.formatDate(issueDate);
    if (!date) return '';
    return `${this.label(isInvoice ? 'Émise le' : 'Émis le', language)} ${date}`;
  }

  /**
   * Coordonnées de l'entreprise, en haut à droite.
   *
   * Regroupées sur quatre à six lignes plutôt qu'une par champ : l'ancien rendu
   * empilait huit lignes (dont le pays deux fois) et mangeait le quart de la
   * page avant même le titre.
   */
  private companyLines(
    info: ReturnType<PdfService['getCompanyInfo']>,
    language: DocumentLanguage,
  ): string[] {
    const phoneLabel = language === 'en' ? 'Phone' : 'Tél';
    const address = buildAddressLines([
      info.address,
      postalLine(info.postalCode, info.city),
      info.country,
    ]);
    const contact = compact([info.phone ? `${phoneLabel} : ${info.phone}` : null, info.email]).join(
      ' · ',
    );
    const legal = compact([
      info.registrationNumber ? `RC : ${info.registrationNumber}` : null,
      info.taxId ? `NIF/TVA : ${info.taxId}` : null,
    ]).join(' · ');

    return compact([...address, contact, info.website, legal]);
  }

  /** Mentions légales du pied de page : deux lignes, sur toutes les pages. */
  private footerLines(info: ReturnType<PdfService['getCompanyInfo']>): string[] {
    const legal = compact([
      info.registrationNumber ? `RC ${info.registrationNumber}` : null,
      info.taxId ? `NIF ${info.taxId}` : null,
    ]).join(' · ');

    return compact([
      inlineAddress([
        info.name,
        info.address,
        postalLine(info.postalCode, info.city),
        info.country,
        legal,
      ]),
      compact([info.phone, info.email, info.website]).join(' · '),
    ]);
  }

  /**
   * Encadré de références : statut en pastille, puis échéance (facture) ou
   * validité (devis). L'échéance passe en rouge quand la pièce est en retard —
   * c'est l'information qu'un comptable cherche en premier.
   */
  private metaRows(
    type: 'invoice' | 'quote',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    document: any,
    language: DocumentLanguage,
  ): DocumentKeyValue[] {
    const status = String(document.status ?? '');
    const rows: DocumentKeyValue[] = [];

    if (status) {
      rows.push({
        value: this.getStatusLabel(status, language),
        pill: true,
        tone: STATUS_TONES[status] ?? 'neutral',
      });
    }

    if (type === 'invoice') {
      const due = this.formatDate(document.dueDate);
      if (due) {
        rows.push({
          label: this.label("Date d'échéance", language),
          value: due,
          tone: status === 'OVERDUE' ? 'danger' : undefined,
        });
      }
      return rows;
    }

    const validUntil = this.formatDate(document.validUntil);
    if (validUntil) {
      rows.push({ label: this.label("Valable jusqu'au", language), value: validUntil });
    }
    return rows;
  }

  /** Destinataire : client d'une facture, client ou prospect d'un devis. */
  private recipientParty(
    type: 'invoice' | 'quote',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contact: any,
    language: DocumentLanguage,
  ): DocumentParty {
    const heading = this.label(type === 'invoice' ? 'FACTURÉ À' : 'DESTINATAIRE', language);
    const fallback = language === 'en' ? 'Client' : 'Client';

    if (!client) return { heading, name: fallback, lines: [] };

    const personName = compact([
      contact?.firstName ?? client.contactFirstName,
      contact?.lastName ?? client.contactLastName,
    ]).join(' ');
    const companyName = typeof client.companyName === 'string' ? client.companyName.trim() : '';
    const legalName = typeof client.legalName === 'string' ? client.legalName.trim() : '';

    // Le nom légal REMPLACE le nom commercial quand il le contient déjà :
    // écrire « Maison Vasseur » puis « Maison Vasseur SARL » faisait deux lignes
    // pour une seule entité.
    const name =
      legalName && companyName && legalName.toLowerCase().includes(companyName.toLowerCase())
        ? legalName
        : companyName || personName || contact?.email || client.email || fallback;

    const address = buildAddressLines([
      legalName && legalName !== name ? legalName : null,
      client.addressLine1 ?? client.address,
      client.addressLine2,
      postalLine(client.postalCode, client.city),
      client.region,
      client.country,
    ]);
    const details = compact([
      contact?.jobTitle ?? client.jobTitle,
      compact([contact?.email ?? client.email, contact?.phone ?? client.phone]).join(' · '),
      compact([
        client.registrationNumber ? `RC : ${client.registrationNumber}` : null,
        client.vatNumber ? `NIF/TVA : ${client.vatNumber}` : null,
      ]).join(' · '),
    ]);

    return { heading, name, lines: [...address, ...details] };
  }

  /**
   * Bloc de droite, en regard du destinataire : projet, devis d'origine, objet.
   *
   * Ces liens étaient chargés par la requête (`include: { project, quote }`) et
   * n'étaient JAMAIS écrits dans le document. Ils occupent maintenant la moitié
   * droite du bloc destinataire, qui restait vide.
   */
  private contextParty(
    type: 'invoice' | 'quote',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    document: any,
    language: DocumentLanguage,
  ): DocumentParty | null {
    const project = document.project ?? null;
    const quote = document.quote ?? null;
    const subject = typeof document.subject === 'string' ? document.subject.trim() : '';
    const name = String(project?.name ?? subject ?? '');

    const lines = compact([
      project?.reference ? `${this.label('Projet', language)} ${project.reference}` : null,
      type === 'invoice' && quote?.reference
        ? `${this.label('Devis', language)} ${quote.reference}`
        : null,
      subject && subject !== name ? subject : null,
    ]);

    if (!name && !lines.length) return null;
    return { heading: this.label('Rattaché à', language), name, lines };
  }

  /**
   * Encadré d'argent : détail, bandeau TOTAL, puis récapitulatif de règlement.
   *
   * Une ligne à zéro n'est pas écrite : « Remise 0,00 DA » sur chaque facture
   * faisait douter d'un arrondi et prenait une ligne pour rien. Le solde dû,
   * lui, est TOUJOURS écrit — c'est la seule ligne qu'un reliseur cherche.
   */
  private totalRows(
    type: 'invoice' | 'quote',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    document: any,
    currency: string,
    language: DocumentLanguage,
  ): DocumentKeyValue[] {
    const amount = (value: unknown): Prisma.Decimal => new Prisma.Decimal(String(value ?? 0));
    const positive = (value: unknown): boolean => amount(value).greaterThan(0);
    const rows: DocumentKeyValue[] = [];

    if (positive(document.subtotal)) {
      rows.push({
        label: this.label('Sous-total', language),
        value: this.formatCurrency(document.subtotal, currency),
      });
    }

    if (positive(document.discountAmount)) {
      rows.push({
        label: this.label('Remise', language),
        value: this.formatCurrency(amount(document.discountAmount).negated(), currency),
      });
    }

    if (positive(document.taxAmount)) {
      const rate = amount(document.taxRate).toString().replace('.', ',');
      rows.push({
        label: `${this.label('TVA', language)} ${rate} %`,
        value: this.formatCurrency(document.taxAmount, currency),
      });
    }

    rows.push({
      label: this.label('TOTAL', language),
      value: this.formatCurrency(document.total ?? 0, currency),
      strong: true,
    });

    if (type !== 'invoice') return rows;

    // `amountPaid` est le cumul autoritaire, recalculé dans la même transaction
    // que les règlements : le solde se déduit, il n'est jamais reconstitué à
    // partir de flottants.
    const paid = amount(document.amountPaid);
    const balance = amount(document.total).minus(paid);

    if (paid.greaterThan(0)) {
      rows.push({
        label: this.label('Total payé', language),
        value: this.formatCurrency(paid, currency),
      });
    }

    if (balance.greaterThan(0)) {
      rows.push({
        label: this.label('Solde dû', language),
        value: this.formatCurrency(balance, currency),
        tone: 'danger',
      });
      return rows;
    }

    const paidAt = this.formatDate(document.paidAt);
    rows.push(
      paidAt
        ? { label: this.label('Payée le', language), value: paidAt, tone: 'success' }
        : {
            label: this.label('Solde dû', language),
            value: this.formatCurrency(balance, currency),
            tone: 'success',
          },
    );
    return rows;
  }

  /** Historique des règlements réussis, en regard de l'encadré d'argent. */
  private paymentBlock(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    document: any,
    currency: string,
    language: DocumentLanguage,
  ): { heading: string; rows: DocumentKeyValue[]; empty: string } {
    const payments = (document.payments ?? []) as Array<Record<string, unknown>>;

    return {
      heading: this.label('Règlements encaissés', language),
      rows: payments.map((payment) => {
        const method =
          PAYMENT_METHOD_LABELS[String(payment.method ?? '')] ?? String(payment.method ?? '');
        return {
          // Date et moyen sur la ligne, référence en dessous : la colonne fait
          // 240 pt, et une référence de virement tronquée ne permet plus aucun
          // rapprochement bancaire.
          label: compact([
            this.formatDate(payment.paidAt as Date | string | null | undefined),
            method,
          ]).join(' · '),
          note: payment.reference
            ? `${this.label('Référence', language)} ${payment.reference}`
            : undefined,
          // `payment` vient d'une requête typée en `Record<string, unknown>` :
          // le montant repasse par `Decimal` explicitement plutôt que par un
          // `any` implicite.
          value: this.formatCurrency(
            new Prisma.Decimal(String(payment.amount ?? 0)),
            String(payment.currency ?? currency),
          ),
        };
      }),
      empty: this.label('Aucun règlement enregistré.', language),
    };
  }

  /** Notes et conditions réelles de la pièce, dans cet ordre. */
  private textSections(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    document: any,
    includeTerms: boolean,
    language: DocumentLanguage,
  ): Array<{ heading: string; body: string }> {
    const sections: Array<{ heading: string; body: string }> = [];

    const notes = typeof document.notes === 'string' ? document.notes.trim() : '';
    if (notes) sections.push({ heading: this.label('Notes', language), body: notes });

    const terms = typeof document.terms === 'string' ? document.terms.trim() : '';
    if (includeTerms && terms) {
      sections.push({ heading: this.label('Conditions', language), body: terms });
    }

    return sections;
  }

  /**
   * Quantité lisible : `1` et non `1.00`, mais `2,5` reste décimal.
   *
   * `Decimal.toString()` retire déjà les zéros de queue ; la différence avec un
   * montant est volontaire — une quantité n'est pas une somme.
   */
  private formatQuantity(value: unknown): string {
    return new Prisma.Decimal(String(value ?? 0)).toDecimalPlaces(CENTS, ROUND_HALF_UP).toString();
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
