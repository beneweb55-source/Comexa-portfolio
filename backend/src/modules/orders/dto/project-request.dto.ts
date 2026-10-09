import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { ProjectRequestStatus } from '../../../generated/prisma/enums.js';

/**
 * Demande de projet. Le client n'envoie NI pays NI motif : le serveur les releve
 * sur le compte et sur l'offre du pack.
 */
export class CreateProjectRequestDto {
  @ApiPropertyOptional({
    description: 'Pack concerne, si la demande fait suite a une commande impossible.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  packageId?: string;

  @ApiPropertyOptional({ description: 'Votre besoin, en quelques phrases.' })
  @IsOptional()
  @IsString({ message: 'Le message doit etre du texte.' })
  @MaxLength(2000, { message: 'Le message ne doit pas depasser 2000 caracteres.' })
  message?: string;
}

export class ListProjectRequestsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ProjectRequestStatus })
  @IsOptional()
  @IsEnum(ProjectRequestStatus)
  status?: ProjectRequestStatus;
}

/** Traitement par l'equipe. La note interne n'est jamais renvoyee au client. */
export class UpdateProjectRequestDto {
  @ApiProperty({ enum: ProjectRequestStatus })
  @IsEnum(ProjectRequestStatus, { message: 'Statut inconnu.' })
  status!: ProjectRequestStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  teamNote?: string;
}

export class OfferQueryDto {
  @ApiProperty()
  @IsString({ message: 'Le pack est obligatoire.' })
  @MinLength(1)
  @MaxLength(64)
  packageId!: string;
}
