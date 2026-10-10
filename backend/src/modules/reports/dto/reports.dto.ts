import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { ReportStatus, ReportType } from '../../../generated/prisma/enums.js';
import { PERIOD_PRESETS, type PeriodPreset } from '../report-period.js';

/**
 * CONTRAT DES RAPPORTS.
 *
 * `forbidNonWhitelisted` est actif sur l'application : tout champ non declare
 * ici fait echouer la requete en 400. C'est ce qui transforme un
 * `?clientId=<autre client>` en refus explicite plutot qu'en filtre silencieux.
 */

/** Libelles des types de rapport, pour composer un titre par defaut. */
export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  COMMERCIAL_PIPELINE: 'Pipeline commercial',
  REVENUE: 'Chiffre d affaires',
  OUTSTANDING_INVOICES: 'Encours client',
  TASKS: 'Taches',
  TIME_SPENT: 'Temps passe',
  PROJECT_PROGRESS: 'Avancement des projets',
  ACTIVITY: 'Journal d activite',
};

export class GenerateReportDto {
  @ApiProperty({
    enum: ReportType,
    description: 'Nature du rapport a produire.',
    example: 'REVENUE',
  })
  @IsEnum(ReportType, { message: 'Type de rapport inconnu.' })
  type!: ReportType;

  @ApiPropertyOptional({
    description:
      'Titre de la piece. Un libelle compose a partir du type et de la periode est utilise si absent.',
    minLength: 3,
    maxLength: 160,
  })
  @IsOptional()
  @IsString({ message: 'Le titre doit etre une chaine.' })
  @Length(3, 160, { message: 'Le titre doit faire entre 3 et 160 caracteres.' })
  title?: string;

  @ApiPropertyOptional({
    enum: PERIOD_PRESETS,
    description: 'Periode predefinie. Exclusif avec periodStart et periodEnd.',
  })
  @IsOptional()
  @IsIn([...PERIOD_PRESETS], { message: 'Periode predefinie inconnue.' })
  preset?: PeriodPreset;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Debut de periode explicite, inclus. A fournir avec periodEnd.',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Date de debut invalide.' })
  periodStart?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Fin de periode explicite, incluse. A fournir avec periodStart.',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Date de fin invalide.' })
  periodEnd?: string;

  /**
   * Aucun champ `clientId` n'est declare, et c'est volontaire.
   *
   * Le perimetre client vient du porteur du jeton (`policy.clientId`), jamais
   * d'un identifiant present dans la requete. Un client qui ajouterait
   * `?clientId=<autre>` se fait refuser par le garde de validation.
   */
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Restreint le rapport a un projet precis.',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'Identifiant de projet invalide.' })
  projectId?: string;
}

export class ReportListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ReportType, description: 'Filtre sur la nature du rapport.' })
  @IsOptional()
  @IsEnum(ReportType, { message: 'Type de rapport inconnu.' })
  type?: ReportType;

  @ApiPropertyOptional({ enum: ReportStatus, description: 'Filtre sur l etat de generation.' })
  @IsOptional()
  @IsEnum(ReportStatus, { message: 'Etat de rapport inconnu.' })
  status?: ReportStatus;

  @ApiPropertyOptional({ format: 'uuid', description: 'Filtre sur le projet vise.' })
  @IsOptional()
  @IsUUID(undefined, { message: 'Identifiant de projet invalide.' })
  projectId?: string;
}
