import {
  commonStatusToErrorCode,
  describeGatewayBody,
  GatewayHttpClient,
  withoutQuery,
} from './http.js';
import {
  WhatsAppGatewayError,
  WHATSAPP_ERROR_CODES,
  type GatewayContact,
  type GatewayContactQuery,
  type GatewayQrCode,
  type GatewaySendResult,
  type GatewaySessionState,
  type GatewaySessionStatus,
  type WhatsAppGateway,
  type WhatsAppGatewayConfig,
  type WhatsAppGatewayDriver,
} from '../whatsapp.types.js';
import { canonicalJid, phoneNumberFromJid } from '../whatsapp-identity.js';

/**
 * PILOTE WAHA — WhatsApp HTTP API (`devlikeapro/waha`).
 *
 * -------------------------------------------------------------------------
 * POURQUOI CE PILOTE EN PREMIER
 * -------------------------------------------------------------------------
 * Une seule instance tient PLUSIEURS sessions, ce qui est exactement la forme du
 * besoin ici : chaque membre (ou chaque tiers deleguant) a sa propre session, et
 * personne ne veut un conteneur par numero. Le deploiement tient en un service
 * Compose et un volume — voir `docker-compose.yml`, profil `gateway`.
 *
 * -------------------------------------------------------------------------
 * CE QUE CE FICHIER SAIT DE WAHA, ET RIEN DE PLUS
 * -------------------------------------------------------------------------
 * Les chemins sont ceux des controleurs de WAHA (`src/api/*.controller.ts`) :
 *
 *   POST   /api/sessions                 cree une session
 *   GET    /api/sessions/{name}          etat (`WAHASessionStatus`)
 *   POST   /api/sessions/{name}/start    demarre
 *   POST   /api/sessions/{name}/logout   deconnecte (session conservée)
 *   DELETE /api/sessions/{name}          supprime la session et ses identifiants
 *   GET    /api/{name}/auth/qr           PNG du QR (`?format=raw` rend la valeur)
 *   GET    /api/{name}/profile           profil du compte appaire
 *   GET    /api/contacts/all?session=…   repertoire
 *   POST   /api/sendText                 envoi (`{session, chatId, text}`)
 *
 * Authentification : en-tete `X-Api-Key`.
 *
 * DEUX LIMITES ASSUMEES, ET ECRITES PLUTOT QUE DECOUVERTES EN PRODUCTION :
 *
 *  1. `/api/contacts/all` fait partie de WAHA PLUS. Sur une instance Core, il
 *     repond 402/403/404 : ce pilote traduit alors en
 *     `WHATSAPP_FEATURE_UNAVAILABLE` avec un message qui nomme la licence, au
 *     lieu de rendre un repertoire vide qui ferait croire que le compte n'a
 *     aucun contact.
 *  2. Le QR est rendu en PNG. WAHA accepte aussi `?format=raw`, qui donne la
 *     valeur a dessiner soi-meme ; ce pilote ne l'emploie qu'en repli, quand la
 *     reponse n'est pas une image (session deja appairee, par exemple).
 */

/** Etat brut de WAHA -> vocabulaire de Comexa. */
const STATE_BY_WAHA_STATUS: Readonly<Record<string, GatewaySessionState>> = {
  STOPPED: 'DISCONNECTED',
  STARTING: 'STARTING',
  SCAN_QR_CODE: 'WAITING_QR',
  WORKING: 'CONNECTED',
  FAILED: 'FAILED',
  // L'appairage par cle de passe attend une action du titulaire : rien n'est
  // envoyable, et le QR n'est pas la bonne reponse non plus.
  PASSKEY_REQUIRED: 'STARTING',
  PASSKEY_CONFIRMATION_REQUIRED: 'STARTING',
};

interface WahaSessionDto {
  name?: string;
  status?: string;
  error?: string;
  me?: { id?: string | { _serialized?: string }; pushName?: string };
}

interface WahaProfileDto {
  id?: string | { _serialized?: string };
  pushName?: string;
  name?: string;
}

interface WahaContactDto {
  id?: string | { _serialized?: string };
  name?: string;
  pushName?: string;
  notifyName?: string;
  isBusiness?: boolean;
}

interface WahaMessageDto {
  id?: string | { _serialized?: string };
  key?: { id?: string };
}

export class WahaGateway implements WhatsAppGateway {
  readonly driver: WhatsAppGatewayDriver = 'waha';
  readonly configured = true;

  constructor(
    private readonly config: WhatsAppGatewayConfig,
    private readonly http: GatewayHttpClient = new GatewayHttpClient(),
  ) {}

  private get baseUrl(): string {
    return this.config.baseUrl.replace(/\/+$/, '');
  }

  private get headers(): Record<string, string> {
    return { 'X-Api-Key': this.config.apiKey };
  }

  private get timeoutMs(): number {
    return this.config.timeoutMs;
  }

  async ensureSession(sessionName: string): Promise<void> {
    const response = await this.http.request<WahaSessionDto>({
      method: 'POST',
      url: `${this.baseUrl}/api/sessions`,
      headers: this.headers,
      body: { name: sessionName },
      timeoutMs: this.timeoutMs,
      driver: this.driver,
    });

    // 200/201 : creee. 409 : elle existe deja — c'est le resultat cherche, pas
    // une erreur. Toute autre reponse est un echec reel.
    if (response.status === 200 || response.status === 201 || response.status === 409) {
      return;
    }

    throw this.errorFrom(
      response.status,
      describeGatewayBody(response.body, `WAHA a refuse de creer la session « ${sessionName} ».`),
      sessionName,
    );
  }

  async startSession(sessionName: string): Promise<void> {
    const response = await this.http.request<WahaSessionDto>({
      method: 'POST',
      url: `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionName)}/start`,
      headers: this.headers,
      timeoutMs: this.timeoutMs,
      driver: this.driver,
    });

    if (response.status >= 200 && response.status < 300) return;

    throw this.errorFrom(
      response.status,
      describeGatewayBody(response.body, `WAHA n'a pas pu demarrer la session « ${sessionName} ».`),
      sessionName,
    );
  }

  async getStatus(sessionName: string): Promise<GatewaySessionStatus> {
    const response = await this.http.request<WahaSessionDto>({
      method: 'GET',
      url: `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionName)}`,
      headers: this.headers,
      timeoutMs: this.timeoutMs,
      driver: this.driver,
    });

    if (response.status === 404) {
      throw new WhatsAppGatewayError(
        WHATSAPP_ERROR_CODES.SESSION_NOT_FOUND,
        `La session « ${sessionName} » n'existe pas cote WAHA. Elle a pu etre supprimee, ` +
          'ou la passerelle a perdu son volume de donnees.',
        response.status,
      );
    }

    if (response.status < 200 || response.status >= 300 || !response.body) {
      throw this.errorFrom(
        response.status,
        describeGatewayBody(
          response.body,
          `WAHA n'a pas rendu l'etat de la session « ${sessionName} ».`,
        ),
        sessionName,
      );
    }

    const raw = String(response.body.status ?? 'UNKNOWN');
    const state = STATE_BY_WAHA_STATUS[raw];

    // Le profil est lu SEULEMENT si la session est appairee, et son echec n'est
    // pas une erreur : un numero et un nom d'affichage sont utiles, mais ne
    // valent pas de faire echouer une interrogation d'etat.
    const profile = state === 'CONNECTED' ? await this.readProfile(sessionName) : null;

    return {
      state: state ?? 'FAILED',
      raw,
      phoneNumber: profile?.phoneNumber ?? phoneNumberFrom(response.body.me?.id) ?? null,
      pushName: profile?.pushName ?? response.body.me?.pushName ?? null,
      error:
        state === undefined
          ? `Etat WAHA inconnu : « ${raw} ». La version de la passerelle a peut-etre change.`
          : (response.body.error ?? null),
    };
  }

  async getQrCode(sessionName: string): Promise<GatewayQrCode> {
    const image = await this.http.requestBuffer({
      method: 'GET',
      url: `${this.baseUrl}/api/${encodeURIComponent(sessionName)}/auth/qr`,
      headers: this.headers,
      timeoutMs: this.timeoutMs,
      driver: this.driver,
    });

    if (image.status >= 200 && image.status < 300 && image.bytes && image.bytes.length > 0) {
      return {
        imageBase64: image.bytes.toString('base64'),
        rawValue: null,
        pairingCode: null,
      };
    }

    // Reponse JSON : WAHA rend `{ value }` quand il n'a pas d'image, ou une
    // erreur. Les deux cas se distinguent par le statut.
    if (image.status >= 200 && image.status < 300 && image.text) {
      const parsed = safeJson<{ value?: unknown }>(image.text);
      const value = typeof parsed?.value === 'string' ? parsed.value : null;
      if (value) {
        return { imageBase64: null, rawValue: value, pairingCode: null };
      }
    }

    // 412 : la session est deja appairee, il n'y a plus de QR a montrer. Le dire
    // autrement ferait chercher un QR introuvable.
    if (image.status === 412) {
      throw new WhatsAppGatewayError(
        WHATSAPP_ERROR_CODES.SESSION_NOT_CONNECTED,
        `WAHA n'a pas de QR a rendre pour « ${sessionName} » : la session est deja appairee, ` +
          'ou elle ne tourne pas. Interroger l’etat avant de demander un QR.',
        image.status,
      );
    }

    throw this.errorFrom(
      image.status,
      image.text || `WAHA n'a pas rendu de QR pour la session « ${sessionName} ».`,
      sessionName,
    );
  }

  async logout(sessionName: string): Promise<void> {
    const response = await this.http.request<unknown>({
      method: 'POST',
      url: `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionName)}/logout`,
      headers: this.headers,
      timeoutMs: this.timeoutMs,
      driver: this.driver,
    });

    // 404 : rien a deconnecter — l'objectif (une session qui n'a plus acces) est
    // deja atteint. Le traiter comme une erreur bloquerait la revocation, ce qui
    // est le contraire de ce qu'on veut : revoquer doit toujours aboutir.
    if ((response.status >= 200 && response.status < 300) || response.status === 404) return;

    throw this.errorFrom(
      response.status,
      describeGatewayBody(
        response.body,
        `WAHA n'a pas pu deconnecter la session « ${sessionName} ».`,
      ),
      sessionName,
    );
  }

  async deleteSession(sessionName: string): Promise<void> {
    const response = await this.http.request<unknown>({
      method: 'DELETE',
      url: `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionName)}`,
      headers: this.headers,
      timeoutMs: this.timeoutMs,
      driver: this.driver,
    });

    if ((response.status >= 200 && response.status < 300) || response.status === 404) return;

    throw this.errorFrom(
      response.status,
      describeGatewayBody(
        response.body,
        `WAHA n'a pas pu supprimer la session « ${sessionName} ».`,
      ),
      sessionName,
    );
  }

  async listContacts(sessionName: string, query: GatewayContactQuery): Promise<GatewayContact[]> {
    const url =
      `${this.baseUrl}/api/contacts/all` +
      `?session=${encodeURIComponent(sessionName)}` +
      `&limit=${Math.max(1, Math.min(query.limit, 10_000))}` +
      `&offset=${Math.max(0, query.offset)}`;

    const response = await this.http.request<WahaContactDto[] | { contacts?: WahaContactDto[] }>({
      method: 'GET',
      url,
      headers: this.headers,
      timeoutMs: this.timeoutMs,
      driver: this.driver,
    });

    if (response.status === 401 || response.status === 403 || response.status === 402) {
      throw new WhatsAppGatewayError(
        WHATSAPP_ERROR_CODES.FEATURE_UNAVAILABLE,
        `Le repertoire n'est pas disponible sur cette instance WAHA (HTTP ${response.status}) : ` +
          'la liste des contacts fait partie de WAHA PLUS. Sans cette licence, les envois ' +
          'restent possibles vers un numero connu, mais aucun repertoire ne peut etre lu.',
        response.status,
      );
    }

    if (response.status === 404) {
      throw this.errorFrom(
        response.status,
        describeGatewayBody(response.body, `Session « ${sessionName} » introuvable cote WAHA.`),
        sessionName,
      );
    }

    if (response.status < 200 || response.status >= 300) {
      throw this.errorFrom(
        response.status,
        describeGatewayBody(
          response.body,
          `WAHA n'a pas rendu le repertoire de « ${sessionName} ».`,
        ),
        sessionName,
      );
    }

    const rows = Array.isArray(response.body) ? response.body : (response.body?.contacts ?? []);

    return rows
      .map((row) => {
        // WAHA rend encore des JID en `@c.us` (forme historique des clients
        // WhatsApp Web). La forme canonique est celle que produit
        // `resolveRecipient`, sinon le meme contact existe sous deux identifiants
        // — voir `canonicalJid`.
        const jid = canonicalJid(serializedOf(row?.id));

        return {
          jid,
          name: firstNonEmpty(row?.name, row?.notifyName, row?.pushName),
          phoneNumber: phoneNumberFrom(jid),
          isBusiness: row?.isBusiness === true,
        };
      })
      .filter((contact): contact is GatewayContact => contact.jid.length > 0);
  }

  async sendText(sessionName: string, chatId: string, body: string): Promise<GatewaySendResult> {
    const response = await this.http.request<WahaMessageDto>({
      method: 'POST',
      url: `${this.baseUrl}/api/sendText`,
      headers: this.headers,
      body: { session: sessionName, chatId, text: body },
      timeoutMs: this.timeoutMs,
      driver: this.driver,
    });

    if (response.status < 200 || response.status >= 300) {
      throw this.errorFrom(
        response.status,
        describeGatewayBody(response.body, `WAHA a refuse l'envoi vers « ${chatId} ».`),
        sessionName,
      );
    }

    return {
      messageId: serializedOf(response.body?.id) || response.body?.key?.id || null,
      sentAt: new Date(),
    };
  }

  /** Profil du compte appaire. Un echec n'est jamais une erreur. */
  private async readProfile(
    sessionName: string,
  ): Promise<{ phoneNumber: string | null; pushName: string | null } | null> {
    try {
      const response = await this.http.request<WahaProfileDto>({
        method: 'GET',
        url: `${this.baseUrl}/api/${encodeURIComponent(sessionName)}/profile`,
        headers: this.headers,
        timeoutMs: this.timeoutMs,
        driver: this.driver,
      });

      if (response.status < 200 || response.status >= 300 || !response.body) return null;

      return {
        phoneNumber: phoneNumberFrom(response.body.id),
        pushName: firstNonEmpty(response.body.pushName, response.body.name),
      };
    } catch {
      // Passerelle lente ou route absente selon la version : l'etat reste
      // utilisable sans profil, et une interrogation d'etat ne doit jamais
      // echouer pour un champ decoratif.
      return null;
    }
  }

  /**
   * Traduit un statut en erreur Comexa.
   *
   * Le `404` devient `SESSION_NOT_FOUND` — et non une erreur generique — parce
   * que c'est la cause la plus frequente apres une perte du volume de la
   * passerelle, et que le message doit orienter vers la session, pas vers la cle.
   */
  private errorFrom(status: number, message: string, sessionName: string): WhatsAppGatewayError {
    if (status === 404) {
      return new WhatsAppGatewayError(
        WHATSAPP_ERROR_CODES.SESSION_NOT_FOUND,
        `Session « ${sessionName} » introuvable cote WAHA. ${message}`,
        status,
      );
    }

    if (status === 412) {
      return new WhatsAppGatewayError(
        WHATSAPP_ERROR_CODES.SESSION_NOT_CONNECTED,
        `Session « ${sessionName} » non appairee. ${message}`,
        status,
      );
    }

    const code = commonStatusToErrorCode(status);
    const detail = withoutQuery(message);

    if (code === WHATSAPP_ERROR_CODES.UNAUTHORIZED) {
      return new WhatsAppGatewayError(
        code,
        `WAHA a refuse la cle d'API (HTTP ${status}). Verifier WHATSAPP_GATEWAY_API_KEY : ` +
          "elle doit correspondre au WHATSAPP_API_KEY de l'instance.",
        status,
      );
    }

    return new WhatsAppGatewayError(code, detail, status);
  }
}

/** `id` peut etre une chaine ou `{ _serialized }` selon la version de WAHA. */
function serializedOf(id: string | { _serialized?: string } | undefined | null): string {
  if (!id) return '';
  if (typeof id === 'string') return id;
  return typeof id._serialized === 'string' ? id._serialized : '';
}

/** Extrait le numero d'un JID utilisateur (`213555123456@s.whatsapp.net`). */
/**
 * Numero d'un identifiant WAHA.
 *
 * Passe par `phoneNumberFromJid` : un JID de groupe ne doit JAMAIS devenir un
 * numero (voir la fonction, dans `whatsapp-identity.ts`).
 */
function phoneNumberFrom(id: string | { _serialized?: string } | undefined | null): string | null {
  return phoneNumberFromJid(serializedOf(id));
}

function firstNonEmpty(...values: Array<string | undefined | null>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function safeJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
