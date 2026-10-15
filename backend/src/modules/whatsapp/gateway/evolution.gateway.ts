import { commonStatusToErrorCode, describeGatewayBody, GatewayHttpClient } from './http.js';
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
 * PILOTE EVOLUTION API (`EvolutionAPI/evolution-api`, v2).
 *
 * -------------------------------------------------------------------------
 * QUAND LE CHOISIR PLUTOT QUE WAHA
 * -------------------------------------------------------------------------
 * Evolution apporte une administration complete (instances, webhooks, base de
 * donnees propre, file d'envoi) et une API orientee « instance » la ou WAHA est
 * oriente « session ». Il convient quand la passerelle doit aussi servir
 * d'autres usages que Comexa, ou quand l'equipe veut une interface graphique de
 * gestion. En contrepartie, il exige plus de configuration au depart.
 *
 * -------------------------------------------------------------------------
 * CHEMINS EMPLOYES (montes dans `src/api/routes/index.router.ts` d'Evolution)
 * -------------------------------------------------------------------------
 *   POST   /instance/create                       `{instanceName, qrcode, integration}`
 *   GET    /instance/connect/{name}               rend le QR (`base64`, `code`, `pairingCode`)
 *   GET    /instance/connectionState/{name}       `{instance: {state}}`
 *   GET    /instance/fetchInstances?instanceName= profil (`ownerJid`, `profileName`)
 *   DELETE /instance/logout/{name}                deconnecte
 *   DELETE /instance/delete/{name}                supprime l'instance et ses cles
 *   POST   /chat/findContacts/{name}              `{limit, offset}` -> repertoire
 *   POST   /message/sendText/{name}               `{number, text}` -> message envoye
 *
 * Authentification : en-tete `apikey`.
 *
 * UNE DIFFERENCE QUI A DES CONSEQUENCES : Evolution rend le QR en BASE64 dans un
 * corps JSON (`base64: "data:image/png;base64,..."`) alors que WAHA rend
 * directement un PNG. Les deux pilotes normalisent vers `imageBase64` SANS
 * prefixe `data:` — c'est ce que `sendPhoto` de Telegram attend, et un prefixe
 * oublie ou ajoute produit une image illisible sans aucune erreur cote API.
 */

/** Etat brut d'Evolution -> vocabulaire de Comexa. */
const STATE_BY_EVOLUTION_STATE: Readonly<Record<string, GatewaySessionState>> = {
  open: 'CONNECTED',
  connecting: 'STARTING',
  close: 'DISCONNECTED',
  refused: 'FAILED',
};

/** Integration par defaut : le client multidevice, seul capable d'appairer un compte personnel. */
const DEFAULT_INTEGRATION = 'WHATSAPP-BAILEYS';

interface EvolutionConnectionState {
  instance?: { state?: string; instanceName?: string };
}

interface EvolutionQrPayload {
  pairingCode?: string | null;
  code?: string | null;
  base64?: string | null;
  count?: number;
}

interface EvolutionInstanceDto {
  name?: string;
  instanceName?: string;
  connectionStatus?: string;
  ownerJid?: string;
  profileName?: string;
  profilePictureUrl?: string;
  number?: string;
}

interface EvolutionContactDto {
  id?: string | { _serialized?: string };
  remoteJid?: string;
  name?: string;
  pushName?: string;
  notifyName?: string;
  verifiedName?: string;
  profileName?: string;
  jid?: string;
}

interface EvolutionMessageDto {
  key?: { id?: string; remoteJid?: string };
  message?: { conversation?: string };
  status?: number;
}

export class EvolutionGateway implements WhatsAppGateway {
  readonly driver: WhatsAppGatewayDriver = 'evolution';
  readonly configured = true;

  constructor(
    private readonly config: WhatsAppGatewayConfig,
    private readonly http: GatewayHttpClient = new GatewayHttpClient(),
  ) {}

  private get baseUrl(): string {
    return this.config.baseUrl.replace(/\/+$/, '');
  }

  private get headers(): Record<string, string> {
    return { apikey: this.config.apiKey };
  }

  private get timeoutMs(): number {
    return this.config.timeoutMs;
  }

  async ensureSession(sessionName: string): Promise<void> {
    const response = await this.http.request<unknown>({
      method: 'POST',
      url: `${this.baseUrl}/instance/create`,
      headers: this.headers,
      body: {
        instanceName: sessionName,
        // Le QR sera demande explicitement (`connect`) : le rendre ici
        // produirait une image que personne n'affiche, perimee avant d'etre lue.
        qrcode: false,
        integration: DEFAULT_INTEGRATION,
      },
      timeoutMs: this.timeoutMs,
      driver: this.driver,
    });

    if (response.status >= 200 && response.status < 300) return;

    // Evolution signale une instance existante par un 403 dont le message nomme
    // le conflit. Le traiter comme une erreur empecherait toute reprise apres un
    // redemarrage : le but est d'AVOIR l'instance, pas de l'avoir creee ici.
    if (response.status === 403 || response.status === 409) {
      const detail = describeGatewayBody(response.body, '').toLowerCase();
      if (detail.includes('already') || detail.includes('use') || detail.includes('exist')) {
        return;
      }
    }

    throw this.errorFrom(
      response.status,
      describeGatewayBody(
        response.body,
        `Evolution a refuse de creer l'instance « ${sessionName} ».`,
      ),
      sessionName,
    );
  }

  async startSession(sessionName: string): Promise<void> {
    // Chez Evolution, « demarrer » et « afficher le QR » sont le MEME appel :
    // `GET /instance/connect/{name}` ouvre la session et rend le code. Le
    // resultat est volontairement ignore ici — l'appelant qui veut le QR
    // l'appelle ensuite, et celui qui veut seulement demarrer n'a rien a en
    // faire.
    const response = await this.http.request<EvolutionQrPayload>({
      method: 'GET',
      url: `${this.baseUrl}/instance/connect/${encodeURIComponent(sessionName)}`,
      headers: this.headers,
      timeoutMs: this.timeoutMs,
      driver: this.driver,
    });

    if (response.status >= 200 && response.status < 300) return;

    throw this.errorFrom(
      response.status,
      describeGatewayBody(
        response.body,
        `Evolution n'a pas pu demarrer l'instance « ${sessionName} ».`,
      ),
      sessionName,
    );
  }

  async getStatus(sessionName: string): Promise<GatewaySessionStatus> {
    const response = await this.http.request<EvolutionConnectionState>({
      method: 'GET',
      url: `${this.baseUrl}/instance/connectionState/${encodeURIComponent(sessionName)}`,
      headers: this.headers,
      timeoutMs: this.timeoutMs,
      driver: this.driver,
    });

    if (response.status === 404) {
      throw new WhatsAppGatewayError(
        WHATSAPP_ERROR_CODES.SESSION_NOT_FOUND,
        `L'instance « ${sessionName} » n'existe pas cote Evolution. Elle a pu etre supprimee, ` +
          'ou la passerelle a perdu sa base de donnees.',
        response.status,
      );
    }

    if (response.status < 200 || response.status >= 300) {
      throw this.errorFrom(
        response.status,
        describeGatewayBody(response.body, `Evolution n'a pas rendu l'etat de « ${sessionName} ».`),
        sessionName,
      );
    }

    const raw = String(response.body?.instance?.state ?? 'unknown');
    const state = STATE_BY_EVOLUTION_STATE[raw];
    const profile = state === 'CONNECTED' ? await this.readInstance(sessionName) : null;

    return {
      state: state ?? 'DISCONNECTED',
      raw,
      phoneNumber: profile?.phoneNumber ?? null,
      pushName: profile?.pushName ?? null,
      error:
        state === undefined
          ? `Etat Evolution inconnu : « ${raw} ». La version de la passerelle a peut-etre change.`
          : null,
    };
  }

  async getQrCode(sessionName: string): Promise<GatewayQrCode> {
    const response = await this.http.request<EvolutionQrPayload>({
      method: 'GET',
      url: `${this.baseUrl}/instance/connect/${encodeURIComponent(sessionName)}`,
      headers: this.headers,
      timeoutMs: this.timeoutMs,
      driver: this.driver,
    });

    if (response.status === 404) {
      throw new WhatsAppGatewayError(
        WHATSAPP_ERROR_CODES.SESSION_NOT_FOUND,
        `L'instance « ${sessionName} » n'existe pas cote Evolution.`,
        response.status,
      );
    }

    if (response.status < 200 || response.status >= 300) {
      throw this.errorFrom(
        response.status,
        describeGatewayBody(
          response.body,
          `Evolution n'a pas rendu de QR pour « ${sessionName} ».`,
        ),
        sessionName,
      );
    }

    // Instance deja appairee : Evolution renvoie un etat, pas un QR. Le dire
    // clairement evite d'afficher une image vide dans Telegram.
    const imageBase64 = stripDataUrl(response.body?.base64);
    if (!imageBase64 && !response.body?.code && !response.body?.pairingCode) {
      throw new WhatsAppGatewayError(
        WHATSAPP_ERROR_CODES.SESSION_NOT_CONNECTED,
        `Evolution n'a rendu aucun QR pour « ${sessionName} » : l'instance est deja ` +
          'appairee, ou son telephone est hors ligne.',
        response.status,
      );
    }

    return {
      imageBase64,
      rawValue: response.body?.code ?? null,
      pairingCode: response.body?.pairingCode ?? null,
    };
  }

  async logout(sessionName: string): Promise<void> {
    const response = await this.http.request<unknown>({
      method: 'DELETE',
      url: `${this.baseUrl}/instance/logout/${encodeURIComponent(sessionName)}`,
      headers: this.headers,
      timeoutMs: this.timeoutMs,
      driver: this.driver,
    });

    if ((response.status >= 200 && response.status < 300) || response.status === 404) return;

    throw this.errorFrom(
      response.status,
      describeGatewayBody(response.body, `Evolution n'a pas pu deconnecter « ${sessionName} ».`),
      sessionName,
    );
  }

  async deleteSession(sessionName: string): Promise<void> {
    const response = await this.http.request<unknown>({
      method: 'DELETE',
      url: `${this.baseUrl}/instance/delete/${encodeURIComponent(sessionName)}`,
      headers: this.headers,
      timeoutMs: this.timeoutMs,
      driver: this.driver,
    });

    if ((response.status >= 200 && response.status < 300) || response.status === 404) return;

    throw this.errorFrom(
      response.status,
      describeGatewayBody(response.body, `Evolution n'a pas pu supprimer « ${sessionName} ».`),
      sessionName,
    );
  }

  async listContacts(sessionName: string, query: GatewayContactQuery): Promise<GatewayContact[]> {
    const response = await this.http.request<
      EvolutionContactDto[] | { contacts?: EvolutionContactDto[] }
    >({
      method: 'POST',
      url: `${this.baseUrl}/chat/findContacts/${encodeURIComponent(sessionName)}`,
      headers: this.headers,
      body: {
        limit: Math.max(1, Math.min(query.limit, 10_000)),
        offset: Math.max(0, query.offset),
      },
      timeoutMs: this.timeoutMs,
      driver: this.driver,
    });

    if (response.status === 401 || response.status === 403) {
      throw new WhatsAppGatewayError(
        WHATSAPP_ERROR_CODES.UNAUTHORIZED,
        `Evolution a refuse la cle d'API (HTTP ${response.status}). Verifier ` +
          'WHATSAPP_GATEWAY_API_KEY : c’est l’en-tete `apikey` de l’instance.',
        response.status,
      );
    }

    if (response.status < 200 || response.status >= 300) {
      throw this.errorFrom(
        response.status,
        describeGatewayBody(
          response.body,
          `Evolution n'a pas rendu le repertoire de « ${sessionName} ».`,
        ),
        sessionName,
      );
    }

    const rows = Array.isArray(response.body) ? response.body : (response.body?.contacts ?? []);

    return rows
      .map((row) => {
        // Forme canonique, pour la raison donnee dans `canonicalJid` : le meme
        // contact doit avoir UN identifiant, quel que soit le pilote qui l'a lu.
        const jid = canonicalJid(row?.remoteJid ?? serializedOf(row?.id) ?? row?.jid ?? '');
        return {
          jid,
          name: firstNonEmpty(
            row?.name,
            row?.notifyName,
            row?.pushName,
            row?.verifiedName,
            row?.profileName,
          ),
          phoneNumber: phoneNumberFrom(jid),
          // Evolution ne distingue pas `isBusiness` dans `findContacts` : un nom
          // verifie (`verifiedName`) est l'indice le plus fiable dont on dispose.
          isBusiness: typeof row?.verifiedName === 'string' && row.verifiedName.trim().length > 0,
        };
      })
      .filter((contact): contact is GatewayContact => contact.jid.length > 0);
  }

  async sendText(sessionName: string, chatId: string, body: string): Promise<GatewaySendResult> {
    const response = await this.http.request<EvolutionMessageDto>({
      method: 'POST',
      url: `${this.baseUrl}/message/sendText/${encodeURIComponent(sessionName)}`,
      headers: this.headers,
      // `number` accepte un JID complet ou un numero : on transmet le JID, qui
      // est la forme non ambigue (un numero sans `@` fait deviner le suffixe).
      body: { number: chatId, text: body },
      timeoutMs: this.timeoutMs,
      driver: this.driver,
    });

    if (response.status < 200 || response.status >= 300) {
      throw this.errorFrom(
        response.status,
        describeGatewayBody(response.body, `Evolution a refuse l'envoi vers « ${chatId} ».`),
        sessionName,
      );
    }

    return {
      messageId: response.body?.key?.id ?? null,
      sentAt: new Date(),
    };
  }

  /** Profil de l'instance. Un echec n'est jamais une erreur. */
  private async readInstance(
    sessionName: string,
  ): Promise<{ phoneNumber: string | null; pushName: string | null } | null> {
    try {
      const response = await this.http.request<EvolutionInstanceDto[] | EvolutionInstanceDto>({
        method: 'GET',
        url:
          `${this.baseUrl}/instance/fetchInstances` +
          `?instanceName=${encodeURIComponent(sessionName)}`,
        headers: this.headers,
        timeoutMs: this.timeoutMs,
        driver: this.driver,
      });

      if (response.status < 200 || response.status >= 300 || !response.body) return null;

      const instance = Array.isArray(response.body) ? response.body[0] : response.body;
      if (!instance) return null;

      return {
        phoneNumber: phoneNumberFrom(instance.ownerJid) ?? digitsOnly(instance.number) ?? null,
        pushName: firstNonEmpty(instance.profileName, instance.name),
      };
    } catch {
      return null;
    }
  }

  private errorFrom(status: number, message: string, sessionName: string): WhatsAppGatewayError {
    if (status === 404) {
      return new WhatsAppGatewayError(
        WHATSAPP_ERROR_CODES.SESSION_NOT_FOUND,
        `Instance « ${sessionName} » introuvable cote Evolution. ${message}`,
        status,
      );
    }

    const code = commonStatusToErrorCode(status);

    if (code === WHATSAPP_ERROR_CODES.UNAUTHORIZED) {
      return new WhatsAppGatewayError(
        code,
        `Evolution a refuse la cle d'API (HTTP ${status}). Verifier WHATSAPP_GATEWAY_API_KEY.`,
        status,
      );
    }

    return new WhatsAppGatewayError(code, message, status);
  }
}

/** Retire le prefixe `data:image/png;base64,` qu'Evolution colle a son QR. */
export function stripDataUrl(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^data:[^;]+;base64,(.+)$/s.exec(trimmed);
  return match?.[1] ?? trimmed;
}

function serializedOf(id: string | { _serialized?: string } | undefined | null): string | null {
  if (!id) return null;
  if (typeof id === 'string') return id;
  return typeof id._serialized === 'string' ? id._serialized : null;
}

/**
 * Numero d'un JID Evolution.
 *
 * Passe par `phoneNumberFromJid` : un JID de groupe ne doit JAMAIS devenir un
 * numero (voir la fonction, dans `whatsapp-identity.ts`).
 */
function phoneNumberFrom(jid: string | undefined | null): string | null {
  return phoneNumberFromJid(jid);
}

function digitsOnly(value: string | undefined | null): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

function firstNonEmpty(...values: Array<string | undefined | null>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}
