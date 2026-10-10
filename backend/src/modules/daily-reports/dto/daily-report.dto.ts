import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Corps de `PUT /daily-reports/:date`. Le contenu est le document JSON de l'éditeur riche. */
export class UpsertDailyReportDto {
  @ApiProperty({ description: 'Document JSON de l’éditeur (Tiptap).' })
  @IsObject()
  contentJson!: Record<string, unknown>;

  @ApiPropertyOptional({ maxLength: 280, description: 'Résumé court affiché dans les listes.' })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  summary?: string;
}

/** Filtres de lecture. Les dates sont au format YYYY-MM-DD. */
export class DailyReportQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date de début invalide (AAAA-MM-JJ).' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date de fin invalide (AAAA-MM-JJ).' })
  to?: string;

  @ApiPropertyOptional({ description: 'Restreint la vue d’équipe à un membre.' })
  @IsOptional()
  @IsString()
  userId?: string;
}
