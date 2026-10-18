import { UserStatus } from '../../generated/prisma/enums.js';

/**
 * ORDRE D'AFFICHAGE DES MEMBRES DE L'ANNUAIRE.
 *
 * La regle demandee par l'administration : les comptes ACTIFS en haut de la
 * liste, les comptes SUSPENDUS tout en bas. Entre les deux, les invites (pas
 * encore connectes) puis les archives.
 *
 * Ce classement vit dans un module pur, sans Prisma ni Nest, pour deux raisons :
 * il est partage entre la requete de liste (`UsersService.list`) et ses tests,
 * et une regle d'affichage testable sans base reste une regle qu'on ose
 * changer. Le tri PRECISE l'alphabetique, il ne le remplace pas : a statut
 * egal, on retrouve exactement l'ordre « nom puis prenom » du telephone de
 * l'agence.
 *
 * `localeCompare` en francais, sans tenir compte de la casse : « benali » et
 * « Benali » rangent de la meme facon, et les accents ne separeront pas deux
 * orthographes du meme nom.
 */

/** Rang d'un statut : plus petit = plus haut dans la liste. */
const STATUS_RANK: Record<UserStatus, number> = {
  [UserStatus.ACTIVE]: 0,
  [UserStatus.INVITED]: 1,
  [UserStatus.ARCHIVED]: 2,
  [UserStatus.SUSPENDED]: 3,
};

/** Le minimum de `compareMembers` : un statut et un nom. */
export interface MemberOrderFields {
  readonly status: UserStatus;
  readonly lastName: string;
  readonly firstName: string;
}

function byName(left: string, right: string): number {
  return String(left ?? '').localeCompare(String(right ?? ''), 'fr', { sensitivity: 'base' });
}

export function compareMembers(a: MemberOrderFields, b: MemberOrderFields): number {
  const byStatus = (STATUS_RANK[a.status] ?? 0) - (STATUS_RANK[b.status] ?? 0);
  if (byStatus !== 0) return byStatus;
  const byLast = byName(a.lastName, b.lastName);
  if (byLast !== 0) return byLast;
  return byName(a.firstName, b.firstName);
}
