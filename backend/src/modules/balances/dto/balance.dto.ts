import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsDecimal,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import {
  BalanceTransactionType,
  BalanceTransactionStatus,
  BalanceTransactionKind,
} from '../../../generated/prisma/enums.js';

/**
 * PIEGE `decimal_digits` — A LIRE AVANT DE MODIFIER CES VALEURS.
 *
 * `class-validator` n'interprete PAS `decimal_digits` comme la precision d'une
 * colonne Prisma. La bibliotheque `validator` l'insere TEL QUEL dans une
 * expression reguliere : `decimal_digits: '1,6'` produit `[0-9]{1,6}`. La valeur
 * attendue est donc « nombre de chiffres APRES la virgule, sous la forme
 * `min,max` » — l'ECHELLE, c'est-a-dire les decimales.
 *
 * `Decimal(14, 2)` devient donc `decimal_digits: '1,2'`.
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

  @ApiPropertyOptional({ description: 'Filtrer par statut', enum: BalanceTransactionStatus })
  @IsOptional()
  @IsString()
  status?: BalanceTransactionStatus;

  @ApiPropertyOptional({ description: 'Filtrer par nature', enum: BalanceTransactionKind })
  @IsOptional()
  @IsString()
  kind?: BalanceTransactionKind;
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

/**
 * DTO d'ENREGISTREMENT D'UNE OPERATION DE SOLDE.
 *
 * Le montant est SIGNE : positif pour un credit (ajustement en faveur du
 * membre), negatif pour un debit (versement, avance). La nature (`kind`) dit
 * pourquoi ; le signe dit quoi.
 *
 * Un motif est TOUJOURS obligatoire : une ecriture financiere sans motif
 * n'est pas traçable, et l'historique des soldes n'a de valeur que si l'on
 * peut expliquer chaque ligne.
 */
export class RecordBalanceOperationDto {
  @ApiProperty({ description: 'ID du membre concerné' })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({
    description: 'Nature de l\'opération',
    enum: BalanceTransactionKind,
    example: BalanceTransactionKind.PAYMENT,
  })
  @IsEnum(BalanceTransactionKind)
  kind!: BalanceTransactionKind;

  @ApiProperty({
    description: 'Montant signé (négatif pour une sortie)',
    example: '-50000',
  })
  @IsDecimal({ decimal_digits: '1,2' })
  @IsNotEmpty()
  amount!: string;

  @ApiProperty({ description: 'Devise (3 lettres)', example: 'DZD' })
  @IsString()
  @IsNotEmpty()
  currency!: string;

  @ApiProperty({ description: 'Motif de l\'opération' })
  @IsString()
  @MinLength(3)
  reason!: string;

  @ApiPropertyOptional({ description: 'Date d\'effet (ISO)', example: '2026-10-18' })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @ApiPropertyOptional({ description: 'Référence (virement, pièce)' })
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional({ description: 'Projet concerné' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Clé d\'idempotence' })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

/**
 * DTO de contre-passation d'une operation.
 */
export class ReverseBalanceOperationDto {
  @ApiProperty({ description: 'Motif de la contre-passation' })
  @IsString()
  @MinLength(3)
  reason!: string;

  @ApiPropertyOptional({ description: 'Référence' })
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional({ description: 'Date d\'effet (ISO)' })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}

/**
 * DTO de consultation des soldes (tableau de bord administrateur).
 */
export class ListBalancesQueryDto {
  @ApiPropertyOptional({ description: 'Filtrer par membre' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'Filtrer par projet' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Filtrer par devise' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Filtrer par nature', enum: BalanceTransactionKind })
  @IsOptional()
  @IsString()
  kind?: BalanceTransactionKind;

  @ApiPropertyOptional({ description: 'Début de période (ISO)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Fin de période (ISO)' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

/**
 * DTO de consultation de l'historique global (administrateur).
 */
export class ListBalanceTransactionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filtrer par membre' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'Filtrer par projet' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Filtrer par devise' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Filtrer par nature', enum: BalanceTransactionKind })
  @IsOptional()
  @IsString()
  kind?: BalanceTransactionKind;

  @ApiPropertyOptional({ description: 'Filtrer par type', enum: BalanceTransactionType })
  @IsOptional()
  @IsString()
  type?: BalanceTransactionType;

  @ApiPropertyOptional({ description: 'Filtrer par statut', enum: BalanceTransactionStatus })
  @IsOptional()
  @IsString()
  status?: BalanceTransactionStatus;

  @ApiPropertyOptional({ description: 'Début de période (ISO)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Fin de période (ISO)' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
