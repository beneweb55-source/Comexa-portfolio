import { Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import {
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
  ScopedByService,
} from '../../common/decorators/auth.decorators.js';
import type { RequestMetadata } from './request-meta.js';
import { RequestContext } from './request-meta.js';
// IMPORT DE VALEUR, ET NON `import type` — LE COMPILATEUR EN A BESOIN A L'EXECUTION.
//
// Ce DTO n'apparait que comme TYPE dans la signature ci-dessous, donc
// `import type` semble le choix propre. Il casse pourtant la validation de TOUTE
// la chaine de requete, et de la facon la plus trompeuse possible.
//
// `emitDecoratorMetadata` fait ecrire a TypeScript la classe de chaque parametre
// decore dans `design:paramtypes`. Un `import type` etant EFFACE du JavaScript
// emis, le compilateur ne peut plus nommer la classe : il ecrit `Function`. Or
// `ValidationPipe.toValidate()` n'exclut que `[String, Boolean, Number, Array,
// Object, Buffer, Date]` — `Function` n'y figure pas, la validation s'execute
// donc, sur une classe qui ne declare AUCUNE propriete blanchissable. Avec
// `forbidNonWhitelisted`, chaque parametre est alors « non declare » :
//
//   GET /api/invoices?clientId=X
//   -> 400 {"code":"VALIDATION_FAILED","details":["property clientId should not exist"]}
//
// Ce n'est pas `clientId` qui etait fautif : c'etait le seul parametre que la
// suite de tests envoyait. `?status=`, `?projectId=`, `?search=` et meme
// `?page=2` recevaient le meme 400 — tout le filtrage de la liste etait mort,
// alors que le DTO, lui, etait correct. La lecon vaut pour tout DTO de
// controleur : `import type` est reserve aux types qui ne franchissent aucune
// frontiere d'execution (interfaces, modeles Prisma, types de retour).
import { ListInvoicesQueryDto } from './dto/invoice.dto.js';
import { InvoicesService } from './invoices.service.js';

/**
 * ROUTES DES FACTURES.
 *
 * LE GARDE AUTORISE LA ROUTE ; LE SERVICE RESTREINT LES LIGNES. Un compte de
 * l'espace client detient `invoice:read:own` : il lit SES factures, et le filtre
 * est pose dans le `where` Prisma (`clientId = policy.clientId`, donc le dossier
 * du COMPTE, jamais un identifiant de requete). Une facture hors perimetre
 * n'existe pas : 404, et jamais 403 — un refus distinct confirmerait qu'une
 * ligne existe la ou le porteur n'a rien a voir.
 *
 * IL N'Y A PAS DE `POST /invoices`. Une facture ne se saisit pas, elle se
 * genere depuis un devis accepte : la creation vit dans
 * `QuoteInvoiceController` (`POST /quotes/:id/invoice`), avec le devis qu'elle
 * facture. C'est la seule facon d'entrer une facture dans le systeme, et elle
 * n'accepte aucun montant.
 */
@ApiTags('Factures')
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @ScopedByService()
  @ApiOperation({ summary: 'Lister les factures (les siennes pour un compte client).' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListInvoicesQueryDto,
  ): Promise<unknown> {
    return this.invoices.list(query, new AccessPolicy(user));
  }

  @Get(':id')
  @RequireAnyPermission('invoice:read:any', 'invoice:read:own')
  @ApiOperation({ summary: 'Lire une facture, ses lignes et ses paiements.' })
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.invoices.getOne(id, new AccessPolicy(user));
  }

  @Post(':id/send')
  @RequirePermissions('invoice:send:any')
  @ApiOperation({ summary: 'Envoyer la facture au client. C est cet etat qui la rend payable.' })
  async send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @RequestContext() meta: RequestMetadata,
  ): Promise<unknown> {
    return this.invoices.send(id, new AccessPolicy(user), meta);
  }

  /**
   * Annulation.
   *
   * LE CATALOGUE N'A PAS DE `invoice:cancel:any` : c'est `invoice:write:any`
   * (« creer et modifier les factures ») qui tient lieu de code, et c'est un
   * ecart signale au coordinateur — comme `quote:accept:any` cote devis. Le
   * service, lui, protege la vraie regle : une facture encaissee ne s'annule
   * plus.
   */
  @Post(':id/cancel')
  @RequirePermissions('invoice:write:any')
  @ApiOperation({ summary: 'Annuler une facture non encaissee.' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @RequestContext() meta: RequestMetadata,
  ): Promise<unknown> {
    return this.invoices.cancel(id, new AccessPolicy(user), meta);
  }

  @Delete(':id')
  @RequirePermissions('invoice:delete:any')
  @ApiOperation({ summary: 'Supprimer un brouillon de facture (suppression logique).' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @RequestContext() meta: RequestMetadata,
  ): Promise<{ deleted: true }> {
    return this.invoices.remove(id, new AccessPolicy(user), meta);
  }
}
