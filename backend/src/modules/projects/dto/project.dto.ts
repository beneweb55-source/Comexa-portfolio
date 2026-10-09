import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { Priority, ProjectHealth, ProjectStatus } from '../../../generated/prisma/enums.js';
import { IsDateStringLike } from './is-date-string-like.decorator.js';

/**
 * Contrats d'entree du domaine PROJETS.
 *
 * `forbidNonWhitelisted` est actif : un champ absent d'ici fait ECHOUER la
 * requete. C'est ce qui rend ces classes opposables — un client qui envoie
 * `{ name, clientId, deletedAt: null }` doit apprendre tout de suite que
 * `deletedAt` n'est pas une entree.
 *
 * NOTE SUR LES CHAMPS ABSENTS, VOLONTAIREMENT :
 *
 *  - `status` et `health` ne figurent PAS dans `UpdateProjectDto`. Ils ont leur
 *    propre route (`PATCH /projects/:id/status`) et leur propre permission
 *    (`project:manage:status`). Les laisser passer par le PATCH general
 *    reviendrait a ouvrir le changement de statut a quiconque detient
 *    `project:write:any`, c'est-a-dire a contourner la permission dediee. Un
 *    champ en trop dans un DTO n'est pas une commodite, c'est une faille.
 *  - `deletedAt` n'est evidemment accepte nulle part : la suppression est une
 *    route, avec sa permission, pas un champ que l'on ecrit.
 */

/** Montant decimal en chaine : « 12500.00 ». Deux decimales au maximum. */
const MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

export class CreateProjectDto {
  @ApiProperty({ example: 'Refonte du site vitrine', maxLength: 200 })
  @IsString()
  @MinLength(2, { message: 'Le nom du projet est trop court.' })
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: 'REFONTE-2026', maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  /**
   * Le client d'origine. Obligatoire, et c'est un parti pris : un projet
   * n'existe pas sans client dans cette agence. Le rendre facultatif laisserait
   * creer des projets orphelins, invisibles dans l'espace client, qu'aucune
   * facturation ne pourrait rattacher.
   */
  @ApiProperty({ description: 'Identifiant du client (existant et non supprime).' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  clientId!: string;

  @ApiPropertyOptional({ description: 'Responsable du projet.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  managerId?: string;

  @ApiPropertyOptional({ enum: Priority, default: Priority.NORMAL })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiPropertyOptional({ example: '2026-10-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateStringLike()
  startDate?: string | null;

  @ApiPropertyOptional({ example: '2026-12-20T00:00:00.000Z' })
  @IsOptional()
  @IsDateStringLike()
  dueDate?: string | null;

  @ApiPropertyOptional({ example: '12500.00', description: 'Budget contractuel.' })
  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'Le budget doit etre un montant a deux decimales maximum.' })
  budget?: string;

  @ApiPropertyOptional({ example: 'EUR', default: 'EUR', maxLength: 3 })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currency?: string;
}

/**
 * Modification d'un projet.
 *
 * `clientId` EST modifiable, et c'est assume : un projet rattache au mauvais
 * client arrive — erreur de saisie, client qui fusionne, dossier repris par une
 * autre societe. Le refuser obligerait a supprimer et recreer le projet, ce qui
 * effacerait taches, temps et fil d'activite. La validite du client cible est
 * verifiee dans le service, comme a la creation.
 */
export class UpdateProjectDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Le nom du projet est trop court.' })
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;

  @ApiPropertyOptional({ maxLength: 5000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientId?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Retirer le responsable.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  managerId?: string | null;

  @ApiPropertyOptional({ enum: Priority })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateStringLike()
  startDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateStringLike()
  dueDate?: string | null;

  @ApiPropertyOptional({ example: '12500.00', nullable: true })
  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'Le budget doit etre un montant a deux decimales maximum.' })
  budget?: string | null;

  @ApiPropertyOptional({ maxLength: 3 })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currency?: string;
}

/**
 * Pilotage du projet : statut, sante, avancement declare.
 *
 * Les trois voyagent ENSEMBLE parce qu'ils partagent la meme permission
 * (`project:manage:status`) et le meme geste : un chef de projet qui declare un
 * projet « a risque » ajuste presque toujours l'avancement dans le meme ecran.
 * Les separer multiplierait les requetes sans rien proteger de plus.
 */
export class UpdateProjectStatusDto {
  @ApiProperty({ enum: ProjectStatus })
  @IsEnum(ProjectStatus)
  status!: ProjectStatus;

  @ApiPropertyOptional({ enum: ProjectHealth })
  @IsOptional()
  @IsEnum(ProjectHealth)
  health?: ProjectHealth;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "L'avancement doit etre un entier." })
  @Min(0, { message: "L'avancement ne peut pas etre negatif." })
  @Max(100, { message: "L'avancement ne peut pas depasser 100." })
  progressPercent?: number;
}

/** Filtres de la liste des projets. */
export class ProjectQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  /**
   * Filtre par client. Il ne peut PAS elargir le perimetre : le filtre de scope
   * est combine en ET avec celui-ci, donc un compte client qui demande l'identifiant
   * d'un autre client obtient une liste vide, pas la liste de l'autre.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  managerId?: string;

  @ApiPropertyOptional({ description: 'Recherche sur le nom, la reference ou le code.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class AddProjectMemberDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  userId!: string;

  @ApiPropertyOptional({ example: 'Developpeur front', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  projectRole?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "L'allocation doit etre un entier." })
  @Min(0, { message: "L'allocation ne peut pas etre negative." })
  @Max(100, { message: "L'allocation ne peut pas depasser 100." })
  allocationPercent?: number;
}
