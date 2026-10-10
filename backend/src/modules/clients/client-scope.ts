import { SCOPE_ANY, type AccessPolicy, type ScopeName } from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
// `composeAnd` est une regle de surete, pas un utilitaire de confort : deux
// copies divergeraient le jour ou l'une serait corrigee. Il est donc DEFINI une
// seule fois, dans `prospects/prospect-scope.ts`, et simplement REEXPORTE ici
// (voir la derniere ligne de ce fichier). `client-scope.spec.ts` verifie
// l'identite des deux references — pas seulement l'egalite de leur
// comportement — donc la propriete est tenue par un test, pas par ce commentaire.
//
// CE BLOC A DIT LE CONTRAIRE, ET C'ETAIT FAUX. Il justifiait cet emplacement par
// l'impossibilite d'ecrire dans `src/common/`, presente comme « hors perimetre de
// cette livraison ». Or `src/common/` compte une trentaine de fichiers et
// `src/common/dto/` accueille deja des aides partagees (`boolean-filter.ts`,
// `pagination.dto.ts`) : ce dossier n'a jamais ete hors perimetre. La vraie raison
// est plus prosaique : le deplacement vers `src/common/dto/where.dto.ts`, qui
// reste sa place logique, n'a pas ete fait. C'est un rangement en attente, pas
// une contrainte subie — et la difference compte pour qui lira ce fichier.
import { composeAnd } from '../prospects/prospect-scope.js';

/**
 * PERIMETRE DES CLIENTS ET DES CONTACTS.
 *
 * EXIGENCE DU CAHIER DES CHARGES, citee mot pour mot :
 *
 *   « Un client ne doit jamais pouvoir modifier l'ID d'un autre client dans une
 *     requete pour acceder a ses donnees. »
 *
 * Ce fichier est la reponse a cette phrase, et il la prend au sens strict :
 *
 *  1. POUR UN PORTEUR DU ROLE CLIENT, L'IDENTIFIANT VIENT DU JETON, JAMAIS DU
 *     CHEMIN. `policy.clientId` remplace l'identifiant fourni par la requete.
 *     Le parametre d'URL n'est pas « verifie apres coup » : il est simplement
 *     absent de la requete SQL. Un chemin d'appel qui oublierait une
 *     verification n'aurait donc rien a oublier.
 *
 *  2. LE FILTRE VA DANS LE `where` PRISMA. Le perimetre est une contrainte de
 *     LECTURE ET D'ECRITURE : `updateMany` et `deleteMany` le portent aussi, donc
 *     une ligne hors perimetre ne peut pas etre modifiee — meme si elle etait
 *     lue par erreur.
 *
 *  3. UN COMPTE CLIENT SANS RATTACHEMENT EST REFUSE EN 403. C'est une
 *     incoherence de donnees : son perimetre serait vide, et le seul moyen de
 *     continuer serait de se rabattre sur un identifiant venu de la requete —
 *     exactement ce qu'il ne faut pas faire. On refuse, on ne devine pas.
 *
 * Consequence assumee : une tentative d'acces a la fiche d'un autre client ne
 * renvoie pas 403 mais 404 — la fiche n'existe pas DANS LE PERIMETRE. C'est le
 * resultat direct d'un filtre pose dans le `where`, et c'est le bon resultat :
 * un 403 distinct confirmerait au passage l'existence de la ligne visee.
 */

export type ClientResource = 'client' | 'contact';
export type ClientAction = 'read' | 'write';

/** Du plus large au plus etroit. Aucun scope `own` n'existe hors espace client. */
const FULL_SCOPE: readonly ScopeName[] = [SCOPE_ANY];

/**
 * Le rattachement du porteur, ou un refus.
 *
 * Les ecritures de l'espace client sont refusees ici, sur le ROLE et non sur la
 * permission : le catalogue ne donne aujourd'hui aucune ecriture au role CLIENT,
 * et cette fonction garantit que l'ajouter demain par erreur ne suffirait pas a
 * lui faire modifier le dossier d'un autre. Les contacts du CRM sont tenus par
 * l'agence : un client les lit, il ne les corrige pas.
 */
function ownClientId(policy: AccessPolicy, action: ClientAction): string {
  if (action === 'write') {
    throw AppException.forbidden(
      "L'espace client ne modifie pas son dossier : ces informations sont tenues par l'agence.",
    );
  }

  const own = policy.clientId;

  if (!own) {
    throw AppException.forbidden(
      "Ce compte client n'est rattache a aucun dossier : signalez-le a l'agence.",
    );
  }

  return own;
}

/**
 * Perimetre sur la table des clients.
 *
 * `resource` est la ressource dont la PERMISSION autorise l'action, pas la table
 * interrogee : la creation d'un contact passe par `contact:write:any` et doit
 * d'abord s'assurer que le client vise existe. Le `where` rendu, lui, est
 * toujours un perimetre de donnees.
 */
export function clientPerimeter(
  policy: AccessPolicy,
  resource: ClientResource,
  action: ClientAction,
): Prisma.ClientWhereInput {
  if (policy.isClient()) {
    return { id: ownClientId(policy, action) };
  }

  policy.requireScope(resource, action, FULL_SCOPE);
  return {};
}

/**
 * Perimetre sur la table des contacts.
 *
 * Le filtre porte `clientId` — c'est la seule colonne qui rattache un contact a
 * un dossier. Un porteur de l'espace client ne peut donc atteindre que les
 * contacts de SON client, quel que soit l'identifiant present dans l'URL.
 */
export function contactPerimeter(
  policy: AccessPolicy,
  resource: ClientResource,
  action: ClientAction,
): Prisma.ContactWhereInput {
  if (policy.isClient()) {
    return { clientId: ownClientId(policy, action) };
  }

  policy.requireScope(resource, action, FULL_SCOPE);
  return {};
}

export { composeAnd };
