import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DisabledTranscriptionProvider } from './disabled.provider.js';
import {
  assertAudioPayload,
  OpenAiCompatibleTranscriptionProvider,
  transcriptionEndpoint,
} from './openai-compatible.provider.js';
import { createTranscriptionProvider } from './transcription.module.js';
import {
  ACCEPTED_AUDIO_MIME_TYPES,
  DEFAULT_TRANSCRIPTION_MAX_BYTES,
  DEFAULT_TRANSCRIPTION_TIMEOUT_MS,
  TRANSCRIPTION_ERROR_CODES,
  TranscriptionError,
  audioFilenameFor,
  isAcceptedAudioMimeType,
  normalizeLanguageCode,
  type TranscriptionConfig,
  type TranscriptionRequest,
} from './transcription.types.js';

/**
 * CE QUE CES TESTS PROTEGENT.
 *
 * -------------------------------------------------------------------------
 * 1. UN APPEL AU MOTEUR COUTE DE L'ARGENT
 * -------------------------------------------------------------------------
 * La transcription est facturee a la duree audio, Y COMPRIS quand elle echoue.
 * Chaque controle qui peut avoir lieu avant l'appel doit donc avoir lieu avant
 * l'appel — et ces tests verifient l'ordre : un corps vide est signale avant un
 * type MIME inconnu, parce que c'est la faute la plus frequente cote n8n (un noeud
 * qui telecharge mal le fichier Telegram rend un buffer vide avec le bon type).
 *
 * -------------------------------------------------------------------------
 * 2. LES CODES D'ERREUR SONT UN CONTRAT
 * -------------------------------------------------------------------------
 * Le workflow n8n branche ses reprises sur `error.code`, jamais sur le message
 * (voir `docs/API-N8N.md` §4). Un 401 du fournisseur doit rendre
 * `TRANSCRIPTION_UNAUTHORIZED` et non un code generique : sans distinction, un
 * workflow ne peut pas savoir s'il faut reessayer plus tard (429) ou appeler un
 * humain (cle invalide).
 *
 * -------------------------------------------------------------------------
 * 3. AUCUN FFMPEG
 * -------------------------------------------------------------------------
 * Un vocal Telegram est de l'Opus dans un conteneur OGG, et c'est un format que
 * les moteurs acceptent directement. La liste `ACCEPTED_AUDIO_MIME_TYPES` est
 * testee pour rester alignee sur ce que Telegram annonce reellement : retirer
 * `audio/ogg` de la liste casserait TOUT le bot sans qu'aucune erreur ne soit
 * levee ailleurs.
 */

const CONFIG: TranscriptionConfig = {
  kind: 'openai-compatible',
  baseUrl: 'https://api.groq.com/openai/v1',
  apiKey: 'gsk_cle-de-test',
  model: 'whisper-large-v3-turbo',
  language: null,
  prompt: null,
  maxBytes: DEFAULT_TRANSCRIPTION_MAX_BYTES,
  timeoutMs: DEFAULT_TRANSCRIPTION_TIMEOUT_MS,
};

/** Octets d'un faux OGG : seuls le nombre et le type comptent ici. */
const OGG = Buffer.from('OggS'.repeat(64), 'utf8');

interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly form: Record<string, string>;
  readonly fileName: string | null;
  readonly fileBytes: number;
  readonly fileType: string | null;
}

/**
 * Fabrique un `fetch` de test qui rend la reponse donnee.
 *
 * Le formulaire `multipart` EST INSPECTE : c'est la seule facon de verifier que le
 * nom de fichier porte la bonne extension (plusieurs serveurs Whisper ignorent
 * `mimeType` et deduisent le conteneur du nom) et que la cle part dans un
 * EN-TETE, jamais dans le corps.
 */
function fakeFetch(spec: { status?: number; json?: unknown; text?: string; throwError?: Error }): {
  fetch: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];

  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const form = init?.body as FormData | undefined;
    const fields: Record<string, string> = {};
    let fileName: string | null = null;
    let fileBytes = 0;
    let fileType: string | null = null;

    if (form) {
      for (const [key, value] of form.entries()) {
        if (typeof value === 'string') {
          fields[key] = value;
          continue;
        }

        fileName = value.name || null;
        fileType = value.type || null;
        fileBytes = value.size;
      }
    }

    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
      form: fields,
      fileName,
      fileBytes,
      fileType,
    });

    if (spec.throwError) throw spec.throwError;

    return new Response(spec.text !== undefined ? spec.text : JSON.stringify(spec.json ?? {}), {
      status: spec.status ?? 200,
      headers: { 'content-type': spec.text !== undefined ? 'text/plain' : 'application/json' },
    });
  }) as typeof fetch;

  return { fetch: fetchImpl, calls };
}

function providerWith(
  spec: Parameters<typeof fakeFetch>[0],
  config: Partial<TranscriptionConfig> = {},
) {
  const { fetch, calls } = fakeFetch(spec);
  return {
    provider: new OpenAiCompatibleTranscriptionProvider({ ...CONFIG, ...config }, fetch),
    calls,
  };
}

function request(overrides: Partial<TranscriptionRequest> = {}): TranscriptionRequest {
  return { audio: OGG, mimeType: 'audio/ogg', ...overrides };
}

async function transcriptionErrorOf(promise: Promise<unknown>): Promise<TranscriptionError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(
      error instanceof TranscriptionError,
      `TranscriptionError attendue, recu : ${String(error)}`,
    );
    return error;
  }

  assert.fail('aucune erreur levee');
}

describe('transcriptionEndpoint — une seule forme d’URL', () => {
  it('ajoute /audio/transcriptions a une racine sans barre finale', () => {
    assert.equal(
      transcriptionEndpoint('https://api.groq.com/openai/v1'),
      'https://api.groq.com/openai/v1/audio/transcriptions',
    );
  });

  it('ne produit pas de double barre avec une racine qui en porte une', () => {
    // `//audio/transcriptions` est refuse par la plupart des fournisseurs, avec un
    // 404 qui ressemble a s'y meprendre a une mauvaise cle.
    assert.equal(
      transcriptionEndpoint('https://api.groq.com/openai/v1///'),
      'https://api.groq.com/openai/v1/audio/transcriptions',
    );
  });
});

describe('formats audio acceptes', () => {
  it('accepte ce que Telegram annonce pour un vocal', () => {
    // Un vocal Telegram arrive en OGG/Opus. Ces trois ecritures se rencontrent
    // selon la version du client et le noeud n8n qui lit l'en-tete.
    assert.equal(isAcceptedAudioMimeType('audio/ogg'), true);
    assert.equal(isAcceptedAudioMimeType('audio/opus'), true);
    assert.equal(isAcceptedAudioMimeType('audio/x-opus'), true);
  });

  it('accepte les autres formats audio servis par les moteurs', () => {
    for (const mimeType of [
      'audio/mpeg',
      'audio/mp4',
      'audio/wav',
      'audio/webm',
      'audio/aac',
      'audio/flac',
      'audio/m4a',
    ]) {
      assert.equal(isAcceptedAudioMimeType(mimeType), true, mimeType);
    }
  });

  it('ignore la casse et les espaces', () => {
    assert.equal(isAcceptedAudioMimeType('  AUDIO/OGG '), true);
  });

  it('accepte application/octet-stream', () => {
    // C'est ce que Telegram rend quand il ne connait pas le type. Le refuser
    // bloquerait des vocaux valides au profit d'un fichier dont le NOM, lui, dit
    // le format.
    assert.equal(isAcceptedAudioMimeType('application/octet-stream'), true);
  });

  it('refuse ce qui n’est pas de l’audio', () => {
    // `video/mp4` est le piege : un enregistrement video Telegram porte ce type,
    // et le transmettre ferait payer un appel au moteur pour une erreur previsible.
    for (const mimeType of ['video/mp4', 'image/png', 'application/json', '', null, undefined]) {
      assert.equal(isAcceptedAudioMimeType(mimeType), false, String(mimeType));
    }
  });

  it('n’a aucun doublon dans la liste', () => {
    assert.equal(
      new Set(ACCEPTED_AUDIO_MIME_TYPES).size,
      ACCEPTED_AUDIO_MIME_TYPES.length,
      'deux entrees identiques masqueraient une intention differente',
    );
  });
});

describe('audioFilenameFor — le nom porte le conteneur', () => {
  it('donne l’extension du type MIME', () => {
    assert.equal(audioFilenameFor('audio/ogg'), 'voice.ogg');
    assert.equal(audioFilenameFor('audio/mpeg'), 'voice.mp3');
    assert.equal(audioFilenameFor('audio/mp4'), 'voice.m4a');
    assert.equal(audioFilenameFor('audio/wav'), 'voice.wav');
  });

  it('retombe sur .ogg pour un type inconnu', () => {
    // Un vocal Telegram est presque toujours de l'OGG : mieux vaut une extension
    // plausible qu'aucune, plusieurs serveurs deduisant le conteneur du nom.
    assert.equal(audioFilenameFor('application/octet-stream'), 'voice.ogg');
    assert.equal(audioFilenameFor(null), 'voice.ogg');
  });

  it('retire les caracteres dangereux de l’indice', () => {
    // L'indice vient de Telegram (`file_id`), donc d'un appelant externe, et se
    // retrouve dans des journaux et parfois dans un chemin temporaire cote moteur.
    const name = audioFilenameFor('audio/ogg', '../../etc/passwd');

    assert.ok(!name.includes('/'), name);
    assert.ok(!name.includes('..'), name);
    assert.equal(name, 'etcpasswd.ogg');
  });

  it('retombe sur « voice » quand l’indice ne laisse rien', () => {
    assert.equal(audioFilenameFor('audio/ogg', '///'), 'voice.ogg');
    assert.equal(audioFilenameFor('audio/ogg', ''), 'voice.ogg');
  });

  it('borne la longueur de l’indice', () => {
    assert.ok(audioFilenameFor('audio/ogg', 'a'.repeat(500)).length <= 44);
  });
});

describe('normalizeLanguageCode', () => {
  it('rend null sur une valeur vide : laisser le moteur detecter', () => {
    // Forcer `fr` ferait transcrire un vocal arabe n'importe comment, SANS aucune
    // erreur nulle part. `null` veut dire « detecte ».
    assert.equal(normalizeLanguageCode(undefined), null);
    assert.equal(normalizeLanguageCode(''), null);
    assert.equal(normalizeLanguageCode('   '), null);
  });

  it('accepte les codes courts et les codes avec region, en minuscules', () => {
    assert.equal(normalizeLanguageCode('fr'), 'fr');
    assert.equal(normalizeLanguageCode('FR'), 'fr');
    assert.equal(normalizeLanguageCode('fr-FR'), 'fr-fr');
    assert.equal(normalizeLanguageCode('ar'), 'ar');
  });

  it('LEVE sur une forme invalide au lieu de deviner', () => {
    // Deviner (`francais` -> `fr`) ecrirait une langue FAUSSE dans la colonne
    // `language`, et cette colonne sert justement a expliquer une transcription
    // douteuse.
    for (const value of ['francais', '123', 'fr FR', 'fr--FR', 'f', 'toolongcode']) {
      assert.throws(() => normalizeLanguageCode(value), /Code de langue invalide/, value);
    }
  });

  it('laisse passer une forme BCP-47 correcte meme si la langue est inconnue', () => {
    // LA VALIDITE DE LA LANGUE N'EST PAS NOTRE TRAVAIL : c'est le moteur qui la
    // connait, et sa liste evolue. `frr` (frison du Nord) est un code reel ;
    // le refuser ici bloquerait une langue que le moteur, lui, transcrit.
    assert.equal(normalizeLanguageCode('frr'), 'frr');
    assert.equal(normalizeLanguageCode('zh-Hant-TW'), 'zh-hant-tw');
  });
});

describe('assertAudioPayload — l’ordre des controles', () => {
  it('signale un corps vide AVANT un type MIME inconnu', () => {
    // C'est la faute la plus frequente cote n8n : un noeud qui telecharge mal le
    // fichier Telegram rend un buffer vide avec le bon type MIME. Annoncer
    // « format non reconnu » enverrait chercher du cote du moteur.
    const error = capture(() =>
      assertAudioPayload(request({ audio: Buffer.alloc(0), mimeType: 'audio/ogg' }), CONFIG),
    );

    assert.equal(error.code, TRANSCRIPTION_ERROR_CODES.PAYLOAD_TOO_LARGE);
    assert.match(error.message, /n'a probablement pas ete telecharge/);
  });

  it('refuse un corps au-dela de la borne', () => {
    const error = capture(() =>
      assertAudioPayload(request({ audio: Buffer.alloc(1_000) }), { maxBytes: 500 }),
    );

    assert.equal(error.code, TRANSCRIPTION_ERROR_CODES.PAYLOAD_TOO_LARGE);
    assert.match(error.message, /TRANSCRIPTION_MAX_BYTES/);
  });

  it('accepte un corps exactement a la borne', () => {
    assert.doesNotThrow(() =>
      assertAudioPayload(request({ audio: Buffer.alloc(500) }), { maxBytes: 500 }),
    );
  });

  it('refuse un type MIME non audio', () => {
    const error = capture(() => assertAudioPayload(request({ mimeType: 'video/mp4' }), CONFIG));

    assert.equal(error.code, TRANSCRIPTION_ERROR_CODES.UNSUPPORTED_FORMAT);
    assert.match(error.message, /video\/mp4/, 'le type recu doit etre nomme');
  });

  function capture(call: () => void): TranscriptionError {
    try {
      call();
    } catch (error) {
      assert.ok(error instanceof TranscriptionError);
      return error;
    }

    return assert.fail('aucune erreur levee');
  }
});

describe('OpenAiCompatibleTranscriptionProvider — appel reussi', () => {
  it('poste le formulaire attendu, cle en en-tete', async () => {
    const { provider, calls } = providerWith({ json: { text: 'Bonjour, le devis est pret.' } });

    const result = await provider.transcribe(request());

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.method, 'POST');
    assert.equal(calls[0]!.url, 'https://api.groq.com/openai/v1/audio/transcriptions');
    // LA CLE EST UN EN-TETE, JAMAIS UN CHAMP DU FORMULAIRE : un champ de
    // formulaire est recopie dans les journaux du fournisseur et dans les siens.
    assert.equal(calls[0]!.headers.Authorization, `Bearer ${CONFIG.apiKey}`);
    assert.equal(calls[0]!.form.api_key, undefined);
    assert.equal(calls[0]!.form.model, CONFIG.model);
    assert.equal(calls[0]!.form.response_format, 'json');
    assert.equal(calls[0]!.fileName, 'voice.ogg');
    assert.equal(calls[0]!.fileBytes, OGG.byteLength);
    assert.equal(result.text, 'Bonjour, le devis est pret.');
    assert.equal(result.provider, 'openai-compatible');
    assert.equal(result.model, CONFIG.model);
  });

  it('n’envoie ni langue ni amorce quand rien n’est demande', async () => {
    // Une langue imposee ferait transcrire un vocal arabe n'importe comment.
    const { provider, calls } = providerWith({ json: { text: 'ok' } });

    await provider.transcribe(request());

    assert.equal(calls[0]!.form.language, undefined);
    assert.equal(calls[0]!.form.prompt, undefined);
  });

  it('envoie la langue et l’amorce quand elles sont fournies', async () => {
    const { provider, calls } = providerWith({ json: { text: 'ok' } });

    await provider.transcribe(request({ language: 'ar', prompt: 'Comexa, devis' }));

    assert.equal(calls[0]!.form.language, 'ar');
    assert.equal(calls[0]!.form.prompt, 'Comexa, devis');
  });

  it('recopie la langue rendue par le moteur, sinon celle demandee', async () => {
    const detected = providerWith({ json: { text: 'ok', language: 'fr' } });
    assert.equal((await detected.provider.transcribe(request())).language, 'fr');

    const asked = providerWith({ json: { text: 'ok' } });
    assert.equal((await asked.provider.transcribe(request({ language: 'ar' }))).language, 'ar');

    // Ni l'un ni l'autre : `null`, et surtout pas une langue inventee.
    const none = providerWith({ json: { text: 'ok' } });
    assert.equal((await none.provider.transcribe(request())).language, null);
  });

  it('mesure la duree de l’appel', async () => {
    // La seule mesure qui explique une lenteur : sans elle, « le bot est lent »
    // reste une impression.
    const { provider } = providerWith({ json: { text: 'ok' } });

    const result = await provider.transcribe(request());

    assert.ok(typeof result.elapsedMs === 'number' && result.elapsedMs >= 0);
  });
});

describe('OpenAiCompatibleTranscriptionProvider — traductions d’erreur', () => {
  it('traduit un 401 en cle refusee', async () => {
    // `TRANSCRIPTION_UNAUTHORIZED` et non un code generique : le workflow doit
    // pouvoir distinguer « appeler un humain » de « reessayer plus tard ».
    const { provider } = providerWith({ status: 401, text: 'invalid api key' });

    const error = await transcriptionErrorOf(provider.transcribe(request()));

    assert.equal(error.code, TRANSCRIPTION_ERROR_CODES.UNAUTHORIZED);
    assert.equal(error.status, 401);
    assert.match(error.message, /TRANSCRIPTION_API_KEY/);
  });

  it('traduit un 429 en saturation du fournisseur', async () => {
    const { provider } = providerWith({ status: 429, text: 'rate limit' });

    const error = await transcriptionErrorOf(provider.transcribe(request()));

    assert.equal(error.code, TRANSCRIPTION_ERROR_CODES.RATE_LIMITED);
  });

  it('traduit un 500 en echec amont', async () => {
    const { provider } = providerWith({ status: 500, text: 'internal error' });

    const error = await transcriptionErrorOf(provider.transcribe(request()));

    assert.equal(error.code, TRANSCRIPTION_ERROR_CODES.UPSTREAM_FAILED);
    assert.equal(error.status, 500);
  });

  it('borne le detail recopie depuis le corps d’erreur', async () => {
    // Un fournisseur peut renvoyer une page HTML de plusieurs kilo-octets : la
    // recopier telle quelle produirait un journal illisible.
    const { provider } = providerWith({ status: 500, text: 'x'.repeat(20_000) });

    const error = await transcriptionErrorOf(provider.transcribe(request()));

    assert.ok(error.message.length < 2_000, `message trop long : ${error.message.length}`);
  });

  it('traduit une erreur reseau en moteur injoignable', async () => {
    const { provider } = providerWith({ throwError: new Error('ENOTFOUND api.groq.com') });

    const error = await transcriptionErrorOf(provider.transcribe(request()));

    assert.equal(error.code, TRANSCRIPTION_ERROR_CODES.UPSTREAM_UNREACHABLE);
    assert.match(error.message, /TRANSCRIPTION_BASE_URL/);
  });

  it('traduit un delai depasse en moteur injoignable, avec le delai', async () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    const { provider } = providerWith({ throwError: timeout }, { timeoutMs: 1_500 });

    const error = await transcriptionErrorOf(provider.transcribe(request()));

    assert.equal(error.code, TRANSCRIPTION_ERROR_CODES.UPSTREAM_UNREACHABLE);
    assert.match(error.message, /1500 ms/, 'le delai doit etre chiffre');
  });

  it('refuse un 200 sans champ text exploitable', async () => {
    // UN TEXTE VIDE RESSEMBLE A UNE TRANSCRIPTION REUSSIE D'UN SILENCE. Le
    // workflow creerait une tache « d'apres le vocal » avec un contenu vide, et
    // personne ne verrait l'erreur.
    const { provider } = providerWith({ json: { model: 'inconnu' } });

    const error = await transcriptionErrorOf(provider.transcribe(request()));

    assert.equal(error.code, TRANSCRIPTION_ERROR_CODES.UPSTREAM_FAILED);
    assert.match(error.message, /TRANSCRIPTION_MODEL/);
  });

  it('verifie le format et la taille AVANT d’appeler', async () => {
    const { provider, calls } = providerWith({ json: { text: 'ok' } });

    const error = await transcriptionErrorOf(
      provider.transcribe(request({ mimeType: 'video/mp4' })),
    );

    assert.equal(error.code, TRANSCRIPTION_ERROR_CODES.UNSUPPORTED_FORMAT);
    assert.equal(calls.length, 0, 'aucun appel ne doit partir : il serait facture');
  });
});

describe('DisabledTranscriptionProvider', () => {
  it('annonce qu’il n’est pas configure', () => {
    const provider = new DisabledTranscriptionProvider();

    assert.equal(provider.configured, false);
    assert.equal(provider.kind, 'none');
  });

  it('leve NOT_CONFIGURED au lieu de rendre un texte vide', async () => {
    const error = await transcriptionErrorOf(
      new DisabledTranscriptionProvider().transcribe(request()),
    );

    assert.equal(error.code, TRANSCRIPTION_ERROR_CODES.NOT_CONFIGURED);
    assert.match(error.message, /TRANSCRIPTION_PROVIDER/);
  });
});

describe('createTranscriptionProvider — le choix du moteur', () => {
  it('rend le pilote desactive pour none', () => {
    const provider = createTranscriptionProvider({ ...CONFIG, kind: 'none' });

    assert.equal(provider.kind, 'none');
    assert.equal(provider.configured, false);
  });

  it('rend le pilote compatible OpenAI pour openai-compatible', () => {
    const provider = createTranscriptionProvider(CONFIG);

    assert.equal(provider.kind, 'openai-compatible');
    assert.equal(provider.configured, true);
  });

  it('LEVE sur un moteur inconnu au lieu de retomber sur le pilote desactive', () => {
    // Un moteur ajoute a l'enum sans implementation doit casser au demarrage.
    // Retomber sur `none` ferait croire que la transcription est volontairement
    // eteinte, alors qu'elle est cassee.
    assert.throws(
      () => createTranscriptionProvider({ ...CONFIG, kind: 'deepgram' as never }),
      /TRANSCRIPTION_PROVIDER/,
    );
  });
});
