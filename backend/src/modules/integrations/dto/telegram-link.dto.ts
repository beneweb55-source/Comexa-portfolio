import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { normalizePairingCode, normalizeTelegramId } from '../telegram-command.js';

/**
 * Normalisations appliquées AVANT la validation.
 *
 * Le `ValidationPipe` global valide ce qu'il reçoit : sans ces transformations,
 * « 944 330 », « ٩٤٤٣٣٠ » ou un code transmis comme nombre par n8n étaient
 * rejetés en 400 avant même d'atteindre le service — alors que le service,
 * lui, savait les lire. Une valeur impossible à normaliser est laissée telle
 * quelle : la règle `@Matches` la refuse alors avec un message explicite.
 */
const toPairingCode = ({ value }: { value: unknown }) => normalizePairingCode(value) ?? value;
const toTelegramId = ({ value }: { value: unknown }) => normalizeTelegramId(value) ?? value;

export class VerifyTelegramCodeDto {
  @ApiProperty({
    description:
      'Code à 6 chiffres reçu par le membre via son interface Comexa. Espaces, tirets et chiffres arabes sont tolérés.',
    example: '482913',
  })
  @Transform(toPairingCode)
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Le code doit comporter exactement 6 chiffres.' })
  code!: string;

  @ApiProperty({ description: 'Identifiant numérique Telegram du compte (id utilisateur).' })
  @Transform(toTelegramId)
  @IsString()
  @Length(1, 64)
  telegramUserId!: string;

  @ApiProperty({ description: 'Identifiant de chat Telegram (privé avec le bot).' })
  @Transform(toTelegramId)
  @IsString()
  @Length(1, 64)
  telegramChatId!: string;

  @ApiPropertyOptional({ description: "Nom d'utilisateur Telegram (sans le @)." })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  telegramUsername?: string;
}

/**
 * Message brut reçu par le bot, transmis tel quel par le workflow n8n.
 *
 * Le texte n'est PAS validé comme une commande : c'est le rôle du service, qui
 * répond `handled: false` pour tout message qui n'est pas une commande Comexa.
 */
export class TelegramCommandDto {
  @ApiProperty({
    description: 'Texte exact du message Telegram (`message.text`).',
    example: '/lier 944330',
  })
  @IsString()
  @Length(1, 4096)
  text!: string;

  @ApiProperty({
    description: 'Identifiant numérique Telegram de l’expéditeur (`message.from.id`).',
  })
  @Transform(toTelegramId)
  @IsString()
  @Length(1, 64)
  telegramUserId!: string;

  @ApiProperty({ description: 'Identifiant du chat (`message.chat.id`).' })
  @Transform(toTelegramId)
  @IsString()
  @Length(1, 64)
  telegramChatId!: string;

  @ApiPropertyOptional({ description: 'Pseudo Telegram (`message.from.username`), sans le @.' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  telegramUsername?: string;

  @ApiPropertyOptional({
    description:
      'Type de conversation (`message.chat.type`). Une liaison est refusée hors conversation privée.',
    enum: ['private', 'group', 'supergroup', 'channel'],
  })
  @IsOptional()
  @IsIn(['private', 'group', 'supergroup', 'channel'])
  chatType?: string;
}
