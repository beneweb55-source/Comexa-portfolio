/**
 * IDEMPOTENCE DES CREATIONS — LES REGLES PURES.
 *
 * -----------------------------------------------------------------------------
 * LE PROBLEME, TEL QU'IL SE POSE VRAIMENT
 * -----------------------------------------------------------------------------
 * n8n rejoue. Un workflow qui expire cote client (timeout reseau, redemarrage du
 * conteneur, retry du noeud HTTP) repart de zero : la meme requete est renvoyee,
 * et le serveur — qui, lui, a tres bien pu la traiter — cree une DEUXIEME tache.
 * L'operateur voit deux fois la meme ligne et perd confiance dans l'automatism.
 *
 * La parade est un identifiant d'idempotence : le client genere une cle par
 * OPERATION LOGIQUE (une cle par tache a creer, pas une cle par essai), et la
 * renvoie a chaque tentative. Le serveur reconnait la cle et rejoue la reponse
 * au lieu de reexecuter l'ecriture.
 *
 * -----------------------------------------------------------------------------
 * CE FICHIER NE CONTIENT QUE DES REGLES, SANS BASE NI FRAMEWORK
 * -----------------------------------------------------------------------------
 * Tout ce qui est testable sans serveur est ici — validation de la cle, empreinte
 * du corps, duree de conservation. L'intercepteur qui les applique vit a cote et
 * reste une simple mecanique d'enregistrement. La consequence pratique : les
 * regles sont verifiees par `npm test`, sans PostgreSQL.
 */
import { createHash } from 'node:crypto';

/** En-tete porte par l'appelant. Les en-tetes HTTP sont insensibles a la casse. */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

/** En-tete pose par le serveur quand il rejoue une reponse au lieu de reecrire. */
export const IDEMPOTENCY_REPLAY_HEADER = 'idempotency-replayed';

/**
 * Duree de conservation d'une cle : 24 heures.
 *
 * Assez pour absorber une panne de n8n pendant la nuit et le rejeu du matin ;
 * pas assez pour transformer la table en archive. Au-dela, une cle rejoueue est
 * traitee comme neuve : mieux vaut une creation en double, tardive et explicable,
 * qu'une reponse ressuscitee d'une semaine qui ne correspond plus a rien.
 */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Longueur maximale d'une cle. Au-dela, c'est un abus ou une erreur de client. */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

/** Motif accepte : lettres, chiffres, tirets et soulignes. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,}$/;

/**
 * Normalise la cle presentee par l'appelant.
 *
 * RENVOIE `null` AU LIEU DE JETER : l'intercepteur decide du statut HTTP et du
 * message, ce fichier ne connait ni l'un ni l'autre. Une cle invalide n'est pas
 * une erreur technique, c'est une requete mal formee — 400, donc.
 */
export function normalizeIdempotencyKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  const key = raw.trim();
  if (key.length === 0) return null;
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) return null;
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) return null;

  return key;
}

/**
 * Empreinte du corps de la requete.
 *
 * POURQUOI UNE EMPREINTE, ET PAS UNE COMPARAISON DE CHAINE. Deux appels peuvent
 * envoyer le meme corps avec un ordre de cles different, ou avec le meme contenu
 * mais des espaces differents : la comparaison brutale verrait une difference et
 * refuserait un rejeu legitime. L'ordre des cles est donc fixe avant le hachage.
 *
 * POURQUOI CETTE EMPREINTE EST INDISPENSABLE. Une cle rejouee avec un AUTRE
 * corps est un conflit : « cree la tache A » puis « cree la tache B » avec la
 * meme cle. Repondre le premier resultat au second appel serait mentir ; le
 * serveur refuse donc en 422, et le client doit generer une nouvelle cle.
 */
export function fingerprintOf(body: unknown): string {
  return createHash('sha256').update(stableJson(body)).digest('hex');
}

/** Serialisation stable : les cles d'objet sont triees, a tous les niveaux. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
}

/** La date d'expiration d'une cle, calculee une seule fois. */
export function idempotencyExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + IDEMPOTENCY_TTL_MS);
}
