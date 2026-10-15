import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * IDENTITE WHATSAPP — regles pures : numeros, JID, noms de session, codes.
 *
 * -------------------------------------------------------------------------
 * POURQUOI CES REGLES SONT ISOLEES
 * -------------------------------------------------------------------------
 * Ce fichier ne connait ni Prisma, ni Nest, ni HTTP. Ce sont les regles les plus
 * consequentes du domaine, et les plus faciles a verifier seules :
 *
 *  - UN DESTINATAIRE MAL NORMALISE ENVOIE LE MESSAGE A QUELQU'UN D'AUTRE.
 *    `0555 12 34 56` sans indicatif n'est pas un numero : compose tel quel, il
 *    aboutit ailleurs. Le refus explicite vaut mieux qu'une devinette — c'est
 *    pourquoi l'indicatif par defaut vient de la configuration
 *    (`WHATSAPP_DEFAULT_COUNTRY_CODE`) et pourquoi un numero ambigu est REJETE,
 *    pas corrige en silence.
 *  - UN NOM DE SESSION DEVINE OUVRIRAIT LE COMPTE D'UN AUTRE. Le nom est la seule
 *    adresse d'une session cote passerelle : deux comptes qui partagent un nom
 *    partagent un acces. D'ou l'alea dans le nom, et la contrainte UNIQUE en
 *    base.
 *  - UN CODE D'AUTORISATION EST UN SECRET. Meme mecanique que
 *    `IntegrationToken` et `TelegramLink` : empreinte SHA-256 stockee, code
 *    affiche une fois, comparaison a duree constante.
 */

/**
 * Indicatifs telephones reconnus, par pays ISO 3166-1 alpha-2.
 *
 * UNE LISTE COURTE ET ASSUMEE COMME TELLE. Une table complete des indicatifs
 * (et des regles de longueur par pays) tient dans `libphonenumber`, qui pese
 * plus de 500 Ko de donnees. Ce projet envoie des WhatsApp depuis l'Algerie, la
 * France, le Maghreb, l'Afrique de l'Ouest et le Golfe — la liste ci-dessous
 * couvre ces cas, et TOUT AUTRE PAYS EST REFUSE avec un message qui dit de
 * saisir le numero en format international.
 *
 * Refuser est le bon comportement : deviner l'indicatif d'un pays absent
 * produirait un envoi vers un numero valide… qui n'est pas le bon destinataire.
 * Ajouter un pays ici est une ligne, et c'est une decision explicite.
 */
export const COUNTRY_DIAL_CODES: Readonly<Record<string, number>> = {
  DZ: 213,
  MA: 212,
  TN: 216,
  LY: 218,
  EG: 20,
  FR: 33,
  BE: 32,
  LU: 352,
  CH: 41,
  NL: 31,
  DE: 49,
  ES: 34,
  IT: 39,
  PT: 351,
  GB: 44,
  TR: 90,
  AE: 971,
  SA: 966,
  QA: 974,
  KW: 965,
  BH: 973,
  OM: 968,
  JO: 962,
  LB: 961,
  SN: 221,
  CI: 225,
  ML: 223,
  BF: 226,
  NE: 227,
  TG: 228,
  BJ: 229,
  MR: 222,
  GN: 224,
  CM: 237,
  TD: 235,
  GA: 241,
  CG: 242,
  CA: 1,
  US: 1,
};

/** Longueur d'un numero international, indicatif compris (E.164 : 15 au plus). */
const MIN_PHONE_DIGITS = 8;
const MAX_PHONE_DIGITS = 15;

/** Suffixe d'un JID utilisateur. */
export const USER_JID_SUFFIX = '@s.whatsapp.net';
/** Suffixe d'un JID de groupe. */
export const GROUP_JID_SUFFIX = '@g.us';

/**
 * Suffixe HISTORIQUE d'un JID utilisateur, tel que le rendent encore les clients
 * WhatsApp Web (donc WAHA, donc Baileys).
 */
const LEGACY_USER_JID_SUFFIX = '@c.us';

/**
 * Forme canonique d'un JID.
 *
 * -------------------------------------------------------------------------
 * POURQUOI CETTE FONCTION EXISTE
 * -------------------------------------------------------------------------
 * `resolveRecipient` produit `213555123456@s.whatsapp.net`. Un repertoire lu
 * chez WAHA rend `213555123456@c.us`. LES DEUX DESIGNENT LA MEME PERSONNE, et
 * sans forme unique :
 *
 *   - la contrainte `(accountId, jid)` de `whatsapp_contacts` laisserait deux
 *     lignes pour un seul contact, selon le chemin par lequel il est arrive ;
 *   - une recherche par JID manquerait la moitie des entrees ;
 *   - un envoi vers un contact choisi dans la liste et un envoi vers le meme
 *     numero saisi a la main partiraient sous deux identifiants differents, donc
 *     avec deux lignes distinctes dans le journal — et le plafond horaire ne les
 *     additionnerait pas correctement.
 *
 * Les JID de groupe (`@g.us`), de liste de diffusion (`@broadcast`) et les
 * identifiants sans numero (`@lid`) sont LAISSES TELS QUELS : `@s.whatsapp.net`
 * n'a de sens que pour un utilisateur, et reecrire un JID de groupe le rendrait
 * injoignable.
 */
export function canonicalJid(raw: string | undefined | null): string {
  const value = (raw ?? '').trim().toLowerCase();
  if (value.length === 0) return '';

  if (value.endsWith(LEGACY_USER_JID_SUFFIX)) {
    return `${value.slice(0, -LEGACY_USER_JID_SUFFIX.length)}${USER_JID_SUFFIX}`;
  }

  return value;
}

export type NormalizedPhone =
  | { readonly ok: true; readonly phone: string; readonly jid: string }
  | { readonly ok: false; readonly reason: PhoneRejectionReason; readonly message: string };

export type PhoneRejectionReason =
  'EMPTY' | 'UNKNOWN_COUNTRY' | 'AMBIGUOUS_FORMAT' | 'TOO_SHORT' | 'TOO_LONG' | 'NOT_A_NUMBER';

/**
 * Normalise un numero en format international SANS `+`, puis en JID.
 *
 * Formes acceptees : `+213555123456`, `00213555123456`, `0555123456` (avec
 * l'indicatif par defaut), `213555123456`, et les memes avec espaces, tirets,
 * points ou parentheses.
 *
 * CE QUI EST REFUSE, ET POURQUOI :
 *  - un numero local SANS `0` initial et sans indicatif reconnu (`555123456`) :
 *    le prefixer reviendrait a deviner, et une devinette ici envoie le message a
 *    quelqu'un d'autre ;
 *  - un pays absent de `COUNTRY_DIAL_CODES` : meme raison.
 *
 * Les deux refus nomment la correction a faire (saisir le `+`), ce qui rend le
 * message exploitable par le bot : il peut le recopier tel quel a l'utilisateur.
 */
export function normalizePhoneNumber(
  raw: string | undefined | null,
  defaultCountry = 'DZ',
): NormalizedPhone {
  const value = (raw ?? '').trim();

  if (value.length === 0) {
    return reject('EMPTY', 'Aucun destinataire fourni.');
  }

  const country = defaultCountry.trim().toUpperCase();
  const dialCode = COUNTRY_DIAL_CODES[country];

  const hadPlus = value.startsWith('+');
  const digits = value.replace(/[^\d]/g, '');

  if (digits.length === 0) {
    return reject('NOT_A_NUMBER', `« ${value} » ne contient aucun chiffre.`);
  }

  if (hadPlus) {
    return finish(digits, 'format international (+)');
  }

  if (digits.startsWith('00')) {
    return finish(digits.slice(2), 'format international (00)');
  }

  if (dialCode === undefined) {
    return reject(
      'UNKNOWN_COUNTRY',
      `Indicatif pays inconnu pour « ${country} » (WHATSAPP_DEFAULT_COUNTRY_CODE). ` +
        `Saisir le destinataire en format international, par exemple +213555123456.`,
    );
  }

  const dial = String(dialCode);

  // Numero local avec le 0 de sortie nationale : `0555123456` -> `213555123456`.
  if (digits.startsWith('0')) {
    return finish(dial + digits.slice(1), 'numero local, indicatif ' + dial + ' applique');
  }

  // Deja international, sans le `+` : accepte seulement si le prefixe correspond
  // a l'indicatif par defaut ET si la longueur est plausible. Autrement le
  // numero est ambigu — et l'ambiguite ici envoie au mauvais destinataire.
  if (digits.startsWith(dial) && digits.length >= dial.length + 7) {
    return finish(digits, 'numero international sans +');
  }

  return reject(
    'AMBIGUOUS_FORMAT',
    `« ${value} » n'est pas un numero international lisible : il ne commence ni par « + », ` +
      `ni par « 00 », ni par « 0 » (numero local), et ne correspond pas a l'indicatif ${dial}. ` +
      `Saisir par exemple +${dial}555123456.`,
  );

  function finish(phone: string, _how: string): NormalizedPhone {
    if (phone.length < MIN_PHONE_DIGITS) {
      return reject(
        'TOO_SHORT',
        `Le numero « ${phone} » ne compte que ${phone.length} chiffres, moins que les ` +
          `${MIN_PHONE_DIGITS} d'un numero international plausible.`,
      );
    }
    if (phone.length > MAX_PHONE_DIGITS) {
      return reject(
        'TOO_LONG',
        `Le numero « ${phone} » compte ${phone.length} chiffres, au-dela du maximum E.164 ` +
          `(${MAX_PHONE_DIGITS}).`,
      );
    }
    return { ok: true, phone, jid: `${phone}${USER_JID_SUFFIX}` };
  }
}

function reject(reason: PhoneRejectionReason, message: string): NormalizedPhone {
  return { ok: false, reason, message };
}

/**
 * Resout un DESTINATAIRE : numero, JID utilisateur, ou JID de groupe.
 *
 * Retourne aussi `kind`, parce que la decision d'envoyer a un groupe n'appartient
 * pas a cette fonction : un message de groupe touche tous ses membres, ce qui
 * depasse l'autorisation « envoyer a mes contacts ». Le pilote de regles
 * (`whatsapp-send-policy.ts`) tranche, avec un message qui explique le refus.
 */
export type ResolvedRecipient =
  | {
      readonly ok: true;
      readonly jid: string;
      readonly phone: string | null;
      readonly kind: 'user' | 'group';
    }
  | { readonly ok: false; readonly reason: string; readonly message: string };

export function resolveRecipient(
  raw: string | undefined | null,
  defaultCountry = 'DZ',
): ResolvedRecipient {
  const value = (raw ?? '').trim();

  if (value.length === 0) {
    return { ok: false, reason: 'EMPTY', message: 'Aucun destinataire fourni.' };
  }

  if (value.includes('@')) {
    const jid = value.toLowerCase();
    if (jid.endsWith(GROUP_JID_SUFFIX)) {
      return { ok: true, jid, phone: null, kind: 'group' };
    }
    if (jid.endsWith(USER_JID_SUFFIX) || jid.endsWith('@lid') || jid.endsWith('@broadcast')) {
      const phone = /^(\d+)@/.exec(jid)?.[1] ?? null;
      return { ok: true, jid, phone, kind: 'user' };
    }
    return {
      ok: false,
      reason: 'UNKNOWN_JID',
      message:
        `« ${value} » ressemble a un identifiant WhatsApp, mais son suffixe n'est pas ` +
        'reconnu (attendu @s.whatsapp.net ou @g.us).',
    };
  }

  const normalized = normalizePhoneNumber(value, defaultCountry);
  if (!normalized.ok) {
    return { ok: false, reason: normalized.reason, message: normalized.message };
  }

  return { ok: true, jid: normalized.jid, phone: normalized.phone, kind: 'user' };
}

/**
 * Nom de session cote passerelle.
 *
 * `<prefixe>-<alea>`, et PAS `<prefixe>-<userId>`. Deux raisons :
 *
 *  1. UN MEMBRE PEUT DETENIR PLUSIEURS AUTORISATIONS (la sienne, plus celle d'un
 *     tiers). Un nom derive de l'identifiant seul ferait se croiser deux comptes
 *     — et croiser deux sessions, c'est envoyer depuis le mauvais telephone.
 *  2. LE NOM NE DOIT RIEN REVELER. Il apparait dans les journaux de la
 *     passerelle, qui est un service distinct : y recopier l'identifiant Comexa
 *     d'un membre y exporterait une donnee qui ne la regarde pas.
 *
 * L'alea est borne en longueur (les deux pilotes limitent les noms d'instance)
 * et restreint aux caracteres acceptes par les deux : minuscules, chiffres,
 * tirets.
 */
export function sessionNameFor(
  prefix: string,
  entropy = randomBytes(6).toString('base64url'),
): string {
  const cleanPrefix =
    prefix
      .replace(/[^a-z0-9-]/gi, '')
      .toLowerCase()
      .slice(0, 20) || 'comexa';
  const suffix = entropy
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase()
    .slice(0, 12);

  return `${cleanPrefix}-${suffix}`.slice(0, 40);
}

/** Suffixes qui designent un UTILISATEUR (donc un numero de telephone). */
const USER_JID_SUFFIXES: readonly string[] = [USER_JID_SUFFIX, LEGACY_USER_JID_SUFFIX];

/**
 * Numero d'un JID, ou `null`.
 *
 * -------------------------------------------------------------------------
 * POURQUOI PAS UNE SIMPLE EXPRESSION `^(\d+)@`
 * -------------------------------------------------------------------------
 * Un JID de GROUPE commence lui aussi par des chiffres :
 * `120363001234567890@g.us`. Une extraction naive recopierait cet identifiant
 * dans la colonne `phoneNumber` de `whatsapp_contacts`, et trois choses
 * casseraient ensuite, toutes silencieusement :
 *
 *   - une recherche par numero tomberait sur un groupe ;
 *   - un envoi construit depuis cette colonne viserait un groupe, donc des
 *     dizaines de personnes qui n'ont rien autorise ;
 *   - le journal des envois afficherait un « numero » qui n'existe pas.
 *
 * D'ou la regle : un numero n'est extrait QUE d'un JID d'utilisateur. Les listes
 * de diffusion (`@broadcast`) et les identifiants sans numero (`@lid`) rendent
 * `null` aussi.
 *
 * La borne de longueur est celle d'E.164 (voir `MIN_PHONE_DIGITS` /
 * `MAX_PHONE_DIGITS`) : un identifiant de groupe serait de toute facon refuse,
 * mais le dire ici evite de dependre d'un controle en aval.
 */
export function phoneNumberFromJid(raw: string | undefined | null): string | null {
  const value = (raw ?? '').trim().toLowerCase();
  if (value.length === 0) return null;

  if (!USER_JID_SUFFIXES.some((suffix) => value.endsWith(suffix))) return null;

  const digits = value.slice(0, value.indexOf('@'));
  return digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS ? digits : null;
}

/** Vrai si le nom est acceptable pour WAHA comme pour Evolution. */
export function isUsableSessionName(name: string | undefined | null): boolean {
  const value = (name ?? '').trim();
  return value.length >= 3 && value.length <= 40 && /^[a-z0-9][a-z0-9-]*$/.test(value);
}

// -----------------------------------------------------------------------------
// CODE D'AUTORISATION (delegation)
// -----------------------------------------------------------------------------

/**
 * Alphabet du code, SANS les caracteres qui se confondent a la lecture.
 *
 * Le code est recopie a la main depuis un courriel ou un message Telegram : `0`
 * et `O`, `1` et `I` produiraient des echecs d'appairage dont personne ne
 * trouverait la cause. 32 caracteres, donc 5 bits par symbole.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Symboles du corps du code : 12, soit 60 bits d'alea. */
const CODE_BODY_LENGTH = 12;

export const DELEGATION_CODE_PREFIX = 'WA';

/**
 * Genere un code d'autorisation, presente en trois groupes (`WA-XXXX-XXXX-XXXX`).
 *
 * Les tirets ne font pas partie du secret : `normalizeDelegationCode` les retire,
 * donc un tiers peut le saisir avec ou sans, et une faute de copier-coller sur un
 * tiret ne coute pas un aller-retour.
 */
export function generateDelegationCode(random = randomInt): string {
  let body = '';
  for (let i = 0; i < CODE_BODY_LENGTH; i++) {
    body += CODE_ALPHABET[random(0, CODE_ALPHABET.length)];
  }

  const groups = body.match(/.{1,4}/g) ?? [body];
  return `${DELEGATION_CODE_PREFIX}-${groups.join('-')}`;
}

/** Retire prefixe, tirets et espaces ; met en majuscules. Renvoie `null` si vide. */
export function normalizeDelegationCode(raw: string | undefined | null): string | null {
  const value = (raw ?? '').trim().toUpperCase().replace(/[\s-]/g, '');

  if (value.length === 0) return null;

  // Le prefixe est facultatif a la saisie : `WA-ABCD-…` et `ABCD-…` designent le
  // meme code. Le retirer ici garantit que l'empreinte comparee est la meme dans
  // les deux cas — sans quoi un code saisi sans prefixe serait toujours refuse.
  const withoutPrefix = value.startsWith(DELEGATION_CODE_PREFIX)
    ? value.slice(DELEGATION_CODE_PREFIX.length)
    : value;

  return withoutPrefix.length > 0 ? withoutPrefix : null;
}

/** Vrai si la valeur a la FORME d'un code (avant toute recherche en base). */
export function looksLikeDelegationCode(raw: string | undefined | null): boolean {
  const value = normalizeDelegationCode(raw);
  return value !== null && value.length === CODE_BODY_LENGTH && /^[A-Z2-9]+$/.test(value);
}

/** Empreinte SHA-256 (hex). C'est la SEULE chose stockee. */
export function hashDelegationCode(raw: string): string {
  const normalized = normalizeDelegationCode(raw) ?? '';
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Compare un code presente a une empreinte stockee, A DUREE CONSTANTE.
 *
 * `timingSafeEqual` et non `===` : une comparaison qui s'arrete au premier
 * caractere different mesure combien de caracteres etaient justes. La garde de
 * longueur est obligatoire — `timingSafeEqual` LEVE sur deux buffers de tailles
 * differentes, ce qui transformerait un code invalide en erreur 500.
 */
export function delegationCodeMatches(raw: string, hash: string): boolean {
  const computed = Buffer.from(hashDelegationCode(raw), 'utf8');
  const stored = Buffer.from(hash, 'utf8');

  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
}
