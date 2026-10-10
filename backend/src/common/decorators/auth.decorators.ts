import {
  SetMetadata,
  createParamDecorator,
  type CustomDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/principal.js';
import { AppException } from '../errors/app-error.js';

/**
 * Decorateurs d'authentification et d'autorisation.
 *
 * Ils ne font que POSER une metadonnee sur le gestionnaire de route. La decision
 * est prise par les gardes (`access.guards.ts`), qui la lisent. Cette separation
 * est ce qui permet de tester une regle d'acces sans monter un serveur HTTP.
 */

/** Cle sous laquelle le porteur est attache a la requete. */
export const REQUEST_USER_KEY = 'authenticatedUser';

type RequestWithUser = Request & { [REQUEST_USER_KEY]?: AuthenticatedUser };

/** Le porteur, ou `undefined` si la requete est anonyme. */
export function userFromRequest(request: unknown): AuthenticatedUser | undefined {
  return (request as RequestWithUser | undefined)?.[REQUEST_USER_KEY];
}

/**
 * Le porteur de la requete. A utiliser sur une route PROTEGEE.
 *
 * Leve si l'utilisateur est absent. C'est volontaire : une route protegee dont
 * le gestionnaire recoit `undefined` compilerait, puis echouerait a l'execution
 * sur un `user.id` — ou pire, servirait des donnees sans porteur. Mieux vaut un
 * refus net, immediatement, avec la bonne cause.
 *
 * `@Public()` et `@CurrentUser()` sont incompatibles en pratique : sur une route
 * publique, utiliser `@CurrentUserOptional()`.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const user = userFromRequest(context.switchToHttp().getRequest<unknown>());
    if (!user) {
      throw AppException.unauthenticated();
    }
    return user;
  },
);

/**
 * Le porteur s'il existe, sinon `undefined`.
 *
 * Pour les routes publiques dont le comportement depend de l'identite : un
 * formulaire de contact rempli par un client connecte n'est pas tout a fait le
 * meme evenement qu'un formulaire rempli par un anonyme.
 */
export const CurrentUserOptional = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined => {
    return userFromRequest(context.switchToHttp().getRequest<unknown>());
  },
);

export const PERMISSIONS_ALL_KEY = 'requiredPermissionsAll';
export const PERMISSIONS_ANY_KEY = 'requiredPermissionsAny';
export const ALLOW_PASSWORD_CHANGE_REQUIRED_KEY = 'allowPasswordChangeRequired';
/** Route de LISTE dont le service restreint les lignes : tout compte authentifie y accede. */
export const SCOPED_BY_SERVICE_KEY = 'scopedByService';

/**
 * Autorise cette route meme si un changement de mot de passe est du.
 *
 * Le cas typique : un compte cree par un administrateur, qui connait donc le mot
 * de passe initial. Tant qu'il n'a pas ete change, TOUT est ferme — sauf les
 * routes qui permettent justement de sortir de cet etat et celles qui servent a
 * savoir ou l'on en est.
 *
 * TROIS ROUTES LE PORTENT, et la liste est verifiee dans
 * `auth.controller.ts` : `POST /auth/logout-all`, `POST /auth/change-password` et
 * `GET /auth/me`. Cette liste avait derive — elle citait `/auth/logout` et
 * `/auth/refresh`, qui n'en ont pas besoin puisqu'ils sont `@Public()` et que le
 * garde les laisse donc passer avant de regarder ce drapeau. Citer une route qui
 * n'est pas concernee est pire que de n'en citer aucune : cela fait croire que la
 * liste a ete relue.
 *
 * Sans ce mecanisme, `mustChangePassword` ne serait qu'un drapeau transmis au
 * frontend, c'est-a-dire exactement ce que le cahier des charges interdit :
 * « ne te limite pas a cacher des boutons cote frontend ». Un appel direct a
 * l'API passerait outre. Ici, c'est le serveur qui refuse.
 */
export const AllowPasswordChangeRequired = (): CustomDecorator<string> =>
  SetMetadata(ALLOW_PASSWORD_CHANGE_REQUIRED_KEY, true);

/**
 * Exige TOUS ces codes de permission.
 *
 * Les codes sont ecrits en clair plutot qu'importes depuis le catalogue : un
 * controleur oblige a importer tout le catalogue perdrait sa lisibilite. Le
 * typage est rattrape autrement — `permissions.catalogue.spec.ts` verifie que
 * tous les codes references par les controleurs existent reellement. Un code
 * mal orthographie fait donc echouer la suite de tests, au lieu de refuser un
 * acces legitime en production sans que personne ne comprenne pourquoi.
 *
 * CE QUE CE TEST COUVRE, ET SA LIMITE. Il lit les decorateurs
 * `@RequirePermissions` et `@RequireAnyPermission` du projet, les appels
 * `requireScope('resource', 'action', [...])` dont les arguments sont
 * entierement litteraux, et les attributions de `ROLE_PERMISSIONS`. Il ne voit
 * PAS un code atteint par une constante (la liste de portees d'un `ACTIONS[...]`)
 * ni un `policy.has('...')` : le balayage est textuel et ne resout rien a
 * l'execution. Un code juste passe donc ce test sans y avoir ete confronte.
 *
 * Le typage des codes est donc verifie A LA COMPILATION DU PROJET, pas a
 * l'execution : `PermissionsGuard` reste la seule barriere reelle, et il repond
 * 403 sur un code que le catalogue ne declare pas.
 */
export const RequirePermissions = (...codes: string[]): CustomDecorator<string> =>
  SetMetadata(PERMISSIONS_ALL_KEY, codes);

/**
 * Exige AU MOINS UN de ces codes.
 *
 * Cas typique : une route de lecture ouverte au chef de projet (`:any`) et au
 * developpeur affecte (`:assigned`). Le garde laisse passer les deux ; c'est le
 * service qui restreint ensuite les lignes renvoyees, selon le scope reellement
 * detenu. Le garde autorise la ROUTE, le service restreint les DONNEES.
 */
export const RequireAnyPermission = (...codes: string[]): CustomDecorator<string> =>
  SetMetadata(PERMISSIONS_ANY_KEY, codes);

/**
 * Liste « mes … » : tout compte authentifie peut appeler la route. Le garde ne
 * decide rien ; le SERVICE renvoie la page vide si le compte n'a aucun droit sur
 * ce type de donnees (ex. un visiteur inscrit qui n'a pas encore commande). Un
 * 403 ici casserait l'espace client avant la premiere commande.
 *
 * A reserver aux listes dont le service applique deja un perimetre explicite.
 */
export const ScopedByService = (): CustomDecorator<string> =>
  SetMetadata(SCOPED_BY_SERVICE_KEY, true);
