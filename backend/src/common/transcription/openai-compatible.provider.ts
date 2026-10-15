import {
  DEFAULT_TRANSCRIPTION_TIMEOUT_MS,
  TranscriptionError,
  TRANSCRIPTION_ERROR_CODES,
  audioFilenameFor,
  isAcceptedAudioMimeType,
  type TranscriptionConfig,
  type TranscriptionProvider,
  type TranscriptionProviderKind,
  type TranscriptionRequest,
  type TranscriptionResult,
} from './transcription.types.js';

/**
 * PILOTE « COMPATIBLE OPENAI » — un seul pilote pour Groq, OpenAI, Mistral et
 * les serveurs Whisper auto-heberges.
 *
 * -------------------------------------------------------------------------
 * POURQUOI UN SEUL PILOTE
 * -------------------------------------------------------------------------
 * La forme `POST {base}/audio/transcriptions` avec un `multipart/form-data`
 * portant `file` et `model` s'est imposee comme un dialecte commun : Groq la
 * sert sur `https://api.groq.com/openai/v1`, OpenAI sur
 * `https://api.openai.com/v1`, et faster-whisper-server comme whisper.cpp
 * `server` l'imitent. Ecrire trois pilotes aurait produit trois fois le meme
 * code, avec trois fois la meme occasion de diverger sur un detail — et la
 * divergence, ici, se paie en transcription fautive ou en 401 incompris.
 *
 * -------------------------------------------------------------------------
 * AUCUNE DEPENDANCE AJOUTEE
 * -------------------------------------------------------------------------
 * `fetch`, `FormData` et `Blob` sont fournis par Node 20+ (le plancher declare
 * dans `package.json`). Ajouter le SDK d'un fournisseur pour un seul appel
 * multipart aurait fait entrer dans l'image un paquet, ses dependances
 * transitives et son calendrier de mise a jour — pour moins de cent lignes
 * ecrites ici.
 *
 * -------------------------------------------------------------------------
 * CE QUE CE FICHIER NE FAIT PAS
 * -------------------------------------------------------------------------
 * Il ne decide d'aucun statut HTTP (il leve `TranscriptionError`, avec un code
 * stable), ne lit aucune variable d'environnement (il recoit une configuration
 * resolue) et n'ecrit rien en base. C'est ce qui le rend testable sans Nest,
 * sans reseau et sans PostgreSQL.
 */

/** Chemin de l'endpoint, ajoute a la racine configuree. */
const TRANSCRIPTIONS_PATH = '/audio/transcriptions';

/**
 * Format de reponse demande au moteur.
 *
 * `json` et NON `verbose_json` : ce dernier n'est pas servi partout (Groq le
 * refuse sur `whisper-large-v3-turbo`), et ce qu'il ajoute — horodatages par
 * segment — n'est utilise par aucun appelant. Demander plus que necessaire ici
 * se paierait d'un 400 chez un fournisseur, pas d'une information utile.
 */
const RESPONSE_FORMAT = 'json';

export class OpenAiCompatibleTranscriptionProvider implements TranscriptionProvider {
  readonly kind: TranscriptionProviderKind = 'openai-compatible';
  readonly configured = true;

  /**
   * @param fetchImpl `fetch` injectable.
   *
   * MEME PARTI PRIS que `GatewayHttpClient` (voir `modules/whatsapp/gateway/http.ts`) :
   * sans lui, verifier qu'un 401 du moteur devient `TRANSCRIPTION_UNAUTHORIZED`
   * exigerait un vrai fournisseur, donc un test qui ne tourne pas en CI — donc un
   * test qui n'existe pas. Le comportement par defaut reste `fetch` global.
   */
  constructor(
    private readonly config: TranscriptionConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    assertAudioPayload(request, this.config);

    const mimeType = request.mimeType.trim().toLowerCase();
    const filename = request.filename?.trim() || audioFilenameFor(mimeType);
    const startedAt = Date.now();

    const form = new FormData();
    // `Blob` et non `File` : `File` n'est disponible que depuis Node 20 de
    // facon inegale selon la distribution, et le nom se passe en troisieme
    // argument de `append`, ce que `FormData` garantit.
    form.append('file', new Blob([new Uint8Array(request.audio)], { type: mimeType }), filename);
    form.append('model', this.config.model);
    form.append('response_format', RESPONSE_FORMAT);

    const language = request.language ?? this.config.language;
    if (language) form.append('language', language);

    const prompt = request.prompt ?? this.config.prompt;
    if (prompt) form.append('prompt', prompt);

    const timeoutMs = this.config.timeoutMs || DEFAULT_TRANSCRIPTION_TIMEOUT_MS;

    let response: Response;
    try {
      response = await this.fetchImpl(transcriptionEndpoint(this.config.baseUrl), {
        method: 'POST',
        headers: {
          // La cle porte l'autorisation. Elle n'est JAMAIS journalisee, et la
          // reponse non plus : un moteur renvoie parfois dans son erreur un
          // fragment de la requete recue.
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: 'application/json',
        },
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw upstreamUnreachable(error, timeoutMs);
    }

    const elapsedMs = Date.now() - startedAt;

    if (!response.ok) {
      throw await upstreamFailure(response, elapsedMs);
    }

    const payload = (await response.json().catch(() => null)) as {
      text?: unknown;
      language?: unknown;
    } | null;

    if (!payload || typeof payload.text !== 'string') {
      throw new TranscriptionError(
        TRANSCRIPTION_ERROR_CODES.UPSTREAM_FAILED,
        'Le moteur a repondu 200 sans champ `text` exploitable. Verifier TRANSCRIPTION_MODEL : ' +
          'un modele inconnu chez ce fournisseur produit souvent une reponse vide.',
        response.status,
      );
    }

    return {
      text: payload.text,
      // `json` ne rend pas la langue detectee : on recopie celle qui avait ete
      // demandee, sinon `null`. Ne pas deviner — une langue inventee en base
      // serait une explication fausse de la transcription.
      language: typeof payload.language === 'string' ? payload.language : (language ?? null),
      provider: this.kind,
      model: this.config.model,
      elapsedMs,
    };
  }
}

/** URL de l'endpoint, a partir d'une racine avec ou sans barre oblique finale. */
export function transcriptionEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${TRANSCRIPTIONS_PATH}`;
}

/**
 * Verifie le format et la taille AVANT d'appeler le moteur.
 *
 * Exportee pour etre testee : ce sont des regles, et elles coutent de l'argent
 * si elles sont appliquees trop tard — un appel au moteur est facture a la
 * duree, y compris quand il echoue sur un format.
 *
 * L'ordre des controles n'est pas indifferent : un corps VIDE est signale avant
 * un type MIME inconnu, parce que c'est la cause la plus frequente cote n8n (un
 * noeud qui telecharge mal le fichier Telegram rend un buffer vide, avec le bon
 * type MIME).
 */
export function assertAudioPayload(
  request: TranscriptionRequest,
  config: Pick<TranscriptionConfig, 'maxBytes'>,
): void {
  const bytes = request.audio?.byteLength ?? 0;

  if (bytes === 0) {
    throw new TranscriptionError(
      TRANSCRIPTION_ERROR_CODES.PAYLOAD_TOO_LARGE,
      "Aucun octet audio recu. Le fichier Telegram n'a probablement pas ete telecharge : " +
        'verifier le noeud binaire du workflow avant d’appeler la transcription.',
    );
  }

  if (bytes > config.maxBytes) {
    throw new TranscriptionError(
      TRANSCRIPTION_ERROR_CODES.PAYLOAD_TOO_LARGE,
      `Audio de ${bytes} octets, au-dela de la borne ${config.maxBytes} ` +
        '(TRANSCRIPTION_MAX_BYTES). Un vocal Telegram depasse rarement 1 Mo par minute : ' +
        'ce corps n’est vraisemblablement pas un vocal.',
    );
  }

  if (!isAcceptedAudioMimeType(request.mimeType)) {
    throw new TranscriptionError(
      TRANSCRIPTION_ERROR_CODES.UNSUPPORTED_FORMAT,
      `Type MIME « ${request.mimeType} » non reconnu comme audio. Attendu : audio/ogg, ` +
        'audio/opus, audio/mpeg, audio/mp4, audio/wav, audio/webm, audio/aac, audio/flac.',
    );
  }
}

/** Traduit une erreur reseau ou un delai depasse. */
function upstreamUnreachable(error: unknown, timeoutMs: number): TranscriptionError {
  const isAbort =
    error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

  return new TranscriptionError(
    TRANSCRIPTION_ERROR_CODES.UPSTREAM_UNREACHABLE,
    isAbort
      ? `Le moteur de transcription n'a pas repondu en ${timeoutMs} ms ` +
          '(TRANSCRIPTION_TIMEOUT_MS). Le vocal est peut-etre long, ou le moteur sature.'
      : `Le moteur de transcription est injoignable (TRANSCRIPTION_BASE_URL). ` +
          `Detail : ${error instanceof Error ? error.message : 'inconnu'}`,
  );
}

/**
 * Traduit une reponse en erreur du fournisseur.
 *
 * Le corps n'est lu QUE pour les erreurs 4xx, et sa taille est bornee : un
 * fournisseur peut renvoyer une page HTML de plusieurs kilo-octets, et la
 * recopier telle quelle dans un message d'erreur produit un journal illisible.
 * Le message rendu est donc tronque, et le statut d'origine est conserve pour le
 * diagnostic.
 */
async function upstreamFailure(response: Response, elapsedMs: number): Promise<TranscriptionError> {
  const detail = await readErrorDetail(response);

  if (response.status === 401 || response.status === 403) {
    return new TranscriptionError(
      TRANSCRIPTION_ERROR_CODES.UNAUTHORIZED,
      `Le moteur a refuse la cle (HTTP ${response.status}). Verifier TRANSCRIPTION_API_KEY : ` +
        `une cle Groq ne fonctionne pas chez OpenAI, et inversement.${detail}`,
      response.status,
    );
  }

  if (response.status === 413) {
    return new TranscriptionError(
      TRANSCRIPTION_ERROR_CODES.PAYLOAD_TOO_LARGE,
      `Le moteur a refuse la taille du fichier (HTTP 413) apres ${elapsedMs} ms.` +
        ` Abaisser TRANSCRIPTION_MAX_BYTES.${detail}`,
      response.status,
    );
  }

  if (response.status === 429) {
    return new TranscriptionError(
      TRANSCRIPTION_ERROR_CODES.RATE_LIMITED,
      `Le moteur limite le debit (HTTP 429). Le rejeu immediat ne fera qu'aggraver la ` +
        `file d'attente.${detail}`,
      response.status,
    );
  }

  return new TranscriptionError(
    TRANSCRIPTION_ERROR_CODES.UPSTREAM_FAILED,
    `Le moteur a repondu HTTP ${response.status} apres ${elapsedMs} ms.` +
      ` Verifier TRANSCRIPTION_MODEL chez ce fournisseur.${detail}`,
    response.status,
  );
}

/** Extrait un fragment de message d'erreur du fournisseur, borne a 300 caracteres. */
async function readErrorDetail(response: Response): Promise<string> {
  try {
    const raw = await response.text();
    if (!raw) return '';

    let text = raw;
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: unknown }; message?: unknown };
      const candidate = parsed?.error?.message ?? parsed?.message;
      if (typeof candidate === 'string') text = candidate;
    } catch {
      // Le corps n'est pas du JSON : on garde le brut, tronque.
    }

    const trimmed = text.replace(/\s+/g, ' ').trim();
    return trimmed.length > 0 ? ` Detail : ${trimmed.slice(0, 300)}` : '';
  } catch {
    // Corps illisible : l'erreur reste informative sans lui.
    return '';
  }
}
