import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

/**
 * Demarrage du minuteur. UN SEUL CHAMP, et c'est volontaire.
 *
 * `userId` est ABSENT : le minuteur appartient au porteur de la requete, et
 * rien ne permet de chronometrer « pour » quelqu'un d'autre — une entree de
 * plus ici serait une entree a proteger. La duree, le statut et les horodatages
 * sont calcules cote serveur : les accepter du client reviendrait a accepter
 * un compte-rendu qu'on ne peut pas verifier.
 */
export class StartTimerDto {
  @ApiProperty({ example: 'clx123abc', description: 'Tache a chronometrer (projet ou personnelle).' })
  @IsString()
  @MaxLength(64)
  taskId!: string;
}
