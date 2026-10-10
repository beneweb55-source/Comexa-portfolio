import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { BooleanFilter } from '../../../common/dto/boolean-filter.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { ClientStatus } from '../../../generated/prisma/enums.js';

/**
 * Contrats d'entree du module clients.
 *
 * Meme semantique de modification que pour les prospects : `null` efface,
 * l'absence ne touche pas.
 *
 * CE QUI N'EST PAS ICI, ET POURQUOI.
 *
 *  - `reference` : la numerotation est produite par `ReferenceService`, dans la
 *    transaction qui cree la ligne. L'accepter du client ferait entrer une
 *    reference choisie a la main dans une sequence legale.
 *  - `deletedAt` : la suppression est une route, pas un champ.
 *  - `convertedFromProspect` : le lien prospect -> client s'ecrit par la
 *    conversion, dans le module prospects. Un client ne se declare pas
 *    « converti depuis » un prospect : c'est le prospect qui porte le lien.
 */

const NAME_MAX = 200;
const EMAIL_MAX = 320;
const TEXT_MAX = 5000;
const ID_MAX = 64;

export class CreateClientDto {
  @ApiProperty({ example: 'Maison Vasseur' })
  @IsString()
  @MinLength(1, { message: 'La raison sociale est obligatoire.' })
  @MaxLength(NAME_MAX)
  companyName!: string;

  @ApiPropertyOptional({ example: 'Maison Vasseur SARL' })
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX)
  legalName?: string;

  @ApiPropertyOptional({ description: 'Identifiant legal, facultatif.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  registrationNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  vatNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX)
  sector?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  website?: string;

  @ApiPropertyOptional({ example: '10-49' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  employeeRange?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  addressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  addressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  region?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  country?: string;

  @ApiPropertyOptional({ enum: Object.values(ClientStatus) })
  @IsOptional()
  @IsEnum(ClientStatus, { message: "Ce statut de client n'existe pas." })
  status?: ClientStatus;

  @ApiPropertyOptional({ description: 'Responsable de compte. Omis, la fiche revient au porteur.' })
  @IsOptional()
  @IsString()
  @MaxLength(ID_MAX)
  accountManagerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_MAX)
  notes?: string;
}

export class UpdateClientDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'La raison sociale ne peut pas etre vide.' })
  @MaxLength(NAME_MAX)
  companyName?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX)
  legalName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  registrationNumber?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  vatNumber?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX)
  sector?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  website?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  employeeRange?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  addressLine1?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  addressLine2?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  region?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  country?: string | null;

  @ApiPropertyOptional({ enum: Object.values(ClientStatus) })
  @IsOptional()
  @IsEnum(ClientStatus, { message: "Ce statut de client n'existe pas." })
  status?: ClientStatus;

  @ApiPropertyOptional({ nullable: true, description: 'Responsable de compte.' })
  @IsOptional()
  @IsString()
  @MaxLength(ID_MAX)
  accountManagerId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_MAX)
  notes?: string | null;
}

export class CreateContactDto {
  @ApiProperty()
  @IsString()
  @MinLength(1, { message: 'Le prenom du contact est obligatoire.' })
  @MaxLength(120)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1, { message: 'Le nom du contact est obligatoire.' })
  @MaxLength(120)
  lastName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail({}, { message: "L'adresse e-mail n'est pas valide." })
  @MaxLength(EMAIL_MAX)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string;

  @ApiPropertyOptional({
    description:
      "Interlocuteur principal. Un client n'a qu'un seul principal : le definir retire le drapeau aux autres.",
  })
  // Le piege de conversion est documente une seule fois, dans boolean-filter.ts.
  @BooleanFilter()
  isPrimary?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_MAX)
  notes?: string;
}

export class UpdateContactDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Le prenom du contact ne peut pas etre vide.' })
  @MaxLength(120)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Le nom du contact ne peut pas etre vide.' })
  @MaxLength(120)
  lastName?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsEmail({}, { message: "L'adresse e-mail n'est pas valide." })
  @MaxLength(EMAIL_MAX)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string | null;

  @ApiPropertyOptional({ description: 'Voir la regle du contact principal.' })
  @BooleanFilter()
  isPrimary?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_MAX)
  notes?: string | null;
}

export class ListClientsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Object.values(ClientStatus) })
  @IsOptional()
  @IsEnum(ClientStatus, { message: "Ce statut de client n'existe pas." })
  status?: ClientStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(ID_MAX)
  accountManagerId?: string;

  @ApiPropertyOptional({ description: 'Recherche sur la raison sociale et la raison legale.' })
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX)
  search?: string;
}
