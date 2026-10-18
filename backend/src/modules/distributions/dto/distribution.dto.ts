import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsDecimal,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { DistributionBaseType, BeneficiaryType } from '../../../generated/prisma/enums.js';

/**
 * PIEGE `decimal_digits` — A LIRE AVANT DE MODIFIER CES VALEURS.
 *
 * `class-validator` n'interprete PAS `decimal_digits` comme la precision d'une
 * colonne Prisma. La bibliotheque `validator` l'insere TEL QUEL dans une
 * expression reguliere : `decimal_digits: '1,6'` produit `[0-9]{1,6}`. La valeur
 * attendue est donc « nombre de chiffres APRES la virgule, sous la forme
 * `min,max` » — l'ECHELLE, c'est-a-dire les decimales.
 *
 * `Decimal(5, 2)` devient donc `decimal_digits: '1,2'`. La precision Prisma
 * (19) produirait `[0-9]{19,2}`, une borne inferieure plus grande que la
 * borne superieure : le constructeur de RegExp leve « numbers out of order »,
 * et la route d'ecriture repond 500 au lieu de valider.
 */

/**
 * DTO pour un bénéficiaire dans une règle de répartition.
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
 * DTO de création d'une règle de répartition.
 *
 * `projectId` absent = règle par défaut (portée globale). `projectId` présent
 * = exception propre à ce projet.
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

  @ApiPropertyOptional({ description: 'Date d\'effet (ISO)' })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @ApiPropertyOptional({
    description: 'Exception propre à un projet (sinon règle par défaut)',
  })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiProperty({ description: 'Liste des bénéficiaires' })
  @IsArray()
  @IsNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateBeneficiaryDto)
  beneficiaries!: CreateBeneficiaryDto[];
}

/**
 * DTO de révision d'une règle : création d'une NOUVELLE VERSION.
 *
 * `confirm` est obligatoire : sans confirmation explicite, le changement est
 * refusé. C'est la garantie qu'un changement de règle n'est jamais un effet
 * de bord.
 */
export class ReviseDistributionConfigDto {
  @ApiPropertyOptional({ description: 'Nouveau nom' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Nouvelle description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Nouvelle base de calcul', enum: DistributionBaseType })
  @IsOptional()
  @IsEnum(DistributionBaseType)
  baseType?: DistributionBaseType;

  @ApiPropertyOptional({ description: 'Date d\'effet de la nouvelle version (ISO)' })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @ApiPropertyOptional({ description: 'Nouvelle liste de bénéficiaires' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBeneficiaryDto)
  beneficiaries?: CreateBeneficiaryDto[];

  @ApiProperty({
    description: 'Confirmation explicite du changement de règle',
    example: true,
  })
  @IsBoolean()
  confirm!: boolean;

  @ApiPropertyOptional({ description: 'Motif du changement' })
  @IsOptional()
  @IsString()
  reason?: string;
}

/**
 * DTO de la requête de calcul de répartition.
 */
export class CalculateDistributionQueryDto {
  @ApiPropertyOptional({ description: 'ID de la configuration (optionnel)' })
  @IsOptional()
  @IsString()
  configId?: string;

  @ApiPropertyOptional({
    description:
      'Clé d\'idempotence : deux appels avec la même clé rendent la même répartition',
  })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

/**
 * DTO du corps de la requête de calcul.
 *
 * La cle d'idempotence est un parametre d'OPERATION, pas un filtre : elle
 * decrit l'etat du monde que l'on veut repartir. Elle se trouve donc dans le
 * corps — la query reste reservee aux filtres de lecture.
 */
export class CalculateDistributionDto {
  @ApiPropertyOptional({ description: 'ID de la configuration (optionnel)' })
  @IsOptional()
  @IsString()
  configId?: string;

  @ApiPropertyOptional({
    description:
      'Clé d\'idempotence : deux appels avec la même clé rendent la même répartition',
  })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

/**
 * DTO de la requête de liste des répartitions.
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

/**
 * DTO de la requête de liste des règles.
 */
export class ListRulesQueryDto {
  @ApiPropertyOptional({ description: 'Filtrer par projet' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Portée : global | project', enum: ['global', 'project'] })
  @IsOptional()
  @IsString()
  scope?: 'global' | 'project';
}

/**
 * DTO de régularisation : appliquer une autre règle à une répartition déjà
 * appliquée, par contre-passation tracée.
 */
export class RegularizeDistributionDto {
  @ApiProperty({ description: 'ID de la règle à appliquer' })
  @IsString()
  @IsNotEmpty()
  configId!: string;

  @ApiProperty({ description: 'Motif de la régularisation' })
  @IsString()
  @MinLength(3)
  reason!: string;
}
