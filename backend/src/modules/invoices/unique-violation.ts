/**
 * VIOLATIONS DE CONTRAINTE D'UNICITE.
 *
 * Prisma signale un conflit d'unicite par le code `P2002` et, dans
 * `meta.target`, la liste des colonnes en conflit. Deux endroits du module en
 * dependent, et pour des raisons opposees :
 *
 *  - `POST /quotes/:id/accept` : `Project.quoteId` est `@unique`. Deux
 *    acceptations simultanees du meme devis ne doivent produire QU'UN projet ;
 *    la seconde doit se voir repondre 409. Un `findFirst` avant creation ne le
 *    garantit pas — les deux requetes le feraient avant que l'une des deux
 *    n'ecrive. La contrainte, elle, le garantit ;
 *  - l'enregistrement d'un paiement : la reference est unique, et un doublon de
 *    reference doit etre traite comme une collision technique, pas comme un
 *    doublon de paiement legitime.
 *
 * POURQUOI PAS `instanceof Prisma.PrismaClientKnownRequestError` : la classe
 * n'est pas reexportee par le client genere de ce projet (le generateur
 * `prisma-client` ne publie que les types de modele). L'inspection structurelle
 * ci-dessous est la seule qui reste juste apres une mise a jour du client, et
 * elle ne depend d'aucun chemin d'import interne a Prisma.
 */

/** Forme minimale d'une erreur Prisma d'unicite. */
interface UniqueConstraintError {
  readonly code?: unknown;
  readonly meta?: { readonly target?: unknown };
}

/**
 * Colonnes en conflit, ou `null` si l'erreur n'est pas un P2002.
 *
 * Un tableau vide est possible : certaines configurations ne renseignent pas
 * `meta.target`. Les appelants doivent traiter ce cas explicitement plutot que
 * de supposer un nom de colonne.
 */
export function uniqueViolationTarget(error: unknown): string[] | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const candidate = error as UniqueConstraintError;

  if (candidate.code !== 'P2002') {
    return null;
  }

  const target = candidate.meta?.target;

  if (Array.isArray(target)) {
    return target.filter((column): column is string => typeof column === 'string');
  }

  if (typeof target === 'string') {
    return [target];
  }

  return [];
}

/**
 * L'erreur est-elle un conflit d'unicite sur CETTE colonne ?
 *
 * Un `meta.target` vide est traite comme un OUI, et c'est le sens qui protege :
 * se tromper dans ce sens refuse une operation reversible (un 409, que
 * l'utilisateur reessaie apres avoir verifie) au lieu d'en accepter une
 * irreversible (deux projets nes du meme devis, ou deux paiements comptes deux
 * fois). Dans les deux appels de ce module, les colonnes candidates sont connues
 * et la colonne visee est celle qui porte la garantie d'idempotence : il n'y a
 * donc pas d'ambiguite a craindre.
 */
export function isUniqueViolationOn(error: unknown, column: string): boolean {
  const target = uniqueViolationTarget(error);

  if (target === null) {
    return false;
  }

  return target.length === 0 || target.includes(column);
}
