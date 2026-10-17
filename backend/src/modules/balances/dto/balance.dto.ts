import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDecimal, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { BalanceTransactionType } from '../../../generated/prisma/enums.js';

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
  @IsDecimal({ decimal_digits: '14,2' })
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
