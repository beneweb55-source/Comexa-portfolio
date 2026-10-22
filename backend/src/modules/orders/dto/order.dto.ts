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

/**
 * Changement d'etat d'une commande par l'equipe.
 *
 * Les transitions autorisees vivent dans le service : ce DTO ne dit que « je
 * veux cet etat », jamais « depuis n'importe lequel ». Valider une commande
 * (creer son projet) reste `POST /orders/:id/validate` ; demarrer le projet
 * reste `POST /orders/:id/start`. Cette route sert aux corrections d'etat
 * (mise en revue, annulation, cloture) et ne cree donc rien.
 */
export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus })
  @IsEnum(OrderStatus, { message: "Cet etat de commande n'existe pas." })
  status!: OrderStatus;
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
