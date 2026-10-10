import { Controller, Delete, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import {
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/auth.decorators.js';
import type { RequestMetadata } from '../invoices/request-meta.js';
import { RequestContext } from '../invoices/request-meta.js';
import { ListPaymentsQueryDto } from './dto/payment.dto.js';
import { PaymentsService } from './payments.service.js';

/**
 * ROUTES DES PAIEMENTS — lectures et correction.
 *
 * IL N'Y A PAS DE `POST /payments` ICI. Un encaissement se rattache TOUJOURS a
 * une facture : la creation vit sous `POST /invoices/:id/payments`
 * (`InvoicePaymentsController`). Exposer en plus un `POST /payments` acceptant un
 * `invoiceId` dans le corps donnerait DEUX chemins pour le meme acte, avec deux
 * facons d'ecrire le controle de solde — et c'est exactement le genre de
 * duplication ou l'un des deux oublie un jour le verrou. La ressource
 * « paiements » se lit et se corrige ; elle ne se cree pas hors de sa facture.
 *
 * POURQUOI `DELETE` ET PAS `POST /:id/refund`. Annuler un encaissement — une
 * saisie erronee, un virement rejete — n'est pas rembourser. `DELETE` marque la
 * ligne supprimee et laisse le statut de la facture redescendre par recalcul :
 * c'est une correction de comptabilite, reversible et tracee. Un remboursement
 * est un acte financier distinct, avec sa propre piece ; il n'existe pas dans
 * cette version, et `PaymentStatus.REFUNDED` reste donc inutilise (ecart
 * documente).
 */
@ApiTags('Paiements')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequireAnyPermission('payment:read:any', 'payment:read:own')
  @ApiOperation({ summary: 'Lister les encaissements (les siens pour un compte client).' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListPaymentsQueryDto,
  ): Promise<unknown> {
    return this.payments.list(query, new AccessPolicy(user));
  }

  @Get(':id')
  @RequireAnyPermission('payment:read:any', 'payment:read:own')
  @ApiOperation({ summary: 'Lire un encaissement et la facture qu il solde.' })
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    return this.payments.getOne(id, new AccessPolicy(user));
  }

  /**
   * Annulation d'un encaissement.
   *
   * LA ROUTE EXIGE `payment:write:any` : le catalogue ne contient pas de
   * `payment:write:own`, donc un porteur de l'espace client ne peut PAS annuler
   * un paiement — ni le sien ni celui d'un autre. Le service applique malgre tout
   * `clientPerimeter(..., 'payment', 'write')` : le jour ou le scope `own`
   * apparaitra au catalogue, la restriction sera deja en place au lieu d'etre a
   * ecrire dans l'urgence.
   */
  @Delete(':id')
  @RequirePermissions('payment:write:any')
  @ApiOperation({ summary: 'Annuler un encaissement (suppression logique, solde recalcule).' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @RequestContext() meta: RequestMetadata,
  ): Promise<{ deleted: true }> {
    return this.payments.remove(id, new AccessPolicy(user), meta);
  }
}
