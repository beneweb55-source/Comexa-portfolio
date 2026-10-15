/// <reference types="multer" />
import { Body, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { RequestMeta, type RequestContext } from '../projects/request-meta.decorator.js';
import { TelegramVoiceService } from './telegram-voice.service.js';
import type { VoiceTranscriptView } from './telegram-voice.presenter.js';
import { TranscribeTelegramVoiceDto } from './dto/telegram-voice.dto.js';

/**
 * TRANSCRIPTION DES VOCAUX TELEGRAM — LA ROUTE DU BOT.
 *
 * -------------------------------------------------------------------------
 * CE QUE LE WORKFLOW DOIT FAIRE AVANT D'APPELER
 * -------------------------------------------------------------------------
 * Telegram ne pousse pas les octets : il donne un `file_id`. Le workflow
 *  1. recoit l'update (`message.voice`, ou `message.audio`) ;
 *  2. appelle `getFile` avec le token du bot, puis telecharge
 *     `https://api.telegram.org/file/bot<token>/<file_path>` ;
 *  3. POST ici en `multipart/form-data`, champ `file`, avec les metadonnees.
 *
 * La route ne connait donc ni le token du bot, ni l'API Telegram — elle ne voit
 * que des octets et des identifiants. C'est ce qui permet de tester la
 * transcription avec `curl` sans aucun compte Telegram.
 *
 * -------------------------------------------------------------------------
 * LE PLAFOND DE MULTER EST PLUS LARGE QUE CELUI DU SERVICE, EXPRÈS
 * -------------------------------------------------------------------------
 * Un depassement du `limits.fileSize` de multer leve une `MulterError`, que le
 * filtre d'exceptions global ne traduit pas : elle sortirait en 500. Le plafond
 * transporte est donc fixe au-dessus de `TRANSCRIPTION_MAX_BYTES`, pour que la
 * borne UTILE soit celle du service — un 413 avec le code
 * `TRANSCRIPTION_PAYLOAD_TOO_LARGE`, la taille recue et la limite, c'est-a-dire
 * de quoi corriger le workflow.
 */

/**
 * Plafond de transport (40 Mio).
 *
 * DECLARE AVANT LA CLASSE : les decorateurs sont evalues a la definition de la
 * classe, donc une constante placee en bas de fichier serait lue avant son
 * initialisation. Assez large pour ne jamais couper avant la borne configuree
 * (`TRANSCRIPTION_MAX_BYTES`, 20 Mio par defaut), assez etroit pour qu'un envoi
 * aberrant ne sature pas la memoire : multer garde le corps EN MEMOIRE, et un
 * fichier de deux gigaoctets serait lu avant d'etre refuse.
 */
const TRANSPORT_CEILING_BYTES = 41_943_040;

@ApiTags('Integrations')
@Controller()
export class TelegramVoiceController {
  constructor(private readonly voice: TelegramVoiceService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('integrations/telegram/transcribe')
  @RequirePermissions('telegram:transcribe:any')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: TRANSPORT_CEILING_BYTES, files: 1 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'telegramUserId', 'telegramFileId'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Octets audio telecharges depuis Telegram (OGG/Opus transmis tels quels).',
        },
        telegramUserId: { type: 'string', maxLength: 64 },
        telegramFileId: { type: 'string', maxLength: 255 },
        telegramChatId: { type: 'string', maxLength: 64 },
        telegramMessageId: { type: 'string', maxLength: 64 },
        mimeType: { type: 'string', example: 'audio/ogg' },
        durationSeconds: { type: 'integer', example: 12 },
        language: { type: 'string', example: 'fr' },
        prompt: { type: 'string', example: 'Comexa, devis, facture' },
      },
    },
  })
  @ApiOperation({
    summary: 'Transcrire un vocal Telegram.',
    description:
      'Rend le texte brut, la langue et le moteur employes. `telegramFileId` est la cle de ' +
      'rejeu : un second appel sur le meme fichier rend la transcription existante avec ' +
      '`replayed: true`, sans nouvel appel au moteur. Aucun octet audio n’est conserve.',
  })
  async transcribe(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: TranscribeTelegramVoiceDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @RequestMeta() meta: RequestContext,
  ): Promise<VoiceTranscriptView> {
    return this.voice.transcribe(dto, file, actor, meta);
  }
}
