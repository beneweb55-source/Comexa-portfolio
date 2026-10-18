import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsDecimal, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { DistributionBaseType, BeneficiaryType } from '../../../generated/prisma/enums.js';

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
 * DTO pour la création d'une configuration de répartition
 */
export class CreateDistributionConfigDto {
  @ApiProperty({ description: 'Nom de la configuration', example: 'Répartition 2026' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ description: 'Description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Base de calcul',
    enum: DistributionBaseType,
    default: DistributionBaseType.COLLECTED_AMOUNT,
  })
  @IsOptional()
  @IsEnum(DistributionBaseType)
  baseType?: DistributionBaseType;

  @ApiPropertyOptional({ description: 'Date d\'effet' })
  @IsOptional()
  @IsString()
  effectiveDate?: string;

  @ApiPropertyOptional({ description: 'Date de fin' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiProperty({ description: 'Liste des bénéficiaires' })
  @IsArray()
  @IsNotEmpty()
  beneficiaries!: CreateBeneficiaryDto[];
}

/**
 * DTO pour un bénéficiaire
 */
export class CreateBeneficiaryDto {
  @ApiProperty({ description: 'Type de bénéficiaire', enum: BeneficiaryType })
  @IsEnum(BeneficiaryType)
  beneficiaryType!: BeneficiaryType;

  @ApiProperty({ description: 'Nom', example: 'Younes' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ description: 'Pourcentage (0-100)', example: '20' })
  // `Decimal(5, 2)` : jusqu'a 2 decimales.
  @IsDecimal({ decimal_digits: '1,2' })
  @IsNotEmpty()
  percentage!: string;

  @ApiPropertyOptional({ description: 'ID de l\'utilisateur (pour MEMBER)' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiProperty({ description: 'Ordre d\'affichage', default: 0 })
  @IsInt()
  order!: number;
}

/**
 * DTO pour la requête de calcul de répartition
 */
export class CalculateDistributionQueryDto {
  @ApiPropertyOptional({ description: 'ID de la configuration (optionnel)' })
  @IsOptional()
  @IsString()
  configId?: string;
}

/**
 * DTO pour la requête de liste des répartitions
 */
export class ListDistributionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filtrer par projet' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Filtrer par statut' })
  @IsOptional()
  @IsString()
  status?: string;
}
