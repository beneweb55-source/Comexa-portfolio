import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * CORPS DE REQUÊTE DU MODULE DE FORMATION.
 *
 * Peu de champs, volontairement : le reste du contrat est dans les routes
 * (paramètres) et dans le catalogue de missions. `whitelist` +
 * `forbidNonWhitelisted` (validation globale) refusent tout champ inventé.
 */

export class StartMissionDto {
  /** Niveau d'assistance demandé pour la session de mission. */
  @IsOptional()
  @IsIn(['full', 'reduced', 'none'])
  assistanceLevel?: 'full' | 'reduced' | 'none';
}

export class CompleteMissionDto {
  @IsOptional()
  @IsIn(['full', 'reduced', 'none'])
  assistanceLevel?: 'full' | 'reduced' | 'none';
}

export class EnterTrainingDto {
  /** Mission éventuellement en cours au moment de l'entrée (informatif). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  missionId?: string;
}

export class ResetTrainingDto {
  /**
   * Confirmation explicite exigée : réinitialiser l'environnement de formation
   * efface le travail de TOUS les membres sur la base d'exercice partagée.
   */
  @IsIn([true])
  confirm!: true;
}

export class CatalogQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  space?: string;
}
