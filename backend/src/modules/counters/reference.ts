import { REFERENCE_PADDING } from '../../common/references/reference.scopes.js';

/**
 * FORMAT DES REFERENCES — la partie PURE de la numerotation.
 *
 * Ce fichier ne connait ni Nest, ni Prisma, ni les portees : il transforme un
 * prefixe, une annee et une sequence en une chaine. C'est volontaire. Le contrat
 * metier — quelles portees existent, quel prefixe va avec laquelle — vit dans
 * `counter.service.ts`, a un seul endroit. Ici il n'y a que de l'assemblage de
 * caracteres, donc rien qui puisse diverger entre deux appelants.
 *
 * LA PORTEE EST ANNUELLE. Le compteur est indexe par `(scope, year)` en base :
 * au 1er janvier la ligne de l'annee nouvelle n'existe pas et repart donc a 1.
 * C'est une exigence comptable — une facture doit se lire `FAC-2026-0007` et non
 * `FAC-0000472` — et c'est aussi ce qui rend la sequence courte et verifiable a
 * l'oeil sur un document imprime.
 */

/**
 * Nombre de chiffres de la sequence par defaut. Voir `formatReference`.
 *
 * Le NOM reste ici — c'est le defaut du formateur, et c'est ainsi qu'il se lit
 * dans la signature de `formatReference` — mais la VALEUR vit dans
 * `src/common/references/reference.scopes.ts` avec les portees et les prefixes :
 * une politique de numerotation se lit d'un seul endroit. Sans cela, passer la
 * sequence a cinq chiffres demanderait de penser a deux constantes, et l'oubli
 * ne se verrait que sur les documents emis apres coup.
 */
export const DEFAULT_SEQUENCE_DIGITS = REFERENCE_PADDING;

/**
 * `<PREFIX>-<ANNEE>-<SEQUENCE>`, et rien d'autre.
 *
 * `padStart` n'ecrit QUE des zeros en tete : au-dela de 9999 la sequence
 * continue a 10000, 10001... et reste unique. Un `slice(-4)` (qui donnerait
 * « 0000 » pour 10000) ferait collisionner tout le reste de l'annee, et la
 * collision n'apparaitrait qu'au 10000e document — c'est-a-dire jamais en
 * developpement, et en production deux ans plus tard.
 */
export function formatReference(
  prefix: string,
  year: number,
  sequence: number,
  padding: number = DEFAULT_SEQUENCE_DIGITS,
): string {
  const digits =
    Number.isFinite(padding) && padding >= 1 ? Math.trunc(padding) : DEFAULT_SEQUENCE_DIGITS;
  return `${prefix}-${year}-${String(sequence).padStart(digits, '0')}`;
}

/**
 * Annee d'imputation du compteur.
 *
 * Lue sur l'horloge du processus, et non sur une date fournie par l'appelant :
 * un client qui posterait `year` obtiendrait une reference d'une annee close, et
 * la numerotation legale d'une annee ne se rouvre pas. Le seul cas ou l'annee se
 * choisit ailleurs est la reprise d'historique (`prisma/seed.ts`, scripts), pas
 * une requete HTTP.
 */
export function referenceYear(now: Date = new Date()): number {
  return now.getFullYear();
}
