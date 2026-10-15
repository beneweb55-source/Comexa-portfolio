import {
  TranscriptionError,
  TRANSCRIPTION_ERROR_CODES,
  type TranscriptionProvider,
  type TranscriptionProviderKind,
  type TranscriptionRequest,
  type TranscriptionResult,
} from './transcription.types.js';

/**
 * PILOTE DESACTIVE — le comportement par defaut du backend.
 *
 * -------------------------------------------------------------------------
 * POURQUOI UNE CLASSE, ET NON UN TEST DANS LE SERVICE
 * -------------------------------------------------------------------------
 * Sans moteur configure, la route de transcription doit repondre 503 avec un code
 * nomme (`TRANSCRIPTION_NOT_CONFIGURED`) — et surtout PAS un texte vide. Un texte
 * vide ressemblerait a une transcription reussie d'un silence : le workflow n8n
 * la traiterait comme telle, et la tache creee « d'apres le vocal » serait vide
 * sans que personne ne voie l'erreur.
 *
 * En faire un pilote a part entiere place la decision au MEME endroit que les
 * autres moteurs : le service appelle `transcribe()` sans savoir si un moteur
 * existe. Un `if (!configured)` dans le service aurait fini par etre oublie dans
 * un second appelant — c'est exactement la derive que `common/storage` evite
 * avec ses pilotes.
 *
 * `configured: false` sert aussi au contrat d'API : annoncer l'etat d'une
 * fonctionnalite sans obliger l'appelant a provoquer une erreur pour le
 * decouvrir.
 */
export class DisabledTranscriptionProvider implements TranscriptionProvider {
  readonly kind: TranscriptionProviderKind = 'none';
  readonly configured = false;

  async transcribe(_request: TranscriptionRequest): Promise<TranscriptionResult> {
    throw new TranscriptionError(
      TRANSCRIPTION_ERROR_CODES.NOT_CONFIGURED,
      'Aucun moteur de transcription n’est configure. Renseigner ' +
        'TRANSCRIPTION_PROVIDER=openai-compatible avec TRANSCRIPTION_BASE_URL et ' +
        'TRANSCRIPTION_API_KEY, puis redeployer le backend.',
    );
  }
}
