import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import {
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/auth.decorators.js';
import type { Quote } from '../../generated/prisma/client.js';
import type { RequestMetadata } from '../invoices/request-meta.js';
import { RequestContext } from '../invoices/request-meta.js';
import {
  CreateQuoteDto,
  ListQuotesQueryDto,
  RefuseQuoteDto,
  UpdateQuoteDto,
  type QuoteAcceptanceResult,
} from './dto/quote.dto.js';
import { QuotesService } from './quotes.service.js';

/**
 * ROUTES DES DEVIS.
 *
 * LE GARDE AUTORISE LA ROUTE ; LE SERVICE RESTREINT LES LIGNES. Chaque route
 * ci-dessous est ouverte a un ou deux codes de permission, et c'est tout ce que
 * le garde peut dire : il ne connait pas les donnees. Le perimetre reel — « ce
 * devis est-il le sien ? » — est pose par `QuotesService` dans le `where` Prisma
 * (voir `billing-access.ts`). Un porteur CLIENT qui remplace l'identifiant dans
 * l'URL vise donc un devis hors de son perimetre, donc un 404.
 *
 * POURQUOI LES ROUTES `:id` SONT OUVERTES A DEUX CODES. Un commercial detient
 * `quote:read:any`, un compte client `quote:read:own`. Le garde laisse passer
 * les deux, et c'est le service qui donne a chacun ce qui lui revient. Refuser
 * `quote:read:own` ici fermerait l'espace client ; n'accepter que lui fermerait
 * le back-office.
 *
 * `POST /quotes` N'EST PAS OUVERTE A `quote:write:own`, ET C'EST VOLONTAIRE. La
 * creation d'un devis est un geste commercial : un compte de l'espace client ne
 * s'etablit pas un devis a lui-meme. Le catalogue porte pourtant
 * `quote:write:own` (« modifier ses propres devis »), et le service sait deja
 * traiter ce cas — la jour ou une route de creation en libre-service existera, le
 * perimetre suivra sans qu'une ligne change ici.
 */
@ApiTags('Devis')
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  @RequireAnyPermission('quote:read:any', 'quote:read:own')
  @ApiOperation({ summary: 'Lister les devis (les siens pour un compte client).' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListQuotesQueryDto,
  ): Promise<unknown> {
    return this.quotes.list(query, new AccessPolicy(user));
  }

  @Post()
  @RequirePermissions('quote:write:any')
  @ApiOperation({ summary: 'Etablir un devis en brouillon. Aucun total n est accepte.' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateQuoteDto,
    @RequestContext() meta: RequestMetadata,
  ): Promise<Quote> {
    return this.quotes.create(dto, new AccessPolicy(user), meta);
  }

  @Get(':id')
  @RequireAnyPermission('quote:read:any', 'quote:read:own')
  @ApiOperation({ summary: "Lire un devis et ses lignes (le sien pour l'espace client)." })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<Quote> {
    return this.quotes.getOne(id, new AccessPolicy(user));
  }

  @Patch(':id')
  @RequirePermissions('quote:write:any')
  @ApiOperation({ summary: 'Modifier un devis en brouillon (envoye, il est fige).' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateQuoteDto,
    @RequestContext() meta: RequestMetadata,
  ): Promise<Quote> {
    return this.quotes.update(id, dto, new AccessPolicy(user), meta);
  }

  @Delete(':id')
  @RequirePermissions('quote:delete:any')
  @ApiOperation({ summary: 'Supprimer un brouillon (suppression logique).' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @RequestContext() meta: RequestMetadata,
  ): Promise<{ deleted: true }> {
    return this.quotes.remove(id, new AccessPolicy(user), meta);
  }

  @Post(':id/send')
  @RequirePermissions('quote:send:any')
  @ApiOperation({ summary: 'Envoyer le devis au client. C est cet etat qui le fige.' })
  async send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @RequestContext() meta: RequestMetadata,
  ): Promise<Quote> {
    return this.quotes.send(id, new AccessPolicy(user), meta);
  }

  /**
   * Consultation par le CLIENT.
   *
   * La route est ouverte au seul `quote:read:own`, que seuls les comptes de
   * l'espace client detiennent : le service refuse de son cote tout porteur qui
   * n'est pas un compte client. Les deux barrieres disent la meme chose, et c'est
   * voulu — `viewedAt` doit dater l'ouverture par le CLIENT, pas une visite du
   * commercial dans son propre back-office.
   */
  @Post(':id/view')
  @RequirePermissions('quote:read:own')
  @ApiOperation({ summary: 'Marquer le devis comme consulte (compte client uniquement).' })
  async markViewed(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<Quote> {
    return this.quotes.markViewed(id, new AccessPolicy(user));
  }

  /**
   * DECISION DU CLIENT.
   *
   * L'acceptation est ouverte a `quote:accept:own` — le client, sur son propre
   * devis — et a `quote:write:any` — le commercial qui enregistre un accord recu
   * par courriel ou par telephone.
   *
   * LE CATALOGUE N'A PAS DE `quote:accept:any`, ET C'EST UN ECART SIGNALE au
   * coordinateur : c'est `quote:write:any` qui tient lieu de code interne, et il
   * est plus large que le droit qu'il represente (il autorise aussi la creation
   * et la modification). Le jour ou `quote:accept:any` est ajoutee, elle remplace
   * `quote:write:any` dans ce `@RequireAnyPermission` sans que le service change
   * — `acceptancePerimeter` lit deja `quote:accept:any` en premier.
   */
  @Post(':id/accept')
  @RequireAnyPermission('quote:accept:own', 'quote:write:any')
  @ApiOperation({ summary: 'Accepter le devis : cree le client si besoin, et le projet.' })
  async accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @RequestContext() meta: RequestMetadata,
  ): Promise<QuoteAcceptanceResult> {
    return this.quotes.accept(id, new AccessPolicy(user), meta);
  }

  @Post(':id/refuse')
  @RequireAnyPermission('quote:accept:own', 'quote:write:any')
  @ApiOperation({ summary: 'Refuser le devis. Le motif est obligatoire.' })
  async refuse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RefuseQuoteDto,
    @RequestContext() meta: RequestMetadata,
  ): Promise<Quote> {
    return this.quotes.refuse(id, dto, new AccessPolicy(user), meta);
  }
}
