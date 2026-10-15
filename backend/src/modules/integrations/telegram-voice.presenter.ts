/**
 * PRESENTATION DES TRANSCRIPTIONS — la forme rendue au bot.
 *
 * -------------------------------------------------------------------------
 * POURQUOI UN FICHIER SEPARE
 * -------------------------------------------------------------------------
 * Comme les autres `*.presenter.ts` du depot : la forme d'une reponse est un
 * CONTRAT, et un contrat se teste sans base de donnees ni conteneur Nest. Un
 * presentateur est une fonction pure, donc `npm test` peut affirmer qu'aucun
 * octet audio ni aucune cle de fournisseur n'en sort.
 *
 * -------------------------------------------------------------------------
 * CE QUI N'EST JAMAIS RENDU
 * -------------------------------------------------------------------------
 *  - LES OCTETS AUDIO. Ils ne sont pas stockes du tout : `voice_transcripts` ne
 *    contient que le texte. Un vocal est une donnee personnelle, souvent
 *    enregistree dans un lieu prive ; le conserver au-dela du temps strictement
 *    necessaire a la transcription n'aurait aucun fondement. Le nettoyage
 *    periodique (`TelegramVoiceService.purgeExpired`) borne meme la duree du
 *    TEXTE.
 *  - LA CLE DU FOURNISSEUR. `provider` et `model` sont rendus — ils expliquent
 *    une transcription douteuse — mais jamais l'URL ni la cle.
 *
 * `replayed` distingue une transcription fraiche d'une reponse rejouee : le
 * workflow peut alors savoir qu'il n'a rien coute de plus, et ne pas repondre
 * deux fois a l'utilisateur.
 */

/** Ligne `voice_transcripts`, telle que lue en base. */
export interface VoiceTranscriptRow {
  readonly id: string;
  readonly userId: string;
  readonly telegramUserId: string;
  readonly telegramChatId: string | null;
  readonly telegramMessageId: string | null;
  readonly telegramFileId: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly durationSeconds: number | null;
  readonly language: string | null;
  readonly text: string;
  readonly provider: string;
  readonly model: string | null;
  readonly createdAt: Date;
}

/** Ce que le bot recoit. */
export interface VoiceTranscriptView {
  readonly id: string;
  /** Membre Comexa dont le compte Telegram a produit le vocal. */
  readonly userId: string;
  readonly telegramUserId: string;
  readonly telegramChatId: string | null;
  readonly telegramMessageId: string | null;
  readonly telegramFileId: string;
  /** Le texte transcrit. Brut : aucun HTML, aucune mise en forme. */
  readonly text: string;
  readonly language: string | null;
  /** Moteur effectif (`openai-compatible`, `none`) et modele (`whisper-large-v3-turbo`). */
  readonly provider: string;
  readonly model: string | null;
  readonly mimeType: string;
  readonly bytes: number;
  readonly durationSeconds: number | null;
  /** Vrai quand cette reponse vient d'une transcription DEJA faite. */
  readonly replayed: boolean;
  readonly createdAt: string;
}

/**
 * Met en forme une transcription.
 *
 * `replayed` est explicite et vaut `false` par defaut : un appel qui oublie de le
 * passer rend une transcription fraiche, jamais l'inverse.
 */
export function toVoiceTranscriptView(
  row: VoiceTranscriptRow,
  options: { replayed?: boolean } = {},
): VoiceTranscriptView {
  return {
    id: row.id,
    userId: row.userId,
    telegramUserId: row.telegramUserId,
    telegramChatId: row.telegramChatId,
    telegramMessageId: row.telegramMessageId,
    telegramFileId: row.telegramFileId,
    text: row.text,
    language: row.language,
    provider: row.provider,
    model: row.model,
    mimeType: row.mimeType,
    bytes: row.bytes,
    durationSeconds: row.durationSeconds,
    replayed: options.replayed === true,
    // ISO 8601 : la forme attendue partout ailleurs dans cette API, et la seule
    // qu'un workflow n8n compare sans surprise de fuseau horaire.
    createdAt: row.createdAt.toISOString(),
  };
}
