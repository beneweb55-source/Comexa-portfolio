import { SCOPE_ANY, SCOPE_OWN, type AccessPolicy, type ScopeName } from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';

/**
 * PERIMETRE DES PROSPECTS — la seule fonction qui decide QUELLES lignes un
 * porteur peut atteindre.
 *
 * POURQUOI UN FICHIER A PART.
 *
 * Le controle d'acces se joue a deux niveaux, et les confondre est la faute
 * classique : `@RequirePermissions` sur la route autorise l'APPEL, pas les
 * DONNEES. Un commercial a `prospect:read:own` : il peut appeler la liste, et il
 * ne doit y voir que son portefeuille. Si ce filtre est ecrit a la main dans
 * chaque methode du service, il finit par manquer dans la onzieme — celle qu'on
 * a ajoutee six mois plus tard. Ici, il n'y a qu'un endroit a relire.
 *
 * LE FILTRE EST DESTINE AU `where` PRISMA, JAMAIS A UN `if` APRES LECTURE.
 *
 * Un `if` apres lecture laisse fuiter l'existence de la ligne (un 403 sur une
 * fiche existante et un 404 sur une fiche inexistante racontent deux choses
 * differentes) et il est contourne par tout chemin d'appel qui l'oublie. Le
 * perimetre rendu ici est donc compose en `AND` avec les autres criteres par les
 * services : voir le commentaire sur `composeAnd`, qui explique pourquoi un
 * filtre utilisateur ne peut JAMAIS elargir le perimetre.
 */

/**
 * Ce que « own » designe POUR LES PROSPECTS : les fiches dont le porteur est
 * responsable, c'est-a-dire `ownerId = porteur`. Le catalogue ne definit pas
 * `own` de la meme facon pour chaque ressource (`task:write:own` vise les taches
 * ASSIGNEES, `quote:read:own` le client du porteur) : le sens est donc dit ici,
 * explicitement, et pas devine depuis le nom du scope.
 */
export type ProspectAction = 'read' | 'write' | 'delete' | 'convert';

/** Du plus large au plus etroit. Voir `AccessPolicy.widestScope`. */
const FULL_SCOPE: readonly ScopeName[] = [SCOPE_ANY];
const OWN_SCOPE: readonly ScopeName[] = [SCOPE_ANY, SCOPE_OWN];

const ACTIONS: Record<ProspectAction, readonly ScopeName[]> = {
  read: OWN_SCOPE,
  write: OWN_SCOPE,
  delete: FULL_SCOPE,
  convert: FULL_SCOPE,
};

export interface ProspectPerimeter {
  /** Le scope effectivement detenu, resolu du plus large au plus etroit. */
  readonly scope: ScopeName;
  /** Fragment de `where` Prisma. `{}` pour `any`, `{ ownerId }` pour `own`. */
  readonly where: Prisma.ProspectWhereInput;
}

/**
 * Le perimetre du porteur pour une action donnee.
 *
 * Refuse en 403 si le porteur est un compte de l'espace client, AVANT meme de
 * regarder ses permissions. Un compte CLIENT n'en detient aucune pour les
 * prospects, mais l'inverse — une permission ajoutee par erreur a ce role — ne
 * doit pas ouvrir le pipeline commercial : le role est la barriere, la
 * permission n'est que le second verrou.
 */
export function prospectPerimeter(policy: AccessPolicy, action: ProspectAction): ProspectPerimeter {
  assertInternalSpace(policy);

  const scope = policy.requireScope('prospect', action, ACTIONS[action]);

  return { scope, where: scope === SCOPE_OWN ? { ownerId: policy.userId } : {} };
}

/**
 * Refuse l'espace client, quel que soit le droit porte.
 *
 * « Un compte CLIENT ne voit JAMAIS un prospect » : c'est une exigence du cahier
 * des charges, pas une consequence indirecte de l'attribution des permissions.
 * Elle est donc verifiee sur le ROLE, ici, et pas seulement par le garde.
 */
export function assertInternalSpace(policy: AccessPolicy): void {
  if (policy.isClient()) {
    throw AppException.forbidden("L'espace client n'a pas acces au suivi commercial.");
  }
}

/**
 * Compose des fragments de `where` en `AND`, en ignorant les fragments vides.
 *
 * POURQUOI `AND` ET SURTOUT PAS UN ETALEMENT (`{ ...perimetre, ...filtres }`).
 *
 * Un etalement ecrase : si le filtre de liste porte `ownerId` et que le
 * perimetre porte deja `ownerId`, la derniere cle gagne. Un commercial a
 * `prospect:read:own` qui ajoute `?ownerId=<un collegue>` elargirait alors son
 * perimetre par un simple parametre de requete — la faille d'acces horizontal
 * exacte que ce module doit rendre impossible. En `AND`, deux contraintes
 * contradictoires ne renvoient rien : le perimetre ne peut pas etre elargi, au
 * pire la liste est vide.
 */
export function composeAnd<T>(...fragments: T[]): T[] {
  return fragments.filter((fragment) => Object.keys(fragment as object).length > 0);
}
