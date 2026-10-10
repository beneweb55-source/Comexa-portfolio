import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

/**
 * FILTRES DE CONSULTATION DU JOURNAL.
 *
 * CE QUI EST FILTRABLE, ET CE QUI NE L'EST PAS.
 *
 * Les quatre filtres correspondent a la facon dont on interroge reellement un
 * journal : « qu'a fait cette personne ? » (`actorId`), « qui a supprime ce
 * compte ? » (`entityType` + `entityId`), « quels changements de droits ont eu
 * lieu ? » (`action`), « que s'est-il passe ce mois-la ? » (`from`/`to`).
 *
 * Il n'y a PAS de filtre plein texte sur `before`/`after`. Deux raisons : la
 * recherche dans une colonne JSON n'est pas indexable utilement en PostgreSQL
 * sans index dedie, et surtout elle supposerait de lire les secrets que le
 * masquage est justement charge de retirer — filtrer sur une valeur qu'on refuse
 * de renvoyer transforme le journal en oracle (« cette requete rend un resultat,
 * donc le mot de passe contient ceci »).
 *
 * LES DATES SONT DES CHAINES.
 *
 * `@IsDateString` plutot que `@IsDate` avec `@Type(() => Date)` : une chaine
 * invalide doit produire un 400 lisible, et `new Date('hier')` rend
 * `Invalid Date` — un objet qui passe tous les tests de verite et qu'on envoie
 * ensuite a Prisma. La conversion est faite une seule fois, dans le service,
 * apres la validation.
 */
export class ListAuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: "Identifiant du porteur dont on veut l'historique." })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  actorId?: string;

  /**
   * Le code de l'action, en entier.
   *
   * Correspondance EXACTE, et non partielle. Les actions sont un vocabulaire
   * ferme ecrit dans le code (`USER_CREATED`, `ROLE_PERMISSIONS_REPLACED`...) :
   * une recherche partielle rendrait « USER_READ » capable de ramener
   * « USER_READ_ALL » le jour ou l'action existera, et un filtre d'audit qui
   * ramene autre chose que ce qu'on a demande est pire qu'un filtre absent —
   * c'est la conclusion qu'on tirerait d'une enquete qui ne porterait pas sur ce
   * qu'on croit.
   */
  @ApiPropertyOptional({ example: 'USER_SUSPENDED' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  action?: string;

  @ApiPropertyOptional({ example: 'User' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityType?: string;

  @ApiPropertyOptional({ description: "Identifiant de l'objet concerne." })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityId?: string;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00.000Z', description: 'Debut de periode.' })
  @IsOptional()
  @IsDateString({}, { message: 'La date de debut doit etre une date ISO 8601.' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30T23:59:59.999Z', description: 'Fin de periode.' })
  @IsOptional()
  @IsDateString({}, { message: 'La date de fin doit etre une date ISO 8601.' })
  to?: string;
}
