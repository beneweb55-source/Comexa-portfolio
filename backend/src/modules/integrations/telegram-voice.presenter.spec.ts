import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toVoiceTranscriptView, type VoiceTranscriptRow } from './telegram-voice.presenter.js';

/**
 * CE QUE CES TESTS PROTEGENT.
 *
 * Une transcription est le TEXTE D'UNE VOIX : une donnee personnelle parmi les
 * plus sensibles que traite ce backend. Le presenter est le dernier endroit ou
 * l'on peut garantir ce qui en sort.
 *
 * Deux invariants sont testes ici, et ils ne sont pas decoratifs :
 *
 *   - AUCUN OCTET AUDIO. Ils ne sont pas stockes, mais une ligne de plus dans un
 *     `select` Prisma suffirait a les faire apparaitre dans une reponse.
 *   - AUCUNE CLE DE FOURNISSEUR. `provider` et `model` sortent (ils expliquent une
 *     transcription douteuse) ; l'URL et la cle du moteur, non.
 *
 * `replayed` est teste dans les DEUX sens : un rejeu non signale ferait croire au
 * workflow qu'il vient de payer une seconde transcription, et un `replayed: true`
 * sur une transcription fraiche lui ferait ignorer un texte qu'il doit traiter.
 */

const NOW = new Date('2026-10-15T12:34:56.789Z');

function row(overrides: Record<string, unknown> = {}): VoiceTranscriptRow {
  return {
    id: 'vtx_1',
    userId: 'usr_1',
    telegramUserId: '748291034',
    telegramChatId: '748291034',
    telegramMessageId: '99',
    telegramFileId: 'AwACAgIAAxkBAAI-voice-file-id',
    mimeType: 'audio/ogg',
    bytes: 48_512,
    durationSeconds: 12,
    language: 'fr',
    text: 'Bonjour, peux-tu creer une tache pour le devis de demain ?',
    provider: 'openai-compatible',
    model: 'whisper-large-v3-turbo',
    createdAt: NOW,
    ...overrides,
  } as VoiceTranscriptRow;
}

describe('toVoiceTranscriptView', () => {
  it('rend le texte et ses metadonnees', () => {
    const view = toVoiceTranscriptView(row());

    assert.equal(view.text, 'Bonjour, peux-tu creer une tache pour le devis de demain ?');
    assert.equal(view.language, 'fr');
    assert.equal(view.provider, 'openai-compatible');
    assert.equal(view.model, 'whisper-large-v3-turbo');
    assert.equal(view.bytes, 48_512);
    assert.equal(view.durationSeconds, 12);
    assert.equal(view.mimeType, 'audio/ogg');
  });

  it('rend la date en ISO 8601, jamais un objet Date', () => {
    const view = toVoiceTranscriptView(row());

    assert.equal(view.createdAt, '2026-10-15T12:34:56.789Z');
    assert.equal(typeof view.createdAt, 'string');
  });

  it('rend false pour replayed par defaut', () => {
    // Un appel qui oublie l'option rend une transcription FRAICHE, jamais
    // l'inverse : ignorer un texte nouveau ferait perdre une demande du membre.
    assert.equal(toVoiceTranscriptView(row()).replayed, false);
    assert.equal(toVoiceTranscriptView(row(), {}).replayed, false);
    assert.equal(toVoiceTranscriptView(row(), { replayed: false }).replayed, false);
  });

  it('rend true pour replayed quand c’est dit', () => {
    assert.equal(toVoiceTranscriptView(row(), { replayed: true }).replayed, true);
  });

  it('rend null pour les identifiants Telegram absents', () => {
    const view = toVoiceTranscriptView(row({ telegramChatId: null, telegramMessageId: null }));

    assert.equal(view.telegramChatId, null);
    assert.equal(view.telegramMessageId, null);
  });

  it('NE REND AUCUN OCTET AUDIO', () => {
    // Les champs sont passes EXPRÈS : la base ne les contient pas, mais une jointure
    // ou un `select` elargi les ferait apparaitre, et un objet Buffer se serialise
    // en base64 — donc en audio lisible par quiconque lit la reponse.
    const view = toVoiceTranscriptView(
      row({ audio: Buffer.from('OggSfakeaudio'), buffer: 'base64-audio', data: 'audio' }) as never,
    );

    const serialized = JSON.stringify(view);

    assert.ok(!('audio' in view), 'audio ne doit pas sortir');
    assert.ok(!('buffer' in view), 'buffer ne doit pas sortir');
    assert.ok(!('data' in view), 'data ne doit pas sortir');
    assert.ok(!serialized.includes('OggS'), 'aucun octet audio ne doit etre serialise');
  });

  it('NE REND NI L’URL NI LA CLE DU FOURNISSEUR', () => {
    // `provider` et `model` suffisent a expliquer une transcription douteuse. Une
    // cle d'API dans une reponse d'integration finit dans les journaux du workflow,
    // donc dans ceux de n8n.
    const view = toVoiceTranscriptView(
      row({ baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'gsk_cle-de-test' }) as never,
    );

    const serialized = JSON.stringify(view);

    assert.ok(!('apiKey' in view));
    assert.ok(!('baseUrl' in view));
    assert.ok(!serialized.includes('gsk_cle-de-test'));
    assert.ok(!serialized.includes('api.groq.com'));
  });

  it('rend une forme stable : exactement ces cles', () => {
    // Le workflow n8n lit ces champs par leur NOM. Une cle ajoutee n'est pas un
    // probleme ; une cle RENOMMEE casse le bot sans erreur cote backend. Ce test
    // casse a chaque changement de forme, ce qui force a le faire consciemment.
    assert.deepEqual(Object.keys(toVoiceTranscriptView(row())).sort(), [
      'bytes',
      'createdAt',
      'durationSeconds',
      'id',
      'language',
      'mimeType',
      'model',
      'provider',
      'replayed',
      'telegramChatId',
      'telegramFileId',
      'telegramMessageId',
      'telegramUserId',
      'text',
      'userId',
    ]);
  });
});
