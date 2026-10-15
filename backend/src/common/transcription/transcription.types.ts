/**
 * CONTRAT DE TRANSCRIPTION AUDIO — texte brut contre octets.
 *
 * -------------------------------------------------------------------------
 * POURQUOI CE FICHIER NE CONTIENT AUCUN CODE NEST
 * -------------------------------------------------------------------------
 * Comme `common/storage/storage.types.ts` : les regles pures (formats acceptes,
 * nommage du fichier, code de langue) doivent pouvoir etre testees sans monter
 * de module ni de conteneur d'injection. Un test qui demarre Nest pour verifier
 * qu'une extension `.ogg` est acceptee ne tourne pas, donc il n'est pas ecrit.
 *
 * -------------------------------------------------------------------------
 * CE QUI EST DECIDE ICI, ET POURQUOI
 * -------------------------------------------------------------------------
 *  1. UN SEUL MOTEUR, PLUSIEURS FOURNISSEURS. L'API `/audio/transcriptions`
 *     d'OpenAI est devenue une forme commune : Groq, OpenAI, Mistral et les
 *     serveurs Whisper auto-heberges la servent tous. Un seul pilote couvre donc
 *     les trois choix reels, et changer de fournisseur devient une URL —
 *     pas une dependance, ni un code a reecrire.
 *
 *  2. PAS DE FFMPEG. Telegram envoie ses vocaux en Opus dans un conteneur OGG,
 *     et c'est justement un format que les moteurs acceptent directement
 *     (`audio/ogg`, `audio/opus`, `audio/webm`). Exiger une conversion aurait
 *     ajoute un binaire systeme a l'image Docker, un point de panne et du temps
 *     de calcul — pour rendre un fichier que le destinataire sait deja lire. La
 *     liste `ACCEPTED_AUDIO_MIME_TYPES` borne ce qui est transmis : ce qui n'y
 *     est pas est refuse AVANT l'appel, avec un message qui nomme le format.
 *
 *  3. LES ERREURS SONT TYPEES, PAS HTTP. Un pilote leve `TranscriptionError`
 *     avec un code stable ; c'est le service d'integration qui decide du statut
 *     HTTP. Inverser les deux ferait dependre le pilote de la couche de
 *     transport — et rendrait impossible son test hors HTTP.
 */

/** Moteurs de transcription connus. `none` desactive la fonctionnalite. */
export type TranscriptionProviderKind = 'none' | 'openai-compatible';

/**
 * Jetons d'injection.
 *
 * Des `Symbol`, et jamais les classes : les services dependent de l'INTERFACE
 * `TranscriptionProvider`, que TypeScript efface a la compilation. La metadonnee
 * `design:paramtypes` ne contient alors plus rien d'exploitable et Nest echoue a
 * resoudre — le piege est documente dans `common/storage/storage.types.ts`.
 */
export const TRANSCRIPTION_PROVIDER_TOKEN = Symbol('TRANSCRIPTION_PROVIDER');
export const TRANSCRIPTION_CONFIG_TOKEN = Symbol('TRANSCRIPTION_CONFIG');

/**
 * Formats transmis au moteur.
 *
 * La liste suit ce que les moteurs compatibles OpenAI documentent, PLUS les
 * variantes que Telegram annonce reellement : un vocal arrive en `audio/ogg` ou
 * `audio/opus`, un fichier audio en `audio/mpeg`, `audio/mp4`, `audio/aac`,
 * `audio/wav`. `application/octet-stream` est accepte aussi — c'est ce que
 * Telegram renvoie quand il ne connait pas le type, et le refuser bloquerait des
 * vocaux valides au profit d'un fichier dont le nom, lui, dit le format.
 *
 * CE QUI N'Y EST PAS EST REFUSE NET : `video/mp4` ou `image/png` ne sont pas de
 * l'audio, et les transmettre ferait payer un appel au moteur pour une erreur
 * previsible.
 */
export const ACCEPTED_AUDIO_MIME_TYPES = [
  'audio/ogg',
  'audio/opus',
  'audio/x-opus',
  'audio/x-opus+ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/flac',
  'audio/amr',
  'application/octet-stream',
] as const;

export type AcceptedAudioMimeType = (typeof ACCEPTED_AUDIO_MIME_TYPES)[number];

/**
 * Extension par type MIME, pour donner un NOM au fichier transmis.
 *
 * Le nom n'est pas decoratif : plusieurs serveurs Whisper ignorent `mimeType` et
 * deduisent le conteneur de l'extension. Un OGG envoye sous le nom `audio` peut
 * donc etre refuse alors que les octets sont bons.
 */
const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/x-opus': 'opus',
  'audio/x-opus+ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
  'audio/amr': 'amr',
  'application/octet-stream': 'ogg',
};

/** Vrai si ce type MIME peut etre transmis au moteur. */
export function isAcceptedAudioMimeType(mimeType: string | undefined | null): boolean {
  const value = (mimeType ?? '').trim().toLowerCase();
  return (ACCEPTED_AUDIO_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * Nom de fichier envoye au moteur, derive du type MIME.
 *
 * Le fragment d'identifiant est retire de tout caractere non alphanumerique : il
 * vient de Telegram, donc d'un appelant externe, et un nom de fichier est
 * recopie dans des journaux et parfois dans un chemin temporaire cote moteur.
 */
export function audioFilenameFor(mimeType: string | undefined | null, hint = 'voice'): string {
  const normalized = (mimeType ?? '').trim().toLowerCase();
  const extension = EXTENSION_BY_MIME[normalized] ?? 'ogg';
  const safeHint = hint.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'voice';
  return `${safeHint}.${extension}`;
}

/**
 * Normalise un code de langue.
 *
 * Accepte `fr`, `fr-FR`, `ar`, `en-gb`. Renvoie `null` si la valeur est vide :
 * `null` veut dire « laisser le moteur detecter », ce qui est le comportement
 * utile pour une equipe qui parle francais ET arabe — forcer `fr` ferait
 * transcrire un vocal arabe n'importe comment, sans aucune erreur nulle part.
 *
 * Une valeur NON VIDE MAIS MAL FORMEE LEVE. Deviner (`frr` -> `fr`) produirait
 * une langue fausse dans la colonne `language` de `voice_transcripts`, et cette
 * colonne sert justement a expliquer une transcription douteuse.
 */
export function normalizeLanguageCode(raw: string | undefined | null): string | null {
  const value = (raw ?? '').trim();
  if (value.length === 0) return null;

  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value)) {
    throw new Error(
      `Code de langue invalide : « ${value} ». Attendu : deux ou trois lettres, ` +
        "eventuellement suivies d'une region (`fr`, `fr-FR`, `ar`), ou rien pour " +
        'laisser le moteur detecter.',
    );
  }

  // `fr-FR` : la casse n'a pas de sens pour le moteur, et deux ecritures de la
  // meme langue donneraient deux valeurs distinctes en base.
  return value.toLowerCase();
}

/** Ce qu'un appel au moteur recoit. */
export interface TranscriptionRequest {
  /** Octets audio. Jamais un flux : la taille doit etre connue avant l'envoi. */
  readonly audio: Buffer;
  /** Type MIME annonce par Telegram (ou par l'appelant). */
  readonly mimeType: string;
  /** Nom de fichier transmis au moteur — voir `audioFilenameFor`. */
  readonly filename?: string;
  /** Langue forcee ; `null` laisse le moteur detecter. */
  readonly language?: string | null;
  /** Amorce de decodage (vocabulaire metier). */
  readonly prompt?: string | null;
}

/** Ce qu'un appel au moteur rend. */
export interface TranscriptionResult {
  /** Texte brut. Jamais de HTML : les moteurs n'en produisent pas de fiable. */
  readonly text: string;
  /** Langue rendue par le moteur, ou celle qui avait ete forcee. */
  readonly language: string | null;
  readonly provider: TranscriptionProviderKind;
  readonly model: string;
  /** Duree de l'appel, en millisecondes : la seule mesure qui explique une lenteur. */
  readonly elapsedMs: number;
}

/**
 * Codes d'erreur STABLES de la transcription.
 *
 * Le service d'integration les recopie dans `error.code` : c'est ce qu'un
 * workflow n8n teste, jamais le message (voir `docs/API-N8N.md` §4).
 */
export const TRANSCRIPTION_ERROR_CODES = {
  /** Aucun moteur configure (`TRANSCRIPTION_PROVIDER=none`). */
  NOT_CONFIGURED: 'TRANSCRIPTION_NOT_CONFIGURED',
  /** Le format transmis n'est pas de l'audio reconnu. */
  UNSUPPORTED_FORMAT: 'TRANSCRIPTION_UNSUPPORTED_FORMAT',
  /** Audio vide ou plus grand que `TRANSCRIPTION_MAX_BYTES`. */
  PAYLOAD_TOO_LARGE: 'TRANSCRIPTION_PAYLOAD_TOO_LARGE',
  /** Cle refusee par le fournisseur (401/403). */
  UNAUTHORIZED: 'TRANSCRIPTION_UNAUTHORIZED',
  /** Le fournisseur limite le debit (429). */
  RATE_LIMITED: 'TRANSCRIPTION_RATE_LIMITED',
  /** Le fournisseur n'a pas repondu dans le delai, ou est injoignable. */
  UPSTREAM_UNREACHABLE: 'TRANSCRIPTION_UPSTREAM_UNREACHABLE',
  /** Le fournisseur a repondu, mais en erreur ou sans texte exploitable. */
  UPSTREAM_FAILED: 'TRANSCRIPTION_UPSTREAM_FAILED',
} as const;

export type TranscriptionErrorCode =
  (typeof TRANSCRIPTION_ERROR_CODES)[keyof typeof TRANSCRIPTION_ERROR_CODES];

/**
 * Erreur d'un pilote de transcription.
 *
 * `status` est le statut RENVOYE PAR LE FOURNISSEUR (ou `null` sans reponse) :
 * il sert au diagnostic, pas a la reponse HTTP — celle-ci est decidee par le
 * service, qui traduit le `code`.
 */
export class TranscriptionError extends Error {
  constructor(
    readonly code: TranscriptionErrorCode,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

/** Le pilote. Deux proprietes et une methode, rien de plus. */
export interface TranscriptionProvider {
  readonly kind: TranscriptionProviderKind;
  /**
   * Vrai si un appel peut reussir.
   *
   * Le pilote desactive repond `false`, ce qui permet au contrat d'API
   * (`GET /api/health`) d'annoncer l'etat de la fonctionnalite SANS qu'un
   * appelant ait a provoquer une erreur pour le decouvrir.
   */
  readonly configured: boolean;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}

/** Configuration resolue, lue une seule fois au demarrage. */
export interface TranscriptionConfig {
  readonly kind: TranscriptionProviderKind;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly language: string | null;
  readonly prompt: string | null;
  readonly maxBytes: number;
  readonly timeoutMs: number;
}

/** Taille maximale par defaut (20 Mo) — la valeur effective vient de l'environnement. */
export const DEFAULT_TRANSCRIPTION_MAX_BYTES = 20_971_520;

/** Delai d'attente par defaut du moteur. */
export const DEFAULT_TRANSCRIPTION_TIMEOUT_MS = 60_000;
