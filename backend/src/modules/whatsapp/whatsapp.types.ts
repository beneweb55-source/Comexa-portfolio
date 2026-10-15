/**
 * CONTRAT DE LA PASSERELLE WHATSAPP — ce que Comexa sait faire, sans savoir qui
 * le fait.
 *
 * -------------------------------------------------------------------------
 * POURQUOI UNE INTERFACE, ALORS QU'IL N'Y A (ENCORE) QU'UN SEUL PILOTE UTILE
 * -------------------------------------------------------------------------
 * Parce que le choix du pilote n'est pas un detail technique, c'est une
 * decision d'exploitation : WAHA tient plusieurs sessions dans un seul
 * conteneur et se configure en une variable ; Evolution API apporte une
 * interface d'administration et une base propre. Les deux parlent un dialecte
 * different (`X-Api-Key` contre `apikey`, `POST /api/sendText` contre
 * `POST /message/sendText/{instance}`), et AUCUN des deux ne devrait pouvoir
 * infiltrer ces differences dans les regles metier.
 *
 * Sans cette interface, « envoyer un message » contiendrait des `if (driver ===
 * 'waha')` — et chaque regle de consentement serait ecrite deux fois, avec deux
 * occasions de diverger. Ici, le consentement, les plafonds et le journal sont
 * ecrits UNE fois, au-dessus du pilote.
 *
 * -------------------------------------------------------------------------
 * CE QUE LA PASSERELLE DETIENT, ET CE QUE COMEXA DETIENT
 * -------------------------------------------------------------------------
 * La passerelle garde les IDENTIFIANTS DE SESSION (cookies, cles de couplage) :
 * c'est elle qui tient la connexion WhatsApp Web. Comexa ne conserve que le NOM
 * de session, l'etat, les traces d'envoi et le consentement. Une fuite de la
 * base Comexa ne donne donc pas acces aux comptes WhatsApp — c'est la raison
 * d'etre de ce tiers, et c'est pourquoi aucun pilote ne doit jamais renvoyer
 * d'identifiant de session dans une reponse.
 *
 * -------------------------------------------------------------------------
 * AUCUN CODE NEST ICI
 * -------------------------------------------------------------------------
 * Le fichier ne depend que de lui-meme : les types, les codes d'erreur et les
 * regles de traduction d'etat sont testables sans module ni HTTP.
 */

/** Pilotes de passerelle connus. `none` desactive la fonctionnalite. */
export type WhatsAppGatewayDriver = 'none' | 'waha' | 'evolution';

/** Jetons d'injection — des `Symbol`, pour les raisons documentees dans `common/storage/storage.types.ts`. */
export const WHATSAPP_GATEWAY_TOKEN = Symbol('WHATSAPP_GATEWAY');
export const WHATSAPP_GATEWAY_CONFIG_TOKEN = Symbol('WHATSAPP_GATEWAY_CONFIG');

/**
 * Etat d'une session, TRADUIT dans le vocabulaire de Comexa.
 *
 * Les valeurs recopient l'enum `WhatsAppSessionStatus` du schema Prisma, moins
 * `REVOKED` qui est une decision de Comexa et jamais un etat renvoye par la
 * passerelle. Une session revoquee n'est pas interrogee.
 */
export type GatewaySessionState =
  'DISCONNECTED' | 'STARTING' | 'WAITING_QR' | 'CONNECTED' | 'FAILED';

export interface GatewaySessionStatus {
  readonly state: GatewaySessionState;
  /**
   * Etat BRUT renvoye par la passerelle (`WORKING`, `SCAN_QR_CODE`, `open`…).
   *
   * Conserve pour le diagnostic : quand un pilote traduit mal un etat nouveau,
   * c'est cette valeur qui le montre, et sans elle il faudrait aller lire les
   * journaux de la passerelle pour comprendre.
   */
  readonly raw: string;
  readonly phoneNumber: string | null;
  readonly pushName: string | null;
  readonly error: string | null;
}

/** QR code d'appairage. */
export interface GatewayQrCode {
  /**
   * Image PNG en base64, SANS prefixe `data:`.
   *
   * C'est ce que le bot Telegram envoie (`sendPhoto` accepte du base64) : le
   * titulaire scanne l'ecran depuis WhatsApp > Appareils connectes. `null` quand
   * la passerelle ne fournit que la valeur brute.
   */
  readonly imageBase64: string | null;
  /** Contenu brut du QR, a dessiner soi-meme si l'image manque. */
  readonly rawValue: string | null;
  /** Code d'appairage par numero, quand la passerelle en propose un. */
  readonly pairingCode: string | null;
}

/** Contact tel que la passerelle le rend, avant mise en cache. */
export interface GatewayContact {
  readonly jid: string;
  readonly name: string | null;
  readonly phoneNumber: string | null;
  readonly isBusiness: boolean;
}

/** Resultat d'un envoi accepte par la passerelle. */
export interface GatewaySendResult {
  /** Identifiant du message cote WhatsApp — la seule preuve d'envoi exploitable. */
  readonly messageId: string | null;
  readonly sentAt: Date;
}

/** Options de synchronisation du repertoire. */
export interface GatewayContactQuery {
  readonly limit: number;
  readonly offset: number;
}

/**
 * Codes d'erreur STABLES de la passerelle.
 *
 * Recopies dans `error.code` par le controleur d'integration : un workflow n8n
 * teste ces codes, jamais les messages (voir `docs/API-N8N.md` §4).
 */
export const WHATSAPP_ERROR_CODES = {
  /** Aucune passerelle configuree (`WHATSAPP_GATEWAY_DRIVER=none`). */
  NOT_CONFIGURED: 'WHATSAPP_GATEWAY_NOT_CONFIGURED',
  /** La passerelle ne repond pas, ou pas dans le delai. */
  UNREACHABLE: 'WHATSAPP_GATEWAY_UNREACHABLE',
  /** Cle d'API refusee par la passerelle (401/403). */
  UNAUTHORIZED: 'WHATSAPP_GATEWAY_UNAUTHORIZED',
  /** La session n'existe pas cote passerelle (jamais creee, ou supprimee). */
  SESSION_NOT_FOUND: 'WHATSAPP_SESSION_NOT_FOUND',
  /** La session existe mais n'est pas appairee : l'envoi est impossible. */
  SESSION_NOT_CONNECTED: 'WHATSAPP_SESSION_NOT_CONNECTED',
  /** Fonctionnalite absente du pilote ou de sa licence (ex. repertoire WAHA Core). */
  FEATURE_UNAVAILABLE: 'WHATSAPP_FEATURE_UNAVAILABLE',
  /** Destinataire illisible (ni numero, ni JID). */
  INVALID_RECIPIENT: 'WHATSAPP_INVALID_RECIPIENT',
  /** La passerelle a repondu en erreur. */
  UPSTREAM_FAILED: 'WHATSAPP_GATEWAY_FAILED',
} as const;

export type WhatsAppErrorCode = (typeof WHATSAPP_ERROR_CODES)[keyof typeof WHATSAPP_ERROR_CODES];

/**
 * Erreur de passerelle.
 *
 * Comme `TranscriptionError` : elle porte un CODE stable et le statut d'origine,
 * mais ne decide d'aucun statut HTTP. C'est le service, puis le filtre global,
 * qui traduisent.
 */
export class WhatsAppGatewayError extends Error {
  constructor(
    readonly code: WhatsAppErrorCode,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'WhatsAppGatewayError';
  }
}

/** La passerelle. Neuf operations — pas une de plus. */
export interface WhatsAppGateway {
  readonly driver: WhatsAppGatewayDriver;
  /**
   * Vrai si un appel peut reussir.
   *
   * Sert au contrat d'API et aux messages : annoncer « la passerelle n'est pas
   * configuree » est plus utile que de laisser un appelant decouvrir un 503 au
   * milieu d'un workflow.
   */
  readonly configured: boolean;

  /** Cree la session cote passerelle si elle n'existe pas. Idempotent. */
  ensureSession(sessionName: string): Promise<void>;

  /** Demarre la session (la rend prete a afficher un QR). */
  startSession(sessionName: string): Promise<void>;

  /** Etat courant, traduit. */
  getStatus(sessionName: string): Promise<GatewaySessionStatus>;

  /** QR d'appairage. Leve si la session n'est pas en attente de couplage. */
  getQrCode(sessionName: string): Promise<GatewayQrCode>;

  /** Deconnecte la session SANS la supprimer : elle peut etre reaffichee. */
  logout(sessionName: string): Promise<void>;

  /** Supprime la session et ses identifiants cote passerelle. Definitif. */
  deleteSession(sessionName: string): Promise<void>;

  /** Repertoire du compte appaire, page par page. */
  listContacts(sessionName: string, query: GatewayContactQuery): Promise<GatewayContact[]>;

  /** Envoi d'un message texte. */
  sendText(sessionName: string, chatId: string, body: string): Promise<GatewaySendResult>;
}

/** Configuration resolue de la passerelle, lue une seule fois au demarrage. */
export interface WhatsAppGatewayConfig {
  readonly driver: WhatsAppGatewayDriver;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly sessionPrefix: string;
  readonly maxMessagesPerHour: number;
  readonly maxBodyLength: number;
  readonly sessionCacheMs: number;
  readonly contactCacheMinutes: number;
  readonly defaultCountryCode: string;
  /** Duree de validite du code d'autorisation, en millisecondes. */
  readonly delegationCodeTtlMs: number;
  /** Duree du consentement accorde, en millisecondes ; `null` = sans limite. */
  readonly consentTtlMs: number | null;
}
