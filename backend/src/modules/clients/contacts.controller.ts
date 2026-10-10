import { Body, Controller, Delete, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import type { Contact } from '../../generated/prisma/client.js';
import { ClientsService } from './clients.service.js';
import { UpdateContactDto } from './dto/client.dto.js';

/**
 * ROUTES DES CONTACTS, PRISES PAR LEUR PROPRE IDENTIFIANT.
 *
 * Un contact s'atteint par `/contacts/:id` et non par
 * `/clients/:clientId/contacts/:id`. La difference n'est pas cosmetique : avec
 * le client dans le chemin, il faudrait VERIFIER que le contact appartient bien
 * au client annonce — une verification qu'un appelant peut oublier. Ici, le
 * contact est atteint par sa seule cle, et le perimetre (`clientId` du porteur,
 * ou `any` pour l'agence) est pose dans le `where` : voir `contactPerimeter`.
 *
 * AUCUN CODE DE SUPPRESSION DEDIE. Le catalogue n'a pas de `contact:delete:any`.
 * La suppression logique d'un contact est un ecrit sur la fiche, donc
 * `contact:write:any` — le code le plus proche. A signaler au coordonnateur :
 * distinguer « gerer » de « supprimer » se decide dans le catalogue, pas ici.
 *
 * L'ESPACE CLIENT N'ECRIT AUCUN CONTACT. Il ne detient de toute facon aucun des
 * deux codes ci-dessous, et `contactPerimeter` refuse l'ecriture sur le ROLE
 * avant meme de regarder les permissions : les interlocuteurs du CRM sont tenus
 * par l'agence.
 */
@ApiTags('Contacts')
@Controller('contacts')
export class ContactsController {
  constructor(private readonly clients: ClientsService) {}

  @Patch(':id')
  @RequirePermissions('contact:write:any')
  @ApiOperation({ summary: 'Modifier un interlocuteur.' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
  ): Promise<Contact> {
    return this.clients.updateContact(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('contact:write:any')
  @ApiOperation({ summary: 'Supprimer logiquement un interlocuteur.' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ deleted: true }> {
    return this.clients.removeContact(user, id);
  }
}
