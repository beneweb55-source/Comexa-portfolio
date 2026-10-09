import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { MilestoneStatus } from '../../../generated/prisma/enums.js';
import { IsDateStringLike } from '../../projects/dto/is-date-string-like.decorator.js';

/**
 * Contrats d'entree du domaine JALONS.
 *
 * PAS DE `status` A LA CREATION, ET C'EST UN CHOIX. Un jalon nait `PENDING` : on
 * ne nait pas atteint, et `reachedAt` date un fait qui doit avoir eu lieu. Laisser
 * creer directement en `REACHED` ouvrirait une porte a une date d'atteinte fausse
 * — saisie apres coup, donc invérifiable — dans l'espace que le client consulte.
 * Le passage a `REACHED` se fait par `PATCH /milestones/:id`, qui date l'evenement
 * au moment ou il est declare et ecrit l'entree correspondante dans le fil.
 */

export class CreateMilestoneDto {
  @ApiProperty({ example: 'Livraison de la maquette', maxLength: 300 })
  @IsString()
  @MinLength(2, { message: 'Le titre du jalon est trop court.' })
  @MaxLength(300)
  title!: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateStringLike()
  dueDate?: string | null;

  @ApiPropertyOptional({ description: "Ordre d'affichage dans la frise." })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order?: number;
}

export class UpdateMilestoneDto {
  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Le titre du jalon est trop court.' })
  @MaxLength(300)
  title?: string;

  @ApiPropertyOptional({ maxLength: 5000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateStringLike()
  dueDate?: string | null;

  @ApiPropertyOptional({ description: "Ordre d'affichage dans la frise." })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order?: number;

  /**
   * Statut, transitions controlees par `canTransitionMilestone`.
   *
   * `REACHED` et `MISSED` ne sont pas des etapes de travail mais des CONSTATS :
   * les atteindre date `reachedAt` et publie une entree dans le fil du projet. Le
   * service refuse une transition qui n'existe pas dans la table, plutot que
   * d'accepter n'importe quel statut parce qu'il est valide pour l'enum.
   */
  @ApiPropertyOptional({ enum: MilestoneStatus })
  @IsOptional()
  @IsEnum(MilestoneStatus)
  status?: MilestoneStatus;
}
