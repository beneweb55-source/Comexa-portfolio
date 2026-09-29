import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PERIOD_PRESETS, type PeriodPreset } from '../../reports/report-period.js';

/**
 * CONTRAT DES TABLEAUX DE BORD.
 *
 * `forbidNonWhitelisted` est actif : tout parametre non declare ici fait
 * echouer la requete en 400. C'est la premiere des deux barrieres contre
 * l'acces horizontal — un client qui ajoute `?clientId=<autre client>` a l'URL
 * de l'espace client se fait refuser par le garde de validation, avant meme
 * d'atteindre le service.
 */

export class AgencyDashboardQueryDto {
  @ApiPropertyOptional({
    enum: PERIOD_PRESETS,
    description: 'Fenetre des encaissements et des entrees de la periode. THIS_MONTH par defaut.',
  })
  @IsOptional()
  @IsIn([...PERIOD_PRESETS], { message: 'Periode predefinie inconnue.' })
  preset?: PeriodPreset;
}

/**
 * Vue personnelle : AUCUN parametre.
 *
 * La classe est volontairement vide. Ses donnees sont celles du porteur du
 * jeton, et rien d'autre : il n'existe donc aucun identifiant a fournir, et
 * aucun identifiant fourni ne sera accepte.
 */
export class PersonalDashboardQueryDto {}

/**
 * Espace client : AUCUN parametre.
 *
 * Classe vide pour la meme raison, et c'est ici que la regle est la plus
 * stricte : le perimetre vient de `policy.clientId`, jamais de la requete. Un
 * client ne peut donc pas designer un autre client, meme en le voulant.
 */
export class ClientDashboardQueryDto {}
