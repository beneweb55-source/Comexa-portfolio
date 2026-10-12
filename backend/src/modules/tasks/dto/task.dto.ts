import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { BooleanFilter } from '../../../common/dto/boolean-filter.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { Priority, TaskStatus } from '../../../generated/prisma/enums.js';
import { IsDateStringLike } from '../../projects/dto/is-date-string-like.decorator.js';

/**
 * Contrats d'entree du domaine TACHES.
 *
 * TROIS CHAMPS SONT ABSENTS, VOLONTAIREMENT :
 *
 *  - `status` n'est pas dans `UpdateTaskDto` : il a sa propre route
 *    (`PATCH /tasks/:id/status`) parce qu'une transition de statut ecrit une
 *    entree dans le fil d'activite et notifie quelqu'un. La laisser passer par le
 *    PATCH general ferait ces effets par surprise, ou pas du tout.
 *  - `assigneeId` n'y est pas non plus : assigner est
 *    `PATCH /tasks/:id/assign`, avec `task:assign:any`. Un `project:write:any`
 *    ne doit pas permettre de reattribuer le travail de quelqu'un d'autre par un
 *    chemin indirect.
 *  - `parentTaskId` n'est modifiable NULLE PART. Deplacer une tache sous un autre
 *    parent est exactement l'operation qui fait mentir la regle des sous-taches
 *    (« un parent clos n'a pas d'enfant ouvert ») : on la refuse plutot que de
 *    revalider tout un arbre a chaque modification.
 */

/** Une estimation au-dela est une faute de saisie, pas un vrai travail. */
const MAX_ESTIMATE_MINUTES = 60_000;

export class CreateTaskDto {
  @ApiProperty({ example: 'Integrer la maquette de la page accueil', maxLength: 300 })
  @IsString()
  @MinLength(2, { message: 'Le titre de la tache est trop court.' })
  @MaxLength(300)
  title!: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ description: 'Jalon auquel rattacher la tache.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  milestoneId?: string;

  @ApiPropertyOptional({ description: 'Tache parente (sous-tache).' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  parentTaskId?: string;

  @ApiPropertyOptional({ enum: Priority, default: Priority.NORMAL })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiPropertyOptional({ description: 'Assignee des la creation.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  assigneeId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_ESTIMATE_MINUTES })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "L'estimation doit etre un entier de minutes." })
  @Min(1, { message: "L'estimation doit etre strictement positive." })
  @Max(MAX_ESTIMATE_MINUTES)
  estimateMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateStringLike()
  startDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateStringLike()
  dueDate?: string | null;

  /**
   * Visibilite pour le client. FAUX PAR DEFAUT, et le defaut vient du schema,
   * pas d'ici : une tache interne le reste tant que personne ne la partage
   * explicitement. Le champ est donc optionnel et son absence signifie « interne ».
   */
  @ApiPropertyOptional({ default: false })
  // Le piege de conversion est documente une seule fois, dans boolean-filter.ts.
  @BooleanFilter()
  isClientVisible?: boolean;

  @ApiPropertyOptional({ description: "Ordre d'affichage dans la liste." })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order?: number;
}

/**
 * TACHE PERSONNELLE — un `CreateTaskDto` REDUIT, et c'est le contrat.
 *
 * Les champs absents le sont volontairement : pas de projet, pas de jalon, pas
 * de parent, pas d'assigne, pas de visibilite client, pas d'ordre de tableau.
 * Ce qui ne peut pas etre renseigne ne peut pas etre detourne ;
 * `TasksService.createPersonal` impose le reste a l'ecriture (assigne =
 * rapporteur = porteur, `isPersonal: true`, `isClientVisible: false`).
 */
export class CreatePersonalTaskDto {
  @ApiProperty({ example: 'Preparer les notes de la reunion client', maxLength: 300 })
  @IsString()
  @MinLength(2, { message: 'Le titre de la tache est trop court.' })
  @MaxLength(300)
  title!: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ enum: Priority, default: Priority.NORMAL })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_ESTIMATE_MINUTES })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "L'estimation doit etre un entier de minutes." })
  @Min(1, { message: "L'estimation doit etre strictement positive." })
  @Max(MAX_ESTIMATE_MINUTES)
  estimateMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateStringLike()
  startDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateStringLike()
  dueDate?: string | null;
}

export class UpdateTaskDto {
  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Le titre de la tache est trop court.' })
  @MaxLength(300)
  title?: string;

  @ApiPropertyOptional({ maxLength: 5000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  milestoneId?: string | null;

  @ApiPropertyOptional({ enum: Priority })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_ESTIMATE_MINUTES, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "L'estimation doit etre un entier de minutes." })
  @Min(1)
  @Max(MAX_ESTIMATE_MINUTES)
  estimateMinutes?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateStringLike()
  startDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateStringLike()
  dueDate?: string | null;

  @ApiPropertyOptional()
  @BooleanFilter()
  isClientVisible?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order?: number;
}

export class UpdateTaskStatusDto {
  @ApiProperty({ enum: TaskStatus })
  @IsEnum(TaskStatus)
  status!: TaskStatus;
}

/**
 * Assignation.
 *
 * `assigneeId` accepte `null` : retirer une tache a quelqu'un est une operation
 * normale (depart, reorganisation) et doit passer par la meme route, avec la meme
 * permission et la meme trace.
 *
 * `@ValidateIf((_, value) => value !== null)` ET NON `@IsOptional()`, ET LA
 * DIFFERENCE COMPTE. `@IsOptional()` laisse passer `null` ET `undefined` : un
 * corps `{}` serait donc accepte, le champ arriverait `undefined`, et le service
 * ecrirait « tache desassignee » dans le fil d'activite sans que rien n'ait
 * change. Ici `null` est explicitement demande (on desassigne), tandis qu'un
 * champ ABSENT est refuse par `@IsString()`. L'appelant doit dire lequel des deux
 * il veut.
 */
export class AssignTaskDto {
  @ApiProperty({ nullable: true, description: 'Null pour desassigner.' })
  @ValidateIf((_, value) => value !== null)
  @IsString({ message: "L'identifiant de l'assigne est obligatoire (null pour desassigner)." })
  @MaxLength(64)
  assigneeId!: string | null;
}

export class TaskQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TaskStatus })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @ApiPropertyOptional({ enum: Priority })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  assigneeId?: string;

  /**
   * Filtre « par personne », sur le CREATEUR de la tache.
   *
   * C'est un IDENTIFIANT DE COMPTE, jamais un nom : deux homonymes restent deux
   * personnes, et un renommage ne deplace pas des taches. Combine en `AND` avec
   * le projet et le perimetre du porteur (voir `taskFilterWhere`), il ne peut pas
   * faire sortir la liste du projet courant.
   */
  @ApiPropertyOptional({ description: 'Taches creees par ce compte (identifiant unique).' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  reporterId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  milestoneId?: string;

  @ApiPropertyOptional({ description: 'Recherche sur le titre.' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

  /**
   * Ne renvoyer que les taches racines (sans parent).
   *
   * Le filtre s'ecrit `?rootOnly=true`. Un `@Transform` seul ne suffit pas : la
   * conversion implicite du pipe passe AVANT lui et `Boolean('false')` vaut
   * `true`, donc `?rootOnly=false` filtrait la liste au lieu de la laisser
   * entiere — un bogue silencieux, invisible en lecture. Le piege et sa mesure
   * sont documentes une seule fois, dans `common/dto/boolean-filter.ts`.
   */
  @ApiPropertyOptional({ description: 'Uniquement les taches sans parent.' })
  @BooleanFilter()
  rootOnly?: boolean;

  /**
   * `?personalOnly=true` : ne garder que les taches PERSONNELLES (espace prive).
   * Meme piege de conversion que `rootOnly` — mesure documentee dans
   * `boolean-filter.ts`.
   */
  @ApiPropertyOptional({ description: 'Uniquement les taches personnelles.' })
  @BooleanFilter()
  personalOnly?: boolean;
}
