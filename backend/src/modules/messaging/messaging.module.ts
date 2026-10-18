import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { NotificationModule } from '../notifications/notification.module.js';
import { ConversationService } from './conversation.service.js';
import { MessageService } from './message.service.js';
import { MessagingController } from './messaging.controller.js';
import { SharedResourcesController } from './shared-resources.controller.js';
import { SharedResourcesService } from './shared-resources.service.js';

/**
 * MODULE DE MESSAGERIE.
 *
 * CE QU'IL DECLARE, ET CE QU'IL NE DECLARE PAS.
 *
 *  - il declare ses deux services, ses services de ressources partagees et ses
 *    controleurs : les routes de messagerie, le filtrage des conversations par
 *    participation, et la relecture des cartes de ressources ;
 *  - il IMPORTE `NotificationModule` parce que `MessageService` a besoin de
 *    `NotificationService` pour prevenir les destinataires ;
 *  - il IMPORTE `DocumentsModule` pour UNE raison seulement : la visibilite
 *    d'un document (interne, client, par projet, expire) ne vit que dans
 *    `DocumentsService`. Un partage de document qui recopierait ces regles les
 *    desynchroniserait a bas bruit ; il delegue donc, et le service reste la
 *    seule autorite. (Attention au cycle : `DocumentsModule` ne doit JAMAIS
 *    importer `MessagingModule`.)
 *  - il NE DECLARE PAS `RealtimeGateway`. La passerelle est declaree dans
 *    `NotificationModule`, qui est deja monte dans `app.module.ts` : la
 *    declarer ici en plus en ferait une SECONDE instance sur le meme namespace,
 *    donc deux serveurs socket.io concurrents qui se disputeraient les
 *    connexions. Un seul provider, un seul serveur.
 *
 * `PrismaService` et `AuditService` ne sont pas importes : `PrismaModule` et
 * `AuditModule` sont `@Global()`. De meme, `EventEmitter2` vient d'un module
 * global. Les declarer ici dupliquerait des providers globaux.
 */
@Module({
  imports: [NotificationModule, DocumentsModule],
  controllers: [MessagingController, SharedResourcesController],
  providers: [ConversationService, MessageService, SharedResourcesService],
  exports: [ConversationService, MessageService, SharedResourcesService],
})
export class MessagingModule {}
