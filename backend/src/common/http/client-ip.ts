import type { Request } from 'express';

/**
 * L'ADRESSE DU CLIENT ET SON USER-AGENT, POUR LES COLONNES QUI LES ENREGISTRENT.
 *
 * Quatre endroits ecrivent l'origine d'une requete : la session (`sessions`), le
 * journal d'audit (`audit_logs`), la signature d'un devis (`quotes.acceptedByIp`)
 * et la file des demandes de contact (`contact_requests`). Trois d'entre eux
 * portaient leur PROPRE copie de la fonction de lecture ; le quatrieme — la
 * demande de contact — n'en avait pas et lisait `request.ip` directement.
 *
 * La consequence etait deja ecrite dans son propre commentaire : « derriere un
 * reverse proxy, la colonne contiendra la meme adresse pour tout le monde ».
 * C'est exactement ce que ce fichier supprime.
 *
 * POURQUOI UN FICHIER COMMUN PLUTOT QUE QUATRE COPIES. La consigne avait ete
 * laissee dans `projects/request-meta.decorator.ts` : « A FUSIONNER dans
 * `src/common/` le jour ou un troisieme module en aura besoin. » Ce jour est
 * arrive — auth, factures, projets — et le quatrieme appelant a montre le prix
 * de l'attente : il ne suivait pas la convention des trois autres. Une regle
 * recopiee finit par n'etre respectee que trois fois sur quatre.
 *
 * CE QUE CETTE VALEUR VAUT : UN INDICE, PAS UNE PREUVE. Un en-tete HTTP se
 * falsifie. Elle sert a reconstituer une chronologie (« l'acceptation vient de
 * cette adresse »), jamais a autoriser quoi que ce soit. Aucune decision d'acces
 * ne doit lire ce fichier.
 *
 * LES DEUX MODES, ET POURQUOI LE DEFAUT NE CHANGE RIEN.
 *
 *   - `TRUST_PROXY` non renseigne (le defaut) : on lit le PREMIER element de
 *     `x-forwarded-for`, a defaut `request.ip`. C'est la convention historique du
 *     depot, et elle donne la bonne valeur derriere un proxy — au prix d'une
 *     confiance aveugle dans un en-tete qu'un client peut poser lui-meme s'il n'y
 *     a aucun proxy devant l'application.
 *   - `TRUST_PROXY` renseigne : on lit `request.ip`, qu'Express a resolu en
 *     traversant EXACTEMENT le nombre de sauts declares. C'est plus sur, et ce
 *     n'est pas qu'une question de journal : le limiteur de debit global
 *     (`ThrottlerGuard`, 120 requetes par minute) compte par `request.ip` — vu
 *     dans la source installee, son `getTracker` est `normalizeIp(req.ip)`. Proxy
 *     sans `trust proxy`, tous les visiteurs partagent donc UN SEUL compteur, et
 *     le site finit par repondre 429 a tout le monde. Symetriquement,
 *     `trust proxy` a `true` laisse un client forger une adresse par requete et
 *     echapper entierement au limiteur.
 *
 * D'ou un reglage explicite, et un defaut qui ne modifie pas le comportement
 * existant : le mode historique, qui est celui que la production utilise
 * aujourd'hui.
 */

/**
 * Longueurs BORNEES, et non contraintes de colonne.
 *
 * Les colonnes concernees sont des `TEXT` cote PostgreSQL — verifie dans le SQL
 * des migrations. Ces bornes ne reparent donc pas un depassement : elles
 * limitent ce qu'on accepte de stocker d'une valeur entierement controlee par
 * l'appelant. Sans elles, dix megaoctets d'en-tete deviennent dix megaoctets en
 * base.
 */
const MAX_IP_LENGTH = 45;
const MAX_USER_AGENT_LENGTH = 512;

/**
 * La valeur d'`app.set('trust proxy', ...)` : booleen, nombre de sauts, ou liste
 * de proxies de confiance. Express accepte ces trois formes, et `false` desactive
 * la confiance (c'est le defaut d'Express lui-meme).
 */
export type TrustProxySetting = boolean | number | string | string[];

/**
 * ETAT DE CONFIGURATION, LU PAR TOUS LES APPELANTS.
 *
 * Une variable de module plutot qu'un parametre, parce que les appelants sont des
 * DECORATEURS de parametre (`createParamDecorator`) : ils s'evaluent par requete
 * et n'ont pas d'acces naturel au conteneur d'injection. Faire descendre le
 * reglage jusqu'a eux demanderait de resoudre `ConfigService` a chaque requete
 * pour une valeur qui ne change pas apres le demarrage.
 *
 * La valeur est posee une seule fois, par `configureApp`, qui l'ecrit TOUJOURS —
 * y compris pour la remettre au defaut. C'est ce qui evite qu'une suite de tests
 * herite du reglage d'une autre.
 */
let trustProxy: TrustProxySetting = false;

/** Pose le reglage. Appele par `configureApp`, jamais par un module metier. */
export function configureClientIp(setting: TrustProxySetting): void {
  trustProxy = setting;
}

/** `true` si Express resout `request.ip` en traversant des sauts de confiance. */
export function isTrustingProxy(): boolean {
  if (trustProxy === false) return false;
  if (trustProxy === true) return true;
  if (typeof trustProxy === 'number') return trustProxy > 0;
  if (Array.isArray(trustProxy)) return trustProxy.length > 0;
  const trimmed = trustProxy.trim();
  return trimmed.length > 0 && trimmed !== 'false';
}

/**
 * Traduit `TRUST_PROXY` en la valeur attendue par Express.
 *
 * POURQUOI UNE CHAINE EN ENTREE, ET NON UN BOOLEEN. `EnvironmentVariables` est
 * rempli avec `enableImplicitConversion`, ou `'false'` devient `true` — la meme
 * inversion que celle corrigee dans `common/dto/boolean-filter.ts`. Un champ
 * booleen ici lirait donc « false » comme « faire confiance a tout le monde »,
 * c'est-a-dire l'inverse exact de la demande. Le champ est une chaine, et la
 * traduction est faite ici, une fois.
 *
 * Ce qui est accepte : `false`/`off`/`no`/`0`/vide, `true`/`on`/`yes`, un nombre
 * de sauts, ou une liste separee par des virgules de `loopback`, `linklocal`,
 * `uniquelocal` et d'adresses ou de plages CIDR. Toute autre valeur leve : le
 * processus refuse de demarrer avec un reglage qui n'en est pas un.
 */
export function parseTrustProxy(raw: string): TrustProxySetting {
  const value = raw.trim();
  const lowered = value.toLowerCase();

  if (
    value.length === 0 ||
    lowered === 'false' ||
    lowered === 'off' ||
    lowered === 'no' ||
    value === '0'
  ) {
    return false;
  }

  if (lowered === 'true' || lowered === 'on' || lowered === 'yes') {
    return true;
  }

  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  const tokens = value
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  for (const token of tokens) {
    if (!isRecognisedProxyToken(token)) {
      throw new Error(
        `TRUST_PROXY : « ${token} » n'est pas un proxy reconnu. Attendu : false, true, ` +
          'un nombre de sauts, ou une liste de « loopback », « linklocal », « uniquelocal », ' +
          "d'adresses IP ou de plages CIDR separees par des virgules.",
      );
    }
  }

  return tokens;
}

/**
 * Reconnait les formes qu'Express sait compiler, sans reimplementer sa logique.
 *
 * Le controle est volontairement GROSSIER : il attrape la faute de frappe
 * (`garbage`, `proxy-interne`) avant que le processus ne demarre, et laisse
 * Express valider finement une adresse ou une plage. Les caracteres autorises
 * sont ceux d'une IP v6, d'une IP v4 et d'un CIDR — hexadecimaux, deux-points,
 * point et barre oblique.
 */
function isRecognisedProxyToken(token: string): boolean {
  const lowered = token.toLowerCase();
  if (lowered === 'loopback' || lowered === 'linklocal' || lowered === 'uniquelocal') {
    return true;
  }
  return /^[0-9a-f.:/]+$/i.test(token);
}

/**
 * Le premier element de `x-forwarded-for`, quand il existe.
 *
 * Exporte parce que les appelants qui ont besoin de la valeur BRUTE — sans le
 * mode `TRUST_PROXY` — doivent lire la meme chose que ce module, et non
 * reecrire la lecture de l'en-tete.
 */
export function firstForwardedIp(request: Request): string | null {
  const header = request.headers['x-forwarded-for'];
  const raw = Array.isArray(header) ? header[0] : header;

  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }

  const first = raw.split(',')[0]?.trim();
  return first && first.length > 0 ? first : null;
}

/**
 * L'adresse du client, selon le mode configure.
 *
 * Le prefixe `::ffff:` est retire : c'est la forme que prend une adresse IPv4 vue
 * par une socket IPv6, et le conserver ferait apparaitre deux notations pour la
 * meme adresse selon la pile reseau du serveur.
 */
export function clientIp(request: Request): string | null {
  if (isTrustingProxy()) {
    return normalizeIp(request.ip);
  }

  return normalizeIp(firstForwardedIp(request) ?? request.ip);
}

/** L'en-tete `User-Agent`, borne. `null` plutot qu'une chaine vide. */
export function clientUserAgent(request: Request): string | null {
  const header = request.headers['user-agent'];
  const raw = Array.isArray(header) ? header[0] : header;

  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, MAX_USER_AGENT_LENGTH);
}

/**
 * 45 caracteres n'est pas un nombre choisi au hasard : c'est la longueur de la
 * plus longue adresse IPv6 ecrite en toutes lettres, avec une IPv4 embarquee.
 * Une adresse reelle ne peut donc pas etre tronquee — seules les valeurs qui ne
 * sont pas des adresses le sont.
 */
function normalizeIp(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const stripped = value.trim().replace(/^::ffff:/i, '');
  return stripped.length === 0 ? null : stripped.slice(0, MAX_IP_LENGTH);
}
