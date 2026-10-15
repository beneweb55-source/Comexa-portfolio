import { HttpStatus } from '@nestjs/common';
import { evaluateConsent, hasGrantedScope, type ConsentState } from './consent.js';
import type { ResolvedRecipient } from './whatsapp-identity.js';

/**
 * REGLE D'ENVOI — ce qui decide si un message WhatsApp peut partir.
 *
 * -------------------------------------------------------------------------
 * POURQUOI UNE FONCTION PURE, ET NON DES GARDES DANS LE SERVICE
 * -------------------------------------------------------------------------
 * Un envoi depuis le compte d'une personne est l'operation la plus consequente du
 * module : elle est visible par un tiers, elle engage le numero de quelqu'un, et
 * elle ne se reprend pas. Les conditions qui l'autorisent sont donc ecrites ICI,
 * dans une fonction qui ne lit ni base ni reseau, et qui peut etre testee cas par
 * cas — session coupee, consentement expire, autorisation retiree, groupe,
 * plafond horaire atteint, corps trop long.
 *
 * Dispersees dans le service, ces regles seraient huit `if` entre deux appels
 * Prisma, et chaque test exigerait une base. Le resultat pratique est connu : les
 * regles qu'on ne teste pas sont celles qu'on oublie d'appliquer dans le second
 * chemin d'envoi.
 *
 * -------------------------------------------------------------------------
 * L'ORDRE DES REFUS N'EST PAS INDIFFERENT
 * -------------------------------------------------------------------------
 * Un compte revoque est refuse AVANT qu'on examine le destinataire ou la longueur
 * du texte. Deux raisons : le refus le plus grave doit etre celui qu'on lit, et
 * un appelant qui corrige le corps d'un message avant de decouvrir que l'accès a
 * ete retire perd un aller-retour pour rien.
 *
 * Le plafond horaire est verifie EN DERNIER : c'est le seul refus qui peut
 * devenir un succes sans rien changer a la demande, simplement en attendant.
 * Annoncer d'abord un probleme de consentement ferait croire qu'il faut corriger
 * quelque chose.
 */

/** Codes de refus STABLES — ce qu'un workflow n8n teste, jamais le message. */
export const SEND_REJECTION_CODES = {
  /** Session coupee, jamais appairee, ou en attente de QR. */
  SESSION_NOT_CONNECTED: 'WHATSAPP_SESSION_NOT_CONNECTED',
  /** Autorisation retiree (revocation, ou compte desactive cote Comexa). */
  ACCOUNT_REVOKED: 'WHATSAPP_ACCOUNT_REVOKED',
  /** Aucun consentement enregistre. */
  CONSENT_MISSING: 'WHATSAPP_CONSENT_MISSING',
  /** Consentement depasse. */
  CONSENT_EXPIRED: 'WHATSAPP_CONSENT_EXPIRED',
  /** Consentement retire par le titulaire. */
  CONSENT_REVOKED: 'WHATSAPP_CONSENT_REVOKED',
  /** Texte de consentement modifie depuis l'acceptation. */
  CONSENT_OUTDATED: 'WHATSAPP_CONSENT_OUTDATED',
  /** La capacite requise n'a pas ete accordee. */
  SCOPE_NOT_GRANTED: 'WHATSAPP_SCOPE_NOT_GRANTED',
  /** Destinataire illisible (ni numero international, ni JID reconnu). */
  RECIPIENT_INVALID: 'WHATSAPP_RECIPIENT_INVALID',
  /** Destinataire de groupe. */
  GROUP_NOT_ALLOWED: 'WHATSAPP_GROUP_NOT_ALLOWED',
  /** Corps vide. */
  BODY_EMPTY: 'WHATSAPP_BODY_EMPTY',
  /** Corps plus long que `WHATSAPP_MAX_BODY_LENGTH`. */
  BODY_TOO_LONG: 'WHATSAPP_BODY_TOO_LONG',
  /** Plafond horaire atteint pour ce compte. */
  RATE_LIMITED: 'WHATSAPP_RATE_LIMITED',
} as const;

export type SendRejectionCode = (typeof SEND_REJECTION_CODES)[keyof typeof SEND_REJECTION_CODES];

/** Etat de session en base (enum Prisma `WhatsAppSessionStatus`). */
export type StoredSessionStatus =
  'DISCONNECTED' | 'STARTING' | 'WAITING_QR' | 'CONNECTED' | 'FAILED' | 'REVOKED';

export interface SendPolicyInput {
  readonly sessionStatus: StoredSessionStatus;
  readonly consent: ConsentState;
  readonly recipient: ResolvedRecipient;
  readonly body: string;
  /** Nombre d'envois ACCEPTES par la passerelle dans l'heure glissante. */
  readonly sentInLastHour: number;
  readonly maxBodyLength: number;
  readonly maxMessagesPerHour: number;
  readonly now?: Date;
}

export type SendPolicyVerdict =
  | { readonly ok: true; readonly jid: string; readonly phone: string | null }
  | { readonly ok: false; readonly code: SendRejectionCode; readonly message: string };

/**
 * Decide.
 *
 * `sentInLastHour` est PASSE EN ARGUMENT : la regle ne doit pas savoir comment on
 * compte. Le service interroge la base (ou un compteur en memoire) et fournit le
 * nombre — ce qui permet de tester le plafond sans aucune donnee.
 */
export function evaluateSendPolicy(input: SendPolicyInput): SendPolicyVerdict {
  // 1. Le compte est-il encore autorise, tout court ?
  if (input.sessionStatus === 'REVOKED') {
    return refuse(
      SEND_REJECTION_CODES.ACCOUNT_REVOKED,
      "L'autorisation d'utiliser ce compte WhatsApp a ete retiree. Aucun envoi n'est possible.",
    );
  }

  // 2. Le consentement tient-il ?
  const consent = evaluateConsent(input.consent, input.now ?? new Date());
  if (!consent.ok) {
    return refuse(consentCodeOf(consent.code), consent.message);
  }

  const sendScope = hasGrantedScope(input.consent, 'message:send');
  if (!sendScope.ok) {
    return refuse(SEND_REJECTION_CODES.SCOPE_NOT_GRANTED, sendScope.message);
  }

  // 3. La session est-elle utilisable ?
  if (input.sessionStatus !== 'CONNECTED') {
    return refuse(
      SEND_REJECTION_CODES.SESSION_NOT_CONNECTED,
      `La session WhatsApp n'est pas appairee (etat : ${input.sessionStatus}). ` +
        'Relancer l’appairage puis reessayer.',
    );
  }

  // 4. Le destinataire est-il lisible ?
  if (!input.recipient.ok) {
    // Le message vient de la resolution, et il est RECOPIE TEL QUEL dans le chat
    // Telegram. Un message vide laisserait l'utilisateur devant un refus muet :
    // d'ou le repli, qui nomme au moins la raison machine.
    const detail =
      input.recipient.message.trim() || `Destinataire refuse (${input.recipient.reason}).`;
    return refuse(SEND_REJECTION_CODES.RECIPIENT_INVALID, detail);
  }

  if (input.recipient.kind === 'group') {
    return refuse(
      SEND_REJECTION_CODES.GROUP_NOT_ALLOWED,
      "L'envoi vers un groupe WhatsApp n'est pas autorise : un message de groupe touche " +
        'tous ses membres, ce qui depasse l’autorisation accordee pour des contacts ' +
        'individuels. Envoyer aux membres nommement, un par un.',
    );
  }

  // 5. Le corps est-il envoyable ?
  const body = (input.body ?? '').trim();
  if (body.length === 0) {
    return refuse(SEND_REJECTION_CODES.BODY_EMPTY, 'Le message est vide.');
  }
  if (body.length > input.maxBodyLength) {
    return refuse(
      SEND_REJECTION_CODES.BODY_TOO_LONG,
      `Le message compte ${body.length} caracteres, au-dela de la borne ` +
        `${input.maxBodyLength} (WHATSAPP_MAX_BODY_LENGTH). Le tronquer changerait son ` +
        'sens : il faut le raccourcir a la source.',
    );
  }

  // 6. Le plafond horaire est-il atteint ?
  if (input.sentInLastHour >= input.maxMessagesPerHour) {
    return refuse(
      SEND_REJECTION_CODES.RATE_LIMITED,
      `Plafond atteint : ${input.sentInLastHour} messages envoyes dans l'heure pour ce ` +
        `compte (WHATSAPP_MAX_MESSAGES_PER_HOUR = ${input.maxMessagesPerHour}). ` +
        "Cette limite protege le numero d'un bannissement : attendre la fin de l'heure " +
        'glissante, ou répartir les envois.',
    );
  }

  return { ok: true, jid: input.recipient.jid, phone: input.recipient.phone };
}

/**
 * Traduit un refus en statut HTTP.
 *
 * Le choix suit la table de `docs/API-N8N.md` :
 *  - 400 pour une ENTREE illisible (destinataire, corps) ;
 *  - 409 pour un ETAT qui empeche l'operation (session non appairee, revoquee) ;
 *  - 403 pour une AUTORISATION absente ou retiree (consentement) ;
 *  - 429 pour un PLAFOND, seul cas ou la meme demande reussira plus tard sans
 *    changer.
 *
 * Confondre ces statuts couterait cher a un workflow : un 422 sur un plafond
 * l'inciterait a corriger la requete, alors qu'il suffit d'attendre.
 */
export function httpStatusForSendRejection(code: SendRejectionCode): HttpStatus {
  switch (code) {
    case SEND_REJECTION_CODES.RATE_LIMITED:
      return HttpStatus.TOO_MANY_REQUESTS;
    case SEND_REJECTION_CODES.SESSION_NOT_CONNECTED:
    case SEND_REJECTION_CODES.ACCOUNT_REVOKED:
      return HttpStatus.CONFLICT;
    case SEND_REJECTION_CODES.RECIPIENT_INVALID:
    case SEND_REJECTION_CODES.BODY_EMPTY:
    case SEND_REJECTION_CODES.BODY_TOO_LONG:
      return HttpStatus.BAD_REQUEST;
    case SEND_REJECTION_CODES.GROUP_NOT_ALLOWED:
      return HttpStatus.UNPROCESSABLE_ENTITY;
    default:
      return HttpStatus.FORBIDDEN;
  }
}

function refuse(code: SendRejectionCode, message: string): SendPolicyVerdict {
  return { ok: false, code, message };
}

/** Code de consentement -> code de refus d'envoi. */
function consentCodeOf(code: string): SendRejectionCode {
  switch (code) {
    case 'CONSENT_REVOKED':
      return SEND_REJECTION_CODES.CONSENT_REVOKED;
    case 'CONSENT_EXPIRED':
      return SEND_REJECTION_CODES.CONSENT_EXPIRED;
    case 'CONSENT_OUTDATED':
      return SEND_REJECTION_CODES.CONSENT_OUTDATED;
    case 'SCOPE_NOT_GRANTED':
      return SEND_REJECTION_CODES.SCOPE_NOT_GRANTED;
    default:
      return SEND_REJECTION_CODES.CONSENT_MISSING;
  }
}
