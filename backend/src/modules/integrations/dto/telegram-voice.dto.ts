import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

/**
 * DTO DE LA TRANSCRIPTION DES VOCAUX TELEGRAM.
 *
 * -------------------------------------------------------------------------
 * UN CORPS `multipart/form-data`, DONC DES CHAINES
 * -------------------------------------------------------------------------
 * L'audio arrive en piece jointe ; les metadonnees arrivent en champs de
 * formulaire, c'est-a-dire EN CHAINES, meme pour `durationSeconds`. La conversion
 * implicite du `ValidationPipe` global s'en occupe, et `@IsInt()` borne le
 * resultat : une chaine non numerique repond 400 au lieu de devenir `NaN` en
 * base, ou `NaN` casserait la seule colonne qui explique pourquoi un vocal de
 * trente secondes a coute ce qu'il a coute.
 *
 * -------------------------------------------------------------------------
 * `telegramFileId` EST OBLIGATOIRE, ET CE N'EST PAS UNE TRACE
 * -------------------------------------------------------------------------
 * C'est la CLE DE REJEU. Un workflow n8n rejoue un noeud HTTP dont la reponse a
 * expire ; sans cette cle, le meme vocal serait transcrit deux fois — donc paye
 * deux fois, et rendu sous deux identifiants differents, ce qui ferait deux
 * reponses differentes a une meme question posee au bot.
 *
 * La contrainte d'unicite est en base (`voice_transcripts.telegramFileId`), pas
 * seulement ici : deux requetes simultanees sur le meme fichier ne passent pas
 * par le meme processus, et seule la base peut les departager.
 */
export class TranscribeTelegramVoiceDto {
  /** Identifiant Telegram de l'expediteur du vocal. */
  @ApiProperty({
    description:
      'Identifiant Telegram de l’expediteur. Resolu en membre Comexa via la ' +
      'liaison existante : un compte Telegram non lie repond 404.',
    example: '748291034',
  })
  @IsString()
  @Length(1, 64)
  telegramUserId!: string;

  /**
   * Identifiant du FICHIER Telegram — la cle de rejeu.
   *
   * Stable pour un meme fichier, donc exactement ce qu'il faut pour dedoublonner.
   * `message_id` ne l'est pas : un message transfere ou repondu change
   * d'identifiant alors que le fichier, lui, ne change pas.
   */
  @ApiProperty({
    description: 'Identifiant du fichier audio Telegram (`file_id`). Cle de rejeu : unique.',
    example: 'AwACAgIAAxkBAAI-voice-file-id',
  })
  @IsString()
  @Length(1, 255)
  telegramFileId!: string;

  @ApiPropertyOptional({ description: 'Identifiant du chat d’ou vient le vocal.' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  telegramChatId?: string;

  @ApiPropertyOptional({ description: 'Identifiant du message Telegram.' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  telegramMessageId?: string;

  /**
   * Type MIME annonce par Telegram.
   *
   * Facultatif : sans lui, celui de la piece jointe est employe. Le champ existe
   * parce que Telegram annonce `audio/ogg` alors que le transport HTTP, lui, peut
   * avoir perdu l'information — et parce que le moteur deduit parfois le conteneur
   * du NOM de fichier, que ce type sert a construire.
   */
  @ApiPropertyOptional({
    description: 'Type MIME annonce par Telegram (defaut : celui de la piece jointe).',
    example: 'audio/ogg',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  mimeType?: string;

  /** Duree annoncee par Telegram, en secondes. */
  @ApiPropertyOptional({ description: 'Duree annoncee par Telegram, en secondes.', example: 12 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86_400)
  durationSeconds?: number;

  /**
   * Langue forcee (`fr`, `ar`, `fr-FR`).
   *
   * OMISE PAR DEFAUT, ET C'EST LE CHOIX UTILE : une equipe qui parle francais et
   * arabe serait mal servie par une langue imposee. Sans ce champ, la valeur de
   * `TRANSCRIPTION_LANGUAGE` s'applique, et si elle est vide le moteur detecte.
   */
  @ApiPropertyOptional({
    description:
      'Code de langue BCP-47 court (`fr`, `ar`, `fr-FR`). Omis : `TRANSCRIPTION_LANGUAGE`, ' +
      'sinon detection automatique.',
    example: 'fr',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  language?: string;

  /**
   * Amorce de decodage : vocabulaire metier attendu.
   *
   * N'est PAS un texte a faire dire au modele. Un moteur de transcription qui
   * recoit une amorce l'emploie comme indice de vocabulaire ; y ecrire une
   * consigne (« reponds poliment ») ne produirait pas une reponse, mais une
   * transcription biaisee vers ces mots.
   */
  @ApiPropertyOptional({
    description:
      'Vocabulaire attendu (noms propres, termes metier). Omis : `TRANSCRIPTION_PROMPT`.',
    example: 'Comexa, devis, facture, Algerie',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  prompt?: string;
}
