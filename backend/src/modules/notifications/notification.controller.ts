import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import type { Paginated } from '../../common/interceptors/transform.interceptor.js';
import { ListNotificationsQueryDto } from './dto/notification.dto.js';
import {
  NotificationInboxService,
  type NotificationView,
} from './notification-inbox.service.js';

/**
 * ROUTES DE LA BOITE DE NOTIFICATIONS.
 *
 * CE CONTROLEUR EST DECLARE DANS `NotificationModule`, pas dans un module a lui.
 * La boite est la contrepartie en lecture du service d'ecriture : les separer
 * ferait deux modules pour un seul sujet, et le module de notifications devrait
 * de toute facon exporter son service.
 *
 * AUCUNE ROUTE N'ACCEPTE D'IDENTIFIANT DE DESTINATAIRE. `userId` n'existe pas
 * dans les DTO de ce dossier ; il vient du jeton et de lui seul. Une route
 * « lire les notifications de X » n'existe pas, et ne doit pas etre ajoutee :
 * elle serait un acces horizontal de plus a defendre, alors que le besoin — lire
 * LES SIENNES — est deja couvert.
 */
@ApiTags('Notifications')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly inbox: NotificationInboxService) {}

  @Get()
  @RequirePermissions('notification:read:own')
  @ApiOperation({ summary: 'Lister ses notifications' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<Paginated<NotificationView>> {
    return this.inbox.list(new AccessPolicy(user), query);
  }

  /**
   * `read-all` AVANT `:id/read` dans l'ordre de declaration, pour une raison de
   * lisibilite seulement : les deux chemins n'ont pas le meme nombre de
   * segments, donc Express ne peut pas confondre l'un avec l'autre. L'ordre
   * importe en revanche pour `GET /notifications/:id` face a une eventuelle
   * route litterale de meme forme — il n'y en a pas ici.
   */
  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('notification:read:own')
  @ApiOperation({ summary: 'Marquer toutes ses notifications comme lues' })
  markAllRead(@CurrentUser() user: AuthenticatedUser): Promise<{ updated: number }> {
    return this.inbox.markAllRead(new AccessPolicy(user));
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('notification:read:own')
  @ApiOperation({ summary: 'Marquer une notification comme lue' })
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<NotificationView> {
    return this.inbox.markRead(new AccessPolicy(user), id);
  }

  @Delete(':id')
  @RequirePermissions('notification:manage:own')
  @ApiOperation({ summary: 'Supprimer une notification' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ deleted: true }> {
    return this.inbox.remove(new AccessPolicy(user), id);
  }
}
