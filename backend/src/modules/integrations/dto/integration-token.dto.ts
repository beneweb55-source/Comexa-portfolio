import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  INTEGRATION_NAME_PATTERN,
  MAX_INTEGRATION_SCOPES,
} from '../../../common/auth/integration-token.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

/**
 * Creation d'un jeton d'integration.
 *
 * AUCUN CHAMP NE PERMET DE FOURNIR LE SECRET : il est genere cote serveur. Une
 * integration qui choisirait son propre secret choisirait un secret faible, et
 * c'est le genre de raccourci qu'on prend « juste pour un test » et qui finit en
 * production.
 */
export class CreateIntegrationTokenDto {
  @ApiProperty({
    example: 'n8n-production',
    description:
      'Nom unique de l’integration : minuscules, chiffres et tirets (3 a 40 caracteres).',
  })
  @IsString()
  @Matches(INTEGRATION_NAME_PATTERN, {
    message:
      'Le nom ne peut contenir que des minuscules, des chiffres et des tirets (3 a 40 caracteres).',
  })
  name!: string;

  /**
   * Codes de permission du catalogue. Vide = aucune donnee accessible : le jeton
   * sert alors de reserve, le temps de decider de son perimetre.
   *
   * `integration:manage:any` est refuse : une machine ne distribue pas d'acces.
   */
  @ApiProperty({
    description: 'Codes de permission accordes (sous-ensemble du catalogue).',
    example: ['task:read:any', 'project:read:any'],
  })
  @IsArray()
  @ArrayMaxSize(MAX_INTEGRATION_SCOPES)
  @IsString({ each: true })
  scopes!: string[];

  /**
   * Duree de validite en jours. `null` ou absent = pas d'expiration.
   *
   * Une date d'expiration est la seule mesure qui survive au depart d'une
   * personne : un jeton cree par un administrateur qu'on oublie de revoquer
   * finit par tomber tout seul.
   */
  @ApiPropertyOptional({
    description: 'Expiration en jours (1 a 3650).',
    minimum: 1,
    maximum: 3650,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  expiresInDays?: number;
}

/**
 * Renouvellement : le secret change, les droits peuvent changer, et l'ancien
 * jeton cesse de fonctionner DES LA REPONSE RENDUE.
 */
export class RenewIntegrationTokenDto {
  @ApiPropertyOptional({ description: 'Nouveaux codes de permission (remplacent les precedents).' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_INTEGRATION_SCOPES)
  @IsString({ each: true })
  scopes?: string[];

  @ApiPropertyOptional({ description: 'Nouvelle expiration en jours (1 a 3650).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  expiresInDays?: number;
}

/** Liste des jetons : pagination commune a toutes les listes de l'API. */
export class ListIntegrationTokensQueryDto extends PaginationQueryDto {}
