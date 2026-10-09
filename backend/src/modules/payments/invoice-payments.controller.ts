import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import {
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/auth.decorators.js';
import type { RequestMetadata } from '../invoices/request-meta.js';
import { RequestContext } from '../invoices/request-meta.js';
import { CreatePaymentDto, ListPaymentsQueryDto } from './dto/payment.dto.js';
import { PaymentsService } from './payments.service.js';

/**
 * LES ENCAISSEMENTS D'UNE FACTURE — c'est ici que le module paiements CREE.
 *
 * POURQUOI LE CHEMIN EST SOUS `invoices`. Un paiement n'existe pas seul : il solde
 * une facture, il en prend la devise, et il en fait bouger le statut. La ressource
 * qui le porte est donc la facture, et l'URL le dit. C'est aussi ce qui rend le
 * controle de solde possible sans que l'appelant ait a designer la facture deux
 * fois — une fois dans l'URL, une fois dans le corps, avec le risque qu'elles
 * divergent.
 *
 * POURQUOI CE CONTROLEUR VIT DANS LE MODULE PAIEMENTS ET NON DANS CELUI DES
 * FACTURES. Trois raisons, dans l'ordre d'importance :
 *
 *  1. `InvoicesModule` importerait `PaymentsModule` (pour ce controleur) pendant
 *     que `PaymentsModule` importe `InvoicesModule` (pour `lockForPayment` et
 *     `recomputePaymentState`) : un cycle de modules Nest, qui se resout par
 *     `forwardRef` et se paie ensuite en injections fragiles ;
 *  2. c'est le module paiements qui porte la regle du plafond, la reference
 *     `PAY-…` et l'audit `PAYMENT_RECORDED` — la route doit vivre avec sa regle ;
 *  3. NestJS monte deux controleurs sur le meme prefixe `invoices` sans
 *     difficulte, exactement comme `QuoteInvoiceController` le fait deja sur
 *     `quotes`. Les chemins ne se recouvrent pas.
 *
 * LE CORPS N'ACCEPTE PAS DE DEVISE, et pas de client : la devise est celle de la
 * facture, et le dossier client vient du compte authentifie. Voir
 * `dto/payment.dto.ts`.
 */
@ApiTags('Paiements')
@Controller('invoices')
export class InvoicePaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(':id/payments')
  @RequirePermissions('payment:write:any')
  @ApiOperation({ summary: 'Enregistrer un encaissement sur une facture (plafonne au solde).' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreatePaymentDto,
    @RequestContext() meta: RequestMetadata,
  ): Promise<unknown> {
    // Verrou de la facture, controle du solde et recalcul du statut se font dans
    // le service, dans une seule transaction : rien de tout cela ne peut etre
    // reparti entre le controleur et le service sans rouvrir la fenetre de
    // concurrence que `invoice-lock.ts` ferme.
    return this.payments.createForInvoice(id, dto, new AccessPolicy(user), meta);
  }

  @Get(':id/payments')
  @RequireAnyPermission('payment:read:any', 'payment:read:own')
  @ApiOperation({ summary: 'Lister les encaissements d une facture.' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: ListPaymentsQueryDto,
  ): Promise<unknown> {
    return this.payments.listForInvoice(id, query, new AccessPolicy(user));
  }
}
