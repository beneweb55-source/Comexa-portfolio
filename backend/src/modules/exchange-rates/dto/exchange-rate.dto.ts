import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsDecimal, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

/**
 * PIEGE `decimal_digits` — A LIRE AVANT DE MODIFIER CES VALEURS.
 *
 * `class-validator` n'interprete PAS `decimal_digits` comme la precision d'une
 * colonne Prisma. La bibliotheque `validator` l'insere TEL QUEL dans une
 * expression reguliere : `decimal_digits: '1,6'` produit `[0-9]{1,6}`. La valeur
 * attendue est donc « nombre de chiffres APRES la virgule, sous la forme
 * `min,max` ».
 *
 * Ce fichier portait la precision Prisma (`Decimal(19, 6)`), ce qui generait
 * `[0-9]{19,6}` — une borne inferieure PLUS GRANDE que la borne superieure. Le
 * constructeur de `RegExp` levait « numbers out of order in {} quantifier », et
 * la requete repondait 500 « Invalid regular expression » au lieu de valider.
 * Aucune compilation ne l'a signale, et aucun test unitaire du service ne
 * pouvait le voir : l'erreur naissait a l'execution, dans le validateur, sur la
 * seule route d'ecriture.
 *
 * La correspondance est donc : `@db.Decimal(p, s)` devient `decimal_digits:
 * '1,s'` — `s` etant l'echelle, c'est-a-dire les decimales.
 */

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
  // `Decimal(19, 6)` : jusqu'a 6 decimales.
  @IsDecimal({ decimal_digits: '1,6' })
  @IsNotEmpty()
  rate!: string;

  @ApiPropertyOptional({ description: "Date d'effet (format: YYYY-MM-DD)" })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @ApiProperty({ description: 'Source du taux (obligatoire)', example: "Banque d'Algérie" })
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
