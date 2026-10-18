import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * JETONS D'INTEGRATION — regles pures, sans base ni framework.
 *
 * Ce fichier ne connait ni Prisma ni Nest : il rend des decisions testables
 * seules (« ce jeton a-t-il la bonne forme ? », « cette empreinte est-elle la
 * sienne ? »). C'est ce qui permet de verifier la mecanique la plus sensible —
 * le hachage et la comparaison — sans monter une base de donnees.
 *
 * -------------------------------------------------------------------------
 * POURQUOI SHA-256 ET NON ARGON2/BCRYPT
 * -------------------------------------------------------------------------
 * Argon2 et bcrypt servent a ralentir le cassage d'un secret DEVINABLE : un mot
 * de passe choisi par une personne. Ici le secret fait 32 octets tires d'un
 * generateur cryptographique — il y a 2^256 possibilities et rien a deviner. Une
 * fonction lente ne protegerait donc rien de plus, et couterait son temps de
 * calcul a CHAQUE requete, sur le chemin le plus chaud de l'API.
 *
 * La contrepartie est une contrainte, et elle est tenue ici : ce mecanisme
 * n'est sur QUE si le jeton est long et aleatoire. C'est `generate()` qui le
 * garantit, et c'est pourquoi la generation ne passe jamais par autre chose
 * (aucune saisie manuelle, aucune derive d'un mot de passe).
 */

/** Reconnaitre un jeton d'integration au premier coup d'oeil, dans un journal. */
export const INTEGRATION_TOKEN_PREFIX = 'cxi_';

/** Octets aleatoires du secret : 32, soit 256 bits. */
export const INTEGRATION_TOKEN_BYTES = 32;

/** Longueur du fragment affichable (`cxi_` + 8 caracteres). */
export const INTEGRATION_PREFIX_LENGTH = 12;

/**
 * Nom d'une integration : `n8n-production`, `agent-veille`.
 *
 * Minuscules, chiffres et tirets, 3 a 40 caracteres. Le nom est UNIQUE et sert
 * a reconnaitre un jeton dans une liste : lui autoriser espaces, accents ou
 * casse donnerait deux entrees « n8n » et « N8n » que rien ne distingue a
 * l'ecran, et le doute profiterait toujours au jeton le plus ancien.
 */
export const INTEGRATION_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/**
 * Plafond de permissions par jeton : borne la surface d'une fuite.
 *
 * 250, et non 40. Un plafond n'a de sens que rapporte a la TAILLE DU
 * CATALOGUE : `ALL_PERMISSION_CODES` compte un peu plus de cent codes, dont
 * tous sauf `INTEGRATION_MANAGED_CODES` sont attribuables a une integration
 * (voir `integration-token.spec.ts`, qui verifie que le catalogue entier
 * passe). A 40, le plafond serait descendu SOUS le plus large besoin legitime —
 * une integration d'agence qui pilote projets, taches, agenda, CRM et
 * facturation en une seule connexion — et aurait oblige a tailler dans les
 * droits au hasard, ou a contourner la regle.
 *
 * La marge restante laisse le catalogue plus que doubler sans repasser par ici,
 * tout en gardant une borne : une liste absurde de mille codes est toujours
 * refusee net, jamais tronquee en silence.
 */
export const MAX_INTEGRATION_SCOPES = 250;

/**
 * Genere un jeton. Le seul moyen d'en obtenir un.
 *
 * `base64url` plutot que l'hexadecimal : a quantite d'alea egale, la chaine est
 * plus courte, donc lisible dans un fichier de configuration n8n — ou un jeton
 * tronque par un copier-coller se remarque tout de suite a sa longueur.
 */
export function generateIntegrationToken(bytes: number = INTEGRATION_TOKEN_BYTES): string {
  return INTEGRATION_TOKEN_PREFIX + randomBytes(bytes).toString('base64url');
}

/**
 * Vrai si la chaine PRÉTEND etre un jeton d'integration.
 *
 * C'est le PREFIXE qui tranche, et non la forme complete : un jeton
 * d'integration tronque, corrompu ou expire doit etre refuse PAR LE CHEMIN
 * DES INTEGRATIONS, qui sait dire « ton jeton d'integration est invalide ». Le
 * faire tomber dans la verification JWT ne donnerait qu'un « jeton invalide »
 * generique — et, pour une machine, une reponse qui ne dit pas quoi corriger.
 *
 * La distinction avec `looksLikeIntegrationToken` est donc volontaire :
 *   - `claimsIntegrationToken` : « a quoi ce jeton dit ressembler ? » (routage) ;
 *   - `looksLikeIntegrationToken` : « a-t-il la forme exacte ? » (validite).
 */
export function claimsIntegrationToken(token: string): boolean {
  return typeof token === 'string' && token.startsWith(INTEGRATION_TOKEN_PREFIX);
}

/**
 * Vrai si la chaine a la FORME d'un jeton d'integration.
 *
 * Ce test ne dit pas que le jeton est valide — seulement qu'il merite une
 * recherche en base. Sans lui, chaque requete sans session declencherait un
 * hachage et une lecture pour `Bearer undefined` ou pour un JWT d'utilisateur.
 */
export function looksLikeIntegrationToken(token: string): boolean {
  if (typeof token !== 'string' || !token.startsWith(INTEGRATION_TOKEN_PREFIX)) {
    return false;
  }
  const secret = token.slice(INTEGRATION_TOKEN_PREFIX.length);
  // 32 octets en base64url = 43 caracteres, sans remplissage.
  return secret.length >= 43 && /^[A-Za-z0-9_-]+$/.test(secret);
}

/**
 * Fragment affichable d'un jeton : de quoi le reconnaitre, pas de quoi le
 * reconstituer. Il est montre dans les listes et les journaux — jamais dans une
 * reponse qui permettrait de deviner la suite.
 */
export function displayPrefixOf(token: string): string {
  return token.slice(0, INTEGRATION_PREFIX_LENGTH);
}

/** Empreinte du jeton. C'est la SEULE chose qui est stockee. */
export function hashIntegrationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Compare un jeton presente a une empreinte stockee.
 *
 * `timingSafeEqual` et non `===` : une comparaison de chaines s'arrete au
 * premier caractere different, et la difference de duree mesure alors combien de
 * caracteres etaient justes — de quoi deviner un secret octet par octet. La
 * comparaison a duree constante supprime cette fuite.
 *
 * La garde de longueur n'est pas defensive mais obligatoire : `timingSafeEqual`
 * LEVE une exception sur deux buffers de tailles differentes, ce qui
 * transformerait une simple erreur de forme en erreur 500.
 */
export function integrationTokenMatches(token: string, hash: string): boolean {
  const computed = Buffer.from(hashIntegrationToken(token), 'utf8');
  const stored = Buffer.from(hash, 'utf8');

  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
}

/**
 * Nom de compte technique associe a une integration.
 *
 * Le domaine `.invalid` est RESERVE par la RFC 2606 : il n'existe pas et
 * n'existera jamais. Un courriel y est donc inutilisable pour une connexion, ce
 * qui est exactement ce qu'on veut — le compte technique ne doit jamais pouvoir
 * se connecter par le formulaire, meme si quelqu'un lui trouvait un mot de passe.
 */
export function integrationEmailFor(name: string): string {
  return `${slugifyIntegrationName(name)}@integrations.invalid`;
}

/** Normalise un nom d'integration : minuscules, tirets, sans accents. */
export function slugifyIntegrationName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Un nom est recevable s'il est assez long et de la bonne forme. */
export function isValidIntegrationName(name: string): boolean {
  return typeof name === 'string' && INTEGRATION_NAME_PATTERN.test(name);
}

/**
 * Un jeton est perime a partir de `expiresAt`, et `null` signifie « jamais ».
 *
 * `>=` et non `>` : a l'instant exact de l'expiration, le jeton ne passe plus.
 * Une minute de tolerance paraitrait charitable ; c'est une minute ou un jeton
 * qu'on a cru coupe fonctionne encore.
 */
export function isIntegrationTokenExpired(
  expiresAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return false;
  const limit = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(limit.getTime())) return true;
  return now.getTime() >= limit.getTime();
}

/**
 * Epure une liste de permissions pour un jeton.
 *
 * Trois regles, et elles sont toutes des limites de degats :
 *
 *  - UN CODE INCONNU EST REFUSE, pas ignore. Accepter silencieusement une
 *    faute de frappe (`task:reed:any`) donnerait un jeton qui a l'air d'etre
 *    autorise a lire les taches et qui ne peut rien faire — ou, pire, un code
 *    invente qui correspondrait plus tard a une vraie permission.
 *  - AUCUN JETON NE RECOIT UN CODE D'ADMINISTRATION D'INTEGRATION
 *    (`INTEGRATION_MANAGED_CODES`) : une machine ne distribue pas des acces, et
 *    ne dresse pas non plus la carte des integrations. Sans cette regle, un
 *    jeton vole dans un workflow n8n permettrait de s'en creer d'autres — la
 *    revocation ne servirait plus — ou, avec la simple lecture, de lister les
 *    autres integrations avec leurs noms, leurs droits et leur derniere
 *    utilisation : exactement le plan dont un attaquant a besoin.
 *  - Les doublons sont retires et l'ordre est stable : deux demandes identiques
 *    donnent le meme jeton, et une comparaison de listes reste possible.
 *
 * `knownCodes` est PASSE EN PARAMETRE et non importe du catalogue : ce fichier
 * reste sans dependance, donc testable sans base ni client genere.
 */

/**
 * Les codes qu'UN JETON ne peut JAMAIS porter.
 *
 * Le defaut est le plus strict, et c'est voulu : un appelant qui veut
 * deliberement lever la limite doit le dire en passant `managedCodes`, au lieu
 * de l'obtenir par omission. Une machine qui gere lesIntegrations est une
 * machine qui peut se remplacer elle-meme.
 */
export const INTEGRATION_MANAGED_CODES: readonly string[] = [
  'integration:read:any',
  'integration:manage:any',
];
export function normalizeIntegrationScopes(
  scopes: readonly string[],
  knownCodes: ReadonlySet<string> | readonly string[],
  options: { readonly managedCodes?: readonly string[] } = {},
): { ok: true; scopes: string[] } | { ok: false; unknown: string[]; forbidden: string[] } {
  const known = knownCodes instanceof Set ? knownCodes : new Set(knownCodes);
  const forbidden = new Set(options.managedCodes ?? INTEGRATION_MANAGED_CODES);

  const cleaned = [...new Set((scopes ?? []).map((scope) => scope.trim()).filter(Boolean))];

  const unknown = cleaned.filter((scope) => !known.has(scope));
  const refused = cleaned.filter((scope) => forbidden.has(scope));

  if (unknown.length > 0 || refused.length > 0) {
    return { ok: false, unknown, forbidden: refused };
  }

  if (cleaned.length > MAX_INTEGRATION_SCOPES) {
    // Au-dela du plafond, on refuse plutot que de tronquer : un jeton tronque
    // en silence ferait perdre la derniere permission sans le dire.
    return { ok: false, unknown: [], forbidden: [] };
  }

  return { ok: true, scopes: cleaned.sort() };
}
