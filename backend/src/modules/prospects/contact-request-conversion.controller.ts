import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { ProspectsService, type ProspectFromContactRequest } from './prospects.service.js';

/**
 * CONVERTIR UNE DEMANDE DE CONTACT EN PROSPECT — l'anneau VISITEUR -> PROSPECT.
 *
 * CETTE ROUTE VIT DANS LE MODULE COMMERCIAL, PAS DANS CELUI DU CONTENU. Elle est
 * montee sur `contact-requests` parce que c'est la ressource qui la situe — « le
 * prospect DE CETTE demande » — mais elle CREE un prospect : c'est le module
 * commercial qui en porte la regle, la numerotation `PRO-`, le journal d'etapes,
 * l'audit et la notification. La placer cote contenu ferait dependre le contenu
 * du pipeline commercial, et la regle « un prospect nait numerote, journalise et
 * attribue » serait ecrite dans un module qui ne connait pas les prospects.
 *
 * C'EST LE PRECEDENT EXACT DE `QuoteInvoiceController`, qui porte
 * `POST /quotes/:id/invoice` depuis le module FACTURES (voir le commentaire de
 * `app.module.ts`, section FACTURATION). Deux controleurs partagent donc un meme
 * prefixe de chemin, et c'est voulu : `ContentModule` garde la file de traitement
 * et les notes internes sous `contact-requests`, le module commercial y ajoute le
 * seul geste qui fait naitre une piste.
 *
 * POURQUOI LE CONTENU NE LE FAIT PAS LUI-MEME. `ContactRequestService.update`
 * refuse `status: CONVERTED` depuis la file de traitement, explicitement : une
 * demande convertie est une demande dont on a tire un prospect, et autoriser ce
 * statut depuis la file produirait des demandes marquees converties SANS prospect
 * derriere. Cette route est le seul chemin qui pose cet etat, et elle le pose
 * dans la transaction qui cree la piste.
 *
 * LA PERMISSION EST CELLE DU CATALOGUE, au nom exact :
 * `contactrequest:convert:any` — « Convertir une demande de contact en
 * prospect ». Elle est portee par la route, et le service y ajoute le refus de
 * l'espace client, sur le ROLE. Les deux verrous, comme partout dans ce module.
 *
 * LE CORPS N'EST PAS LU, ET C'EST DELIBERE. Rien de ce que l'appelant pourrait
 * ecrire n'a sa place ici : l'etat de la demande, sa reference, le responsable de
 * la piste et sa date de conversion sont decides par le serveur. Accepter un
 * `status`, un `ownerId` ou une `reference` en corps reviendrait a laisser
 * l'appelant fabriquer une piste sans origine verifiable — alors que toute la
 * valeur de cette conversion est precisement que l'origine soit certaine.
 * NE PAS SE FIER A `forbidNonWhitelisted` ICI — CE BLOC L'A AFFIRME A TORT.
 * Il annoncait un `400` « avant le service ». Cette route ne peut pas le
 * produire : le handler ne declare aucun `@Body()`, donc le corps n'est transmis
 * a aucun pipe, et `forbidNonWhitelisted` n'a rien a rejeter. Un champ comme
 * `status` ou `ownerId` est **ignore**, pas refuse. L'effet protecteur reste
 * entier, mais il vient de ce que le corps n'est JAMAIS LU — une raison plus
 * solide que celle qui etait ecrite, puisque rien ne depend alors d'un refus.
 * Seul un corps JSON malforme rend un `400`, leve par l'analyseur du corps.
 */
@ApiTags('contact-requests')
@Controller('contact-requests')
export class ContactRequestConversionController {
  constructor(private readonly prospects: ProspectsService) {}

  /**
   * `@HttpCode(HttpStatus.OK)` parce que la route ne cree pas la ressource du
   * chemin : elle CONVERTIT une demande existante en autre chose. Un 201
   * annoncerait la creation d'une demande de contact qui n'a pas eu lieu. C'est
   * aussi le code de `POST /prospects/:id/convert`, la conversion jumelle.
   */
  @Post(':id/convert')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('contactrequest:convert:any')
  @ApiOperation({
    summary: 'Convertir une demande de contact en prospect',
    description:
      'Cree la fiche prospect (reference PRO-, source CONTACT_FORM) et passe la demande a CONVERTED, ' +
      'dans une seule transaction. Refuse en 409 une demande deja convertie.',
  })
  async convert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ProspectFromContactRequest> {
    return this.prospects.convertContactRequest(user, id);
  }
}
