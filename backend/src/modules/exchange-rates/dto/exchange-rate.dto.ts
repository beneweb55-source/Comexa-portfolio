import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsDecimal, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

/**
 * DTO pour la création/mise à jour d'un taux de change
 */
export class UpsertExchangeRateDto {
  @ApiProperty({ description: 'Devise source (code ISO 4217)', example: 'DZD' })
  @IsString()
  @IsNotEmpty()
  fromCurrency!: string;

  @ApiProperty({ description: 'Devise cible (code ISO 4217)', example: 'EUR' })
  @IsString()
  @IsNotEmpty()
  toCurrency!: string;

  @ApiProperty({ description: 'Taux de change (1 fromCurrency = X toCurrency)', example: '0.0065' })
  @IsDecimal({ decimal_digits: '19,6' })
  @IsNotEmpty()
  rate!: string;

  @ApiPropertyOptional({ description: 'Date d\'effet (format: YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @ApiProperty({ description: 'Source du taux (obligatoire)', example: 'Banque d\'Algérie' })
  @IsString()
  @IsNotEmpty()
  source!: string;

  @ApiPropertyOptional({ description: 'Référence externe (URL, document)' })
  @IsOptional()
  @IsString()
  reference?: string;
}

/**
 * DTO pour la requête de conversion
 */
export class ConvertAmountQueryDto {
  @ApiProperty({ description: 'Montant à convertir', example: '10000' })
  @IsDecimal()
  @IsNotEmpty()
  amount!: string;

  @ApiProperty({ description: 'Devise source', example: 'DZD' })
  @IsString()
  @IsNotEmpty()
  from!: string;

  @ApiProperty({ description: 'Devise cible', example: 'EUR' })
  @IsString()
  @IsNotEmpty()
  to!: string;

  @ApiPropertyOptional({ description: 'Date du taux (format: YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  date?: string;
}

/**
 * DTO pour la requête d'historique
 */
export class RateHistoryQueryDto extends PaginationQueryDto {
  @ApiProperty({ description: 'Devise source', example: 'DZD' })
  @IsString()
  @IsNotEmpty()
  fromCurrency!: string;

  @ApiProperty({ description: 'Devise cible', example: 'EUR' })
  @IsString()
  @IsNotEmpty()
  toCurrency!: string;
}
