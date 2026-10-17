import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

/**
 * DTO pour la création d'une devise
 */
export class CreateCurrencyDto {
  @ApiProperty({ description: 'Code ISO 4217 (3 lettres majuscules)', example: 'DZD' })
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  code!: string;

  @ApiProperty({ description: 'Nom de la devise', example: 'Dinar Algérien' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ description: 'Symbole monétaire', example: 'د.ج' })
  @IsString()
  @MinLength(1)
  @MaxLength(5)
  symbol!: string;

  @ApiPropertyOptional({ description: 'Devise par défaut', default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/**
 * DTO pour la mise à jour d'une devise
 */
export class UpdateCurrencyDto {
  @ApiPropertyOptional({ description: 'Nom de la devise' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'Symbole monétaire' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(5)
  symbol?: string;

  @ApiPropertyOptional({ description: 'Devise active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Devise par défaut' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/**
 * DTO pour la liste des devises
 */
export class ListCurrenciesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filtrer par devise active' })
  @IsOptional()
  @IsBoolean()
  activeOnly?: boolean;
}
