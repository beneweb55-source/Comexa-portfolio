import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderPaymentStatus, OrderStatus } from '../../../generated/prisma/enums.js';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

/**
 * Commande d'un pack.
 *
 * LE CLIENT N'ENVOIE NI DEVISE NI MONTANT. Les deux viennent du tarif en base
 * et du pays de residence du compte. Un champ `currency` accepte ici serait
 * une porte ouverte pour payer en DZD un pack facture en EUR.
 */
export class CreateOrderDto {
  @ApiProperty({ description: 'Identifiant du pack choisi.' })
  @IsString({ message: 'Le pack est obligatoire.' })
  @MinLength(1)
  @MaxLength(64)
  packageId!: string;
}

export class ListOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;
}

/** Enregistrement d'un paiement par l'equipe : jamais par le client. */
export class RecordPaymentDto {
  @ApiProperty({ enum: OrderPaymentStatus })
  @IsEnum(OrderPaymentStatus, { message: 'Etat de paiement inconnu.' })
  paymentStatus!: OrderPaymentStatus;

  @ApiPropertyOptional({ description: 'Reference du virement, du cheque ou du recu.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  note?: string;
}
