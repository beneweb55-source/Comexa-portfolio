import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class VerifyTelegramCodeDto {
  @ApiProperty({
    description: 'Code à 6 chiffres reçu par le membre via son interface Comexa.',
    example: '482913',
  })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Le code doit comporter exactement 6 chiffres.' })
  code!: string;

  @ApiProperty({ description: 'Identifiant numérique Telegram du compte (id utilisateur).' })
  @IsString()
  @Length(1, 64)
  telegramUserId!: string;

  @ApiProperty({ description: 'Identifiant de chat Telegram (privé avec le bot).' })
  @IsString()
  @Length(1, 64)
  telegramChatId!: string;

  @ApiPropertyOptional({ description: "Nom d'utilisateur Telegram (sans le @)." })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  telegramUsername?: string;
}
