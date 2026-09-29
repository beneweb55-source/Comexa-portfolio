import type { Prisma } from '../../generated/prisma/client.js';
import type { RoleCode } from '../../generated/prisma/enums.js';

/**
 * PROJECTION DES ROLES ET DES PERMISSIONS.
 *
 * Aucune donnee sensible ici : `Role` et `Permission` ne portent ni secret ni
 * donnee personnelle. La projection existe quand meme, pour la meme raison que
 * dans `user.presenter.ts` — une liste BLANCHE. Les modeles portent des colonnes
 * techniques (`id`, `createdAt`, `updatedAt`) que le frontend n'utilise pas, et
 * qui deviendraient autant de champs a maintenir le jour ou l'API change de
 * forme. Ce qui sort est ce qui sert.
 *
 * Les codes sont la cle : `Role.code` est unique et stable, `Role.id` est un
 * cuid interne. L'API expose le code partout — `PATCH /roles/DEVELOPER/
 * permissions` se lit et se journalise, `/roles/clx8f2.../permissions` non.
 */

export const PERMISSION_SELECT = {
  code: true,
  resource: true,
  action: true,
  scope: true,
  description: true,
} as const satisfies Prisma.PermissionSelect;

export const ROLE_SELECT = {
  code: true,
  name: true,
  description: true,
  isSystem: true,
  _count: { select: { permissions: true } },
} as const satisfies Prisma.RoleSelect;

export const ROLE_DETAIL_SELECT = {
  code: true,
  name: true,
  description: true,
  isSystem: true,
  permissions: {
    select: { permission: { select: PERMISSION_SELECT } },
    // Tri par code : deux appels rendent le meme ordre, ce qui permet de
    // comparer deux reponses — avant/apres un changement, ou entre deux
    // environnements.
    orderBy: { permission: { code: 'asc' } },
  },
} as const satisfies Prisma.RoleSelect;

export type RoleRow = Prisma.RoleGetPayload<{ select: typeof ROLE_SELECT }>;
export type RoleDetailRow = Prisma.RoleGetPayload<{ select: typeof ROLE_DETAIL_SELECT }>;
export type PermissionRow = Prisma.PermissionGetPayload<{ select: typeof PERMISSION_SELECT }>;

/** Une permission du catalogue, telle qu'elle existe en base. */
export interface PermissionView {
  readonly code: string;
  readonly resource: string;
  readonly action: string;
  /**
   * `any`, `own`, `assigned`, `client`. C'est la portee qui distingue « lire
   * tous les projets » de « lire les siens » : deux droits de meme nom, deux
   * perimetres sans rapport. Le frontend en a besoin pour composer un libelle
   * comprehensible, et il ne peut pas le deduire du code sans le redecouper.
   */
  readonly scope: string;
  readonly description: string | null;
}

/** Un role, sans ses permissions. */
export interface RoleView {
  readonly code: RoleCode;
  readonly name: string;
  readonly description: string | null;
  /**
   * Vrai pour les roles que le produit pose lui-meme. Aujourd'hui tous le sont
   * (`seed.ts` les cree) : le champ est la pour que l'interface puisse, plus
   * tard, distinguer un role metier d'un role que l'administration a invente.
   */
  readonly isSystem: boolean;
  /**
   * Le NOMBRE seulement, pas la liste. Sur un ecran qui affiche sept roles,
   * envoyer les cent permissions de chacun ferait transiter les donnees de tout
   * le catalogue pour dessiner sept nombres. Le detail s'obtient a l'unite par
   * `GET /roles/:code`.
   */
  readonly permissionCount: number;
}

/** Un role et ses permissions. */
export interface RoleDetailView extends RoleView {
  readonly permissions: readonly PermissionView[];
}

export function presentPermission(row: PermissionRow): PermissionView {
  return {
    code: row.code,
    resource: row.resource,
    action: row.action,
    scope: row.scope,
    description: row.description,
  };
}

export function presentPermissions(rows: readonly PermissionRow[]): PermissionView[] {
  return rows.map(presentPermission);
}

export function presentRole(row: RoleRow): RoleView {
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    permissionCount: row._count.permissions,
  };
}

export function presentRoles(rows: readonly RoleRow[]): RoleView[] {
  return rows.map(presentRole);
}

export function presentRoleDetail(row: RoleDetailRow): RoleDetailView {
  const permissions = row.permissions
    .map((link) => presentPermission(link.permission))
    .sort(comparePermissions);

  return {
    code: row.code,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    permissionCount: permissions.length,
    permissions,
  };
}

/**
 * Ordre des permissions : ressource, puis action, puis portee.
 *
 * La base trie deja par code, ce qui revient presque au meme — mais « presque »
 * suffit a produire une liste ou `user:read:any` suit `task:write:own` sans
 * logique visible. Trier sur les trois composants separement donne un catalogue
 * qui se lit par metier, ce qui est l'usage : on cherche « ce qui touche aux
 * factures », pas un code precis dont on connait deja le nom.
 */
function comparePermissions(left: PermissionView, right: PermissionView): number {
  return (
    left.resource.localeCompare(right.resource) ||
    left.action.localeCompare(right.action) ||
    left.scope.localeCompare(right.scope)
  );
}
