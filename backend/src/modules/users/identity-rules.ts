import { AppException } from '../../common/errors/app-error.js';
import { RoleCode } from '../../generated/prisma/enums.js';

/**
 * INVARIANTS D'IDENTITE ET D'ACCES.
 *
 * Un endroit unique, et des fonctions PURES : aucun Prisma, aucun Nest. Les
 * services leur passent des faits qu'ils ont deja lus (`activeAdminCount`,
 * `currentRoles`), elles rendent une decision. C'est ce qui permet de les tester
 * exhaustivement sans base de donnees — et l'invariant qu'elles protegent est
 * trop important pour etre verifie seulement a travers un test HTTP.
 *
 * CE QU'ELLES EMPECHENT, CONCRETEMENT.
 *
 * Sans ces regles, la sequence suivante est acceptee par une API qui a pourtant
 * l'air correcte : le seul administrateur de l'agence se retire son propre role
 * ADMIN « pour voir », ou se suspend, ou se supprime. Il ne reste alors plus
 * personne pour attribuer des roles, creer des comptes ou modifier les
 * parametres. La seule sortie est une intervention manuelle en base — sur un
 * serveur de production, avec un client au telephone. C'est le genre de panne
 * qui n'arrive qu'une fois, mais qui coute une journee entiere.
 *
 * Le role ADMIN est le seul dont les permissions viennent du CATALOGUE et non
 * d'une liste : `ROLE_PERMISSIONS.ADMIN` vaut `'ALL'`. La table
 * `role_permissions` contient bien toutes les permissions pour ce role (le seed
 * les developpe), mais elle en est une COPIE. Modifier cette copie depuis
 * l'administration ferait diverger la base du catalogue, et le prochain
 * deploiement qui rejoue le seed effacerait silencieusement la modification —
 * en attendant, l'ADMIN ne detiendrait plus ce que le catalogue lui promet.
 */

/** Le seul role dont les permissions ne sont pas une liste editable. */
const IMMUTABLE_ROLE = RoleCode.ADMIN;

/** Operations interdites sur son propre compte. */
export type SelfAccountAction = 'DELETE' | 'SUSPEND';

/**
 * Codes demandes qui n'existent pas dans l'ensemble connu.
 *
 * Renvoie la liste plutot que de lever : l'appelant sait s'il interroge les
 * roles ou les permissions, et c'est lui qui choisit le code d'erreur et le
 * message. Deux ressources, une seule regle de comparaison.
 */
export function unknownCodes(requested: readonly string[], known: readonly string[]): string[] {
  const knownSet = new Set(known);
  return requested.filter((code) => !knownSet.has(code));
}

/** Vrai si la chaine est l'une des sept valeurs de l'enumeration `RoleCode`. */
export function isKnownRoleCode(value: string): value is RoleCode {
  return (Object.values(RoleCode) as readonly string[]).includes(value);
}

/**
 * Refuse une operation sur son propre compte.
 *
 * 422 et non 403 : le porteur detient bien la permission (`user:manage:any`),
 * c'est l'ETAT qui rend l'operation impossible. Un 403 ferait croire a un
 * probleme de droits et pousserait a en demander davantage, ce qui ne
 * resoudrait rien.
 */
export function assertNotSelfAccount(
  actorId: string,
  targetId: string,
  action: SelfAccountAction,
): void {
  if (actorId !== targetId) {
    return;
  }

  throw AppException.unprocessable(
    action === 'DELETE' ? 'SELF_DELETE_FORBIDDEN' : 'SELF_SUSPEND_FORBIDDEN',
    action === 'DELETE'
      ? 'Vous ne pouvez pas supprimer votre propre compte.'
      : 'Vous ne pouvez pas suspendre votre propre compte.',
  );
}

/** Refuse des codes de role absents de la base. */
export function assertRolesKnown(requested: readonly string[], known: readonly string[]): void {
  const unknown = unknownCodes(requested, known);

  if (unknown.length === 0) {
    return;
  }

  throw AppException.unprocessable(
    'UNKNOWN_ROLE',
    `Role(s) inconnu(s) : ${unknown.join(', ')}.`,
    { roles: unknown },
  );
}

/**
 * Refuse tout changement sur le role ADMIN.
 *
 * Voir l'en-tete du fichier : les permissions d'ADMIN sont la copie de `'ALL'`
 * du catalogue, pas une liste que l'administration peut editer.
 */
export function assertRoleIsMutable(code: RoleCode): void {
  if (code !== IMMUTABLE_ROLE) {
    return;
  }

  throw AppException.unprocessable(
    'ROLE_IMMUTABLE',
    "Le role ADMIN tient ses permissions du catalogue, pas d'une liste en base. " +
      'Le modifier ici le restreindrait jusqu\'au prochain seed, qui le retablirait sans prevenir.',
  );
}

// -----------------------------------------------------------------------------
// Rattachement a un dossier client
// -----------------------------------------------------------------------------
//
// POURQUOI CES DEUX REGLES EXISTENT.
//
// `users.clientId` n'est pas un champ d'identite ordinaire : c'est la SOURCE du
// perimetre de l'espace client. Trois mecanismes le lisent, et aucun ne verifie
// le role :
//
//   - `client-scope.ts` en tire l'identifiant qui remplace celui de l'URL ;
//   - `project-scope.ts` en tire `{ clientId }` ou `MATCH_NOTHING` ;
//   - `audience.ts` (`clientPortalUserIds`) en tire la liste des DESTINATAIRES
//     des notifications de devis, de facture et de paiement.
//
// Les deux premiers sont des perimetres de LECTURE : un compte qui porterait un
// `clientId` sans le role CLIENT n'y gagnerait rien, le role manquant fermant
// chaque route. Le troisieme ne regarde PAS le role — il filtre sur `clientId`,
// `deletedAt` et `status` seulement. Un developpeur a qui l'on aurait pose un
// `clientId` par distraction recevrait donc, en clair, les notifications
// commerciales du dossier : references de devis, montants de factures,
// confirmations de paiement. C'est la fuite que la premiere regle ferme.
//
// La seconde regle ferme la meme porte par l'autre bout : retirer le role CLIENT
// a un compte rattache laisserait exactement le meme compte incoherent, mais
// construit en deux requetes au lieu d'une seule.

/** Vrai si la liste de roles contient CLIENT. */
function holdsClientRole(roles: readonly string[]): boolean {
  return roles.includes(RoleCode.CLIENT);
}

/**
 * Refuse un rattachement client sur un compte qui ne porte pas le role CLIENT.
 *
 * Appelee a la creation (les roles demandes sont ceux qui seront poses) comme a
 * la modification (les roles deja en base, qu'un PATCH ne touche pas).
 *
 * 422 et non 400 : la requete est bien formee, c'est la COMBINAISON
 * `clientId` + roles qui est impossible. Le code d'erreur est stable et
 * interrogeable, comme les autres refus de ce module.
 */
export function assertClientScopeRequiresClientRole(
  clientId: string | null,
  roles: readonly string[],
): void {
  if (clientId === null || holdsClientRole(roles)) {
    return;
  }

  throw AppException.unprocessable(
    'CLIENT_ROLE_REQUIRED',
    "Un compte ne peut etre rattache a un dossier client que s'il porte le role CLIENT : " +
      'ce rattachement est le perimetre de l\'espace client, et il decide des notifications ' +
      'que le compte recevra.',
    { clientId, roles: [...roles].sort() },
  );
}

/**
 * Refuse un changement de roles qui laisserait un rattachement orphelin.
 *
 * Le refus est PREFERE a un detachement automatique, et c'est un choix. Retirer
 * le role CLIENT est une operation sur les DROITS ; effacer un rattachement est
 * une operation sur le PERIMETRE d'un dossier. Les faire dans la meme requete
 * rendrait le second invisible dans l'intention du premier : l'appelant qui
 * change des roles ne s'attend pas a perdre un rattachement, et l'audit
 * enregistrerait deux faits pour un geste.
 *
 * Le chemin reste ouvert et explicite : `PATCH /users/:id` avec
 * `clientId: null`, puis le changement de roles.
 */
export function assertClientScopeDetachedBeforeRoleChange(
  clientId: string | null,
  nextRoles: readonly string[],
): void {
  if (clientId === null || holdsClientRole(nextRoles)) {
    return;
  }

  throw AppException.unprocessable(
    'CLIENT_SCOPE_STILL_ATTACHED',
    'Ce compte est rattache a un dossier client : retirez d\'abord le rattachement ' +
      '(PATCH /users/:id avec clientId: null) avant de lui retirer le role CLIENT.',
    { clientId },
  );
}

export interface RoleChange {
  /** Le porteur de la requete. */
  readonly actorId: string;
  /** Le compte dont on remplace les roles. */
  readonly targetId: string;
  /** Roles detenus par le compte AVANT le changement. */
  readonly currentRoles: readonly string[];
  /** Roles demandes. */
  readonly nextRoles: readonly string[];
  /** Le compte vise est-il actif ? Un compte suspendu ne compte pas dans les administrateurs actifs. */
  readonly targetIsActive: boolean;
  /** Nombre de comptes ACTIFS portant ADMIN, releve dans la meme transaction. */
  readonly activeAdminCount: number;
}

/**
 * Refuse un changement de roles qui laisserait l'agence sans administrateur.
 *
 * DEUX REGLES, DANS CET ORDRE :
 *
 *  1. On ne se retire pas SOI-MEME son propre ADMIN, meme s'il en reste cinq
 *     autres. C'est une defense contre la manipulation autant que contre
 *     l'erreur : se demettre soi-meme est presque toujours une facon de
 *     contourner la regle suivante, ou un geste qu'on regrette dans la minute.
 *     Un autre administrateur peut le faire — c'est le seul chemin legitime.
 *
 *  2. On ne retire pas ADMIN au DERNIER administrateur actif. Le compte vise
 *     peut etre inactif (suspendu) : dans ce cas il ne comptait deja pas dans
 *     les actifs, et lui retirer ADMIN ne reduit pas leur nombre.
 */
export function assertAdministratorRemains(change: RoleChange): void {
  const losesAdmin = change.currentRoles.includes(RoleCode.ADMIN) &&
    !change.nextRoles.includes(RoleCode.ADMIN);

  if (!losesAdmin) {
    return;
  }

  if (change.actorId === change.targetId) {
    throw AppException.unprocessable(
      'SELF_ADMIN_REMOVAL_FORBIDDEN',
      'Vous ne pouvez pas retirer votre propre role ADMIN. Demandez a un autre administrateur de le faire.',
    );
  }

  assertNotLastActiveAdministrator(
    change.targetIsActive,
    change.activeAdminCount,
    "Ce compte est le dernier administrateur actif : lui retirer ADMIN laisserait l'agence " +
      'sans personne pour gerer les comptes.',
  );
}

/**
 * Refuse une operation qui retirerait le dernier administrateur actif.
 *
 * Utilisee par la suspension, qui n'est pas un changement de role mais qui
 * produit le meme effet : un administrateur suspendu ne peut plus rien gerer.
 * En pratique le porteur de `user:manage:any` est lui-meme un administrateur
 * actif et ne peut pas se suspendre (voir `assertNotSelfAccount`), donc cette
 * regle ne se declenche jamais aujourd'hui. Elle est la pour rester vraie le
 * jour ou le catalogue accordera `user:manage:any` a un autre role.
 */
export function assertNotLastActiveAdministrator(
  targetIsActiveAdmin: boolean,
  activeAdminCount: number,
  message: string,
): void {
  if (!targetIsActiveAdmin || activeAdminCount > 1) {
    return;
  }

  throw AppException.unprocessable('LAST_ADMIN_PROTECTED', message, { activeAdminCount });
}
