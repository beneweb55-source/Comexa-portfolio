import { AppException } from '../../common/errors/app-error.js';
import { DocumentVisibility } from '../../generated/prisma/enums.js';

/**
 * LA REGLE DE VISIBILITE, ISOLEE ET PURE.
 *
 * Exigence du client, mot pour mot : « Le client ne doit pas voir les documents
 * internes. » C'est la regle la plus facile a casser de ce module, parce que le
 * porteur CLIENT detient `document:read:client` : la ROUTE s'ouvre donc pour
 * lui, et c'est le FILTRE qui protege. Une permission ne suffit jamais — elle
 * dit « tu peux appeler cette route », pas « tu peux voir ces lignes ».
 *
 * La regle est ecrite ici, hors de tout service et de toute dependance Nest,
 * pour trois raisons :
 *
 *   1. elle se teste en une seconde, sans base de donnees ni serveur ;
 *   2. il n'existe qu'UN endroit a relire pour verifier qu'un client ne voit
 *      pas l'interne, au lieu de quatre `where` disperses ;
 *   3. elle prend un objet simple, pas un `AuthenticatedUser`. Un service qui
 *      la contourne doit ecrire explicitement de quoi il parle, ce qui se voit
 *      en revue.
 */

/** Le role CLIENT, lu hors de Prisma pour que ce fichier reste pur. */
const CLIENT_ROLE_MARKER = 'CLIENT';

/** Ce qu'un porteur apporte a la decision. */
export interface DocumentAccessSubject {
  /** Vrai si le porteur appartient a l'espace client. */
  readonly isClient: boolean;
  /** Le dossier client du porteur, `null` pour un compte interne. */
  readonly clientId: string | null;
  readonly permissions: ReadonlySet<string>;
}

/**
 * Les trois facons de lire des documents.
 *
 *  - `any`    : tout, y compris les documents internes de tous les clients.
 *  - `own`    : tout, y compris internes, mais sur les projets ou l'on
 *               travaille. C'est le scope des equipes projet.
 *  - `client` : les documents PARTAGEABLES du dossier client du porteur,
 *               jamais l'interne.
 */
export type DocumentAccessScopeName = 'any' | 'own' | 'client';

export interface DocumentAccessScope {
  readonly scope: DocumentAccessScopeName;
  /** Visibilites lisibles. Ne contient JAMAIS `INTERNAL` pour un porteur CLIENT. */
  readonly visibilities: readonly DocumentVisibility[];
  /** Restriction au dossier client, `null` pour un porteur interne. */
  readonly clientId: string | null;
}

/**
 * Les visibilites qu'un porteur CLIENT peut lire.
 *
 * `INTERNAL` n'y figure pas, et cette constante n'est jamais construite a
 * partir du jeu de permissions : c'est la garantie structurelle du module. La
 * faire dependre du catalogue la rendrait fausse le jour ou quelqu'un ajoute
 * une permission a un role, et personne ne verrait l'interne reapparaitre dans
 * l'espace client.
 */
export const CLIENT_VISIBILITIES: readonly DocumentVisibility[] = Object.freeze([
  DocumentVisibility.CLIENT,
  DocumentVisibility.PUBLIC,
]);

/** Toutes les visibilites, pour un porteur interne autorise. */
export const ALL_VISIBILITIES: readonly DocumentVisibility[] = Object.freeze([
  DocumentVisibility.INTERNAL,
  DocumentVisibility.CLIENT,
  DocumentVisibility.PUBLIC,
]);

/**
 * Resout ce que ce porteur peut lire.
 *
 * ORDRE DES VERIFICATIONS, ET IL COMPTE.
 *
 * Le role CLIENT est teste EN PREMIER, avant les permissions. Un compte client
 * qui se verrait attribuer `document:read:any` par erreur — ou par une
 * attribution de role trop large ajoutee six mois plus tard — reste confine a
 * ses documents partageables. Verifier les permissions d'abord ferait dependre
 * l'isolation d'une donnee de configuration, or c'est exactement ce qui derive
 * sans que personne ne s'en apercoive.
 *
 * Leve `FORBIDDEN` quand aucun scope n'est detenu : une route ouverte par
 * erreur ne doit pas servir de donnees, et le refus doit etre un refus, pas une
 * liste vide.
 */
export function resolveDocumentAccess(subject: DocumentAccessSubject): DocumentAccessScope {
  if (subject.isClient) {
    // Un compte client sans dossier client ne peut rien lire : sans cette
    // ligne, le filtre `clientId: null` se traduirait par « aucun filtre » et
    // ouvrirait la bibliotheque entiere. C'est le genre de valeur absente qui
    // transforme une restriction en autorisation.
    if (!subject.clientId) {
      throw forbiddenAccess("Ce compte client n'est rattache a aucun dossier.");
    }

    return { scope: 'client', visibilities: CLIENT_VISIBILITIES, clientId: subject.clientId };
  }

  if (subject.permissions.has('document:read:any')) {
    return { scope: 'any', visibilities: ALL_VISIBILITIES, clientId: null };
  }

  if (subject.permissions.has('document:read:own')) {
    // Les projets ou le porteur travaille sont resolus par le service : cela
    // demande une lecture en base, et cette fonction doit rester pure.
    return { scope: 'own', visibilities: ALL_VISIBILITIES, clientId: null };
  }

  if (subject.permissions.has('document:read:client')) {
    if (!subject.clientId) {
      throw forbiddenAccess(
        'La lecture des documents partages exige un dossier client rattache au compte.',
      );
    }

    return { scope: 'client', visibilities: CLIENT_VISIBILITIES, clientId: subject.clientId };
  }

  throw forbiddenAccess('Droit insuffisant pour lire des documents.');
}

/**
 * Reintroduit le role CLIENT dans le sujet, depuis une liste de roles.
 *
 * Le marqueur `CLIENT_ROLE_MARKER` est declare ici plutot qu'importe du
 * catalogue de roles : ce fichier doit rester testable sans charger la table
 * des roles, et la valeur est un contrat de la base, pas une convention locale.
 */
export function isClientRole(roles: readonly string[]): boolean {
  return roles.includes(CLIENT_ROLE_MARKER);
}

/**
 * Restreint les visibilites autorisees a celle que l'appelant DEMANDE.
 *
 * Le filtre ne peut que RETRECIR. Sans filtre, le porteur obtient tout ce a
 * quoi il a droit ; avec un filtre, il obtient l'intersection. `?visibility=`
 * ne peut donc jamais elargir ce qu'un porteur CLIENT voit, meme envoye a la
 * main dans l'URL.
 *
 * Un filtre HORS des visibilites autorisees leve `FORBIDDEN` (403) — ni 422, ni
 * une liste vide. Le choix n'est pas cosmetique :
 *
 *  - ce n'est pas une demande incoherente, c'est une demande a laquelle le
 *    porteur n'a PAS DROIT. Un 422 repondrait « votre requete est malformee »
 *    la ou le probleme est un droit manquant. 403 est aussi le refus deja
 *    employe par `resolveDocumentAccess` plus haut : les deux refus de ce
 *    fichier parlent donc d'une seule voix, et le frontend n'a qu'un code a
 *    traiter ;
 *  - une liste vide serait PIRE que les deux. Un ecran qui demanderait
 *    `INTERNAL` pour tout le monde afficherait « aucun document », et personne
 *    ne saurait si la base est vide ou si la demande est fautive. Le refus
 *    explicite fait remonter le bogue d'appel au lieu de le masquer.
 *
 * Ce 403 ne revele rien : il confirme seulement qu'un NIVEAU de visibilite
 * existe — valeur publique dans la documentation OpenAPI — et jamais qu'un
 * document existe. C'est ce qui le distingue de la doctrine IDOR du projet
 * (« 404, jamais 403 »), laquelle protege l'existence d'une LIGNE : ici, aucune
 * ligne n'est lue avant le refus.
 *
 * NOTE : ce commentaire a annonce un 422 et une liste vide ; ni l'un ni l'autre
 * n'a jamais ete le comportement. Le comportement est un 403 depuis l'origine
 * (« refuse un client qui demande les documents internes »), et c'est donc le
 * commentaire qui etait faux — pas le code.
 */
export function narrowVisibilities(
  allowed: readonly DocumentVisibility[],
  requested: DocumentVisibility | undefined,
): readonly DocumentVisibility[] {
  if (requested === undefined) {
    return allowed;
  }

  if (!allowed.includes(requested)) {
    throw forbiddenAccess(`Vous ne pouvez pas consulter les documents de visibilite ${requested}.`);
  }

  return [requested];
}

/**
 * Un refus d'acces, toujours sous la meme forme.
 *
 * `AppException.forbidden` prend UN SEUL argument : le message. Le code
 * (`FORBIDDEN`) est celui du catalogue, il ne se choisit pas ici.
 */
function forbiddenAccess(message: string): AppException {
  return AppException.forbidden(message);
}
