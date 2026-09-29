import { Module } from '@nestjs/common';
import { NotificationModule } from '../notifications/notification.module.js';
import { ConversationService } from './conversation.service.js';
import { MessageService } from './message.service.js';
import { MessagingController } from './messaging.controller.js';

/**
 * MODULE DE MESSAGERIE.
 *
 * CE QU'IL DECLARE, ET CE QU'IL NE DECLARE PAS.
 *
 *   - il declare ses deux services et son controleur : les routes de messagerie
 *     et le filtrage des conversations par participation ;
 *   - il IMPORTE `NotificationModule` parce que `MessageService` a besoin de
 *     `NotificationService` pour prevenir les destinataires ;
 *   - il NE DECLARE PAS `RealtimeGateway`. La passerelle est declaree dans
 *     `NotificationModule`, qui est deja monte dans `app.module.ts` : la
 *     declarer ici en plus en ferait une SECONDE instance sur le meme namespace,
 *     donc deux serveurs socket.io concurrents qui se disputeraient les
 *     connexions. Un seul provider, un seul serveur.
 *
 * `PrismaService` et `AuditService` ne sont pas importes : `PrismaModule` et
 * `AuditModule` sont `@Global()`. De meme, `EventEmitter2` vient d'un module
 * global. Les declarer ici dupliquerait des providers globaux.
 */
@Module({
  imports: [NotificationModule],
  controllers: [MessagingController],
  providers: [ConversationService, MessageService],
  exports: [ConversationService, MessageService],
})
export class MessagingModule {}
