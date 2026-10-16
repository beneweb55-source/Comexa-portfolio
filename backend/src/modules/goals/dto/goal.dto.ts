import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { GoalStatus } from '../../../generated/prisma/enums.js';
import { IsDateStringLike } from '../../projects/dto/is-date-string-like.decorator.js';
import { GOAL_COLORS } from '../goal-rules.js';

/**
 * Contrats des OBJECTIFS PERSONNELS.
 *
 * `ownerId` n'existe dans AUCUN de ces DTO : le proprietaire est toujours le
 * porteur du jeton. Rien ne permet de creer, lire ou modifier l'objectif de
 * quelqu'un d'autre — le champ qui le permettrait n'est pas declare.
 */
export class CreateGoalDto {
  @ApiProperty({ example: 'Livrer la boutique Maison Vasseur', maxLength: 160 })
  @IsString()
  @MinLength(2, { message: "Le titre de l'objectif est trop court." })
  @MaxLength(160)
  title!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ description: 'Date cible (jour).' })
  @IsOptional()
  @IsDateStringLike()
  targetDate?: string | null;

  @ApiPropertyOptional({ enum: GOAL_COLORS, default: 'blue' })
  @IsOptional()
  @IsIn([...GOAL_COLORS], { message: "Teinte d'objectif inconnue." })
  color?: string;
}

export class UpdateGoalDto {
  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: "Le titre de l'objectif est trop court." })
  @MaxLength(160)
  title?: string;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateStringLike()
  targetDate?: string | null;

  @ApiPropertyOptional({ enum: GOAL_COLORS })
  @IsOptional()
  @IsIn([...GOAL_COLORS], { message: "Teinte d'objectif inconnue." })
  color?: string;

  @ApiPropertyOptional({ enum: GoalStatus })
  @IsOptional()
  @IsEnum(GoalStatus)
  status?: GoalStatus;
}

/** `?status=` : ACTIVE, ACHIEVED, ARCHIVED, ou `all`. Par defaut : tout sauf l'archive. */
export class GoalQueryDto {
  @ApiPropertyOptional({ enum: [...Object.values(GoalStatus), 'all'] })
  @IsOptional()
  @IsIn([...Object.values(GoalStatus), 'all'])
  status?: GoalStatus | 'all';
}
