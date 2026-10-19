import PDFDocument from 'pdfkit';
import { fittedImageSize, readImageSize } from './image-size.js';

/**
 * MISE EN PAGE DES DOCUMENTS COMMERCIAUX (factures et devis).
 *
 * Ce module est VOLONTAIREMENT PUR : il ne connaît ni Prisma, ni Nest, ni la
 * configuration. Il reçoit un `DocumentModel` (que des chaînes déjà formatées)
 * et un `PDFDocument`, et il dessine. On peut donc le tester sans base de
 * données ni client Prisma généré — c'est exactement ce que fait
 * `document-layout.spec.ts`, qui compte les pages produites.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI IL A ÉTÉ RÉÉCRIT : LA DEUXIÈME PAGE PRESQUE VIDE
 * ---------------------------------------------------------------------------
 *
 * L'ancien rendu descendait la page section par section et demandait, avant
 * chaque section, « est-ce qu'il reste 46 pt ? 58 pt ? 42 pt ? ». Trois
 * conséquences visibles sur les factures réelles :
 *
 *  1. LES RÉSERVES ÉTAIENT FAUSSES. `Math.min(46, lignes × 12 + 24)` ne
 *     mesurait jamais la section entière : une section de conditions de six
 *     lignes réservait 46 pt, puis débordait ligne à ligne.
 *  2. LES BLOCS ÉTAIENT INDÉPENDANTS. La signature et le pied de page
 *     demandaient chacun leur place séparément : il suffisait que le tableau
 *     compte trois lignes de plus pour que LA SIGNATURE SEULE parte en page 2.
 *     C'est le « 1 / 2 » avec une deuxième page blanche de la capture.
 *  3. LA PAGE ÉTAIT GASPILLÉE. Le logo était réservé dans une boîte de 140 pt de
 *     haut alors que le fichier réel (1131 × 261) ne mesure que 35 pt une fois
 *     ramené à 150 pt de large ; et tout le bas du document (règlements, notes,
 *     conditions, signature) s'empilait en pleine largeur sous un encadré de
 *     totaux qui n'occupe que la moitié droite. Une facture d'une seule
 *     prestation dépassait donc la page — alors qu'il restait 250 pt de large
 *     inutilisés à chaque étage.
 *
 * Ce module règle les trois, dans cet ordre :
 *
 *  - LA PAGE EST UTILISÉE SUR SES DEUX COLONNES. Destinataire | contexte,
 *    règlements | totaux, notes et conditions | signature. Le document tient
 *    debout sans sacrifier la hiérarchie : cinq prestations, leurs règlements,
 *    des notes, des conditions et une signature tiennent sur une seule page A4.
 *  - CHAQUE BLOC SE MESURE AVANT D'ÊTRE DESSINÉ, puis `ensureSpace` décide. Un
 *    bloc atomique (encadré de totaux, signature, titre de section + première
 *    ligne) ne se coupe jamais en deux.
 *  - LES DEUX DERNIERS BLOCS SONT SOLIDAIRES. Quand le bloc de clôture (notes,
 *    conditions, signature) serait seul à partir en page suivante — donc
 *    clairsemé — il emmène l'argent avec lui. Une page 2 ne peut plus se réduire
 *    à un trait de signature.
 *  - LA DERNIÈRE LIGNE DU TABLEAU GARDE L'ARGENT AVEC ELLE (`keepWithMoney`) :
 *    jamais de totaux orphelins en haut de page 2, jamais de ligne isolée en bas
 *    de page 1.
 *  - DEUX PASSES DE DENSITÉ. Si la passe normale déborde, on rejoue la mise en
 *    page en densité compacte (espacements inter-blocs réduits de 45 %) et on
 *    garde le meilleur des deux résultats. Un document qui débordait de 50 pt
 *    tient maintenant sur une page, au lieu d'en produire une deuxième pour trois
 *    lignes.
 *  - LE PIED DE PAGE N'EST PLUS DANS LE FLUX : il est dessiné à la fin sur
 *    CHAQUE page tamponnée (`bufferPages`), dans une bande réservée. Il ne peut
 *    donc plus provoquer de saut de page, et la numérotation « Page 1 / 2 » est
 *    exacte même quand le document se termine sur plusieurs pages.
 */

// ---------------------------------------------------------------------------
// Modèle de document
// ---------------------------------------------------------------------------

/** Tonalité d'une valeur : pilote la pastille et la couleur d'encre. */
export type DocumentTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface DocumentKeyValue {
  /** Absent sur une ligne « pilule » (statut), qui n'a pas de libellé. */
  label?: string;
  value: string;
  /**
   * Mention secondaire, écrite sous le libellé en corps réduit.
   *
   * Utilisée par les règlements : la référence de paiement ne tient pas sur la
   * même ligne que la date et le moyen dans une colonne de 240 pt, et la
   * tronquer aurait fait disparaître la seule information qui permet de
   * rapprocher un virement. Elle passe donc en dessous, plutôt que de sauter.
   */
  note?: string;
  tone?: DocumentTone;
  /** Ligne mise en avant : le TOTAL, dessiné en bandeau plein. */
  strong?: boolean;
  /** Dessiné sous forme de pilule, alignée à droite dans son encadré. */
  pill?: boolean;
}

export interface DocumentItemRow {
  title: string;
  description?: string;
  quantity: string;
  unitPrice: string;
  amount: string;
}

export interface DocumentParty {
  heading: string;
  name: string;
  lines: string[];
}

export interface DocumentSection {
  heading: string;
  body: string;
}

export interface DocumentModel {
  kind: 'invoice' | 'quote';
  /** « FACTURE » / « INVOICE » : déjà traduit par l'appelant. */
  title: string;
  reference: string;
  referenceLabel: string;
  /** « Émise le 10/09/2026 » — vide si la date est inconnue. */
  issuedLine: string;
  company: { name: string; lines: string[] };
  logo: Buffer | null;
  /** Encadré en haut à droite : statut, échéance, validité. */
  meta: DocumentKeyValue[];
  recipient: DocumentParty;
  /** Bloc de droite, en regard du destinataire : projet, devis d'origine. */
  context?: DocumentParty | null;
  items: {
    headers: [string, string, string, string];
    rows: DocumentItemRow[];
    empty: string;
  };
  /** La ligne `strong` sépare le détail (au-dessus) du récapitulatif (dessous). */
  totals: DocumentKeyValue[];
  payments?: { heading: string; rows: DocumentKeyValue[]; empty: string } | null;
  /** Notes, conditions : tout ce qui est texte libre. */
  sections: DocumentSection[];
  signature?: { heading: string; caption: string } | null;
  /** Message de remerciement, en bas de la colonne de gauche. */
  thanks?: string;
  /** Mentions légales du pied de page, déjà assemblées. */
  footer: string[];
  /** Rappel écrit en haut des pages suivantes. */
  continuation: string;
}

export interface RenderedDocument {
  buffer: Buffer;
  pageCount: number;
  /** Densité retenue : utile au diagnostic d'un document qui déborde. */
  density: LayoutDensity;
}

export type LayoutDensity = 'normal' | 'compact';

export interface LayoutResult {
  pageCount: number;
  /** Hauteur de contenu de la DERNIÈRE page, en points. Sert à détecter une
   *  page presque vide sans avoir à rouvrir le PDF. */
  lastPageContentHeight: number;
  density: LayoutDensity;
}

export interface DocumentInfo {
  Title?: string;
  Author?: string;
  Subject?: string;
  Keywords?: string;
}

// ---------------------------------------------------------------------------
// Géométrie de la page (A4 portrait, en points : 1 pt = 1/72 pouce)
// ---------------------------------------------------------------------------

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;

const MARGIN_TOP = 40;
const MARGIN_SIDE = 44;
const MARGIN_BOTTOM = 40;
/** Bande réservée au pied de page : le flux de contenu s'arrête au-dessus. */
const FOOTER_BAND = 30;

const LEFT = MARGIN_SIDE;
const RIGHT = PAGE_WIDTH - MARGIN_SIDE;
const WIDTH = RIGHT - LEFT;
const TOP = MARGIN_TOP;
const BOTTOM = PAGE_HEIGHT - MARGIN_BOTTOM - FOOTER_BAND;
/** Hauteur utile d'une page : ce qu'un bloc doit pouvoir remplir d'un seul tenant. */
const PAGE_CONTENT_HEIGHT = BOTTOM - TOP;

/** Liseré de marque, en haut de chaque page. */
const BAND_HEIGHT = 5;

/** En dessous de cette hauteur de contenu, une page paraît vide à l'œil. */
const SPARSE_PAGE = 150;

/**
 * Seuil exposé pour les tests : c'est la définition chiffrée de « page presque
 * vide », celle de la capture (une page 2 réduite à une signature et un pied de
 * page). Le spécifique vérifie qu'aucun document produit ne descend en dessous.
 */
export const SPARSE_PAGE_HEIGHT = SPARSE_PAGE;

const LOGO_BOX = { width: 172, height: 48 };
const WORDMARK_HEIGHT = 32;
const COMPANY_WIDTH = 240;
const META_WIDTH = 224;
const TOTALS_WIDTH = 240;
const COLUMN_GAP = 26;
const SIGNATURE_WIDTH = 208;

/** Largeur de la colonne de gauche quand une colonne droite est présente. */
const MONEY_LEFT_WIDTH = WIDTH - TOTALS_WIDTH - COLUMN_GAP;
const BOTTOM_LEFT_WIDTH = WIDTH - SIGNATURE_WIDTH - COLUMN_GAP - 4;

const TABLE = {
  quantity: 42,
  unitPrice: 98,
  amount: 110,
  headerHeight: 26,
  rowPadding: 7,
  titleLine: 12.4,
  descriptionLine: 10.6,
  minRowHeight: 28,
} as const;
const TABLE_DESCRIPTION_WIDTH = WIDTH - TABLE.quantity - TABLE.unitPrice - TABLE.amount;

const TOTALS = { row: 15, pad: 9, band: 30, summaryRow: 16 } as const;
const PAYMENT_ROW = 16;
const PAYMENT_NOTE = 10;
/** Au-delà, la liste des règlements est trop longue pour la colonne de gauche :
 *  elle repasse en pleine largeur, sous les totaux. */
const PAYMENTS_STACKED_HEIGHT = 132;

const SECTION = { heading: 14, line: 12, gap: 10 } as const;
const CLOSING = { full: 58, compact: 34, thanks: 15 } as const;

// ---------------------------------------------------------------------------
// Palette et typographie
// ---------------------------------------------------------------------------

/**
 * Palette d'impression. Ce n'est PAS la palette pastel de l'interface
 * (`softui.tokens.css`) : sur du papier, un pastel de fond vire au gris et un
 * texte pastel devient illisible. On garde les bleus de la marque Comexa, avec
 * des encres contrastées (AA sur blanc).
 */
const INK = {
  primary: '#0b2545',
  accent: '#1568b4',
  text: '#16293d',
  muted: '#54677c',
  faint: '#7d8ea1',
  hairline: '#e2e8f0',
  rule: '#c3d0de',
  wash: '#f5f8fc',
  washStrong: '#e9f1fa',
  paper: '#ffffff',
} as const;

const TONES: Record<DocumentTone, { wash: string; ink: string }> = {
  neutral: { wash: '#eef1f5', ink: '#4a5a6b' },
  info: { wash: '#e4effa', ink: '#1560a8' },
  success: { wash: '#e3f2e8', ink: '#1c7a4a' },
  warning: { wash: '#fbf0dc', ink: '#9d6508' },
  danger: { wash: '#fbe7e7', ink: '#b32020' },
};

type FontStyle = 'regular' | 'bold' | 'italic';

/**
 * Les polices standard du PDF : présentes dans toute visionneuse, aucun fichier
 * à embarquer. Contrepartie assumée : pas de glyphe arabe — le service replie
 * sur le français quand on lui demande l'arabe.
 */
const FAMILIES: Record<FontStyle, string> = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  italic: 'Helvetica-Oblique',
};

const SCALE = {
  wordmark: 21,
  title: 23,
  brand: 12,
  total: 13,
  partyName: 11.2,
  reference: 10.2,
  body: 9.4,
  detail: 8.8,
  small: 8.4,
  label: 7.8,
  micro: 7.2,
} as const;

// ---------------------------------------------------------------------------
// Primitives de dessin
// ---------------------------------------------------------------------------

type Align = 'left' | 'center' | 'right';

interface WriteOptions {
  characterSpacing?: number;
}

function setFont(doc: PDFKit.PDFDocument, style: FontStyle, size: number): void {
  doc.font(FAMILIES[style], size);
}

/**
 * Ascendante des polices Helvetica, en fraction du corps.
 *
 * `pdfkit` positionne un texte par le HAUT de sa ligne, pas par sa baseline :
 * deux textes de corps différents écrits au même `y` ne sont donc pas alignés
 * sur la même ligne d'écriture. Dans un tableau de montants, un libellé à 8,4 pt
 * posé à côté d'un montant à 9,4 pt flottait un point plus haut — visible à
 * l'œil sur une facture imprimée. `topFor` recalcule le `y` d'un texte pour que
 * sa baseline tombe sur celle d'un texte de référence.
 */
const ASCENT = 0.718;

function topFor(baseline: number, size: number): number {
  return baseline - size * ASCENT;
}

function widthOf(doc: PDFKit.PDFDocument, text: string, options?: WriteOptions): number {
  return options?.characterSpacing
    ? doc.widthOfString(text, { characterSpacing: options.characterSpacing })
    : doc.widthOfString(text);
}

/**
 * Tronque à la largeur disponible, en ajoutant « … ».
 *
 * `pdfkit` ne sait tronquer que dans un bloc à hauteur limitée ; sur une ligne
 * unique il déborde simplement de la boîte. Sans cette fonction, une adresse
 * électronique longue ou un nom de client verbeux sortait de la page — et la
 * largeur mesurée ne correspondait plus à la largeur dessinée.
 */
function fit(doc: PDFKit.PDFDocument, text: string, maxWidth: number): string {
  if (maxWidth <= 0 || text.length === 0) return '';
  if (widthOf(doc, text) <= maxWidth) return text;

  let kept = text;
  while (kept.length > 1 && widthOf(doc, `${kept.slice(0, -1).trimEnd()}…`) > maxWidth) {
    kept = kept.slice(0, -1);
  }
  return `${kept.slice(0, -1).trimEnd()}…`;
}

/** Écrit UNE ligne, sans retour automatique, alignée dans sa boîte. */
function writeLine(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  width: number,
  align: Align = 'left',
  options?: WriteOptions,
): void {
  const trimmed = fit(doc, text, width);
  if (!trimmed) return;
  doc.text(trimmed, x, y, {
    width,
    align,
    lineBreak: false,
    ...(options?.characterSpacing ? { characterSpacing: options.characterSpacing } : {}),
  });
}

/** Écrit un titre de section : petites capitales espacées, encre pâle. */
function writeHeading(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  width: number,
): void {
  setFont(doc, 'bold', SCALE.label);
  doc.fillColor(INK.faint);
  writeLine(doc, text.toUpperCase(), x, y, width, 'left', { characterSpacing: 0.6 });
}

/**
 * Retour à la ligne manuel.
 *
 * `pdfkit` mesure avec la police ET la taille courantes : la mesure est donc
 * toujours celle du rendu final, à condition d'avoir posé la police avant —
 * c'est le contrat de tous les `prepare*` ci-dessous.
 */
function wrapText(doc: PDFKit.PDFDocument, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = '';

  for (const word of text.split(/\s+/).filter(Boolean)) {
    let token = word;

    // Mot plus large que la colonne (URL, référence) : coupe au caractère,
    // sinon la ligne déborde et la hauteur calculée devient fausse.
    while (widthOf(doc, token) > maxWidth && token.length > 1) {
      let chunk = '';
      let consumed = 0;
      for (const character of token) {
        if (chunk && widthOf(doc, `${chunk}${character}`) > maxWidth) break;
        chunk += character;
        consumed += character.length;
      }
      if (!chunk) break;
      if (current) {
        lines.push(current);
        current = '';
      }
      lines.push(chunk);
      token = token.slice(consumed);
    }

    const candidate = current ? `${current} ${token}` : token;
    if (current && widthOf(doc, candidate) > maxWidth) {
      lines.push(current);
      current = token;
    } else {
      current = candidate;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function strokeLine(
  doc: PDFKit.PDFDocument,
  x1: number,
  y: number,
  x2: number,
  color: string,
  width = 0.7,
): void {
  doc.save();
  doc.strokeColor(color).lineWidth(width).moveTo(x1, y).lineTo(x2, y).stroke();
  doc.restore();
}

function hairline(doc: PDFKit.PDFDocument, y: number): void {
  strokeLine(doc, LEFT, y, RIGHT, INK.hairline);
}

function filledRect(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  radius?: number,
): void {
  if (width <= 0 || height <= 0) return;
  doc.save();
  doc.fillColor(color);
  if (radius && radius > 0) doc.roundedRect(x, y, width, height, radius).fill();
  else doc.rect(x, y, width, height).fill();
  doc.restore();
}

function drawBand(doc: PDFKit.PDFDocument): void {
  doc.save();
  const gradient = doc.linearGradient(0, 0, PAGE_WIDTH, 0);
  gradient.stop(0, INK.primary).stop(1, INK.accent);
  doc.rect(0, 0, PAGE_WIDTH, BAND_HEIGHT).fill(gradient);
  doc.restore();
}

// ---------------------------------------------------------------------------
// Flux de mise en page
// ---------------------------------------------------------------------------

interface Flow {
  doc: PDFKit.PDFDocument;
  model: DocumentModel;
  y: number;
  page: number;
  /** Point le plus bas atteint sur la page courante. */
  deepest: number;
  lastPageContentHeight: number;
  gap: (value: number) => number;
}

function createFlow(doc: PDFKit.PDFDocument, model: DocumentModel, density: LayoutDensity): Flow {
  const scale = density === 'compact' ? 0.55 : 1;
  return {
    doc,
    model,
    y: TOP,
    page: 0,
    deepest: TOP,
    lastPageContentHeight: 0,
    // Plancher à 4 pt : compacter ne doit jamais coller deux blocs l'un à l'autre.
    gap: (value: number) => Math.max(4, Math.round(value * scale)),
  };
}

function openPage(flow: Flow): void {
  const { doc, model } = flow;
  if (flow.page > 0) doc.addPage({ size: [PAGE_WIDTH, PAGE_HEIGHT], margin: 0 });
  flow.page += 1;
  drawBand(doc);

  // Rappel de référence en haut des pages suivantes : un lecteur qui imprime et
  // perd l'ordre des feuilles doit pouvoir retrouver son document.
  if (flow.page > 1 && model.continuation) {
    setFont(doc, 'regular', SCALE.micro + 0.6);
    doc.fillColor(INK.faint);
    writeLine(doc, model.continuation, LEFT, 18, WIDTH, 'left', { characterSpacing: 0.7 });
  }

  flow.y = TOP;
  flow.deepest = TOP;
}

function breakPage(flow: Flow): void {
  flow.lastPageContentHeight = flow.deepest - TOP;
  openPage(flow);
}

/**
 * Réserve la place d'un bloc ATOMIQUE : s'il ne tient pas, on change de page
 * AVANT de le dessiner, jamais au milieu.
 */
function ensureSpace(flow: Flow, required: number): void {
  if (required <= 0 || flow.y + required <= BOTTOM) return;
  breakPage(flow);
}

function advance(flow: Flow, y: number): void {
  flow.y = y;
  if (y > flow.deepest) flow.deepest = y;
}

// ---------------------------------------------------------------------------
// Préparation des blocs : mesurer, puis dessiner
// ---------------------------------------------------------------------------

interface PreparedParty {
  heading: string;
  name: string[];
  lines: string[][];
  height: number;
}

function prepareParty(doc: PDFKit.PDFDocument, party: DocumentParty, width: number): PreparedParty {
  setFont(doc, 'bold', SCALE.partyName);
  const name = wrapText(doc, party.name, width);

  setFont(doc, 'regular', SCALE.small);
  const lines = party.lines.map((line) => wrapText(doc, line, width));

  const height =
    (party.heading ? 12 : 0) +
    name.length * 14 +
    lines.reduce((total, wrapped) => total + wrapped.length * 11.4, 0);

  return { heading: party.heading, name, lines, height };
}

function drawParty(
  doc: PDFKit.PDFDocument,
  prepared: PreparedParty,
  x: number,
  y: number,
  width: number,
): number {
  let cursor = y;

  if (prepared.heading) {
    writeHeading(doc, prepared.heading, x, cursor, width);
    cursor += 12;
  }

  setFont(doc, 'bold', SCALE.partyName);
  doc.fillColor(INK.primary);
  for (const line of prepared.name) {
    writeLine(doc, line, x, cursor, width);
    cursor += 14;
  }

  setFont(doc, 'regular', SCALE.small);
  doc.fillColor(INK.muted);
  for (const wrapped of prepared.lines) {
    for (const line of wrapped) {
      writeLine(doc, line, x, cursor, width);
      cursor += 11.4;
    }
  }

  return cursor;
}

interface PreparedItemRow {
  title: string[];
  description: string[];
  height: number;
}

function prepareItemRow(doc: PDFKit.PDFDocument, item: DocumentItemRow): PreparedItemRow {
  setFont(doc, 'bold', SCALE.body);
  const title = wrapText(doc, item.title, TABLE_DESCRIPTION_WIDTH - 14);

  setFont(doc, 'regular', SCALE.detail);
  const description = item.description
    ? wrapText(doc, item.description, TABLE_DESCRIPTION_WIDTH - 14)
    : [];

  const textHeight = title.length * TABLE.titleLine + description.length * TABLE.descriptionLine;

  return {
    title,
    description,
    height: Math.max(textHeight + TABLE.rowPadding * 2, TABLE.minRowHeight),
  };
}

interface PreparedTotals {
  detail: DocumentKeyValue[];
  total: DocumentKeyValue | null;
  summary: DocumentKeyValue[];
  height: number;
}

/**
 * Découpe les totaux autour de la ligne `strong` : le détail (sous-total,
 * remise, TVA) au-dessus du bandeau TOTAL, le récapitulatif (total payé, solde
 * dû) en dessous.
 */
function prepareTotals(rows: DocumentKeyValue[]): PreparedTotals {
  const totalIndex = rows.findIndex((row) => row.strong);
  const pivot = totalIndex === -1 ? rows.length : totalIndex;
  const detail = rows.slice(0, pivot);
  const total = totalIndex === -1 ? null : (rows[totalIndex] ?? null);
  const summary = rows.slice(pivot + (total ? 1 : 0));

  const height =
    (detail.length ? detail.length * TOTALS.row + TOTALS.pad * 2 + 6 : 0) +
    (total ? TOTALS.band + (summary.length ? 8 : 0) : 0) +
    summary.length * TOTALS.summaryRow;

  return { detail, total, summary, height };
}

function drawTotals(
  doc: PDFKit.PDFDocument,
  prepared: PreparedTotals,
  x: number,
  y: number,
  width: number,
): number {
  const padX = 12;
  const valueWidth = 104;
  let cursor = y;

  if (prepared.detail.length) {
    const boxHeight = prepared.detail.length * TOTALS.row + TOTALS.pad * 2;
    filledRect(doc, x, cursor, width, boxHeight, INK.wash, 7);

    let rowY = cursor + TOTALS.pad;
    for (const row of prepared.detail) {
      const baseline = rowY + SCALE.body * ASCENT + 1;

      setFont(doc, 'regular', SCALE.small);
      doc.fillColor(INK.muted);
      writeLine(
        doc,
        row.label ?? '',
        x + padX,
        topFor(baseline, SCALE.small),
        width - padX * 2 - valueWidth,
        'left',
      );

      setFont(doc, 'regular', SCALE.body);
      doc.fillColor(row.tone ? TONES[row.tone].ink : INK.text);
      writeLine(
        doc,
        row.value,
        x + width - padX - valueWidth,
        topFor(baseline, SCALE.body),
        valueWidth,
        'right',
      );

      rowY += TOTALS.row;
    }
    cursor += boxHeight + 6;
  }

  if (prepared.total) {
    filledRect(doc, x, cursor, width, TOTALS.band, INK.primary, 7);

    setFont(doc, 'bold', SCALE.small);
    doc.fillColor(INK.paper);
    writeLine(
      doc,
      (prepared.total.label ?? '').toUpperCase(),
      x + padX,
      cursor + 10.6,
      width - padX * 2 - valueWidth,
      'left',
      { characterSpacing: 0.7 },
    );

    setFont(doc, 'bold', SCALE.total);
    doc.fillColor(INK.paper);
    writeLine(
      doc,
      prepared.total.value,
      x + width - padX - valueWidth - 2,
      cursor + 7.8,
      valueWidth + 2,
      'right',
    );

    cursor += TOTALS.band + (prepared.summary.length ? 8 : 0);
  }

  if (prepared.summary.length) {
    strokeLine(doc, x + padX, cursor - 4, x + width - padX, INK.hairline);
    for (const row of prepared.summary) {
      const tone = row.tone ? TONES[row.tone] : null;
      const labelSize = tone ? SCALE.body : SCALE.small;
      const baseline = cursor + SCALE.body * ASCENT + 1;

      setFont(doc, tone ? 'bold' : 'regular', labelSize);
      doc.fillColor(tone ? tone.ink : INK.muted);
      writeLine(
        doc,
        row.label ?? '',
        x + padX,
        topFor(baseline, labelSize),
        width - padX * 2 - valueWidth,
        'left',
      );

      setFont(doc, 'bold', SCALE.body);
      doc.fillColor(tone ? tone.ink : INK.text);
      writeLine(
        doc,
        row.value,
        x + width - padX - valueWidth,
        topFor(baseline, SCALE.body),
        valueWidth,
        'right',
      );

      cursor += TOTALS.summaryRow;
    }
  }

  return cursor;
}

interface PreparedSection {
  heading: string;
  lines: string[];
  height: number;
}

function prepareSection(
  doc: PDFKit.PDFDocument,
  section: DocumentSection,
  width: number,
): PreparedSection {
  setFont(doc, 'regular', SCALE.small);
  const lines = wrapText(doc, section.body, width);
  return {
    heading: section.heading,
    lines,
    height: SECTION.heading + lines.length * SECTION.line + 2,
  };
}

// ---------------------------------------------------------------------------
// Blocs du document
// ---------------------------------------------------------------------------

function drawHeader(flow: Flow): void {
  const { doc, model } = flow;
  const logo = model.logo ? fittedImageSize(readImageSize(model.logo), LOGO_BOX) : null;

  if (model.logo && logo) {
    try {
      doc.image(model.logo, LEFT, TOP, { width: logo.width, height: logo.height });
    } catch {
      // Un fichier présent mais illisible (PNG tronqué, droits) ne doit pas
      // empêcher la facture de sortir : on continue sans logo.
    }
  } else {
    // Pas de logo exploitable : le nom devient la signature visuelle du haut de
    // page, à gauche, et les coordonnées restent à droite sans le répéter.
    setFont(doc, 'bold', SCALE.wordmark);
    doc.fillColor(INK.primary);
    writeLine(doc, model.company.name, LEFT, TOP + 2, WIDTH - COMPANY_WIDTH - COLUMN_GAP, 'left', {
      characterSpacing: 0.4,
    });
  }

  const boxX = RIGHT - COMPANY_WIDTH;
  let cursor = TOP;

  if (logo) {
    setFont(doc, 'bold', SCALE.brand);
    doc.fillColor(INK.primary);
    writeLine(doc, model.company.name, boxX, cursor, COMPANY_WIDTH, 'right');
    cursor += 15;
  }

  setFont(doc, 'regular', SCALE.small);
  doc.fillColor(INK.muted);
  for (const line of model.company.lines) {
    writeLine(doc, line, boxX, cursor, COMPANY_WIDTH, 'right');
    cursor += 11;
  }

  const leftHeight = logo ? logo.height : WORDMARK_HEIGHT;
  advance(flow, TOP + Math.max(leftHeight, cursor - TOP) + flow.gap(13));
  hairline(doc, flow.y);
  advance(flow, flow.y + flow.gap(15));
}

function measureMetaHeight(meta: DocumentKeyValue[]): number {
  if (!meta.length) return 0;
  return meta.reduce((total, row) => total + (row.pill || !row.label ? 24 : 16), 14);
}

function drawTitleBlock(flow: Flow): void {
  const { doc, model } = flow;
  const boxX = RIGHT - META_WIDTH;
  const leftWidth = WIDTH - META_WIDTH - COLUMN_GAP;
  const metaHeight = measureMetaHeight(model.meta);
  const titleHeight = 27 + (model.reference ? 14 : 0) + (model.issuedLine ? 13 : 0);

  ensureSpace(flow, Math.max(metaHeight, titleHeight));

  let cursor = flow.y;
  setFont(doc, 'bold', SCALE.title);
  doc.fillColor(INK.primary);
  writeLine(doc, model.title, LEFT, cursor - 3, leftWidth, 'left', { characterSpacing: 1.1 });
  cursor += 27;

  if (model.reference) {
    setFont(doc, 'bold', SCALE.reference);
    doc.fillColor(INK.accent);
    writeLine(doc, `${model.referenceLabel} ${model.reference}`, LEFT, cursor, leftWidth, 'left');
    cursor += 14;
  }

  if (model.issuedLine) {
    setFont(doc, 'regular', SCALE.body - 0.4);
    doc.fillColor(INK.muted);
    writeLine(doc, model.issuedLine, LEFT, cursor, leftWidth, 'left');
    cursor += 13;
  }

  const boxBottom = drawMetaBox(doc, model.meta, boxX, flow.y, META_WIDTH);
  advance(flow, Math.max(cursor, boxBottom) + flow.gap(17));
}

function drawMetaBox(
  doc: PDFKit.PDFDocument,
  meta: DocumentKeyValue[],
  x: number,
  y: number,
  width: number,
): number {
  const height = measureMetaHeight(meta);
  if (!height) return y;

  filledRect(doc, x, y, width, height, INK.wash, 8);

  const padX = 12;
  let cursor = y + 7;

  for (const row of meta) {
    if (row.pill || !row.label) {
      const tone = TONES[row.tone ?? 'neutral'];
      setFont(doc, 'bold', SCALE.label);
      const label = row.value.toUpperCase();
      const pillWidth = Math.min(
        width - padX * 2,
        widthOf(doc, label, { characterSpacing: 0.7 }) + 22,
      );
      const pillX = x + width - padX - pillWidth;

      filledRect(doc, pillX, cursor, pillWidth, 18, tone.wash, 9);
      doc.fillColor(tone.ink);
      writeLine(doc, label, pillX, cursor + 4.8, pillWidth, 'center', { characterSpacing: 0.7 });
      cursor += 24;
      continue;
    }

    const baseline = cursor + SCALE.body * ASCENT + 1.5;

    setFont(doc, 'regular', SCALE.label);
    doc.fillColor(INK.faint);
    writeLine(
      doc,
      row.label,
      x + padX,
      topFor(baseline, SCALE.label),
      width - padX * 2 - 106,
      'left',
      { characterSpacing: 0.4 },
    );

    setFont(doc, 'bold', SCALE.body);
    doc.fillColor(TONES[row.tone ?? 'neutral'].ink);
    writeLine(doc, row.value, x + width - padX - 106, topFor(baseline, SCALE.body), 106, 'right');
    cursor += 16;
  }

  return y + height;
}

function drawParties(flow: Flow): void {
  const { doc, model } = flow;
  const leftWidth = Math.round(WIDTH * 0.56);
  const rightX = LEFT + leftWidth + COLUMN_GAP;
  const rightWidth = RIGHT - rightX;

  const recipient = prepareParty(doc, model.recipient, leftWidth);
  const context = model.context ? prepareParty(doc, model.context, rightWidth) : null;

  ensureSpace(flow, Math.max(recipient.height, context?.height ?? 0));

  const leftBottom = drawParty(doc, recipient, LEFT, flow.y, leftWidth);
  const rightBottom = context ? drawParty(doc, context, rightX, flow.y, rightWidth) : flow.y;

  advance(flow, Math.max(leftBottom, rightBottom) + flow.gap(13));
  hairline(doc, flow.y);
  advance(flow, flow.y + flow.gap(14));
}

function drawItemsTable(flow: Flow, keepWithMoney: number): void {
  const { doc, model } = flow;
  const quantityX = LEFT + TABLE_DESCRIPTION_WIDTH;
  const priceX = quantityX + TABLE.quantity;
  const amountX = priceX + TABLE.unitPrice;

  const drawHeaderRow = (y: number): number => {
    filledRect(doc, LEFT, y, WIDTH, TABLE.headerHeight, INK.washStrong, 5);
    setFont(doc, 'bold', SCALE.label);
    doc.fillColor(INK.primary);

    const headers = model.items.headers;
    writeLine(
      doc,
      (headers[0] ?? '').toUpperCase(),
      LEFT + 10,
      y + 9,
      TABLE_DESCRIPTION_WIDTH - 14,
      'left',
      {
        characterSpacing: 0.6,
      },
    );
    writeLine(
      doc,
      (headers[1] ?? '').toUpperCase(),
      quantityX - 8,
      y + 9,
      TABLE.quantity,
      'right',
      {
        characterSpacing: 0.6,
      },
    );
    writeLine(doc, (headers[2] ?? '').toUpperCase(), priceX - 10, y + 9, TABLE.unitPrice, 'right', {
      characterSpacing: 0.6,
    });
    writeLine(doc, (headers[3] ?? '').toUpperCase(), amountX - 10, y + 9, TABLE.amount, 'right', {
      characterSpacing: 0.6,
    });

    return y + TABLE.headerHeight + 3;
  };

  ensureSpace(flow, TABLE.headerHeight + 32);
  advance(flow, drawHeaderRow(flow.y));

  const rows = model.items.rows;
  if (!rows.length) {
    ensureSpace(flow, 26);
    setFont(doc, 'italic', SCALE.small);
    doc.fillColor(INK.faint);
    writeLine(doc, model.items.empty, LEFT + 10, flow.y + 6, WIDTH - 20, 'left');
    advance(flow, flow.y + 26 + flow.gap(12));
    return;
  }

  const prepared = rows.map((row) => prepareItemRow(doc, row));

  prepared.forEach((row, index) => {
    // La DERNIÈRE ligne garde l'argent avec elle : sans cette réserve, une page
    // pouvait se terminer sur une ligne isolée et laisser le bandeau TOTAL
    // orphelin en haut de la page suivante.
    const keep = index === prepared.length - 1 ? keepWithMoney : 0;
    const pageBefore = flow.page;
    ensureSpace(flow, row.height + keep);

    // Un saut de page reprend l'en-tête des colonnes : sans lui, les montants de
    // la page suivante n'ont plus de libellé.
    if (flow.page !== pageBefore) advance(flow, drawHeaderRow(flow.y));

    const item = rows[index];
    const y = flow.y;
    let textY = y + TABLE.rowPadding;

    setFont(doc, 'bold', SCALE.body);
    doc.fillColor(INK.text);
    for (const line of row.title) {
      writeLine(doc, line, LEFT + 10, textY, TABLE_DESCRIPTION_WIDTH - 14);
      textY += TABLE.titleLine;
    }

    setFont(doc, 'regular', SCALE.detail);
    doc.fillColor(INK.muted);
    for (const line of row.description) {
      writeLine(doc, line, LEFT + 10, textY, TABLE_DESCRIPTION_WIDTH - 14);
      textY += TABLE.descriptionLine;
    }

    const baseline = y + TABLE.rowPadding + SCALE.body * ASCENT;

    setFont(doc, 'regular', SCALE.body);
    doc.fillColor(INK.text);
    writeLine(
      doc,
      item?.quantity ?? '',
      quantityX - 8,
      topFor(baseline, SCALE.body),
      TABLE.quantity,
      'right',
    );
    writeLine(
      doc,
      item?.unitPrice ?? '',
      priceX - 10,
      topFor(baseline, SCALE.body),
      TABLE.unitPrice,
      'right',
    );

    setFont(doc, 'bold', SCALE.body);
    doc.fillColor(INK.text);
    writeLine(
      doc,
      item?.amount ?? '',
      amountX - 10,
      topFor(baseline, SCALE.body),
      TABLE.amount,
      'right',
    );

    advance(flow, y + row.height);
    if (index < prepared.length - 1) {
      strokeLine(doc, LEFT + 10, flow.y - 1, RIGHT - 10, INK.hairline);
    }
  });

  advance(flow, flow.y + flow.gap(13));
}

/**
 * Bloc « argent » : règlements à gauche, totaux à droite.
 *
 * Les deux sont liés : c'est le même récit (ce qui a été payé, ce qui reste à
 * payer). Les séparer verticalement coûtait 40 pt de hauteur et laissait la
 * moitié gauche de la page vide — exactement l'espace qui manquait ensuite pour
 * tenir sur une page.
 */
interface MoneyBlock {
  height: number;
  stacked: boolean;
  totals: PreparedTotals;
}

function paymentsHeightOf(
  payments: NonNullable<DocumentModel['payments']> | null | undefined,
): number {
  if (!payments) return 0;
  if (!payments.rows.length) return 15 + 15;
  const rows = payments.rows.reduce(
    (total, row) => total + PAYMENT_ROW + (row.note ? PAYMENT_NOTE : 0),
    0,
  );
  return 15 + rows + 4;
}

function prepareMoneyBlock(flow: Flow, totals: PreparedTotals): MoneyBlock {
  const payments = flow.model.payments;
  const paymentsHeight = paymentsHeightOf(payments);

  // Liste trop longue pour la colonne : elle repasse en pleine largeur sous les
  // totaux, plutôt que de déborder sur la colonne voisine.
  const stacked = paymentsHeight > PAYMENTS_STACKED_HEIGHT;
  const height = stacked
    ? totals.height + flow.gap(12) + paymentsHeight
    : Math.max(totals.height, paymentsHeight);

  return { height, stacked, totals };
}

function drawMoneyBlock(flow: Flow, money: MoneyBlock): void {
  const { doc, model } = flow;
  const payments = model.payments;
  const totalsX = RIGHT - TOTALS_WIDTH;

  if (money.stacked || !payments) {
    advance(flow, drawTotals(doc, money.totals, totalsX, flow.y, TOTALS_WIDTH));
    if (payments) {
      advance(flow, flow.y + flow.gap(12));
      drawPaymentsColumn(flow, payments, LEFT, WIDTH);
    }
    return;
  }

  const bottomTotals = drawTotals(doc, money.totals, totalsX, flow.y, TOTALS_WIDTH);
  const bottomPayments = drawPaymentsColumn(flow, payments, LEFT, MONEY_LEFT_WIDTH);
  advance(flow, Math.max(bottomTotals, bottomPayments));
}

function drawPaymentsColumn(
  flow: Flow,
  payments: NonNullable<DocumentModel['payments']>,
  x: number,
  width: number,
): number {
  const { doc } = flow;
  let cursor = flow.y;

  writeHeading(doc, payments.heading, x, cursor + 1, width);
  cursor += 15;

  if (!payments.rows.length) {
    setFont(doc, 'italic', SCALE.small);
    doc.fillColor(INK.faint);
    writeLine(doc, payments.empty, x, cursor + 1, width, 'left');
    return cursor + 15;
  }

  for (const row of payments.rows) {
    const baseline = cursor + SCALE.small * ASCENT + 1.5;

    setFont(doc, 'regular', SCALE.small);
    doc.fillColor(INK.muted);
    writeLine(doc, row.label ?? '', x, topFor(baseline, SCALE.small), width - 96, 'left');

    setFont(doc, 'bold', SCALE.small);
    doc.fillColor(INK.text);
    writeLine(doc, row.value, x + width - 96, topFor(baseline, SCALE.small), 96, 'right');

    cursor += PAYMENT_ROW;

    if (row.note) {
      setFont(doc, 'regular', SCALE.micro + 0.4);
      doc.fillColor(INK.faint);
      writeLine(doc, row.note, x, cursor, width - 96, 'left');
      cursor += PAYMENT_NOTE;
    }
  }

  return cursor + 2;
}

/**
 * Bloc de clôture : notes et conditions à gauche, signature à droite.
 *
 * `flowing` bascule quand le texte libre est plus long qu'une page : on ne peut
 * alors plus le traiter comme un bloc atomique, et la pagination reprend ligne
 * à ligne (titre et première ligne toujours solidaires).
 */
interface BottomBlock {
  sections: PreparedSection[];
  leftWidth: number;
  height: number;
  flowing: boolean;
}

function prepareBottomBlock(flow: Flow): BottomBlock {
  const { doc, model } = flow;
  const hasSignature = Boolean(model.signature);
  const leftWidth = hasSignature ? BOTTOM_LEFT_WIDTH : WIDTH;

  const sections = model.sections
    .map((section) => prepareSection(doc, section, leftWidth))
    .filter((section) => section.lines.length > 0);

  const sectionsHeight = sections.reduce(
    (total, section) => total + section.height + SECTION.gap,
    0,
  );
  const thanksHeight = model.thanks ? CLOSING.thanks : 0;
  const leftHeight = sectionsHeight + thanksHeight;
  const rightHeight = hasSignature ? CLOSING.full : 0;

  const height = Math.max(leftHeight, rightHeight);
  return { sections, leftWidth, height, flowing: leftHeight > PAGE_CONTENT_HEIGHT };
}

function drawBottomBlock(flow: Flow, block: BottomBlock): void {
  const { doc, model } = flow;
  const signature = model.signature;
  const signatureX = RIGHT - SIGNATURE_WIDTH;

  if (block.flowing) {
    drawFlowingSections(flow, WIDTH);
    if (signature) {
      ensureSpace(flow, CLOSING.full);
      drawSignature(flow, signature, RIGHT - SIGNATURE_WIDTH, flow.y, true);
    } else if (model.thanks) {
      ensureSpace(flow, CLOSING.thanks);
      drawThanks(flow, LEFT, flow.y, WIDTH);
    }
    return;
  }

  let leftBottom = flow.y;
  for (const section of block.sections) {
    leftBottom = drawSection(doc, section, LEFT, leftBottom, block.leftWidth);
  }
  if (model.thanks) leftBottom = drawThanks(flow, LEFT, leftBottom + 4, block.leftWidth);

  const rightBottom = signature
    ? drawSignature(flow, signature, signatureX, flow.y, false)
    : flow.y;

  advance(flow, Math.max(leftBottom, rightBottom));
}

function drawSection(
  doc: PDFKit.PDFDocument,
  section: PreparedSection,
  x: number,
  y: number,
  width: number,
): number {
  let cursor = y;
  writeHeading(doc, section.heading, x, cursor, width);
  cursor += SECTION.heading;

  setFont(doc, 'regular', SCALE.small);
  doc.fillColor(INK.muted);
  for (const line of section.lines) {
    writeLine(doc, line, x, cursor, width);
    cursor += SECTION.line;
  }

  return cursor + SECTION.gap;
}

/** Texte libre trop long pour un bloc : pagination ligne à ligne. */
function drawFlowingSections(flow: Flow, width: number): void {
  const { doc, model } = flow;

  for (const section of model.sections) {
    const prepared = prepareSection(doc, section, width);
    if (!prepared.lines.length) continue;

    // Titre et première ligne solidaires : un titre seul en bas de page est
    // illisible, et c'est l'un des cas qui produisaient une page 2 exsangue.
    ensureSpace(flow, SECTION.heading + SECTION.line);
    writeHeading(doc, prepared.heading, LEFT, flow.y, width);
    advance(flow, flow.y + SECTION.heading);

    setFont(doc, 'regular', SCALE.small);
    doc.fillColor(INK.muted);
    for (const line of prepared.lines) {
      ensureSpace(flow, SECTION.line);
      writeLine(doc, line, LEFT, flow.y, width);
      advance(flow, flow.y + SECTION.line);
    }

    advance(flow, flow.y + flow.gap(SECTION.gap));
  }
}

function drawThanks(flow: Flow, x: number, y: number, width: number): number {
  setFont(flow.doc, 'italic', SCALE.body);
  flow.doc.fillColor(INK.accent);
  writeLine(flow.doc, flow.model.thanks ?? '', x, y, width, 'left');
  return y + CLOSING.thanks;
}

function drawSignature(
  flow: Flow,
  signature: NonNullable<DocumentModel['signature']>,
  x: number,
  y: number,
  compact: boolean,
): number {
  const doc = flow.doc;
  const lift = compact ? 8 : 30;

  writeHeading(doc, signature.heading, x, y, SIGNATURE_WIDTH);
  strokeLine(doc, x, y + 12 + lift, x + SIGNATURE_WIDTH, INK.rule, 0.8);

  setFont(doc, 'regular', SCALE.micro + 0.4);
  doc.fillColor(INK.faint);
  writeLine(doc, signature.caption, x, y + 17 + lift, SIGNATURE_WIDTH, 'left');

  return y + 12 + lift + 15;
}

// ---------------------------------------------------------------------------
// Pied de page (bande réservée, toutes les pages)
// ---------------------------------------------------------------------------

function drawFooter(
  doc: PDFKit.PDFDocument,
  model: DocumentModel,
  page: number,
  pageCount: number,
): void {
  const y = BOTTOM + 9;
  hairline(doc, y);

  if (pageCount > 1) {
    setFont(doc, 'bold', SCALE.micro + 0.4);
    doc.fillColor(INK.faint);
    writeLine(doc, `Page ${page} / ${pageCount}`, RIGHT - 92, y + 6, 92, 'right', {
      characterSpacing: 0.4,
    });
  }

  const legal = model.footer.filter(Boolean).slice(0, 2);
  if (!legal.length) return;

  setFont(doc, 'regular', SCALE.micro);
  doc.fillColor(INK.faint);
  let cursor = y + 5.5;
  for (const line of legal) {
    writeLine(doc, line, LEFT, cursor, WIDTH - 100, 'left');
    cursor += 9;
  }
}

/**
 * Pied de page sur CHAQUE page tamponnée.
 *
 * Appelée une fois le flux terminé : c'est ce qui permet d'écrire « Page 2 / 3 »
 * alors que le nombre total de pages n'est connu qu'à la fin. Exige un document
 * créé avec `bufferPages: true`.
 */
export function drawPageFooters(doc: PDFKit.PDFDocument, model: DocumentModel): void {
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    drawFooter(doc, model, index + 1, range.count);
  }
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

/**
 * Dessine le document dans `doc` et renvoie ce qu'il a produit.
 *
 * Exportée pour les tests : c'est cette fonction que le spécifique interroge
 * pour compter les pages et mesurer le remplissage de la dernière.
 */
export function layoutDocument(
  doc: PDFKit.PDFDocument,
  model: DocumentModel,
  options: { density?: LayoutDensity } = {},
): LayoutResult {
  const density = options.density ?? 'normal';
  const flow = createFlow(doc, model, density);

  openPage(flow);
  drawHeader(flow);
  drawTitleBlock(flow);
  drawParties(flow);

  const money = prepareMoneyBlock(flow, prepareTotals(model.totals));
  const bottom = prepareBottomBlock(flow);

  drawItemsTable(flow, money.height + flow.gap(13));

  // --- Clôture solidaire --------------------------------------------------
  //
  // Quand le bloc de clôture serait SEUL à partir en page suivante, il emmène
  // l'argent avec lui : c'est la règle qui interdit la « page 2 avec un trait de
  // signature et rien d'autre » de la capture. Elle ne s'applique que si le bloc
  // de clôture est clairsemé (sinon il remplit sa page tout seul) et si
  // l'ensemble tient sur une page (sinon la pagination bloc par bloc reprend ses
  // droits). La décision est prise AVANT de dessiner l'argent, puisque les deux
  // blocs se mesurent sans rien écrire.
  const closingHeight = bottom.flowing ? 0 : bottom.height;
  const grouped = money.height + flow.gap(15) + closingHeight;
  if (
    closingHeight > 0 &&
    closingHeight < SPARSE_PAGE &&
    grouped <= PAGE_CONTENT_HEIGHT &&
    flow.y + grouped > BOTTOM
  ) {
    breakPage(flow);
  }

  ensureSpace(flow, money.height);
  drawMoneyBlock(flow, money);
  advance(flow, flow.y + flow.gap(15));

  if (!bottom.flowing) ensureSpace(flow, bottom.height);
  drawBottomBlock(flow, bottom);

  flow.lastPageContentHeight = flow.deepest - TOP;
  return { pageCount: flow.page, lastPageContentHeight: flow.lastPageContentHeight, density };
}

function createDocument(bufferPages: boolean, info: DocumentInfo): PDFKit.PDFDocument {
  const doc = new PDFDocument({
    size: [PAGE_WIDTH, PAGE_HEIGHT],
    // Marges gérées à la main : le document aligne des colonnes à droite et
    // réserve une bande de pied de page, ce qu'une marge automatique ne fait pas.
    margin: 0,
    bufferPages,
    info,
  });

  if (!bufferPages) {
    // Passe de mesure : les octets sont jetés au fur et à mesure. Sans cet
    // écouteur, un document de vingt pages mesuré deux fois s'accumulerait en
    // mémoire avant d'être produit pour de vrai.
    doc.on('data', () => {});
  }

  return doc;
}

function finalize(doc: PDFKit.PDFDocument): Promise<Buffer> {
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.end();
  return finished;
}

export interface LayoutPlan {
  density: LayoutDensity;
  result: LayoutResult;
}

/**
 * Décide de la densité AVANT de produire le document, et renvoie la mesure qui
 * va avec.
 *
 * Dès qu'un document déborde sur une deuxième page, on essaie la densité
 * compacte : si elle fait rentrer le document sur une page de moins, c'est elle
 * qui gagne. C'est le filet qui attrape les factures à trois lignes de
 * prestation dont la signature débordait — le cas de la capture.
 *
 * On ne garde le compact que s'il est réellement meilleur (moins de pages, ou
 * dernière page mieux remplie) : compacter un document qui tient déjà
 * réduirait ses respirations sans rien gagner.
 *
 * Exportée parce que c'est elle que le spécifique interroge : compter les pages
 * d'un PDF terminé obligerait à le rouvrir, alors que la mesure est déjà là.
 */
export function planLayout(model: DocumentModel, info: DocumentInfo = {}): LayoutPlan {
  const normalDoc = createDocument(false, info);
  const normal = layoutDocument(normalDoc, model, { density: 'normal' });
  normalDoc.end();

  if (normal.pageCount <= 1) return { density: 'normal', result: normal };

  const compactDoc = createDocument(false, info);
  const compact = layoutDocument(compactDoc, model, { density: 'compact' });
  compactDoc.end();

  const compactIsBetter =
    compact.pageCount < normal.pageCount ||
    (normal.lastPageContentHeight < SPARSE_PAGE &&
      compact.lastPageContentHeight > normal.lastPageContentHeight);

  return compactIsBetter
    ? { density: 'compact', result: compact }
    : { density: 'normal', result: normal };
}

/**
 * Génère le PDF complet : passe de mesure, choix de densité, rendu final, puis
 * pieds de page sur toutes les pages.
 */
export async function renderDocument(
  model: DocumentModel,
  options: { info?: DocumentInfo } = {},
): Promise<RenderedDocument> {
  const info = options.info ?? {};
  const plan = planLayout(model, info);

  const doc = createDocument(true, info);
  const result = layoutDocument(doc, model, { density: plan.density });
  drawPageFooters(doc, model);
  const buffer = await finalize(doc);

  return { buffer, pageCount: result.pageCount, density: plan.density };
}
