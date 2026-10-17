import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsDecimal, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { DistributionBaseType, BeneficiaryType } from '../../../generated/prisma/enums.js';

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
  @IsDecimal({ decimal_digits: '5,2' })
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
