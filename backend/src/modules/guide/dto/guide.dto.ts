import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * CORPS DE REQUÊTE DU GUIDE.
 *
 * Un seul champ : la réponse choisie à une micro-question (`recall`). Le
 * serveur ne fait jamais confiance à un « c'est fait » envoyé par le
 * navigateur pour une étape vérifiable — il recompte les données.
 */
export class CompleteGuideStepDto {
  @ApiPropertyOptional({ description: 'Option choisie pour la micro-question de l’étape.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  optionId?: string;
}
