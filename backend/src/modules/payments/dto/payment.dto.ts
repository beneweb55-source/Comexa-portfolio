import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { PaymentMethod, PaymentStatus } from '../../../generated/prisma/enums.js';

/**
 * CONTRATS D'ENTREE DES PAIEMENTS.
 *
 * LE MONTANT D'UN PAIEMENT EST LE SEUL MONTANT QU'UN CLIENT FOURNISSE
 * LEGITIMEMENT, et c'est la raison pour laquelle ce fichier existe separement de
 * celui des factures : ici, un `amount` est attendu. Partout ailleurs — devis,
 * factures — un montant envoye par le client n'est jamais cru.
 *
 * Ce montant est encadre par TROIS bornes, et chacune repond a un usage
 * different :
 *
 *  - `@Min(0.01)` : un paiement nul ou negatif n'est pas un paiement. Un
 *    remboursement est un acte distinct, pas un encaissement de -100 ;
 *  - `@Max(...)` : la colonne est `Decimal(14, 2)`, et un nombre a quinze
 *    chiffres significatifs ferait echouer l'insertion en erreur de base — donc
 *    en 500 — au lieu d'un refus lisible ;
 *  - LE SOLDE DE LA FACTURE, verifie dans le service et SOUS VERROU : c'est la
 *    seule borne qui depende de l'etat de la base, et c'est celle qu'un controle
 *    de DTO ne peut pas exprimer (voir `invoice-lock.ts`).
 */

/** `Decimal(14, 2)` porte douze chiffres avant la virgule. */
const MAX_AMOUNT = 999_999_999_999.99;

export class CreatePaymentDto {
  /**
   * Montant encaisse. POSITIF, et jamais superieur au solde de la facture.
   *
   * Le montant est demande en unite monetaire (12.50 pour douze euros
   * cinquante), pas en centimes : c'est ce que porte la colonne, et convertir
   * dans un sens puis dans l'autre finirait par produire des centimes perdus.
   */
  @ApiProperty({ example: 1200.5, description: 'Montant encaisse, positif, plafonne au solde.' })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Le montant doit avoir au plus deux decimales.' })
  @Min(0.01, { message: 'Un paiement doit etre strictement positif.' })
  @Max(MAX_AMOUNT, { message: 'Le montant depasse ce que la colonne peut porter.' })
  amount!: number;

  @ApiProperty({ enum: PaymentMethod, example: 'BANK_TRANSFER' })
  @IsEnum(PaymentMethod, { message: 'Moyen de paiement inconnu.' })
  method!: PaymentMethod;

  @ApiPropertyOptional({ description: 'Date de valeur. Defaut : maintenant.' })
  @IsOptional()
  @IsISO8601({}, { message: 'La date de paiement n est pas une date valide.' })
  paidAt?: string;

  @ApiPropertyOptional({ description: 'Reference du virement, du cheque, de la transaction.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalReference?: string;

  @ApiPropertyOptional({ description: 'Justificatif deja televerse (module documents).' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  proofDocumentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/**
 * Filtres de liste des paiements.
 *
 * PAS DE `currency` ICI, ET PAS DANS LE DTO DE CREATION NON PLUS : un paiement
 * se fait dans la devise de sa facture. Accepter une autre devise ouvrirait la
 * question du taux de change et de l'arrondi — un sujet entier, qui n'a rien a
 * faire dans une version ou aucune conversion n'est stockee.
 */
export class ListPaymentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod, { message: 'Moyen de paiement inconnu.' })
  method?: PaymentMethod;

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus, { message: 'Statut de paiement inconnu.' })
  status?: PaymentStatus;

  @ApiPropertyOptional({ description: 'Paiements de cette facture.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  invoiceId?: string;

  @ApiPropertyOptional({
    description:
      'Filtre interne. IGNORE pour un porteur client, dont le perimetre vient du compte.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  clientId?: string;

  @ApiPropertyOptional({ description: 'Date de valeur, au plus tot (incluse).' })
  @IsOptional()
  @IsISO8601({}, { message: 'La date de debut n est pas une date valide.' })
  from?: string;

  @ApiPropertyOptional({ description: 'Date de valeur, au plus tard (incluse).' })
  @IsOptional()
  @IsISO8601({}, { message: 'La date de fin n est pas une date valide.' })
  to?: string;
}
