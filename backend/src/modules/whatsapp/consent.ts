/**
 * CONSENTEMENT — le texte qui est accepte, la version qui le nomme, et la regle
 * qui dit s'il tient encore.
 *
 * -------------------------------------------------------------------------
 * POURQUOI UN FICHIER POUR UN TEXTE
 * -------------------------------------------------------------------------
 * Parce que le texte EST la regle. Ce qui est autorise ne se deduit pas du code :
 * un envoi depuis le compte WhatsApp de quelqu'un n'est legitime que si cette
 * personne a vu, compris et accepte CE QUI SUIT. Le conserver ici, avec sa
 * version, rend trois choses possibles :
 *
 *  1. LE MEME TEXTE PARTOUT. Le courriel d'invitation, le message Telegram du
 *     bot et la page d'autorisation appellent `describeConsent()`. Deux textes
 *     differents seraient deux consentements differents, et seul le plus large
 *     aurait ete accepte — par personne.
 *  2. UNE VERSION STOCKEE. `WhatsAppAccount.consentVersion` dit QUEL texte a ete
 *     accepte. Quand celui-ci change (une nouvelle capacite, une nouvelle
 *     limite), les autorisations anterieures ne couvrent plus rien : la regle
 *     `isConsentValid` peut exiger un renouvellement au lieu de laisser passer.
 *  3. UNE TRACE OPPOSABLE. `consentAcceptedAt` et `consentIpAddress` repondent a
 *     « qui a accepte quoi, quand, et depuis ou » — la question posee le jour ou
 *     un destinataire s'etonne d'un message.
 *
 * -------------------------------------------------------------------------
 * CE QUE LE TEXTE NE CACHE PAS
 * -------------------------------------------------------------------------
 * Une session WhatsApp Web automatisee est contraire aux conditions d'utilisation
 * de WhatsApp et peut entrainer le bannissement du numero. Le dire au moment du
 * consentement est la seule chose honnete a faire : la personne qui accepte le
 * fait avec SON numero, et elle doit savoir ce qu'elle risque. Les plafonds
 * d'envoi (`WHATSAPP_MAX_MESSAGES_PER_HOUR`) limitent ce risque sans le
 * supprimer, et le texte le dit aussi.
 */

/**
 * Version du texte de consentement.
 *
 * Format `<date>.<revision>` : la date dit DEPUIS QUAND ce texte s'applique, la
 * revision distingue deux corrections du meme jour. Une autorisation est
 * enregistree avec la version acceptee ; changer cette valeur sans changer le
 * texte serait mentir sur ce que les gens ont accepte.
 */
export const CONSENT_VERSION = '2026-10-15.1';

/**
 * Capacites accordables.
 *
 * `message:send` est la seule accordee par defaut. `contact:read` COPIE LE
 * REPERTOIRE du telephone — des donnees de personnes qui n'ont rien demande — et
 * ne doit donc etre accordee que quand un usage le reclame vraiment.
 */
export const WHATSAPP_GRANT_SCOPES = ['message:send', 'contact:read'] as const;

export type WhatsAppGrantScope = (typeof WHATSAPP_GRANT_SCOPES)[number];

const SCOPE_LABELS: Readonly<Record<WhatsAppGrantScope, string>> = {
  'message:send':
    'envoyer des messages texte depuis votre compte WhatsApp, vers les destinataires demandes',
  'contact:read':
    'lire et copier la liste de vos contacts WhatsApp (noms et numeros) dans la base Comexa',
};

/** Vrai si la valeur est une capacite connue. */
export function isKnownGrantScope(value: string): value is WhatsAppGrantScope {
  return (WHATSAPP_GRANT_SCOPES as readonly string[]).includes(value);
}

/** Filtre une liste de capacites demandees : les inconnues sont ignorenees, pas devinees. */
export function normalizeGrantScopes(scopes: readonly string[] | undefined): WhatsAppGrantScope[] {
  const cleaned = [...new Set((scopes ?? []).map((scope) => scope.trim()).filter(Boolean))];
  const known = cleaned.filter(isKnownGrantScope);
  return known.length > 0 ? [...known] : ['message:send'];
}

/** Libelle d'une capacite, pour le texte de consentement. */
export function scopeLabel(scope: WhatsAppGrantScope): string {
  return SCOPE_LABELS[scope];
}

/** Elements variables du texte de consentement. */
export interface ConsentContext {
  /** Membre Comexa qui demande l'autorisation. */
  readonly requestedBy: string;
  /** Personne a qui on la demande (facultatif : le titulaire peut etre inconnu). */
  readonly delegatorName?: string | null;
  /** Capacites demandees. */
  readonly scopes: readonly WhatsAppGrantScope[];
  /** Fin de l'autorisation, si elle est bornee. */
  readonly expiresAt?: Date | null;
  /**
   * Plafond d'envoi reellement configure, rendu dans le texte.
   *
   * Nommer la variable d'environnement au lieu du nombre aurait produit un
   * consentement illisible pour la personne qui le recoit — et un plafond qu'on
   * ne connait pas n'engage a rien.
   */
  readonly maxMessagesPerHour?: number;
}

/**
 * Rend le texte complet du consentement.
 *
 * Ce texte est celui qui est MONTRE avant l'acceptation, et celui dont la version
 * est STOCKEE apres. Le rendre dynamique (nom du demandeur, capacites, echeance)
 * n'est pas une comodite d'affichage : accepter « Comexa peut envoyer des
 * messages » sans savoir QUI ni JUSQU'A QUAND ne serait pas un consentement.
 */
export function describeConsent(context: ConsentContext): string {
  const scopes = normalizeGrantScopes(context.scopes);
  const holder = context.delegatorName?.trim() || 'votre compte WhatsApp';
  const expiry = context.expiresAt
    ? `Cette autorisation prend fin le ${context.expiresAt.toISOString().slice(0, 10)}.`
    : "Cette autorisation n'a pas de date de fin, mais reste révocable a tout moment.";

  return [
    `Autorisation d'utiliser ${holder} depuis Comexa`,
    '',
    `${context.requestedBy} vous demande d'autoriser Comexa, par l'intermediaire du bot ` +
      'Telegram @ComexaWork_bot, a :',
    ...scopes.map((scope) => `  - ${scopeLabel(scope)} ;`),
    '',
    'Ce que cela change concretement :',
    '  - les messages partent DE VOTRE NUMERO : vos destinataires voient un message de vous,',
    '    pas d’un robot ;',
    "  - chaque envoi est journalise (destinataire, texte, date, membre a l'origine de la",
    '    demande) et ce journal est consultable et conservé ;',
    '  - le texte de chaque message est defini par la demande faite au bot : Comexa ne',
    '    redige rien de sa propre initiative ;',
    "  - la conversation n'est PAS lue, et aucun message recu n'est copie, sauf si la",
    '    lecture des contacts figure ci-dessus.',
    '',
    'Ce que vous devez savoir avant d’accepter :',
    '  - connecter un compte a un automate est contraire aux conditions d’utilisation de',
    '    WhatsApp et peut entrainer la suspension definitive du numero ;',
    `  - les envois sont plafonnes a ${context.maxMessagesPerHour ?? 40} messages par heure`,
    '    et par compte, pour limiter ce risque sans le supprimer ;',
    '  - vous pouvez retirer cette autorisation a tout moment : la session est alors',
    '    deconnectee immediatement et les contacts copies sont supprimes.',
    '',
    expiry,
    `Version du consentement : ${CONSENT_VERSION}`,
  ].join('\n');
}

/** Etat d'une autorisation, tel que verifie avant chaque envoi. */
export interface ConsentState {
  readonly consentVersion: string;
  readonly consentAcceptedAt: Date | null;
  readonly consentExpiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly grantedScopes: readonly string[];
}

export type ConsentVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: ConsentRejectionCode; readonly message: string };

export type ConsentRejectionCode =
  | 'CONSENT_MISSING'
  | 'CONSENT_EXPIRED'
  | 'CONSENT_REVOKED'
  | 'CONSENT_OUTDATED'
  | 'SCOPE_NOT_GRANTED';

/**
 * Decide si une autorisation tient encore.
 *
 * L'ORDRE DES CONTROLES EST L'ORDRE D'EXPLICATION : une autorisation revoquee est
 * annoncee comme revoquee meme si elle est aussi perimee, parce que « revoquee »
 * est la reponse utile a la personne qui la lit. Annoncer « expiree » a quelqu'un
 * qui a clique sur « retirer l'acces » laisserait croire que le retrait n'a pas
 * ete pris en compte.
 *
 * `CONSENT_OUTDATED` couvre le cas d'un texte modifie depuis l'acceptation : la
 * capacite demandee n'etait peut-etre pas dans le texte accepte. Le refus est
 * net, et la correction est une nouvelle acceptation — pas une interpretation.
 */
export function evaluateConsent(state: ConsentState, now: Date = new Date()): ConsentVerdict {
  if (state.revokedAt) {
    return {
      ok: false,
      code: 'CONSENT_REVOKED',
      message:
        'Cette autorisation a ete retiree. Un nouveau consentement est necessaire avant tout envoi.',
    };
  }

  if (!state.consentAcceptedAt) {
    return {
      ok: false,
      code: 'CONSENT_MISSING',
      message:
        "Aucun consentement enregistre pour ce compte : l'envoi est refuse tant que le " +
        'titulaire du numero n’a pas accepte.',
    };
  }

  if (state.consentExpiresAt && now.getTime() >= state.consentExpiresAt.getTime()) {
    return {
      ok: false,
      code: 'CONSENT_EXPIRED',
      message:
        `L'autorisation a expire le ${state.consentExpiresAt.toISOString().slice(0, 10)}. ` +
        'Le titulaire doit la renouveler.',
    };
  }

  if (state.consentVersion !== CONSENT_VERSION) {
    return {
      ok: false,
      code: 'CONSENT_OUTDATED',
      message:
        `Le consentement a ete accepte sur la version « ${state.consentVersion} » du texte, ` +
        `or la version en vigueur est « ${CONSENT_VERSION} ». Le titulaire doit accepter a ` +
        'nouveau : ce qui est autorise a pu changer.',
    };
  }

  return { ok: true };
}

/**
 * Verifie qu'une capacite precise a ete accordee.
 *
 * Separe de `evaluateConsent` : un consentement valide ne dit pas TOUT ce qu'il
 * permet. La lecture du repertoire est refusee a un compte qui n'a accorde que
 * l'envoi, et le message doit nommer la capacite manquante — sinon le titulaire
 * croit son autorisation cassée.
 */
export function hasGrantedScope(
  state: Pick<ConsentState, 'grantedScopes'>,
  scope: WhatsAppGrantScope,
): ConsentVerdict {
  if (state.grantedScopes.includes(scope)) {
    return { ok: true };
  }

  return {
    ok: false,
    code: 'SCOPE_NOT_GRANTED',
    message:
      `Le titulaire n'a pas accorde « ${scope} » (${scopeLabel(scope)}). ` +
      'Une nouvelle autorisation, incluant cette capacite, est necessaire.',
  };
}
