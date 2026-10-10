import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsNumber, Min } from 'class-validator';
import { SUPPORTED_CURRENCIES, type SupportedCurrency } from '../order-pricing.js';

/**
 * Nouveau tarif d'un pack, dans UNE devise. DZD et EUR sont independants : aucun
 * des deux n'est deduit de l'autre. Un tarif n'est jamais modifie : on en cree
 * un nouveau, avec sa date d'effet.
 */
export class CreatePackageRateDto {
  @ApiProperty({ enum: SUPPORTED_CURRENCIES })
  @IsIn(SUPPORTED_CURRENCIES as unknown as string[], { message: 'Devise non prise en charge.' })
  currency!: SupportedCurrency;

  @ApiProperty({
    example: 50000,
    description: 'Montant TTC dans la devise indiquee, 2 decimales maximum.',
  })
  @Type(() => Number)
  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 },
    { message: 'Montant invalide.' },
  )
  @Min(0.01, { message: 'Le montant doit etre positif.' })
  amount!: number;

  @ApiProperty({ description: "Date d'effet (ISO 8601)." })
  @Type(() => Date)
  @IsDate({ message: "Date d'effet invalide." })
  effectiveFrom!: Date;
}
