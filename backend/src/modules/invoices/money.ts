import { Prisma } from '../../generated/prisma/client.js';

/**
 * ARITHMETIQUE DES PIECES COMPTABLES — le SEUL endroit du module ou un montant
 * est calcule.
 *
 * POURQUOI PAS DES `number`. Les colonnes monetaires du schema sont
 * `Decimal @db.Decimal(14, 2)` (voir `prisma/schema.prisma`, en-tete
 * « Argent : `Decimal(14, 2)`. JAMAIS de Float pour un montant »). En virgule
 * flottante binaire, `0.1 + 0.2` vaut `0.30000000000000004` : sur une facture a
 * trois lignes, l'ecart d'un centime suffit a faire refuser un rapprochement
 * bancaire, et il ne se reproduit pas d'une execution a l'autre selon l'ordre
 * des additions. Tout passe donc par `Prisma.Decimal` (decimal.js en base
 * 10), y compris les multiplications et la TVA.
 *
 * LA SEULE CONVERSION DEPUIS UN `number` EST L'ENTREE. Un montant arrive du
 * monde exterieur en JSON, donc en `number`. `new Decimal(19.99)` convertit via
 * la representation decimale du nombre (« 19.99 »), pas via son binaire : la
 * valeur est exacte. Et le bruit flottant (`0.1 + 0.2`) est refuse en amont par
 * `@IsNumber({ maxDecimalPlaces: 2 })` sur les DTO — un `0.30000000000000004`
 * porte 17 decimales et n'atteint jamais ce fichier.
 *
 * L'UNITE RETENUE EST LE CENTIME, ARRONDI COMMERCIAL. Tous les resultats
 * intermediaires qui portent un montant sont ramenes a deux decimales avec
 * `ROUND_HALF_UP` — l'arrondi « au plus proche, les .5 au-dessus », celui qu'un
 * comptable attend. On n'arrondit QUE la ou un arrondi est inevitable (produit
 * d'une quantite par un prix, calcul d'une remise en pourcentage, calcul de la
 * TVA) : `subtotal`, `discountAmount` et `total` sont des SOMMES de valeurs deja
 * arrondies, donc exactes au centime sans nouvel arrondi.
 *
 * POURQUOI CE FICHIER VIT DANS `invoices/`. Il est utilise par les trois modules
 * (devis, factures, paiements), et `QuotesModule` importe deja `InvoicesModule`
 * — un devis accepte devient une facture. Placer le noyau partage ici n'ajoute
 * donc aucune dependance : le faire cote devis creerait un cycle d'imports
 * (`quotes -> invoices` par le service, `invoices -> quotes` par le noyau).
 */

/** Arrondi commercial au centime. */
const CENTS = 2;
const ROUND_HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

/**
 * Ce qu'on accepte en entree : ce que Prisma rend, ou ce qui vient d'un DTO.
 *
 * Ecrit en clair plutot que `Prisma.Decimal.Value` : le type `Value` vit dans un
 * `namespace` fusionne avec la classe `Decimal` du paquet runtime, et ce
 * namespace n'est pas reexporte par le client genere (`TS2713`). Enumere les
 * trois formes acceptees evite de dependre de la forme exacte du reexport.
 */
export type DecimalInput = string | number | Prisma.Decimal;

/** Convertit sans jamais passer par un flottant intermediaire. */
export function toDecimal(value: DecimalInput): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

/** Ramene un montant au centime, arrondi commercial. */
export function roundMoney(value: DecimalInput): Prisma.Decimal {
  return toDecimal(value).toDecimalPlaces(CENTS, ROUND_HALF_UP);
}

export function money(value: DecimalInput): Prisma.Decimal {
  return toDecimal(value);
}

export function zero(): Prisma.Decimal {
  return new Prisma.Decimal(0);
}

/**
 * Somme exacte — pas d'arrondi : additionner des valeurs a deux decimales donne
 * un resultat a deux decimales. `0.1 + 0.2` ne peut pas apparaitre ici, les
 * operandes etant deja en base 10.
 */
export function sumMoney(values: readonly Prisma.Decimal[]): Prisma.Decimal {
  let total = zero();
  for (const value of values) {
    total = total.plus(value);
  }
  return total;
}

/** Ligne telle qu'elle arrive du DTO : aucune de ces valeurs n'est un montant. */
export interface LineInput {
  readonly quantity: DecimalInput;
  readonly unitPrice: DecimalInput;
  readonly discountPercent: DecimalInput;
}

/** Ligne calculee, prete a etre ecrite dans `quote_items` / `invoice_items`. */
export interface ComputedLine {
  readonly quantity: Prisma.Decimal;
  readonly unitPrice: Prisma.Decimal;
  readonly discountPercent: Prisma.Decimal;
  /** `quantite x prix unitaire`, avant remise. */
  readonly gross: Prisma.Decimal;
  /** Remise de la ligne, en montant. */
  readonly discountAmount: Prisma.Decimal;
  /** Total de la ligne HORS TAXES, remise deduite. C'est ce qui va en base. */
  readonly lineTotal: Prisma.Decimal;
}

/**
 * Calcule une ligne.
 *
 * La remise est un POURCENTAGE de la ligne, pas un montant : c'est ce que porte
 * le schema (`discountPercent`), et un pourcentage se recalcule quand la
 * quantite change, alors qu'un montant fixe devient faux sans que personne ne
 * s'en apercoive.
 */
export function computeLine(input: LineInput): ComputedLine {
  const quantity = toDecimal(input.quantity);
  const unitPrice = toDecimal(input.unitPrice);
  const discountPercent = toDecimal(input.discountPercent);

  // Deux arrondis seulement : le produit (une quantite decimale fois un prix ne
  // tombe pas forcement juste) et la remise (un pourcentage ne tombe presque
  // jamais juste).
  const gross = roundMoney(quantity.times(unitPrice));
  const discountAmount = roundMoney(gross.times(discountPercent).dividedBy(100));
  const lineTotal = gross.minus(discountAmount);

  return { quantity, unitPrice, discountPercent, gross, discountAmount, lineTotal };
}

/** Totaux d'une piece, tels qu'ils seront stockes sur le document. */
export interface ComputedTotals {
  readonly lines: readonly ComputedLine[];
  /** Somme des lignes AVANT remise. */
  readonly subtotal: Prisma.Decimal;
  /** Somme des remises de ligne. */
  readonly discountAmount: Prisma.Decimal;
  /** Taux applique, tel qu'il sera ecrit dans la colonne `taxRate`. */
  readonly taxRate: Prisma.Decimal;
  readonly taxAmount: Prisma.Decimal;
  readonly total: Prisma.Decimal;
}

/**
 * Calcule les totaux d'une piece a partir de SES LIGNES.
 *
 * LE TAUX DE TVA EST UNIQUE PAR PIECE, et ce n'est pas un raccourci : le schema
 * ne porte qu'une colonne `taxRate` et qu'une colonne `taxAmount` sur le
 * document. Un taux par ligne serait stocke (`quote_items.taxRate`) mais ne
 * pourrait pas etre totalise fidelement — une facture a 5,5 % et 20 % n'aurait
 * qu'un seul taux affiche, donc un document faux. Le taux de la piece est
 * recopie sur chaque ligne pour que la ligne reste auto-descriptive en base,
 * sans jamais servir au calcul.
 *
 * LA TVA SE CALCULE SUR LE NET, remise deduite. C'est la convention francaise
 * pour une remise portee sur la facture, et surtout c'est la seule lecture
 * possible ici : le schema n'a pas de colonne pour une TVA calculee sur le brut
 * avant remise.
 */
export function computeTotals(
  lines: readonly LineInput[],
  taxRate: DecimalInput,
): ComputedTotals {
  const computed = lines.map(computeLine);

  const subtotal = sumMoney(computed.map((line) => line.gross));
  const discountAmount = sumMoney(computed.map((line) => line.discountAmount));
  const netTaxable = subtotal.minus(discountAmount);

  const rate = toDecimal(taxRate);
  const taxAmount = roundMoney(netTaxable.times(rate).dividedBy(100));
  const total = netTaxable.plus(taxAmount);

  return { lines: computed, subtotal, discountAmount, taxRate: rate, taxAmount, total };
}

/** Somme des totaux de ligne, hors taxes. */
export function sumLineTotals(lines: readonly ComputedLine[]): Prisma.Decimal {
  return sumMoney(lines.map((line) => line.lineTotal));
}

/**
 * Ecart entre les totaux du document et la somme de ses lignes, en centimes.
 *
 * C'est L'INVARIANT du module : `subtotal - discountAmount == somme(lineTotal)`.
 * Il est nul par construction, et cette fonction existe pour qu'un test puisse
 * l'affirmer sur des cas limites plutot que de relire le code de calcul en
 * esperant y voir une erreur. Elle servira aussi le jour ou un import
 * d'historique ecrira des pieces dont les totaux ne viennent pas d'ici.
 */
export function lineTotalDelta(totals: ComputedTotals): Prisma.Decimal {
  return totals.subtotal.minus(totals.discountAmount).minus(sumLineTotals(totals.lines));
}

/** Solde du a une piece : jamais negatif, un trop-percu n'est pas une dette. */
export function balanceOf(total: DecimalInput, amountPaid: DecimalInput): Prisma.Decimal {
  const balance = toDecimal(total).minus(toDecimal(amountPaid));
  return balance.isNegative() ? zero() : balance;
}

/** Ligne d'entree avec son libelle : ce que le DTO fournit, rien de plus. */
export interface LineRowInput {
  readonly title: string;
  readonly description?: string | null;
  /** Defaut 1, comme la colonne. */
  readonly quantity?: DecimalInput;
  readonly unitPrice: DecimalInput;
  /** Defaut 0. */
  readonly discountPercent?: DecimalInput;
}

/**
 * Ligne d'entree une fois les defauts appliques.
 *
 * C'est le SEUL endroit qui decide qu'une quantite omise vaut 1 et qu'une remise
 * omise vaut 0. Le DTO ne les applique pas (`plainToInstance` n'applique pas les
 * initialiseurs de classe), la colonne non plus cote calcul : sans cette
 * normalisation, la meme ligne vaudrait `1` en base et `undefined` dans la
 * multiplication, donc `NaN`.
 */
export interface LineEntry {
  readonly title: string;
  readonly description: string | null;
  readonly quantity: DecimalInput;
  readonly unitPrice: DecimalInput;
  readonly discountPercent: DecimalInput;
}

/** Applique les defauts des champs facultatifs d'une ligne. */
export function toLineEntries(items: readonly LineRowInput[]): LineEntry[] {
  return items.map((item) => ({
    title: item.title,
    description: item.description ?? null,
    quantity: item.quantity ?? 1,
    unitPrice: item.unitPrice,
    discountPercent: item.discountPercent ?? 0,
  }));
}

/** Ce qu'il faut d'une ligne STOCKEE pour la remettre dans le calcul. */
export interface StoredLineRow {
  readonly title: string;
  readonly description: string | null;
  readonly quantity: DecimalInput;
  readonly unitPrice: DecimalInput;
  readonly discountPercent: DecimalInput;
}

/**
 * Une ligne relue en base redevient une entree de calcul.
 *
 * Cette fonction existe parce que DEUX chemins recalculent des totaux a partir
 * de lignes deja stockees : modifier le taux de TVA d'un brouillon sans toucher
 * aux lignes (devis), et generer une facture depuis un devis accepte. Ecrire
 * deux fois la meme correspondance serait le bon moyen d'inverser un jour
 * `quantity` et `unitPrice` a un seul des deux endroits — une erreur qui ne
 * change pas la forme du document, seulement son montant.
 */
export function storedLineEntries(rows: readonly StoredLineRow[]): LineEntry[] {
  return rows.map((row) => ({
    title: row.title,
    description: row.description,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    discountPercent: row.discountPercent,
  }));
}

/**
 * Ligne telle qu'elle s'ecrit dans `quote_items` / `invoice_items`.
 *
 * `position` est DERIVEE de l'ordre du tableau, jamais fournie : deux lignes en
 * position 1 produiraient un document dont l'ordre depend du moteur de base de
 * donnees.
 */
export interface LineRow {
  readonly position: number;
  readonly title: string;
  readonly description: string | null;
  readonly quantity: Prisma.Decimal;
  readonly unitPrice: Prisma.Decimal;
  readonly discountPercent: Prisma.Decimal;
  readonly taxRate: Prisma.Decimal;
  readonly lineTotal: Prisma.Decimal;
}

/**
 * Assemble les lignes a ecrire a partir des entrees normalisees et des totaux.
 *
 * Les libelles et les montants sont assemblees EN MEME TEMPS, index par index, et
 * les montants viennent des `totals.lines` calculees a partir de CES entrees.
 * C'est ce qui garantit que le `lineTotal` ecrit pour une ligne est celui de cette
 * ligne : deux boucles separees (d'abord les libelles, puis les montants)
 * finiraient par se desynchroniser le jour ou un `filter` est ajoute d'un seul
 * cote, et un document dont les lignes ne correspondent plus aux totaux est un
 * document faux — pas une erreur visible.
 *
 * `taxRate` est recopie sur chaque ligne pour la rendre auto-descriptive en base ;
 * il ne sert JAMAIS au calcul, qui reste au niveau de la piece (voir
 * `computeTotals`).
 */
export function buildLineRows(
  entries: readonly LineEntry[],
  totals: ComputedTotals,
  taxRate: DecimalInput,
): LineRow[] {
  if (entries.length !== totals.lines.length) {
    // Incoherence interne, pas une erreur d'appelant : `computeTotals` rend
    // exactement une ligne par entree. On refuse bruyamment plutot que d'ecrire
    // un document tronque.
    throw new Error(
      `Lignes incoherentes : ${String(entries.length)} entrees pour ${String(totals.lines.length)} lignes calculees.`,
    );
  }

  const rate = toDecimal(taxRate);
  const rows: LineRow[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const line = totals.lines[index];

    // `noUncheckedIndexedAccess` : l'acces par indice est `T | undefined` meme
    // quand la longueur a ete verifiee. Ce garde dit au compilateur ce que la
    // verification ci-dessus garantit deja, sans desactivation de regle.
    if (!entry || !line) {
      throw new Error(`Ligne ${String(index)} introuvable apres verification de longueur.`);
    }

    rows.push({
      position: index + 1,
      title: entry.title,
      description: entry.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent,
      taxRate: rate,
      lineTotal: line.lineTotal,
    });
  }

  return rows;
}
