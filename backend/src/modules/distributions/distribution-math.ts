import { Prisma } from '../../generated/prisma/client.js';
import { AppException } from '../../common/errors/app-error.js';

/**
 * ARITHMETIQUE DE LA REPARTITION — fonctions PURES, testables sans base.
 *
 * Ce fichier existe parce que la REPARTITION est une operation financière et
 * que deux propriétés doivent etre vraies a chaque fois, sans discussion :
 *
 *  1. LA SOMME REPARTIE EST EXACTEMENT LA BASE. Pas « presque », pas « au
 *     centime pres » : exactement. Une repartition qui perd ou qui invente un
 *     centime est une repartition fausse, et un solde faux est un litige.
 *
 *  2. L'ARRONDI EST DETERMINISTE ET EXPLIQUABLE. Deux executions du meme
 *     calcul donnent le meme resultat, et le resultat s'explique ligne par
 *     ligne (brut, plancher, reste, ajustement). Une repartition que l'on ne
 *     sait pas justifier est une repartition que l'on ne peut pas faire
 *     confiance.
 *
 * LA METHODE : LE PLUS GRAND RESTE.
 *
 * On calcule le montant BRUT de chaque part (`base x %`), on le plancher au
 * centime, puis on distribue les centimes restants un par un, du plus grand
 * reste au plus petit. Les ex aequo sont departages par l'ORDRE des lignes :
 * c'est ce qui rend le resultat reproductible.
 *
 * L'ALTERNATIVE — « le dernier beneficiaire absorbe la difference » — est
 * plus courte, et c'est precisement son probleme : l'ecart atterrit toujours
 * sur la meme personne, sans raison, et l'ordre des lignes decide de qui
 * s'agit. Elle est donc remplacee.
 */

const CENTS = 2;
const ROUND_DOWN = Prisma.Decimal.ROUND_DOWN;

/** Une part a repartir : un pourcentage, et une cle qui la designe. */
export interface ShareInput {
  /** Cle stable de la part (identifiant du beneficiaire). */
  readonly key: string;
  /** Pourcentage, deja converti en Decimal. */
  readonly percentage: Prisma.Decimal;
  /** Beneficiaire MEMBER : identifiant du compte. */
  readonly userId?: string | null;
  /** Beneficiaire COMPANY ou RESERVE : pas de compte. */
  readonly beneficiaryType?: string;
}

/** Le resultat d'une part, avec sa trace d'arrondi. */
export interface ShareResult {
  readonly key: string;
  readonly percentage: Prisma.Decimal;
  /** Montant brut avant arrondi (precision pleine). */
  readonly raw: Prisma.Decimal;
  /** Montant plancher au centime. */
  readonly floor: Prisma.Decimal;
  /** Reste decimal conserve (precision pleine). */
  readonly remainder: Prisma.Decimal;
  /** Centimes ajoutes par le plus-grand-reste. */
  readonly adjustment: Prisma.Decimal;
  /** Montant final de la part. */
  readonly amount: Prisma.Decimal;
  /** Rang de la part dans le departage des ex aequo (0 = premier servis). */
  readonly rank: number;
}

/**
 * Convertit une saisie de pourcentage en Decimal, SANS tolerer le flottant.
 *
 * `Number("33.33")` puis `toString()` peut rendre `33.330000000000002` : la
 * somme des parts ne ferait alors plus 100. On lit donc la chaine, et rien
 * d'autre.
 */
export function parsePercentage(input: string | number | Prisma.Decimal): Prisma.Decimal {
  if (input instanceof Prisma.Decimal) {
    return input;
  }

  const raw = typeof input === 'number' ? String(input) : String(input ?? '').trim();

  if (raw.length === 0) {
    throw AppException.badRequest('INVALID_PERCENTAGE', 'Un pourcentage est obligatoire.');
  }

  // La virgule decimal est acceptee : les saisies francaises utilisent le
  // point, mais un collage depuis un tableur peut bringinguer une virgule.
  const normalized = raw.replace(',', '.');

  if (!/^\d{1,3}(\.\d{1,2})?$/.test(normalized)) {
    throw AppException.badRequest(
      'INVALID_PERCENTAGE',
      `« ${raw} » n'est pas un pourcentage valide (deux decimales au plus).`,
    );
  }

  return new Prisma.Decimal(normalized);
}

/**
 * Verifie qu'un lot de parts est repartissable.
 *
 * QUATRE INTERDITS, ET ILS SONT DANS LE CODE, PAS DANS L'ECRAN :
 * un pourcentage hors bornes, un total different de 100, un beneficiaire
 * MEMBER sans compte, et le meme compte deux fois. L'ecran montre le total
 * pendant la saisie ; le serveur, lui, refuse — parce que l'ecran n'est pas
 * la frontiere.
 */
export function validateShares(shares: readonly ShareInput[]): Prisma.Decimal {
  if (shares.length === 0) {
    throw AppException.badRequest('EMPTY_SHARE_LIST', 'Ajoutez au moins un bénéficiaire.');
  }

  let total = new Prisma.Decimal(0);
  const seenUsers = new Map<string, string>();

  for (const share of shares) {
    if (share.percentage.lessThanOrEqualTo(0)) {
      throw AppException.badRequest(
        'INVALID_PERCENTAGE',
        `Une part ne peut pas être nulle ou négative (${share.percentage.toString()} %).`,
      );
    }

    if (share.percentage.greaterThan(100)) {
      throw AppException.badRequest(
        'INVALID_PERCENTAGE',
        `Une part ne peut pas dépasser 100 % (${share.percentage.toString()} %).`,
      );
    }

    if (share.beneficiaryType === 'MEMBER') {
      if (!share.userId) {
        throw AppException.badRequest(
          'MISSING_MEMBER',
          'Un bénéficiaire de type MEMBER doit être rattaché à un compte de l’équipe.',
        );
      }

      const previous = seenUsers.get(share.userId);
      if (previous) {
        throw AppException.badRequest(
          'DUPLICATE_MEMBER',
          'Un même membre figure deux fois dans la répartition.',
        );
      }
      seenUsers.set(share.userId, share.key);
    }

    total = total.plus(share.percentage);
  }

  if (!total.equals(new Prisma.Decimal(100))) {
    throw AppException.badRequest(
      'INVALID_PERCENTAGE_SUM',
      `Le total des pourcentages (${total.toString()} %) doit être exactement 100 %.`,
    );
  }

  return total;
}

/**
 * Repartit un montant selon des pourcentages, au centime pres.
 *
 * Le montant final de chaque part est `plancher + centimes de reste`, et la
 * somme des parts vaut EXACTEMENT la base : pas de centime perdu, pas de
 * centime invente.
 */
export function splitAmount(
  base: Prisma.Decimal,
  shares: readonly ShareInput[],
): { readonly results: ShareResult[]; readonly total: Prisma.Decimal } {
  if (!base.equals(base)) {
    throw AppException.internal('INVALID_BASE', 'Le montant de base est invalide.');
  }

  const hundred = new Prisma.Decimal(100);

  // La somme des pourcentages doit faire 100 % : sans cette garantie, la
  // repartition distribuerait une partie de la base — ou plus que la base —
  // et le « reste » ne voudrait plus rien dire.
  const percentageTotal = shares.reduce(
    (sum, share) => sum.plus(share.percentage),
    new Prisma.Decimal(0),
  );

  if (!percentageTotal.equals(hundred)) {
    throw AppException.badRequest(
      'INVALID_PERCENTAGE_SUM',
      'Les pourcentages ne totalisent pas 100 % : la répartition ne peut pas être exacte.',
    );
  }

  const raws: Prisma.Decimal[] = shares.map((share) =>
    base.times(share.percentage).div(hundred),
  );
  const floors: Prisma.Decimal[] = raws.map((raw) => raw.toDecimalPlaces(CENTS, ROUND_DOWN));

  const flooredTotal = floors.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0));
  const leftover = base.minus(flooredTotal);

  // Le reste peut etre negatif si les pourcentages ne totalisent pas 100 :
  // c'est une faute de saisie, refusee plus haut. On ne le compense jamais
  // en silence.
  if (leftover.isNegative()) {
    throw AppException.badRequest(
      'INVALID_PERCENTAGE_SUM',
      'Les pourcentages ne totalisent pas 100 % : la répartition ne peut pas être exacte.',
    );
  }

  const remainders: Prisma.Decimal[] = raws.map((raw, index) =>
    raw.minus(floors[index] as Prisma.Decimal),
  );

  // Classement : plus grand reste d'abord ; ex aequo departages par l'ordre
  // des lignes (donc par l'ordre des beneficiaires), jamais par le hasard.
  const order: number[] = shares
    .map((_, index) => index)
    .sort((left, right) => {
      const remainderLeft = remainders[left] as Prisma.Decimal;
      const remainderRight = remainders[right] as Prisma.Decimal;
      const comparison = remainderRight.comparedTo(remainderLeft);
      return comparison !== 0 ? comparison : left - right;
    });

  const cent = new Prisma.Decimal(0.01);
  const adjustments: Prisma.Decimal[] = shares.map(() => new Prisma.Decimal(0));

  let centsLeft = leftover.times(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN).toNumber();

  let cursor = 0;
  while (centsLeft > 0 && order.length > 0) {
    const target = order[cursor % order.length] as number;
    adjustments[target] = (adjustments[target] as Prisma.Decimal).plus(cent);
    cursor += 1;
    centsLeft -= 1;
  }

  const results: ShareResult[] = shares.map((share, index) => ({
    key: share.key,
    percentage: share.percentage,
    raw: raws[index] as Prisma.Decimal,
    floor: floors[index] as Prisma.Decimal,
    remainder: remainders[index] as Prisma.Decimal,
    adjustment: adjustments[index] as Prisma.Decimal,
    amount: (floors[index] as Prisma.Decimal).plus(adjustments[index] as Prisma.Decimal),
    rank: order.indexOf(index),
  }));

  const total = results.reduce((sum, result) => sum.plus(result.amount), new Prisma.Decimal(0));

  return { results, total };
}

/** La trace d'arrondi, serialisable telle qu'elle est stockee en base. */
export interface RoundingTrace {
  readonly base: string;
  readonly method: 'largest-remainder';
  readonly scale: number;
  readonly results: {
    readonly key: string;
    readonly percentage: string;
    readonly raw: string;
    readonly floor: string;
    readonly remainder: string;
    readonly adjustment: string;
    readonly amount: string;
    readonly rank: number;
  }[];
  readonly total: string;
}

export function buildTrace(
  base: Prisma.Decimal,
  results: readonly ShareResult[],
  total: Prisma.Decimal,
): RoundingTrace {
  return {
    base: base.toString(),
    method: 'largest-remainder',
    scale: CENTS,
    results: results.map((result) => ({
      key: result.key,
      percentage: result.percentage.toString(),
      raw: result.raw.toString(),
      floor: result.floor.toString(),
      remainder: result.remainder.toString(),
      adjustment: result.adjustment.toString(),
      amount: result.amount.toString(),
      rank: result.rank,
    })),
    total: total.toString(),
  };
}
