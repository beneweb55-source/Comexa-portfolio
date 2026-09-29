import { Body, Controller, Delete, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { ContactRequestService } from './contact-request.service.js';
import {
  ListContactRequestsQueryDto,
  UpdateContactRequestDto,
} from './dto/contact-request.dto.js';

/**
 * FILE DE TRAITEMENT DES DEMANDES DE CONTACT.
 *
 * Aucune route `@Public()` ici : la reception du formulaire est sur le
 * controleur public (`POST /api/public/contact-requests`). Ce controleur est le
 * cote AGENCE, et il exige `contactrequest:read:any` ou `write:any` a chaque
 * route — c'est-a-dire qu'aucun porteur CLIENT n'y accede, meme si un jour on
 * lui accordait une permission voisine : le catalogue ne lui donne aucun code
 * `contactrequest:*`.
 *
 * La route de conversion n'est PAS ici. `contactrequest:convert:any` existe dans
 * le catalogue, mais convertir une demande en prospect demande d'ecrire un
 * `Prospect`, avec sa propre reference et ses propres regles — c'est le domaine
 * du module commercial, pas celui du contenu. Le refus est aussi explicite cote
 * service : `status: CONVERTED` est rejete par `PATCH`, pour qu'aucune demande
 * ne puisse etre marquee convertie sans prospect derriere.
 *
 * ELLE EXISTE, ET ELLE EST AILLEURS : `POST /api/contact-requests/:id/convert`,
 * servie par `ContactRequestConversionController`
 * (`prospects/contact-request-conversion.controller.ts`), exactement comme
 * `POST /api/quotes/:id/invoice` est servie par le module factures. Le chemin
 * appartient a la ressource demande, le geste appartient au module qui detient la
 * regle, la numerotation `PRO-` et l'audit. Un `PATCH` avec `status: CONVERTED`
 * reste donc le mauvais chemin : il est refuse en `422 CONTACT_REQUEST_CONVERT`.
 */
@ApiTags('Demandes de contact')
@Controller('contact-requests')
export class ContactRequestController {
  constructor(private readonly contactRequests: ContactRequestService) {}

  @Get()
  @RequirePermissions('contactrequest:read:any')
  @ApiOperation({ summary: 'Lister les demandes de contact' })
  async list(@Query() query: ListContactRequestsQueryDto) {
    return this.contactRequests.list(query);
  }

  @Get(':id')
  @RequirePermissions('contactrequest:read:any')
  @ApiOperation({ summary: "Consulter une demande de contact" })
  async findOne(@Param('id') id: string) {
    return this.contactRequests.findOne(id);
  }

  /**
   * Traiter une demande : etat et notes internes.
   *
   * `handledById` et `handledAt` sont poses par le service a partir du porteur de
   * la requete, au premier changement d'etat. Ils ne sont pas acceptes en corps :
   * attribuer un traitement a un collegue qui ne l'a pas fait viderait la trace
   * d'audit de son sens.
   */
  @Patch(':id')
  @RequirePermissions('contactrequest:write:any')
  @ApiOperation({
    summary: 'Traiter une demande',
    description: 'Etat de traitement et notes internes. CONVERTED est refuse : voir le module commercial.',
  })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateContactRequestDto,
  ) {
    return this.contactRequests.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('contactrequest:write:any')
  @ApiOperation({
    summary: 'Retirer une demande de la file',
    description: 'Suppression logique : la reference reste occupee.',
  })
  async remove(@Param('id') id: string): Promise<void> {
    await this.contactRequests.remove(id);
  }
}
