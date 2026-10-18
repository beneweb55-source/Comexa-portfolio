import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequireAnyPermission } from '../../common/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { ResolveSharedResourcesDto } from './dto/messaging.dto.js';
import { SharedResourcesService } from './shared-resources.service.js';
import type { ResourceCardView } from './shared-resource-card.js';

/**
 * RELECTURE DES CARTES DE RESSOURCES PARTAGEES.
 *
 * Une seule route, un seul verbe : `POST /shared-resources/resolve`. Le POST
 * porte la LISTE des couples a relire — une page de fil peut empiler trente
 * cartes, et trente GET separeraient trente fois le meme controle de
 * participation pour rien.
 *
 * POURQUOI CE N'EST PAS UNE ROUTE DES CONVERSATIONS. La relecture ne depend
 * pas de la conversation : elle depend du PORTEUR. La carte est accessible a
 * tout ce que le membre peut lire dans son dashboard, et a rien d'autre —
 * l'eventuelle conversation qui porte le lien n'elargit ni ne restreint ce
 * perimetre. La ranger sous `/conversations/:id/...` suggérerait le contraire.
 *
 * LE GARDE EST CELUI DE LA MESSAGERIE : un compte qui ne peut pas lire de
 * messages n'a aucune raison de resoudre des cartes. Et surtout, cette route
 * NE VERIFIE PAS la participation a une conversation : elle ne renvoie que ce
 * que le porteur peut deja ouvrir chez lui. Un tiers qui recopierait des
 * identifiants vus ailleurs n'apprendrait que ce que ses propres droits lui
 * permettent deja d'apprendre.
 */
@ApiTags('Messagerie — ressources partagées')
@Controller('shared-resources')
export class SharedResourcesController {
  constructor(private readonly resources: SharedResourcesService) {}

  @Post('resolve')
  @RequireAnyPermission('message:read:own', 'conversation:read:own')
  @ApiOperation({
    summary: 'Relire des ressources partagees dans le perimetre du porteur',
    description:
      "Renvoie une carte par couple (resourceType, resourceId), dans l'ordre recu. " +
      'Introuvable, supprime ou hors perimetre : une carte `available: false`, sans distinction — ' +
      "la reponse ne doit pas servir d'oracle d'existence.",
  })
  async resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ResolveSharedResourcesDto,
  ): Promise<{ items: ResourceCardView[] }> {
    const items = await this.resources.resolveAll(
      user,
      dto.resources.map((ref) => ({ resourceType: ref.resourceType, resourceId: ref.resourceId })),
    );
    return { items };
  }
}
