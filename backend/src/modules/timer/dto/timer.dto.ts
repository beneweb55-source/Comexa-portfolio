import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

/** Une note de minuteur devient la description d'une saisie : meme borne (500). */
const MAX_NOTE_LENGTH = 500;

/**
 * Demarrage du minuteur.
 *
 * `userId` est ABSENT : le minuteur appartient au porteur de la requete, et
 * rien ne permet de chronometrer « pour » quelqu'un d'autre — une entree de
 * plus ici serait une entree a proteger. La duree, le statut et les horodatages
 * sont calcules cote serveur : les accepter du client reviendrait a accepter
 * un compte-rendu qu'on ne peut pas verifier.
 *
 * `taskId` est FACULTATIF : le minuteur peut tourner SANS tache. REGLE
 * METIER (appliquee a l'arret, voir `TimerService.stop`) : un temps sans
 * tache est NON FACTURABLE et sans projet — c'est une periode de travail
 * reelle qu'on ne veut pas perdre, pas un blanc comptable. Chronometrer une
 * tache reste la norme ; le sans-tache est l'exception assumee, et la tache
 * peut etre choisie EN COURS DE ROUTE (`PATCH /timer`).
 */
export class StartTimerDto {
  @ApiPropertyOptional({
    example: 'clx123abc',
    description: 'Tache a chronometrer (projet ou personnelle) — omise pour un suivi sans tache.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  taskId?: string;

  @ApiPropertyOptional({ maxLength: MAX_NOTE_LENGTH, description: 'Sur quoi je travaille.' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  note?: string;
}

/**
 * Correction de la session EN COURS : la tache chronometree et/ou la note.
 *
 * `taskId` : ABSENT = inchange ; `null` = detacher la tache (suivi sans tache) ;
 * identifiant = changer de tache, re-verifie avec le meme filtre d'ecriture
 * qu'au demarrage. Le temps deja ecoule est CONSERVE : se tromper de tache au
 * demarrage ne doit pas obliger a jeter le temps travaille.
 */
export class UpdateTimerDto {
  @ApiPropertyOptional({ nullable: true, description: 'Nouvelle tache, ou null pour aucune.' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(64)
  taskId?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: MAX_NOTE_LENGTH })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  note?: string | null;
}

/** Arret : la description finale de la saisie (sinon la note, sinon un libelle par defaut). */
export class StopTimerDto {
  @ApiPropertyOptional({ maxLength: MAX_NOTE_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  description?: string;
}

/**
 * Recherche des taches chronometrables (titre ou nom du projet).
 *
 * `scope=mine` : celles qui me sont assignees (et mes taches personnelles) ;
 * `scope=team` : les AUTRES taches de projet que mes droits me laissent
 * chronometrer (`task:write:any`) ; absent : toutes. Deux listes separees
 * plutot qu'un tri impossible a exprimer (« les miennes d'abord ») qui
 * casserait la pagination.
 */
export class TimerTasksQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

  @ApiPropertyOptional({ enum: ['mine', 'team'] })
  @IsOptional()
  @IsIn(['mine', 'team'])
  scope?: 'mine' | 'team';
}
