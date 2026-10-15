/**
 * VUES WHATSAPP — ce qui sort, et ce qui ne sort jamais.
 *
 * -------------------------------------------------------------------------
 * POURQUOI UN PRESENTER SEPARE
 * -------------------------------------------------------------------------
 * Meme raison que `integration-token.presenter.ts` : rendre IMPOSSIBLE PAR
 * CONSTRUCTION la fuite d'un secret ou d'une donnee qui ne regarde pas
 * l'appelant. Trois choses ne doivent jamais atteindre une reponse :
 *
 *  1. LE CODE D'AUTORISATION d'une delegation, ni son empreinte. Le code n'est
 *     rendu qu'une fois, a la creation, par la route qui le genere — jamais par
 *     une liste. Sans presenter, une jointure ajoutée un vendredi soir rendrait
 *     `codeHash` dans `GET /whatsapp/delegations`, et quiconque peut lire la
 *     liste pourrait se faire passer pour le tiers.
 *  2. L'ADRESSE IP DU CONSENTEMENT. Elle est en base pour la trace, pas pour
 *     l'affichage : elle situe geographiquement une personne qui n'a pas demande
 *     a etre localisee.
 *  3. TOUT IDENTIFIANT DE SESSION cote passerelle. Le NOM de session est rendu
 *     (c'est une adresse, utile au diagnostic) ; les cookies et cles, eux, ne
 *     quittent jamais la passerelle — aucun pilote n'y a acces.
 *
 * Les dates sont rendues en ISO 8601 : le frontend et n8n lisent la meme forme,
 * et un `Date` serialise par Express depend du format JSON du moteur.
 */

/** Etat d'un compte appaire, tel que rendu. */
export interface WhatsAppAccountView {
  readonly id: string;
  /** `SELF` : le numero du membre. `DELEGATED` : le numero d'un tiers autorisant. */
  readonly ownerKind: 'SELF' | 'DELEGATED';
  readonly status: string;
  readonly phoneNumber: string | null;
  readonly pushName: string | null;
  readonly grantedScopes: readonly string[];
  readonly gatewayDriver: string;
  /** Nom de session cote passerelle — une adresse, pas un secret. */
  readonly sessionName: string;
  readonly consent: {
    readonly version: string;
    readonly acceptedAt: string | null;
    readonly expiresAt: string | null;
    /** Vrai si le consentement est utilisable maintenant. */
    readonly valid: boolean;
  };
  readonly pairedAt: string | null;
  readonly revokedAt: string | null;
  readonly lastStatusAt: string | null;
  readonly lastError: string | null;
  readonly holder: {
    readonly id: string;
    readonly firstName: string;
    readonly lastName: string;
  } | null;
  readonly delegation: {
    readonly id: string;
    readonly status: string;
    readonly delegatorName: string | null;
  } | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** QR d'appairage et marche a suivre. */
export interface WhatsAppPairingView {
  readonly accountId: string;
  readonly sessionName: string;
  readonly status: string;
  readonly ownerKind: 'SELF' | 'DELEGATED';
  readonly qr: {
    /** PNG en base64, sans prefixe `data:` — ce que `sendPhoto` de Telegram attend. */
    readonly imageBase64: string | null;
    /** Valeur brute du QR, a dessiner si l'image manque. */
    readonly rawValue: string | null;
    /** Code d'appairage par numero, quand la passerelle en propose un. */
    readonly pairingCode: string | null;
  } | null;
  /** Texte de consentement en vigueur, rendu au titulaire AVANT le scan. */
  readonly consentText: string;
  readonly consentVersion: string;
  readonly consentExpiresAt: string | null;
  /** Marche a suivre, dans l'ordre — le bot peut la recopier telle quelle. */
  readonly instructions: readonly string[];
}

export interface WhatsAppContactView {
  readonly id: string;
  readonly jid: string;
  readonly phoneNumber: string | null;
  readonly name: string | null;
  readonly isBusiness: boolean;
  /** Date de copie depuis la passerelle : ce n'est pas l'etat du telephone en direct. */
  readonly syncedAt: string;
}

export interface WhatsAppMessageView {
  readonly id: string;
  readonly direction: 'OUTBOUND' | 'INBOUND';
  readonly to: { readonly jid: string; readonly phoneNumber: string | null };
  readonly body: string;
  readonly status: 'QUEUED' | 'SENT' | 'FAILED' | 'REFUSED';
  readonly gatewayMessageId: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly requestedBy: {
    readonly id: string;
    readonly firstName: string;
    readonly lastName: string;
  } | null;
  readonly telegramChatId: string | null;
  readonly telegramMessageId: string | null;
  readonly idempotencyKey: string | null;
  readonly sentAt: string | null;
  readonly createdAt: string;
  /**
   * Vrai quand cette ligne est le REJEU d'une cle d'idempotence deja traitee.
   *
   * Le champ n'existe pas en base : c'est la reponse qui le porte, pour qu'un
   * workflow sache qu'il n'a rien envoye de plus. Sans lui, un rejeu reussi est
   * indiscernable d'un second envoi — et le doute porte sur un message parti vers
   * un client.
   */
  readonly replayed?: boolean;
}

export interface WhatsAppDelegationView {
  readonly id: string;
  readonly status: 'PENDING' | 'ACCEPTED' | 'REFUSED' | 'EXPIRED' | 'REVOKED';
  readonly delegatorName: string | null;
  readonly delegatorEmail: string | null;
  readonly delegatorPhone: string | null;
  readonly note: string | null;
  readonly grantedScopes: readonly string[];
  readonly codeExpiresAt: string | null;
  readonly acceptedAt: string | null;
  readonly refusedAt: string | null;
  readonly revokedAt: string | null;
  readonly expiresAt: string | null;
  readonly requestedBy: {
    readonly id: string;
    readonly firstName: string;
    readonly lastName: string;
  };
  readonly accountId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Marche a suivre de l'appairage, dans l'ordre.
 *
 * ECRITE ICI, ET NON DANS LE WORKFLOW : les deux pilotes rendent le meme QR, mais
 * les gestes cote telephone ne changent pas — et un bot qui recopie ces lignes
 * donne la meme explication a tout le monde. Une marche a suivre ecrite dans n8n
 * divergerait de celle-ci au premier changement, sans que rien ne le signale.
 */
export const PAIRING_INSTRUCTIONS: readonly string[] = [
  'Ouvrir WhatsApp sur le telephone du titulaire du numero.',
  'Aller dans Reglages > Appareils connectes > Connecter un appareil.',
  'Scanner le QR code ci-dessus (ou saisir le code d’appairage s’il est fourni).',
  'Laisser la connexion s’etablir : l’etat passe a CONNECTED.',
  'Garder le telephone connecte a Internet : sans lui, la session se deconnecte.',
];

interface AccountRow {
  readonly id: string;
  readonly ownerKind: string;
  readonly status: string;
  readonly phoneNumber: string | null;
  readonly pushName: string | null;
  readonly grantedScopes: readonly string[];
  readonly gatewayDriver: string;
  readonly sessionName: string;
  readonly consentVersion: string;
  readonly consentAcceptedAt: Date | null;
  readonly consentExpiresAt: Date | null;
  readonly pairedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly lastStatusAt: Date | null;
  readonly lastError: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly user?: {
    readonly id: string;
    readonly firstName: string;
    readonly lastName: string;
  } | null;
  readonly delegation?: {
    readonly id: string;
    readonly status: string;
    readonly delegatorName: string | null;
  } | null;
}

/**
 * Rend un compte.
 *
 * `consentValid` est PASSE EN ARGUMENT et non recalcule ici : la regle vit dans
 * `consent.ts`, et un presenter qui la reimplementerait finirait par ne plus
 * etre d'accord avec elle — deux reponses differentes a « ce compte peut-il
 * envoyer ? » seraient pires qu'une seule, meme fausse.
 */
export function toWhatsAppAccountView(row: AccountRow, consentValid: boolean): WhatsAppAccountView {
  return {
    id: row.id,
    ownerKind: row.ownerKind === 'DELEGATED' ? 'DELEGATED' : 'SELF',
    status: row.status,
    phoneNumber: row.phoneNumber,
    pushName: row.pushName,
    grantedScopes: [...row.grantedScopes],
    gatewayDriver: row.gatewayDriver,
    sessionName: row.sessionName,
    consent: {
      version: row.consentVersion,
      acceptedAt: iso(row.consentAcceptedAt),
      expiresAt: iso(row.consentExpiresAt),
      valid: consentValid,
    },
    pairedAt: iso(row.pairedAt),
    revokedAt: iso(row.revokedAt),
    lastStatusAt: iso(row.lastStatusAt),
    lastError: row.lastError,
    holder: row.user ? { ...row.user } : null,
    delegation: row.delegation ? { ...row.delegation } : null,
    createdAt: iso(row.createdAt) ?? '',
    updatedAt: iso(row.updatedAt) ?? '',
  };
}

interface ContactRow {
  readonly id: string;
  readonly jid: string;
  readonly phoneNumber: string | null;
  readonly name: string | null;
  readonly isBusiness: boolean;
  readonly syncedAt: Date;
}

export function toWhatsAppContactView(row: ContactRow): WhatsAppContactView {
  return {
    id: row.id,
    jid: row.jid,
    phoneNumber: row.phoneNumber,
    name: row.name,
    isBusiness: row.isBusiness,
    syncedAt: iso(row.syncedAt) ?? '',
  };
}

interface MessageRow {
  readonly id: string;
  readonly direction: string;
  readonly toJid: string;
  readonly toPhoneNumber: string | null;
  readonly body: string;
  readonly status: string;
  readonly gatewayMessageId: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly telegramChatId: string | null;
  readonly telegramMessageId: string | null;
  readonly idempotencyKey: string | null;
  readonly sentAt: Date | null;
  readonly createdAt: Date;
  readonly requestedBy?: {
    readonly id: string;
    readonly firstName: string;
    readonly lastName: string;
  } | null;
}

export function toWhatsAppMessageView(
  row: MessageRow,
  options: { readonly replayed?: boolean } = {},
): WhatsAppMessageView {
  return {
    id: row.id,
    direction: row.direction === 'INBOUND' ? 'INBOUND' : 'OUTBOUND',
    to: { jid: row.toJid, phoneNumber: row.toPhoneNumber },
    body: row.body,
    status: row.status as WhatsAppMessageView['status'],
    gatewayMessageId: row.gatewayMessageId,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    requestedBy: row.requestedBy ? { ...row.requestedBy } : null,
    telegramChatId: row.telegramChatId,
    telegramMessageId: row.telegramMessageId,
    idempotencyKey: row.idempotencyKey,
    sentAt: iso(row.sentAt),
    createdAt: iso(row.createdAt) ?? '',
    ...(options.replayed ? { replayed: true } : {}),
  };
}

interface DelegationRow {
  readonly id: string;
  readonly status: string;
  readonly delegatorName: string | null;
  readonly delegatorEmail: string | null;
  readonly delegatorPhone: string | null;
  readonly note: string | null;
  readonly grantedScopes?: readonly string[];
  readonly codeExpiresAt: Date | null;
  readonly acceptedAt: Date | null;
  readonly refusedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly requestedBy: {
    readonly id: string;
    readonly firstName: string;
    readonly lastName: string;
  };
  readonly account?: { readonly id: string } | null;
}

export function toWhatsAppDelegationView(row: DelegationRow): WhatsAppDelegationView {
  return {
    id: row.id,
    status: row.status as WhatsAppDelegationView['status'],
    delegatorName: row.delegatorName,
    delegatorEmail: row.delegatorEmail,
    delegatorPhone: row.delegatorPhone,
    note: row.note,
    grantedScopes: [...(row.grantedScopes ?? [])],
    codeExpiresAt: iso(row.codeExpiresAt),
    acceptedAt: iso(row.acceptedAt),
    refusedAt: iso(row.refusedAt),
    revokedAt: iso(row.revokedAt),
    expiresAt: iso(row.expiresAt),
    requestedBy: { ...row.requestedBy },
    accountId: row.account?.id ?? null,
    createdAt: iso(row.createdAt) ?? '',
    updatedAt: iso(row.updatedAt) ?? '',
  };
}

function iso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
