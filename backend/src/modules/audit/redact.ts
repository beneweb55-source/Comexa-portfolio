import type { Prisma } from '../../generated/prisma/client.js';

/**
 * MASQUAGE DES SECRETS DANS LE JOURNAL D'AUDIT.
 *
 * POURQUOI CE FICHIER EXISTE.
 *
 * `before` et `after` sont ecrits par les services metier, et ils sont ecrits
 * pour ETRE RELUS : c'est tout l'interet d'un journal — savoir ce qui a change,
 * de quoi a quoi. Personne n'y met volontairement un mot de passe. Mais personne
 * ne les relit avant de les ecrire non plus, et un jour quelqu'un journalisera
 * `{ ...dto }` ou `{ ...user }` pour aller vite. Le jour ou cela arrive, un
 * secret se retrouve dans une table qui, elle, n'expire jamais, que l'on exporte
 * pour les audits, et que l'on restaure dans les environnements de recette.
 *
 * La seule protection qui tienne est donc au moment de la SORTIE : quoi qu'il y
 * ait dans la colonne, ce que l'API rend est filtre. Le masquage est volontaire -
 * large, quitte a masquer une valeur inoffensive. Un faux positif coute une
 * colonne illisible dans une ligne de journal ; un faux negatif coute un mot de
 * passe.
 *
 * CE QUI EST MASQUE : les cles dont le nom trahit un secret, OU QU'ELLES SOIENT —
 * a n'importe quelle profondeur, y compris dans les tableaux. Un filtre qui ne
 * regarderait que le premier niveau laisserait passer `{ user: { passwordHash } }`,
 * c'est-a-dire exactement la forme que prend un objet Prisma recopie tel quel.
 *
 * CE QUI N'EST PAS MASQUE, ET POURQUOI.
 *
 * `sessionsRevoked` n'est pas masque, alors qu'il contient « session ». Le motif
 * ne cherche donc pas le mot `session` : c'est un COMPTE, et le masquer priverait
 * l'auditeur de la seule information qui dise combien de sessions ont ete
 * fermees. Les identifiants de session qui, eux, sont des capacites — un refresh
 * token, un jeton d'acces — portent le mot `token` et sont filtres par ce motif.
 * Retenir `session` couterait une donnee utile pour couvrir un cas que `token`
 * couvre deja.
 *
 * `mustChangePassword` EST masque, parce qu'il contient « pass ». C'est un faux
 * positif assume : la valeur est un booleen, sa perte ne coute rien. Et cela
 * preserve une propriete utile — dans les charges utiles ECRITES PAR CE MODULE,
 * aucune cle ne contient « pass » ; une cle masquee y est donc toujours le signe
 * qu'un service a journalise quelque chose qu'il n'aurait pas du.
 */

/** Ce qui remplace une valeur masquee. Explicite : une chaine vide ferait croire a une absence. */
export const MASK = '[masque]';

/** Ce qui remplace un objet trop profond. Voir `MAX_DEPTH`. */
export const TRUNCATED = '[profondeur maximale atteinte]';

/**
 * Profondeur maximale de parcours.
 *
 * Une charge utile ecrite a la main ne depasse pas trois ou quatre niveaux. Huit
 * laisse de la marge, et garantit qu'un cycle — impossible depuis JSON, mais
 * possible si un appelant construit l'objet a la main — ne fera pas exploser la
 * pile au milieu d'une reponse HTTP.
 */
const MAX_DEPTH = 8;

/**
 * Motifs interdits, cherches sur le nom de cle NORMALISE.
 *
 * Normaliser, c'est retirer tout ce qui n'est ni lettre ni chiffre et passer en
 * minuscules : `password_hash`, `passwordHash`, `Password-Hash` et
 * `x-api-key` deviennent respectivement `passwordhash`, `passwordhash`,
 * `passwordhash` et `xapikey`. Sans ce nettoyage, il faudrait une expression
 * differente par convention de nommage — et la premiere qui manquerait serait
 * celle qu'un service utiliserait.
 */
const SENSITIVE_KEY =
  /pass|pwd|secret|token|hash|credential|authorization|authheader|cookie|privatekey|apikey|accesskey|signingkey|salt|signature|bearer/;

/**
 * Un JWT : trois segments separes par des points, le premier commencant par
 * `eyJ` (l'en-tete `{"alg":...}` encode en base64url).
 *
 * Cette verification porte sur la VALEUR, pas sur la cle, et c'est le seul cas ou
 * c'est le cas. Un jeton colle dans un champ libre — une note, un motif de refus,
 * un commentaire — ne serait attrape par aucun nom de cle. La forme d'un JWT est
 * assez particuliere pour ne pas se confondre avec du texte ordinaire, et le
 * prefixe `eyJ` la rend reconnaissable sans ambiguite.
 */
const JWT_VALUE = /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

/** `Authorization: Bearer <jeton>` recopie tel quel dans une valeur. */
const BEARER_VALUE = /^bearer\s+\S+/i;

/** Une valeur JSON, apres passage dans le filtre. */
export type RedactedValue =
  string | number | boolean | null | RedactedValue[] | { [key: string]: RedactedValue };

/** Vrai si le nom de cle trahit un secret. Exporte pour etre teste directement. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key.replace(/[^a-z0-9]/gi, '').toLowerCase());
}

/** Vrai si la valeur ressemble a un jeton, quelle que soit la cle qui la porte. */
export function looksLikeCredential(value: string): boolean {
  return JWT_VALUE.test(value) || BEARER_VALUE.test(value);
}

/**
 * Masque recursivement les secrets d'une charge utile.
 *
 * L'ordre teste est : la cle d'abord, la valeur ensuite. C'est ce qui fait
 * qu'une cle franchement sensible est masquee meme si sa valeur est inoffensive,
 * et qu'une valeur ressemblant a un jeton est masquee meme sous une cle anodine.
 */
export function redactJson(value: unknown, depth = 0): RedactedValue {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string') {
    return looksLikeCredential(value) ? MASK : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  // Les autres scalaires ne viennent pas de JSON, mais un appelant peut en
  // passer. `BigInt` est le seul qui ferait lever `JSON.stringify` : le rendre
  // en texte coute une ligne et evite de transformer une reponse de journal en
  // erreur 500.
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (depth >= MAX_DEPTH) {
    return TRUNCATED;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactJson(item, depth + 1));
  }

  if (typeof value === 'object') {
    const output: { [key: string]: RedactedValue } = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = isSensitiveKey(key) ? MASK : redactJson(item, depth + 1);
    }
    return output;
  }

  // `undefined`, fonction, symbole : rien de tout cela ne sort d'une colonne
  // JSON. Rendre `null` plutot que de laisser la propriete disparaitre garde la
  // forme de l'objet lisible.
  return null;
}

/** Le champ `before` ou `after`, tel qu'il part dans la reponse. */
export function redactPayload(value: Prisma.JsonValue | null | undefined): RedactedValue {
  return value === null || value === undefined ? null : redactJson(value);
}
