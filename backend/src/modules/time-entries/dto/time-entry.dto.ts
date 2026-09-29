import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { BooleanFilter } from '../../../common/dto/boolean-filter.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { IsDateStringLike } from '../../projects/dto/is-date-string-like.decorator.js';

/**
 * Contrats d'entree du domaine TEMPS.
 *
 * IL N'Y A PAS DE `projectId`, NI A LA CREATION NI NULLE PART. Le projet d'une
 * saisie se DEDUIT de sa tache, et il est ecrit par le service a partir d'elle.
 * Accepter un `projectId` dans le corps de la requete aurait ouvert exactement la
 * faille que le brief decrit : un porteur qui change un identifiant pour ranger
 * son temps — ou celui d'un autre — dans le projet d'un autre client. Ici, la
 * valeur n'existe pas dans le contrat d'entree, donc elle ne peut pas etre
 * falsifiee.
 *
 * `userId` EXISTE, MAIS N'EST HONORE QUE SOUS `time:write:any`. C'est le sens de
 * cette permission : « saisir et corriger le temps de tous ». Un porteur qui n'a
 * que `time:write:own` et qui designe quelqu'un d'autre est refuse par le
 * service, pas ignore en silence.
 */

const MAX_DESCRIPTION_LENGTH = 2000;

export class CreateTimeEntryDto {
  @ApiProperty({ minimum: 1, maximum: 1440, example: 90 })
  @Type(() => Number)
  @IsInt({ message: 'La duree doit etre un nombre entier de minutes.' })
  @Min(1, { message: 'La duree doit etre strictement positive.' })
  // Le plafond est aussi verifie par `minutesViolation` dans le service, qui rend
  // une phrase utilisable telle quelle. Les deux sont gardes : celui-ci produit un
  // 400 lisible par le client de l'API, l'autre est la regle du domaine, testee
  // sans HTTP.
  @Max(24 * 60)
  minutes!: number;

  @ApiPropertyOptional({ description: 'Journee travaillee (ISO 8601). Defaut : aujourd’hui.' })
  @IsOptional()
  @IsDateStringLike()
  spentOn?: string;

  @ApiPropertyOptional({ maxLength: MAX_DESCRIPTION_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description?: string;

  @ApiPropertyOptional({ default: true })
  // Le piege de conversion est documente une seule fois, dans boolean-filter.ts.
  @BooleanFilter()
  billable?: boolean;

  @ApiPropertyOptional({ description: "Personne dont on saisit le temps. Exige time:write:any." })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;
}

/**
 * Modification d'une saisie existante.
 *
 * `userId` N'Y FIGURE PAS, ET C'EST UN CHOIX. Deplacer une saisie d'une personne a
 * une autre n'est pas une correction, c'est une reecriture de l'histoire : les
 * heures ont ete faites par quelqu'un. Le geste correct est de supprimer la
 * saisie et d'en creer une autre, ce qui laisse deux lignes dans le journal
 * d'audit au lieu d'une modification silencieuse.
 */
export class UpdateTimeEntryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 1440 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'La duree doit etre un nombre entier de minutes.' })
  @Min(1)
  @Max(24 * 60)
  minutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateStringLike()
  spentOn?: string;

  @ApiPropertyOptional({ maxLength: MAX_DESCRIPTION_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description?: string | null;

  @ApiPropertyOptional()
  @BooleanFilter()
  billable?: boolean;
}

export class TimeEntryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filtre sur la personne. Ignore sous time:read:own.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  projectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  taskId?: string;

  @ApiPropertyOptional({ description: 'Debut de periode (jour inclus).' })
  @IsOptional()
  @IsDateStringLike()
  from?: string;

  @ApiPropertyOptional({ description: 'Fin de periode (jour inclus).' })
  @IsOptional()
  @IsDateStringLike()
  to?: string;

  /**
   * Sans conversion, `?billable=false` filtrait sur « facturable » au lieu de
   * « non facturable » : la chaine `"false"` est vraie en JavaScript, et la
   * conversion implicite du pipe passe avant tout `@Transform`. Un bogue
   * silencieux, qui ne se voit qu'en comparant les totaux. Le piege et sa mesure
   * sont documentes une seule fois, dans `common/dto/boolean-filter.ts`.
   */
  @ApiPropertyOptional()
  @BooleanFilter()
  billable?: boolean;
}
