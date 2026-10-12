import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CalendarEventKind, CalendarVisibility } from '../../../generated/prisma/enums.js';

/**
 * DTO DU CALENDRIER.
 *
 * Les horodatages sont des chaines ISO 8601 (avec decalage : `2026-10-12T14:00:00+01:00`).
 * Le service les convertit en UTC AVANT toute comparaison ou ecriture : un
 * calendrier qui melange fuseaux sans les normaliser deplace les rendez-vous
 * selon la machine qui ecrit.
 *
 * `whitelist` global oblige : tout champ non declare ici est un 400, pas un
 * silence. C'est le meme contrat que le reste de l'API.
 */
export class CreateCalendarEventDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsEnum(CalendarEventKind)
  kind?: CalendarEventKind;

  @IsOptional()
  @IsEnum(CalendarVisibility)
  visibility?: CalendarVisibility;

  /** Debut (ISO 8601). Une date seule est acceptee pour un evenement `allDay`. */
  @IsISO8601()
  startsAt!: string;

  /** Fin (ISO 8601) — omise pour un rappel ou une echeance ponctuelle. */
  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string;

  /** Lien optionnel vers une tache (lecture requise) — jamais une obligation. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  taskId?: string;

  /** Lien optionnel vers un projet (lecture requise). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  projectId?: string;
}

/**
 * Mise a jour : meme forme que la creation, tout facultatif, SAUF la presence
 * d'au moins un champ (un PATCH vide n'a pas de sens et se prend un 400).
 */
export class UpdateCalendarEventDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsEnum(CalendarEventKind)
  kind?: CalendarEventKind;

  @IsOptional()
  @IsEnum(CalendarVisibility)
  visibility?: CalendarVisibility;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  taskId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  projectId?: string;
}

/**
 * Fenetre de lecture d'une vue (jour/semaine/mois/periode).
 *
 * `from`/`to` sont ISO 8601 ; les deux sont optionnels (l'absence ouvre la
 * fenetre dans le sens correspondant), mais leur couple doit etre coherent et
 * la fenetre reste bornee (voir `MAX_RANGE_DAYS` dans le service) — une vue
 * « tout l'infini » n'est pas une vue, c'est une table de la base.
 */
export class CalendarRangeQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

/** Remplacement complet de la liste des invites d'un evenement SHARED. */
export class ReplaceParticipantsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  userIds!: string[];
}

export { CalendarEventKind, CalendarVisibility };
