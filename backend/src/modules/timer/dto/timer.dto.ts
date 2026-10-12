import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Demarrage du minuteur. UN SEUL CHAMP, et c'est volontaire.
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
 * tache reste la norme ; le sans-tache est l'exception assumee.
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
}
