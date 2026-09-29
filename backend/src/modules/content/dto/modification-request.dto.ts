import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ModificationStatus, Priority } from '../../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { emptyToUndefined } from './transforms.js';

/**
 * DTO DES DEMANDES DE MODIFICATION.
 *
 * CE QUE LE CLIENT PEUT DIRE, ET CE QU'IL NE PEUT PAS.
 *
 * Une demande de modification est deposee par le client du projet, qui detient
 * `modificationrequest:write:own`. Deux champs du modele decrivent pourtant le
 * travail de l'AGENCE — `estimatedMinutes` et `extraCost` — et ils sont
 * volontairement ABSENTS de `CreateModificationRequestDto` :
 *
 *   - l'estimation est ce que l'agence repond, pas ce que le client demande. Un
 *     client qui chiffre lui-meme sa demande fausse le devis qui suivra ;
 *   - `extraCost` est un montant. Le faire saisir par le client reviendrait a le
 *     laisser fixer le prix de ce qu'il demande — et le supprimer du cote agence
 *     plus tard serait une negation.
 *
 * `projectId` et `clientId` ne sont pas non plus declares cote creation du cote
 * qui compte : le SERVICE derive le client du porteur de la requete. Le
 * `projectId`, lui, est bien dans le corps — un client peut avoir plusieurs
 * projets — mais il est verifie en base contre le `clientId` du porteur. Un
 * identifiant de projet appartenant a un autre client ne remonte pas un 403 mais
 * un 404 : confirmer l'existence d'un projet qu'on ne peut pas voir est deja une
 * fuite.
 */

/** Bornes de saisie. Elles suivent les colonnes du schema. */
const MAX_ID = 40;
const MAX_TITLE = 200;
const MAX_TEXT = 5000;
const MAX_NOTE = 5000;
const MAX_CURRENCY = 3;

export class CreateModificationRequestDto {
  @ApiProperty({ description: 'Projet concerne. Verifie contre le client du porteur.' })
  @emptyToUndefined()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_ID)
  projectId!: string;

  @ApiProperty({ maxLength: MAX_TITLE })
  @emptyToUndefined()
  @IsString()
  @MinLength(3, { message: 'Le titre est trop court.' })
  @MaxLength(MAX_TITLE)
  title!: string;

  @ApiProperty({ maxLength: MAX_TEXT })
  @emptyToUndefined()
  @IsString()
  @MinLength(10, { message: 'Decrivez la modification demandee.' })
  @MaxLength(MAX_TEXT)
  description!: string;

  @ApiPropertyOptional({ enum: Priority, default: Priority.NORMAL })
  @emptyToUndefined()
  @IsOptional()
  @IsEnum(Priority, { message: 'Priorite inconnue.' })
  priority?: Priority;
}

/**
 * Decision de l'agence.
 *
 * `APPROVED` et `REJECTED` sont les deux seules valeurs acceptees : c'est une
 * DECISION, et la route porte `modificationrequest:decide:any`. Les etats
 * `IN_PROGRESS` et `DONE` decrivent l'avancement du travail, qui appartient au
 * module projets — les melanger ici donnerait une route dont la permission
 * annonce une chose et dont le corps en fait une autre.
 *
 * `@IsIn` plutot que `@IsEnum(ModificationStatus)` : la liste fermee rend le
 * refus explicite des la validation, avec un message qui dit ce qui est attendu,
 * au lieu de laisser passer `SUBMITTED` et de le refuser plus loin.
 */
export class DecideModificationRequestDto {
  @ApiProperty({ enum: [ModificationStatus.APPROVED, ModificationStatus.REJECTED] })
  @emptyToUndefined()
  @IsIn([ModificationStatus.APPROVED, ModificationStatus.REJECTED], {
    message: 'Une decision vaut APPROVED ou REJECTED.',
  })
  status!: ModificationStatus;

  @ApiPropertyOptional({ maxLength: MAX_NOTE, description: 'Motif de la decision, affiche au client.' })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOTE)
  decisionNote?: string;

  @ApiPropertyOptional({ description: 'Charge estimee, en minutes. Saisie par l agence.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  estimatedMinutes?: number;

  @ApiPropertyOptional({
    description:
      'Supplement chiffre. Deux decimales au plus : la colonne est un Decimal(14,2), et une ' +
      'valeur plus precise serait arrondie par la base sans que personne ne le voie.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Le supplement accepte au plus deux decimales.' })
  @Min(0)
  @Max(1_000_000)
  extraCost?: number;

  @ApiPropertyOptional({ default: 'EUR', maxLength: MAX_CURRENCY })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CURRENCY)
  @MinLength(3)
  extraCostCurrency?: string;
}

/**
 * Filtres de `GET /api/modification-requests`.
 *
 * Cette route sert DEUX publics avec la meme forme de requete : l'agence, qui
 * voit tout, et le client, qui ne voit que ses demandes. Ce n'est pas le filtre
 * qui decide — c'est le `where` du service, construit a partir du porteur. Le
 * `clientId` n'est donc PAS un filtre accepte ici : s'il l'etait, il faudrait
 * expliquer pourquoi le service l'ignore quand un client le renseigne.
 */
export class ListModificationRequestsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ModificationStatus })
  @emptyToUndefined()
  @IsOptional()
  @IsEnum(ModificationStatus, { message: 'Statut de demande inconnu.' })
  status?: ModificationStatus;

  @ApiPropertyOptional({ enum: Priority })
  @emptyToUndefined()
  @IsOptional()
  @IsEnum(Priority, { message: 'Priorite inconnue.' })
  priority?: Priority;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ID)
  projectId?: string;

  @ApiPropertyOptional({ description: 'Recherche sur le titre et le reference.' })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ description: 'Date de creation minimale (ISO 8601).' })
  @emptyToUndefined()
  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'La date de debut doit etre au format ISO 8601.' })
  from?: string;

  @ApiPropertyOptional({ description: 'Date de creation maximale (ISO 8601).' })
  @emptyToUndefined()
  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'La date de fin doit etre au format ISO 8601.' })
  to?: string;
}
