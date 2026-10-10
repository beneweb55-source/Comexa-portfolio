import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { CreateInvoiceFromQuoteDto } from './dto/invoice.dto.js';
import { InvoicesService } from './invoices.service.js';
import type { RequestMetadata } from './request-meta.js';
import { RequestContext } from './request-meta.js';

/**
 * GENERER UNE FACTURE DEPUIS UN DEVIS.
 *
 * CETTE ROUTE VIT DANS LE MODULE FACTURES, PAS DANS CELUI DES DEVIS. Elle est
 * montee sur `quotes` parce que c'est la ressource qui la situe — « la facture
 * DE CE devis » — mais elle CREE une facture : c'est le module factures qui en
 * porte la regle, le numero, la numerotation et l'audit. La placer cote devis
 * ferait dependre les devis du module factures dans le mauvais sens, et la
 * regle « une facture ne se cree que depuis un devis accepte » serait ecrite
 * dans un module qui ne connait pas les factures.
 *
 * DEUX CONTROLEURS SUR LE MEME CHEMIN `quotes` : NestJS les monte tous les deux,
 * et les routes ne se recouvrent pas (`POST /quotes/:id/invoice` n'existe pas
 * dans `QuotesController`). C'est ce qui permet a chaque module de garder ses
 * routes sans qu'aucun des deux n'importe le controleur de l'autre.
 *
 * LE CORPS N'ACCEPTE AUCUN MONTANT : ni total, ni ligne, ni taux. Les lignes de
 * la facture sont celles du devis, copiees, et les totaux sont recalcules a
 * partir d'elles. Le seul controle laisse a l'appelant porte sur la FORME du
 * document — objet, notes, conditions, dates.
 */
@ApiTags('Factures')
@Controller('quotes')
export class QuoteInvoiceController {
  constructor(private readonly invoices: InvoicesService) {}

  @Post(':id/invoice')
  @RequirePermissions('invoice:write:any')
  @ApiOperation({
    summary: 'Generer la facture d un devis accepte (lignes copiees, totaux recalcules).',
  })
  async createFromQuote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateInvoiceFromQuoteDto,
    @RequestContext() meta: RequestMetadata,
  ): Promise<unknown> {
    return this.invoices.createFromQuote(id, dto, new AccessPolicy(user), meta);
  }
}
