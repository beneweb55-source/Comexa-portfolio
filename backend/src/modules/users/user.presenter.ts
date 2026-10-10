import type { Prisma } from '../../generated/prisma/client.js';
import type { RoleCode, UserStatus } from '../../generated/prisma/enums.js';

/**
 * PROJECTION DES COMPTES VERS L'EXTERIEUR.
 *
 * DEUX PROTECTIONS, ET ELLES NE PROTEGENT PAS DE LA MEME CHOSE.
 *
 * 1. LE `select` — `passwordHash` n'est JAMAIS DEMANDE a la base. Ce n'est pas
 *    une precaution de style : la colonne ne quitte pas PostgreSQL, elle
 *    n'existe donc dans aucune variable, aucun journal, aucune trace de pile.
 *    Un `delete user.passwordHash` apres coup laisse au contraire l'empreinte
 *    circuler en memoire, et il suffit d'un `console.log(user)` pour la retrouver
 *    dans les journaux. Il s'oublie aussi : la prochaine route ecrite par
 *    quelqu'un qui n'a pas lu ce fichier renverra la ligne complete.
 *
 * 2. `presentUser` — LISTE BLANCHE de champs. La fonction construit un objet
 *    NEUF, propriete par propriete. Ajouter une colonne a `User` ne l'expose pas
 *    par accident : il faudrait ecrire la ligne. Une liste noire ferait
 *    l'inverse — toute colonne ajoutee sortirait par defaut, et personne ne le
 *    verrait avant que ce soit en production.
 *
 * Les deux sont necessaires. Le `select` protege la base et les journaux ;
 * `presentUser` protege le contrat de l'API.
 */

/**
 * Champs d'un compte, tels qu'ils sortent de l'API.
 *
 * `as const` est indispensable : sans lui, les `true` sont elargis en `boolean`
 * et `Prisma.UserGetPayload` ne sait plus quel champ est selectionne — le type
 * de la ligne devient inexploitable.
 */
export const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  avatarKey: true,
  status: true,
  isEmailVerified: true,
  lastLoginAt: true,
  mustChangePassword: true,
  clientId: true,
  createdAt: true,
  updatedAt: true,
  roles: {
    select: {
      role: { select: { code: true } },
    },
  },
} as const satisfies Prisma.UserSelect;

/** La ligne telle que la base la rend, pour ce `select` precisement. */
export type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

/** Un compte, tel que le frontend le recoit. */
export interface UserView {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: string | null;
  readonly avatarKey: string | null;
  readonly status: UserStatus;
  readonly isEmailVerified: boolean;
  readonly lastLoginAt: Date | null;
  readonly mustChangePassword: boolean;
  readonly clientId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /**
   * Codes seuls, tries. Le libelle traduisible vit dans `GET /roles` : le
   * dupliquer ici ferait diverger deux copies du meme texte a la premiere
   * reformulation. Le tri rend le tableau comparable d'un rendu a l'autre.
   */
  readonly roles: readonly RoleCode[];
}

export function presentUser(row: UserRow): UserView {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    avatarKey: row.avatarKey,
    status: row.status,
    isEmailVerified: row.isEmailVerified,
    lastLoginAt: row.lastLoginAt,
    mustChangePassword: row.mustChangePassword,
    clientId: row.clientId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    roles: row.roles.map((userRole) => userRole.role.code).sort(),
  };
}

export function presentUsers(rows: readonly UserRow[]): UserView[] {
  return rows.map(presentUser);
}
