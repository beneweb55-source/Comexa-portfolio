import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';
import {
  TRANSCRIPTION_CONFIG_TOKEN,
  TRANSCRIPTION_ERROR_CODES,
  TRANSCRIPTION_PROVIDER_TOKEN,
  audioFilenameFor,
  isAcceptedAudioMimeType,
  normalizeLanguageCode,
  TranscriptionError,
  type TranscriptionConfig,
  type TranscriptionErrorCode,
  type TranscriptionProvider,
} from '../../common/transcription/transcription.types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { RequestContext } from '../projects/request-meta.decorator.js';
import type { TranscribeTelegramVoiceDto } from './dto/telegram-voice.dto.js';
import {
  toVoiceTranscriptView,
  type VoiceTranscriptRow,
  type VoiceTranscriptView,
} from './telegram-voice.presenter.js';

/**
 * TRANSCRIPTION DES VOCAUX TELEGRAM.
 *
 * -------------------------------------------------------------------------
 * CE QUE FAIT CE SERVICE, ET CE QU'IL NE FAIT PAS
 * -------------------------------------------------------------------------
 * IL NE PARLE PAS A TELEGRAM. Le bot vit dans n8n : c'est le workflow qui
 * telecharge le fichier (`getFile` + `getFileUrl`), puis l'envoie ici en
 * `multipart/form-data`. Ce service recoit des OCTETS et rend du TEXTE.
 *
 * Deux raisons a cette coupure, et elles ne sont pas esthetiques :
 *
 *  1. Telegram n'offre pas de transcription par l'API Bot. `messages.transcribe`
 *     est reserve au MTProto et repond `PREMIUM_ACCOUNT_REQUIRED` — un jeton de
 *     bot ne peut pas l'appeler. Il faut donc un moteur externe de toute facon.
 *  2. Un moteur externe est un fournisseur de plus, avec sa cle, ses limites et
 *     ses pannes. Le garder derriere UNE route HTTP — et non dans un worker qui
 *     ecoute Telegram — laisse n8n maitre du rythme, des reprises et des
 *     notifications d'echec, comme pour tout le reste du bot.
 *
 * -------------------------------------------------------------------------
 * AUCUN OCTET AUDIO N'EST CONSERVE
 * -------------------------------------------------------------------------
 * `file.buffer` est transmis au moteur puis oublie : il n'existe ni en base, ni
 * dans MinIO, ni sur disque. Un vocal est une donnee personnelle captee dans un
 * lieu prive ; le conserver au-dela de la transcription n'aurait aucun fondement,
 * et un stock d'audio serait la premiere chose emportee en cas de fuite.
 *
 * Le TEXTE, lui, est conserve — il faut bien que le bot puisse s'y referer — mais
 * pour une duree bornee : `purgeExpired` supprime ce qui depasse
 * `TRANSCRIPT_RETENTION_DAYS`.
 *
 * -------------------------------------------------------------------------
 * LE REJEU
 * -------------------------------------------------------------------------
 * `telegramFileId` est unique en base. Un workflow qui rejoue un noeud HTTP dont
 * la reponse a expire recoit la MEME transcription, avec `replayed: true`, sans
 * second appel au moteur — donc sans second cout. La verification precede
 * l'appel, et la contrainte d'unicite couvre le cas de deux requetes
 * simultanées : la seconde recoit l'erreur de cle dupliquee, relit la ligne, et
 * rend la transcription de la premiere.
 */

/** Colonne lue apres transcription. */
const TRANSCRIPT_SELECT = {
  id: true,
  userId: true,
  telegramUserId: true,
  telegramChatId: true,
  telegramMessageId: true,
  telegramFileId: true,
  mimeType: true,
  bytes: true,
  durationSeconds: true,
  language: true,
  text: true,
  provider: true,
  model: true,
  createdAt: true,
} as const;

/**
 * Statut HTTP par code d'erreur du moteur.
 *
 * LA REGLE : un 4xx signifie « l'appelant doit changer quelque chose », un 5xx
 * « nous devons changer quelque chose ». D'ou deux choix qui surprennent :
 *
 *  - `UNAUTHORIZED` -> 502, PAS 401. La cle refusee est la NOTRE. Rendre 401
 *    dirait au workflow que SON jeton est mauvais, et n8n irait renouveller un
 *    jeton d'integration parfaitement valide pendant que le vrai probleme — une
 *    cle de fournisseur expiree — resterait invisible.
 *  - `RATE_LIMITED` et `UPSTREAM_UNREACHABLE` -> 503, PAS 429. Un 429 annonce a
 *    l'appelant qu'IL depasse un debit ; ici c'est le fournisseur qui est sature.
 *    503 dit « reessayez plus tard », ce que le noeud Retry de n8n comprend.
 */
const HTTP_STATUS_BY_TRANSCRIPTION_ERROR: Readonly<Record<TranscriptionErrorCode, HttpStatus>> = {
  [TRANSCRIPTION_ERROR_CODES.NOT_CONFIGURED]: HttpStatus.SERVICE_UNAVAILABLE,
  [TRANSCRIPTION_ERROR_CODES.UNSUPPORTED_FORMAT]: HttpStatus.UNPROCESSABLE_ENTITY,
  [TRANSCRIPTION_ERROR_CODES.PAYLOAD_TOO_LARGE]: HttpStatus.PAYLOAD_TOO_LARGE,
  [TRANSCRIPTION_ERROR_CODES.UNAUTHORIZED]: HttpStatus.BAD_GATEWAY,
  [TRANSCRIPTION_ERROR_CODES.RATE_LIMITED]: HttpStatus.SERVICE_UNAVAILABLE,
  [TRANSCRIPTION_ERROR_CODES.UPSTREAM_UNREACHABLE]: HttpStatus.SERVICE_UNAVAILABLE,
  [TRANSCRIPTION_ERROR_CODES.UPSTREAM_FAILED]: HttpStatus.BAD_GATEWAY,
};

@Injectable()
export class TelegramVoiceService {
  private readonly logger = new Logger(TelegramVoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    @Inject(TRANSCRIPTION_PROVIDER_TOKEN) private readonly provider: TranscriptionProvider,
    @Inject(TRANSCRIPTION_CONFIG_TOKEN) private readonly transcriptionConfig: TranscriptionConfig,
  ) {}

  /**
   * Etat publie par le contrat d'API.
   *
   * `GET /api/health` annonce `telegramVoice.enabled` SANS qu'un appelant ait a
   * provoquer un 503 pour le decouvrir : un workflow qui apprend a l'execution
   * que la transcription est eteinte a deja consomme un telechargement Telegram
   * pour rien.
   */
  get state(): {
    readonly enabled: boolean;
    readonly provider: string;
    readonly model: string | null;
    readonly maxBytes: number;
    readonly retentionDays: number;
  } {
    return {
      enabled: this.provider.configured,
      provider: this.provider.kind,
      model: this.provider.configured ? this.transcriptionConfig.model : null,
      maxBytes: this.transcriptionConfig.maxBytes,
      retentionDays: this.retentionDays,
    };
  }

  /** Duree de conservation des transcriptions, en jours. `0` = sans limite. */
  private get retentionDays(): number {
    const raw = this.config.get<number>('TRANSCRIPT_RETENTION_DAYS');
    const days = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(days) && days > 0 ? Math.floor(days) : 0;
  }

  /**
   * Transcrit un vocal.
   *
   * L'ORDRE DES CONTROLES N'EST PAS NEUTRE : chacun coute quelque chose de
   * different. Le moteur configure et le format se verifient en memoire ; la
   * liaison Telegram et le rejeu coutent une requete en base ; l'appel au moteur
   * coute de l'argent et des secondes. Tout ce qui peut echouer avant l'appel
   * echoue donc avant l'appel.
   */
  async transcribe(
    dto: TranscribeTelegramVoiceDto,
    file: Express.Multer.File | undefined,
    actor: AuthenticatedUser,
    meta: RequestContext,
  ): Promise<VoiceTranscriptView> {
    if (!actor.permissions.has('telegram:transcribe:any')) {
      throw AppException.forbidden('Droit insuffisant : telegram:transcribe:any');
    }

    if (!this.provider.configured) {
      throw new AppException(
        TRANSCRIPTION_ERROR_CODES.NOT_CONFIGURED,
        'La transcription est desactivee (TRANSCRIPTION_PROVIDER=none). Aucun moteur ne peut ' +
          'etre appele : configurer TRANSCRIPTION_PROVIDER, TRANSCRIPTION_BASE_URL et ' +
          'TRANSCRIPTION_API_KEY, puis redemarrer le backend.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (!file || file.size === 0) {
      throw new AppException(
        'TRANSCRIPTION_AUDIO_REQUIRED',
        'Aucun audio recu. Le champ de formulaire doit s’appeler « file » ' +
          '(multipart/form-data), et contenir les octets telecharges depuis Telegram.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const mimeType = (dto.mimeType?.trim() || file.mimetype || '').toLowerCase();

    if (!isAcceptedAudioMimeType(mimeType)) {
      throw new AppException(
        TRANSCRIPTION_ERROR_CODES.UNSUPPORTED_FORMAT,
        `Format audio non pris en charge : « ${mimeType || 'inconnu'} ». Un vocal Telegram ` +
          'arrive normalement en audio/ogg (Opus) et se transmet tel quel — aucune conversion ' +
          'n’est necessaire.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        { mimeType },
      );
    }

    if (file.size > this.transcriptionConfig.maxBytes) {
      throw new AppException(
        TRANSCRIPTION_ERROR_CODES.PAYLOAD_TOO_LARGE,
        `Audio de ${file.size} octets, au-dela de la limite de ` +
          `${this.transcriptionConfig.maxBytes} octets (TRANSCRIPTION_MAX_BYTES).`,
        HttpStatus.PAYLOAD_TOO_LARGE,
        { bytes: file.size, maxBytes: this.transcriptionConfig.maxBytes },
      );
    }

    // LA LIAISON D'ABORD : transcrire le vocal d'un compte Telegram que personne
    // n'a relie produirait un texte sans proprietaire — donc une donnee
    // personnelle collectee sans base, et sans personne a qui la rendre.
    const link = await this.prisma.telegramLink.findUnique({
      where: { telegramUserId: dto.telegramUserId },
      select: { userId: true, revokedAt: true, user: { select: { status: true } } },
    });

    if (!link || link.revokedAt || link.user.status !== 'ACTIVE') {
      throw AppException.notFound(
        'TELEGRAM_LINK_NOT_FOUND',
        'Aucune liaison Telegram active pour cet identifiant. Le membre doit d’abord lier son ' +
          'compte (POST /api/me/telegram-link/code, puis /integrations/telegram/verify-code).',
      );
    }

    // LE REJEU AVANT L'APPEL : c'est ce qui empeche de payer deux fois le meme
    // fichier quand un noeud HTTP est rejoue.
    const existing = await this.prisma.voiceTranscript.findUnique({
      where: { telegramFileId: dto.telegramFileId },
      select: TRANSCRIPT_SELECT,
    });

    if (existing) {
      return toVoiceTranscriptView(existing, { replayed: true });
    }

    let language: string | null;
    try {
      language = normalizeLanguageCode(dto.language ?? this.transcriptionConfig.language);
    } catch (error) {
      throw new AppException(
        'TRANSCRIPTION_LANGUAGE_INVALID',
        error instanceof Error ? error.message : String(error),
        HttpStatus.BAD_REQUEST,
      );
    }

    let result;
    try {
      result = await this.provider.transcribe({
        audio: file.buffer,
        mimeType,
        // Le nom porte l'extension deduite du MIME : plusieurs serveurs Whisper
        // ignorent `mimeType` et deduisent le conteneur du nom de fichier.
        filename: audioFilenameFor(mimeType, dto.telegramFileId),
        language,
        prompt: dto.prompt?.trim() ? dto.prompt.trim() : this.transcriptionConfig.prompt,
      });
    } catch (error) {
      throw this.toAppException(error);
    }

    if (result.text.trim().length === 0) {
      // UN TEXTE VIDE N'EST PAS UNE TRANSCRIPTION REUSSIE. Le moteur a repondu
      // 200 sans rien d'exploitable (silence, bruit, langue non reconnue). Rendre
      // une chaine vide ferait croire au workflow que le membre n'a rien dit, et
      // le bot repondrait a cote — sans aucune erreur nulle part.
      throw new AppException(
        TRANSCRIPTION_ERROR_CODES.UPSTREAM_FAILED,
        `Le moteur « ${result.model ?? this.transcriptionConfig.model} » n’a rendu aucun texte ` +
          `pour ${file.size} octets de ${mimeType}.`,
        HttpStatus.BAD_GATEWAY,
        { provider: result.provider, model: result.model },
      );
    }

    try {
      const row = await this.prisma.voiceTranscript.create({
        data: {
          userId: link.userId,
          telegramUserId: dto.telegramUserId,
          telegramChatId: dto.telegramChatId ?? null,
          telegramMessageId: dto.telegramMessageId ?? null,
          telegramFileId: dto.telegramFileId,
          mimeType,
          bytes: file.size,
          durationSeconds: dto.durationSeconds ?? null,
          language: result.language ?? language,
          text: result.text,
          provider: result.provider,
          model: result.model,
          // Le compte technique du jeton, pas le membre : « qui a demande cette
          // transcription » et « de qui est le vocal » sont deux questions.
          requestedById: actor.isIntegration ? actor.id : null,
        },
        select: TRANSCRIPT_SELECT,
      });

      await this.auditTranscription(row, actor, meta);

      return toVoiceTranscriptView(row);
    } catch (error) {
      // CONCURRENCE : deux requetes sur le meme `telegramFileId`. La contrainte
      // unique en tranche une, et la perdante rend la transcription de la
      // gagnante — pas une erreur. Le workflow n'a pas a savoir qu'il a essaye
      // deux fois.
      if (isUniqueViolation(error)) {
        const winner = await this.prisma.voiceTranscript.findUnique({
          where: { telegramFileId: dto.telegramFileId },
          select: TRANSCRIPT_SELECT,
        });

        if (winner) return toVoiceTranscriptView(winner, { replayed: true });
      }

      throw error;
    }
  }

  /**
   * Supprime les transcriptions plus anciennes que `TRANSCRIPT_RETENTION_DAYS`.
   *
   * `0` (ou une valeur absente) DESACTIVE la purge : tout est conserve. C'est le
   * choix par defaut du depot — une purge automatique qui partirait sans qu'on
   * l'ait demandee effacerait des preuves.
   *
   * UNE SEULE SUPPRESSION, PAS DE PARCOURS PAR LOTS : la requete est bordee par
   * l'index `voice_transcripts_createdAt_idx`, et un parcours page par page
   * multiplierait les allers-retours sans rien gagner — la table ne depasse
   * jamais quelques milliers de lignes.
   */
  async purgeExpired(now = new Date()): Promise<{ deleted: number; retentionDays: number }> {
    const retentionDays = this.retentionDays;

    if (retentionDays === 0) return { deleted: 0, retentionDays: 0 };

    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
    const { count } = await this.prisma.voiceTranscript.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    if (count > 0) {
      // Le NOMBRE, jamais le contenu : un journal qui recopierait les textes
      // annulerait la purge qu'il decrit.
      this.logger.log(
        `Purge des transcriptions : ${count} ligne(s) plus ancienne(s) que ${retentionDays} jour(s).`,
      );
    }

    return { deleted: count, retentionDays };
  }

  /**
   * Purge planifiee, chaque nuit.
   *
   * L'EXCEPTION NE S'ECHAPPE PAS : un `@Cron` n'a pas d'appelant HTTP, donc une
   * erreur qui remonte ne remonte a personne. Elle est journalisee ici, et la
   * nuit suivante reprend — exactement le parti pris de
   * `InvoiceOverdueService.runOverdueSweep`.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, {
    name: 'voice-transcript-purge',
    waitForCompletion: true,
  })
  async runPurge(): Promise<void> {
    try {
      await this.purgeExpired();
    } catch (error) {
      this.logger.error(
        `Purge des transcriptions interrompue : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Traduit une erreur du moteur en `AppException`.
   *
   * Le MESSAGE DU FOURNISSEUR EST CONSERVE mais le statut ne l'est pas : un 401
   * recu du moteur ne doit pas devenir un 401 rendu (voir
   * `HTTP_STATUS_BY_TRANSCRIPTION_ERROR`). Une erreur qui n'est pas une
   * `TranscriptionError` — un bogue de ce service, par exemple — remonte telle
   * quelle : la masquer en 502 ferait passer une panne interne pour une panne du
   * fournisseur, et la chercherait au mauvais endroit.
   */
  private toAppException(error: unknown): AppException {
    if (!(error instanceof TranscriptionError)) {
      throw error;
    }

    return new AppException(
      error.code,
      error.message,
      HTTP_STATUS_BY_TRANSCRIPTION_ERROR[error.code] ?? HttpStatus.BAD_GATEWAY,
      error.status === null ? undefined : { upstreamStatus: error.status },
    );
  }

  /**
   * Journalise une transcription FRAICHE.
   *
   * UN REJEU N'EST PAS JOURNALISE : il ne produit rien de nouveau, et noyer le
   * journal sous des doublons cacherait les transcriptions reelles. La ligne
   * `voice_transcripts`, elle, reste l'unique trace du contenu.
   *
   * LE TEXTE N'EST PAS RECOPIE DANS L'AUDIT. Il est deja en base ; deux copies
   * d'un meme contenu personnel font deux endroits a purger, et la purge n'en
   * connait qu'un.
   */
  private async auditTranscription(
    transcript: VoiceTranscriptRow,
    actor: AuthenticatedUser,
    meta: RequestContext,
  ): Promise<void> {
    await this.audit.record({
      actorId: actor.id,
      action: 'TELEGRAM_VOICE_TRANSCRIBED',
      entityType: 'VoiceTranscript',
      entityId: transcript.id,
      after: {
        // Le membre concerne, la taille, le moteur : ce qu'il faut pour repondre a
        // « qui a transcrit quoi, avec quel moteur, quand » sans conserver le texte.
        userId: transcript.userId,
        bytes: transcript.bytes,
        provider: transcript.provider,
        model: transcript.model,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }
}

/** Erreur Prisma de cle unique violee (`P2002`). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}
