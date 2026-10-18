import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDecimal, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { BalanceTransactionType } from '../../../generated/prisma/enums.js';

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
 * DTO pour un ajustement de solde
 */
export class AdjustBalanceDto {
  @ApiProperty({ description: 'ID du membre', example: 'usr_xxx' })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({ description: 'Devise', example: 'DZD' })
  @IsString()
  @IsNotEmpty()
  currency!: string;

  @ApiProperty({ description: 'Montant (positif ou négatif)', example: '1000' })
  // `Decimal(14, 2)` : jusqu'a 2 decimales.
  @IsDecimal({ decimal_digits: '1,2' })
  @IsNotEmpty()
  amount!: string;

  @ApiProperty({ description: 'Description de l\'ajustement', example: 'Correction manuelle' })
  @IsString()
  @IsNotEmpty()
  description!: string;
}

/**
 * DTO pour la requête d'historique
 */
export class TransactionHistoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filtrer par devise' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Filtrer par type', enum: BalanceTransactionType })
  @IsOptional()
  @IsString()
  type?: BalanceTransactionType;
}

/**
 * DTO pour la requête de solde
 */
export class GetBalanceQueryDto {
  @ApiPropertyOptional({ description: 'Filtrer par devise', default: 'DZD' })
  @IsOptional()
  @IsString()
  currency?: string;
}
