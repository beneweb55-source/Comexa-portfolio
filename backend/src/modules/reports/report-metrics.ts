import { Prisma } from '../../generated/prisma/client.js';

/**
 * ARITHMETIQUE DES AGREGATS.
 *
 * Deux regles, et ce fichier existe pour qu'elles ne soient pas reecrites de
 * travers dans chaque rapport.
 *
 * 1. L'ARGENT NE PASSE JAMAIS PAR UN FLOTTANT.
 *
 * `0.1 + 0.2 !== 0.3` en binaire. Sur un total de facturation, l'erreur se
 * cumule et finit par deplacer un centime — c'est-a-dire par ne plus tomber
 * juste avec la comptabilite. Le chiffre d'affaires est la seule ligne du
 * tableau de bord que le dirigeant verifie a la main : c'est celle qui doit
 * tomber juste. On additionne donc en `Prisma.Decimal` (exact) et on ne
 * convertit en nombre que pour les RATIOS, ou l'approximation est sans
 * consequence.
 *
 * 2. UN JEU VIDE PRODUIT UN ZERO, JAMAIS `null` NI `NaN`.
 *
 * `aggregate._sum.amount` vaut `null` quand aucune ligne ne correspond, et
 * `null / 0` vaut `NaN`. Un `NaN` serialise en JSON devient `null` ; le
 * frontend affiche alors un tiret, ou `NaN %`, et personne ne sait si la
 * periode est vide ou si le calcul est casse. Toutes les fonctions de ce
 * fichier ramenent donc l'absence de donnee a `0` / `'0.00'`.
 */

/** Ce que Prisma rend d'une colonne `Decimal`, et ce qu'on accepte en entree. */
export type DecimalLike = Prisma.Decimal | number | string | null | undefined;

/** Montant nul, pour les cas ou Prisma ne renvoie rien du tout. */
export function zeroAmount(): Prisma.Decimal {
  return new Prisma.Decimal(0);
}

/**
 * Ramene n'importe quelle entree a un `Decimal` exact.
 *
 * Une chaine invalide leve : c'est volontaire. Une valeur monetaire illisible
 * signale une donnee corrompue, et la remplacer en silence par zero ferait
 * disparaitre de l'argent sans que personne ne s'en apercoive.
 */
export function decimalOf(value: DecimalLike): Prisma.Decimal {
  if (value === null || value === undefined) {
    return zeroAmount();
  }
  if (Prisma.Decimal.isDecimal(value)) {
    return value;
  }
  return new Prisma.Decimal(value);
}

/**
 * Somme exacte. Une liste vide vaut zero.
 *
 * On ne peut pas utiliser `Prisma.Decimal.sum` : il n'existe pas. Et
 * `reduce((a, b) => a + b, 0)` repasserait par des nombres flottants des le
 * premier `+`.
 */
export function sumDecimals(values: readonly DecimalLike[]): Prisma.Decimal {
  let total = zeroAmount();
  for (const value of values) {
    total = total.plus(decimalOf(value));
  }
  return total;
}

/**
 * Montant tel qu'il part dans la reponse JSON : une CHAINE a deux decimales.
 *
 * Pas un nombre. Un `number` JSON ne represente pas exactement `12345.67`, et
 * le frontend qui reformate derriere introduirait une seconde approximation.
 * Une chaine decimale se transporte sans perte et s'affiche telle quelle.
 */
export function amountString(value: DecimalLike): string {
  return decimalOf(value).toFixed(2);
}

/** Compteur Prisma, ramene a un entier sur. `null` et `undefined` valent zero. */
export function countOf(value: number | null | undefined): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
}

function round(value: number, fractionDigits: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(fractionDigits));
}

/**
 * Moyenne sure. Un total nul sur zero element vaut zero, pas `NaN`.
 *
 * `fractionDigits` a 1 par defaut : un avancement moyen s'affiche en pourcentage
 * entier ou a une decimale, jamais avec quinze chiffres significatifs.
 */
export function averageOf(
  sum: number | null | undefined,
  count: number | null | undefined,
  fractionDigits = 1,
): number {
  const total = Number(sum);
  const elements = countOf(count);

  if (!Number.isFinite(total) || elements <= 0) {
    return 0;
  }
  return round(total / elements, fractionDigits);
}

/**
 * Rapport entre deux montants, en fraction (0.42 = 42 %).
 *
 * Un denominateur nul ou negatif donne ZERO et non une division par zero : un
 * taux de recouvrement sans facture emise n'est pas infini, il est nul.
 *
 * `fractionDigits` a 4 : on ne stocke pas un taux en base, on le recalcule a
 * l'affichage, donc garder quatre decimales evite d'afficher 0 % pour 0.4 %.
 */
export function ratioOf(
  numerator: DecimalLike,
  denominator: DecimalLike,
  fractionDigits = 4,
): number {
  const bottom = decimalOf(denominator);
  if (bottom.lte(0)) {
    return 0;
  }
  return round(decimalOf(numerator).div(bottom).toNumber(), fractionDigits);
}

/** Rapport entre deux entiers (part / total), meme contrat que `ratioOf`. */
export function shareOf(part: number | null | undefined, total: number | null | undefined): number {
  const whole = countOf(total);
  if (whole <= 0) {
    return 0;
  }
  return round(countOf(part) / whole, 4);
}

/**
 * Montant total d'une devise, dans la forme qui part en JSON.
 *
 * `count` est le nombre de LIGNES agregees, pas un nombre de devises : c'est ce
 * qui permet de dire « 3 factures » a cote de « 4 200,00 EUR ».
 */
export interface CurrencyAmount {
  readonly currency: string;
  readonly total: string;
  readonly count: number;
}

/** Compteur par valeur d'enumeration (statut, priorite, type...). */
export interface StatusCount {
  readonly status: string;
  readonly count: number;
}

export interface SourceCount {
  readonly source: string;
  readonly count: number;
}

export interface MethodAmount extends CurrencyAmount {
  readonly method: string;
}

/**
 * Montants d'une section, regroupes par devise.
 *
 * `currency` / `total` / `count` resument la devise dominante — celle que l'on
 * met en avant — et `byCurrency` porte le detail. Il n'existe volontairement
 * aucun total « toutes devises confondues » : additionner des euros et des
 * dollars donnerait un nombre qui ne correspond a rien.
 */
export interface AmountSection {
  readonly currency: string;
  readonly total: string;
  readonly count: number;
  readonly byCurrency: readonly CurrencyAmount[];
}

export interface CollectedSection extends AmountSection {
  readonly byMethod: readonly MethodAmount[];
}

/**
 * Ligne de `groupBy` par devise, telle que Prisma la rend.
 *
 * Le total est un `Decimal` (ou `null` sur une table vide) : il entre ici a
 * l'etat brut et ne devient une chaine qu'a la sortie. Accepter les deux formes
 * evite de caster les retours de Prisma dans chaque appelant.
 */
export interface RawCurrencyAmount {
  readonly currency: string;
  readonly total: DecimalLike;
  readonly count: number | null | undefined;
}

/**
 * Convertit des lignes `groupBy` de devise en `CurrencyAmount[]`.
 *
 * Le total est deja une somme Prisma : l'addition est exacte, on ne fait que la
 * mettre en forme.
 */
export function currencyAmounts(rows: readonly RawCurrencyAmount[]): CurrencyAmount[] {
  return rows.map((row) => ({
    currency: row.currency,
    total: amountString(row.total),
    count: countOf(row.count),
  }));
}

/**
 * Section de montants : devise dominante en tete, detail complet dessous.
 *
 * Une liste vide produit `{ currency: 'DZD', total: '0.00', count: 0 }` et non
 * `null` : un tableau de bord sans facture doit afficher zero, pas un tiret.
 */
export function amountSection(rows: readonly RawCurrencyAmount[]): AmountSection {
  const normalized = currencyAmounts(rows);
  const primary = primaryAmount(normalized);

  return {
    currency: primary.currency,
    total: primary.total,
    count: primary.count,
    byCurrency: normalized,
  };
}

/**
 * Devise de repli quand aucune ligne n'existe — celle du schema.
 *
 * C'est le dinar : `Project.currency`, `Quote.currency`, `Invoice.currency`,
 * `Payment.currency` et `Client.currency` portent tous `@default("DZD")`. Le
 * repli doit dire la meme chose que la base ; l'euro ne doit pas reapparaitre
 * comme devise implicite d'un rapport vide.
 */
export const FALLBACK_CURRENCY = 'DZD';

/**
 * Devise principale d'un ensemble de totaux.
 *
 * Un schema multi-devises interdit d'additionner des euros et des dollars : le
 * total « toutes devises confondues » ne veut rien dire. On expose donc le
 * detail par devise, et cette fonction designe celle qui porte le montant le
 * plus eleve — c'est celle que l'on met en avant sur le tableau de bord.
 *
 * A montants egaux, l'ordre alphabetique tranche : deux executions de la meme
 * requete doivent produire la meme reponse, sinon un test devient instable et
 * un utilisateur croit a un changement de chiffre.
 */
export function pickPrimaryCurrency(
  amounts: readonly CurrencyAmount[],
  fallback: string = FALLBACK_CURRENCY,
): string {
  const sorted = sortByAmountDesc(amounts);
  return sorted[0]?.currency ?? fallback;
}

/** Tri decroissant par montant, puis alphabetique : ordre total et stable. */
export function sortByAmountDesc<T extends CurrencyAmount>(amounts: readonly T[]): T[] {
  return [...amounts].sort((left, right) => {
    const difference = decimalOf(right.total).comparedTo(decimalOf(left.total));
    if (difference !== 0) {
      return difference;
    }
    return left.currency.localeCompare(right.currency);
  });
}

/**
 * Total « principal » d'un ensemble multi-devises.
 *
 * Renvoie la devise dominante et son montant. Les autres restent lisibles dans
 * `byCurrency` : les additionner serait une faute comptable, les cacher serait
 * une perte d'information.
 */
export function primaryAmount(amounts: readonly CurrencyAmount[]): CurrencyAmount {
  const sorted = sortByAmountDesc(amounts);
  const first = sorted[0];

  return first ?? { currency: FALLBACK_CURRENCY, total: '0.00', count: 0 };
}
