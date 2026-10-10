import { ApiPropertyOptional } from '@nestjs/swagger';
import { BooleanFilter } from '../../../common/dto/boolean-filter.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

/**
 * Contrat d'entree de la boite de notifications.
 *
 * Le seul filtre accepte est « lue / non lue ». Tout le reste — destinataire,
 * date, type — est decide par le serveur : `userId` vient du PORTEUR et jamais
 * de la requete, sans quoi un utilisateur lirait la boite d'un autre en
 * changeant un parametre.
 */
export class ListNotificationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    type: Boolean,
    description: 'true = deja lues, false = non lues. Omis = les deux.',
  })
  // `?read=false` a renvoye les notifications LUES tant que ce filtre etait un
  // `@Transform` ecrit a la main : le piege et sa mesure sont documentes une
  // seule fois, dans `common/dto/boolean-filter.ts`.
  @BooleanFilter({ message: 'Le filtre de lecture doit etre un booleen.' })
  read?: boolean;
}
