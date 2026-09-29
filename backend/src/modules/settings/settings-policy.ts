import { AppException } from '../../common/errors/app-error.js';

/**
 * POLITIQUE DES PARAMETRES.
 *
 * Le modele `Setting` est minimal : `key`, `value Json`, `description`, et qui a
 * modifie quoi. Il ne porte AUCUNE marque de sensibilite — et `prisma/schema.prisma`
 * n'est pas dans mon perimetre. La sensibilite est donc deduite du NOM de la cle,
 * par une convention explicite et documentee, que les tests verrouillent.
 *
 * L'erreur est choisie dans le sens prudent : on prefere cacher un parametre
 * anodin (desagrement d'affichage, l'administrateur le voit en cochant
 * `includeInternal`) que laisser passer une cle d'API dans une reponse. Un
 * parametre manquant se corrige en une minute ; un secret expose ne se rattrape
 * pas.
 *
 * Ce fichier ne touche ni la base ni Nest : ce sont des decisions pures, donc
 * testables une par une.
 */

/** Longueur maximale d'une cle. */
export const SETTING_KEY_MAX_LENGTH = 80;

/**
 * Format d'une cle : minuscules, segments separes par `.`, `-` ou `_`.
 *
 * Les majuscules sont REFUSEES plutot que corrigees : `@id` est sensible a la
 * casse, donc `Company.Name` et `company.name` seraient deux parametres
 * differents, et l'application lirait l'un en ecrivant l'autre.
 */
export const SETTING_KEY_PATTERN = /^[a-z0-9][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

/** Taille maximale d'une valeur serialisee, en caracteres JSON. */
export const SETTING_VALUE_MAX_LENGTH = 32_768;

/** Nombre maximal d'elements d'un tableau. */
export const SETTING_ARRAY_MAX_ITEMS = 200;

/** Nombre maximal de cles d'un objet imbrique. */
export const SETTING_OBJECT_MAX_KEYS = 100;

/** Longueur maximale d'une chaine. */
export const SETTING_STRING_MAX_LENGTH = 4000;

/** Profondeur maximale d'imbrication. */
export const SETTING_VALUE_MAX_DEPTH = 5;

/**
 * Marqueurs explicites, en PREFIXE de cle.
 *
 * C'est l'echappatoire volontaire : n'importe quelle cle peut etre declaree
 * interne en la nommant `internal.*` ou `private.*`, sans toucher au schema.
 */
export const INTERNAL_SETTING_PREFIXES: readonly string[] = ['internal.', 'private.'];

/**
 * Segments de cle qui designent un secret par nature.
 *
 * La comparaison porte sur le SEGMENT entier, pas sur un fragment : `bank.iban`
 * est interne, `bancaire.mode` ne l'est pas.
 */
export const INTERNAL_SETTING_SEGMENTS: readonly string[] = [
  'secret',
  'secrets',
  'password',
  'passwords',
  'passphrase',
  'token',
  'tokens',
  'key',
  'keys',
  'apikey',
  'api_key',
  'secretkey',
  'secret_key',
  'privatekey',
  'private_key',
  'signingkey',
  'signing_key',
  'accesskey',
  'access_key',
  'credential',
  'credentials',
  'dsn',
  'iban',
  'bic',
  'webhooksecret',
  'webhook_secret',
];

/**
 * Fragments qui, OU QU'ILS SOIENT dans la cle, rendent celle-ci interne.
 *
 * Volontairement restreints a des mots qui ne veulent rien dire d'autre :
 * `invoice.tokenizer` n'existe pas, `smtp.password` si.
 */
export const INTERNAL_SETTING_SUBSTRINGS: readonly string[] = [
  'secret',
  'password',
  'passphrase',
  'apikey',
  'privatekey',
  'credential',
  'token',
  'iban',
];

/** Decoupe une cle en segments sur `.`, `-` et `_`. */
export function settingSegments(key: string): string[] {
  return key
    .toLowerCase()
    .split(/[._-]+/)
    .filter((segment) => segment.length > 0);
}

/** Normalise une cle : espaces en trop retires, minuscules. */
export function normalizeSettingKey(key: string): string {
  return key.trim().toLowerCase();
}

export function isValidSettingKey(key: string): boolean {
  if (key.length === 0 || key.length > SETTING_KEY_MAX_LENGTH) {
    return false;
  }
  return SETTING_KEY_PATTERN.test(key);
}

/**
 * Valide une cle et la renvoie normalisee, ou refuse.
 *
 * Deuxieme barriere : le DTO a deja valide le format, mais le service peut etre
 * appele par un autre chemin un jour, et une cle non validee finirait en `@id`
 * de la table.
 */
export function assertSettingKey(key: string): string {
  if (!isValidSettingKey(key)) {
    throw AppException.badRequest(
      'SETTING_KEY_INVALID',
      `Cle de parametre invalide : « ${key} ». Format attendu : minuscules, segments separes par . - _ (ex. invoice.numbering.prefix).`,
    );
  }
  return normalizeSettingKey(key);
}

/**
 * Un parametre doit-il etre masque aux lecteurs non administrateurs ?
 *
 * Trois regles, dans cet ordre :
 *
 *  1. prefixe marqueur (`internal.`, `private.`) : l'integrateur a parle ;
 *  2. un segment nomme une credential (`bank.iban`, `stripe.api_key`) ;
 *  3. un fragment du nom est sans ambiguite (`smtp.password`).
 */
export function isInternalSetting(key: string): boolean {
  const normalized = normalizeSettingKey(key);

  if (INTERNAL_SETTING_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }

  const segments = settingSegments(normalized);
  if (segments.some((segment) => INTERNAL_SETTING_SEGMENTS.includes(segment))) {
    return true;
  }

  return INTERNAL_SETTING_SUBSTRINGS.some((fragment) => normalized.includes(fragment));
}

// -----------------------------------------------------------------------------
// Valeurs
// -----------------------------------------------------------------------------

/** Valeur JSON admise dans la colonne `value`. */
export type JsonScalar = string | number | boolean;
export type JsonValue =
  | JsonScalar
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function reject(message: string): never {
  throw AppException.unprocessable('SETTING_VALUE_INVALID', message);
}

/**
 * Valide et normalise une valeur de parametre.
 *
 * La colonne est `Json` : tout ce qui n'est pas serialisable en JSON doit etre
 * refuse ICI, sinon l'erreur remonterait de la base sous une forme incomprehensible
 * pour l'appelant. Sont donc refuses : `undefined`, les fonctions, les symboles,
 * les grands entiers, `NaN`, `Infinity`, et tout objet qui n'est pas un objet
 * simple (Date, Map, Set, instance de classe) — un `Date` stocke en base
 * redeviendrait une chaine a la lecture, et le parametre changerait de type tout
 * seul entre l'ecriture et la relecture.
 */
export function normalizeSettingValue(value: unknown, depth = 0): JsonValue {
  if (value === undefined) {
    reject('Valeur absente : un parametre doit avoir une valeur.');
  }

  if (value === null) {
    if (depth === 0) {
      reject('Valeur vide : utiliser une chaine vide ou supprimer le parametre.');
    }
    return null;
  }

  if (typeof value === 'string') {
    if (value.length > SETTING_STRING_MAX_LENGTH) {
      reject(`Chaine trop longue : ${value.length} caracteres, maximum ${SETTING_STRING_MAX_LENGTH}.`);
    }
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      reject('Nombre non fini : NaN et Infinity ne sont pas serialisables en JSON.');
    }
    return value;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (depth >= SETTING_VALUE_MAX_DEPTH) {
    reject(`Imbrication trop profonde : maximum ${SETTING_VALUE_MAX_DEPTH} niveaux.`);
  }

  if (Array.isArray(value)) {
    if (value.length > SETTING_ARRAY_MAX_ITEMS) {
      reject(`Tableau trop long : ${value.length} elements, maximum ${SETTING_ARRAY_MAX_ITEMS}.`);
    }
    return value.map((item) => normalizeSettingValue(item, depth + 1));
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length > SETTING_OBJECT_MAX_KEYS) {
      reject(`Objet trop large : ${keys.length} cles, maximum ${SETTING_OBJECT_MAX_KEYS}.`);
    }
    const normalized: Record<string, JsonValue> = {};
    for (const key of keys) {
      normalized[key] = normalizeSettingValue(value[key], depth + 1);
    }
    return normalized;
  }

  reject(
    `Type non serialisable en JSON (${Object.prototype.toString.call(value)}). Valeurs acceptees : chaine, nombre fini, booleen, tableau, objet simple.`,
  );
}

/** Controle la taille finale de la valeur serialisee. */
export function assertSettingValueSize(value: JsonValue): JsonValue {
  const serialized = JSON.stringify(value) ?? '';
  if (serialized.length > SETTING_VALUE_MAX_LENGTH) {
    throw AppException.unprocessable(
      'SETTING_VALUE_TOO_LARGE',
      `Valeur trop volumineuse : ${serialized.length} caracteres, maximum ${SETTING_VALUE_MAX_LENGTH}.`,
    );
  }
  return value;
}

/** Serialisation stable : cles d'objet triees, pour comparer deux valeurs. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null) ?? 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

/**
 * Deux valeurs de parametre sont-elles identiques ?
 *
 * Sert a ne PAS journaliser une modification qui n'en est pas une : l'historique
 * d'un parametre doit montrer les changements reels, pas les enregistrements de
 * formulaire sans effet. La comparaison est structurelle et insensible a l'ordre
 * des cles — `{"a":1,"b":2}` et `{"b":2,"a":1}` sont la meme valeur.
 */
export function sameSettingValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/**
 * Valeur telle qu'elle doit apparaitre dans la journalisation d'audit.
 *
 * Le journal est un fichier de traces lisible par les administrateurs : y ecrire
 * en clair la valeur d'un secret la rendrait aussitot lisible ailleurs que dans
 * le parametre, et pour toujours. On journalise donc le changement sans sa
 * valeur, et on le dit explicitement plutot que de laisser un champ vide qu'on
 * interpreterait comme « rien n'a change ».
 */
export function auditSettingValue(value: unknown, internal: boolean): unknown {
  return internal ? '[masque : parametre interne]' : value;
}
