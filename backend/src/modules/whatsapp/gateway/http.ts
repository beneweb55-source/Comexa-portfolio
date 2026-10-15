import {
  WhatsAppGatewayError,
  WHATSAPP_ERROR_CODES,
  type WhatsAppErrorCode,
  type WhatsAppGatewayDriver,
} from '../whatsapp.types.js';

/**
 * CLIENT HTTP DES PASSERELLES — un seul endroit pour parler HTTP.
 *
 * -------------------------------------------------------------------------
 * POURQUOI CE FICHIER EXISTE
 * -------------------------------------------------------------------------
 * WAHA et Evolution n'ont rien en commun sauf la forme de l'echange : une cle
 * d'API dans un en-tete, du JSON, un delai, et des statuts a traduire. Sans ce
 * client, chacun des deux pilotes aurait ecrit son `fetch`, son `AbortSignal` et
 * sa table de correspondance des erreurs — et les deux tables auraient fini par
 * diverger, ce qui se verrait comme « le meme incident ne remonte pas la meme
 * erreur selon le pilote ».
 *
 * -------------------------------------------------------------------------
 * `fetchImpl` EST INJECTABLE, ET CE N'EST PAS DU CONFORT
 * -------------------------------------------------------------------------
 * Sans lui, tester la traduction des statuts exigerait un serveur reel ou un
 * mock global de `fetch` (donc un effet de bord visible par les autres tests du
 * meme processus). Ici, un pilote de test rend la reponse voulue, et les regles
 * — 401 devient `WHATSAPP_GATEWAY_UNAUTHORIZED`, un delai depasse devient
 * `WHATSAPP_GATEWAY_UNREACHABLE` — sont verifiees en quelques lignes.
 */

export type FetchLike = typeof fetch;

export interface GatewayRequestOptions {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly timeoutMs: number;
  /** Nomme le pilote dans les messages : sans lui, on ne sait pas qui a echoue. */
  readonly driver: WhatsAppGatewayDriver;
}

export interface GatewayResponse<T> {
  readonly status: number;
  /** Corps interprete en JSON, ou `null` s'il n'est pas du JSON. */
  readonly body: T | null;
  /** Corps brut, tronque — sert aux messages d'erreur. */
  readonly text: string;
}

/** Longueur maximale du corps brut conserve pour un message d'erreur. */
const MAX_ERROR_DETAIL = 400;

export class GatewayHttpClient {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  /**
   * Execute la requete et rend la reponse, SANS lever sur un statut d'erreur.
   *
   * Cette separation est deliberatee : WAHA et Evolution n'emploient pas les
   * memes statuts pour les memes situations (une session absente vaut 404 chez
   * l'un, 403 chez l'autre). C'est donc le pilote qui decide, a partir du
   * statut, et non ce client.
   *
   * Seuls le reseau et le delai levent — ils ne dependent pas du pilote.
   */
  async request<T>(options: GatewayRequestOptions): Promise<GatewayResponse<T>> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    };

    let response: Response;
    try {
      response = await this.fetchImpl(options.url, {
        method: options.method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error) {
      const isAbort =
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

      throw new WhatsAppGatewayError(
        WHATSAPP_ERROR_CODES.UNREACHABLE,
        isAbort
          ? `La passerelle WhatsApp (${options.driver}) n'a pas repondu en ${options.timeoutMs} ms : ` +
              `${options.method} ${withoutQuery(options.url)}.`
          : `La passerelle WhatsApp (${options.driver}) est injoignable : ` +
              `${options.method} ${withoutQuery(options.url)}. ` +
              `Detail : ${error instanceof Error ? error.message : 'inconnu'}. ` +
              'Verifier WHATSAPP_GATEWAY_URL et que le conteneur de la passerelle tourne.',
      );
    }

    const text = await response.text().catch(() => '');
    return {
      status: response.status,
      body: parseJson<T>(text),
      text: text.slice(0, MAX_ERROR_DETAIL),
    };
  }

  /** Requete binaire (le QR de WAHA est un PNG). */
  async requestBuffer(options: GatewayRequestOptions): Promise<{
    status: number;
    contentType: string;
    bytes: Buffer | null;
    text: string;
  }> {
    let response: Response;
    try {
      response = await this.fetchImpl(options.url, {
        method: options.method,
        headers: { Accept: 'image/png, application/json', ...options.headers },
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error) {
      throw new WhatsAppGatewayError(
        WHATSAPP_ERROR_CODES.UNREACHABLE,
        `La passerelle WhatsApp (${options.driver}) est injoignable : ` +
          `${options.method} ${withoutQuery(options.url)}. ` +
          `Detail : ${error instanceof Error ? error.message : 'inconnu'}`,
      );
    }

    const contentType = response.headers.get('content-type') ?? '';

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        status: response.status,
        contentType,
        bytes: null,
        text: text.slice(0, MAX_ERROR_DETAIL),
      };
    }

    // Le contenu est JSON quand la passerelle n'a pas d'image a donner (session
    // deja appairee, ou pilote qui ne rend que la valeur brute) : le renvoyer
    // comme « image » produirait un PNG illisible dans Telegram.
    if (contentType.includes('application/json')) {
      const text = await response.text().catch(() => '');
      return {
        status: response.status,
        contentType,
        bytes: null,
        text: text.slice(0, MAX_ERROR_DETAIL),
      };
    }

    const raw = await response.arrayBuffer().catch(() => null);
    return {
      status: response.status,
      contentType,
      bytes: raw ? Buffer.from(raw) : null,
      text: '',
    };
  }
}

function parseJson<T>(text: string): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Retire la chaine de requete d'une URL avant de l'ecrire dans un message.
 *
 * Certains pilotes passent des parametres sensibles (une cle, un numero) en
 * query : les recopier dans une erreur, donc dans un journal, serait une fuite.
 */
export function withoutQuery(url: string): string {
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}

/**
 * Traduit un statut d'erreur en code Comexa, pour les cas COMMUNS aux deux
 * pilotes. Ce qui en differe reste decide dans le pilote.
 *
 * Exportee pour etre testee : c'est une table de correspondance, et une table
 * non testee finit par comporter une ligne fausse que personne ne regarde.
 */
export function commonStatusToErrorCode(status: number): WhatsAppErrorCode {
  if (status === 401 || status === 403) return WHATSAPP_ERROR_CODES.UNAUTHORIZED;
  if (status === 402 || status === 405 || status === 501) {
    return WHATSAPP_ERROR_CODES.FEATURE_UNAVAILABLE;
  }
  return WHATSAPP_ERROR_CODES.UPSTREAM_FAILED;
}

/**
 * Construit le message d'une erreur de passerelle a partir du corps brut.
 *
 * Le corps est presque toujours du JSON avec un champ `error`, `message` ou
 * `response.message` (Evolution). Ne garder que le premier niveau produirait des
 * messages vides la ou la cause est precise — et une erreur de passerelle sans
 * cause est la plus couteuse a diagnostiquer, puisqu'elle se produit sur le
 * telephone de quelqu'un d'autre.
 */
export function describeGatewayBody(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;

  const candidate = body as Record<string, unknown>;
  const nested =
    typeof candidate.error === 'string'
      ? candidate.error
      : typeof candidate.message === 'string'
        ? candidate.message
        : typeof (candidate.response as Record<string, unknown> | undefined)?.message === 'string'
          ? ((candidate.response as Record<string, unknown>).message as string)
          : null;

  const text = (nested ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text.slice(0, MAX_ERROR_DETAIL) : fallback;
}
