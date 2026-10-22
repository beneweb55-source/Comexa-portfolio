import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import {
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
  ScopedByService,
} from '../../common/decorators/auth.decorators.js';
import { RequestContext, type RequestMetadata } from '../invoices/request-meta.js';
import {
  CreateOrderDto,
  ListOrdersQueryDto,
  RecordPaymentDto,
  UpdateOrderStatusDto,
} from './dto/order.dto.js';
import { OfferQueryDto } from './dto/project-request.dto.js';
import { OrdersService } from './orders.service.js';

/**
 * ROUTES DES COMMANDES.
 *
 * `POST /orders` n'a AUCUNE permission : un visiteur inscrit et verifie n'a pas
 * encore de role, et c'est justement lui qui commande. Le service refuse les
 * comptes non actifs et les collaborateurs de l'agence.
 *
 * Les lectures acceptent `order:read:any` (equipe) ou `order:read:own` (client) ;
 * le perimetre reel est pose par le service, pas par le garde.
 */
@ApiTags('Commandes')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Passer commande d un pack. Active l espace client immediatement.' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrderDto,
    @RequestContext() meta: RequestMetadata,
  ) {
    return this.orders.createOrder(user, dto, meta);
  }

  /** Apercu du prix et du moyen de paiement pour ce compte, sans rien creer. Declare avant `:id`. */
  @Get('offer')
  @ApiOperation({
    summary: "Prix et moyen de paiement pour un pack, ou la raison d'une demande de projet.",
  })
  offer(@CurrentUser() user: AuthenticatedUser, @Query() query: OfferQueryDto) {
    return this.orders.offer(query.packageId, user);
  }

  @Get()
  @ScopedByService()
  @ApiOperation({ summary: 'Lister les commandes (les siennes pour un client).' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListOrdersQueryDto) {
    return this.orders.list(query, new AccessPolicy(user));
  }

  @Get(':id')
  @RequireAnyPermission('order:read:any', 'order:read:own')
  @ApiOperation({ summary: 'Lire une commande et son projet.' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.orders.getOne(id, new AccessPolicy(user));
  }

  @Post(':id/validate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('order:validate:any')
  @ApiOperation({ summary: 'Valider la commande et creer le projet.' })
  validate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.orders.validate(id, user);
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('order:validate:any')
  @ApiOperation({ summary: 'Demarrer le projet issu de la commande.' })
  start(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.orders.start(id, user);
  }

  /**
   * Correction d'etat (mise en revue, annulation, cloture).
   *
   * Les transitions sont verifiees par le service. En particulier, cette route
   * ne peut PAS valider une commande : la validation cree un projet et passe
   * par `POST /orders/:id/validate`, seule a savoir le faire.
   */
  @Patch(':id/status')
  @RequirePermissions('order:validate:any')
  @ApiOperation({ summary: "Changer l'etat d'une commande (transitions controlees)." })
  changeStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.orders.changeStatus(id, dto, user);
  }

  @Patch(':id/payment')
  @RequirePermissions('order:validate:any')
  @ApiOperation({ summary: "Enregistrer l'etat du paiement (equipe seulement)." })
  recordPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
  ) {
    return this.orders.recordPayment(id, dto, user);
  }
}
