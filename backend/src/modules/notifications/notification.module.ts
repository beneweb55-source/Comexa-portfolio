import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RealtimeGateway } from '../messaging/realtime.gateway.js';
import { NotificationController } from './notification.controller.js';
import { NotificationInboxService } from './notification-inbox.service.js';
import { NotificationService } from './notification.service.js';

/**
 * Module des notifications.
 *
 * TROIS CHOSES VIVENT ICI, ET LE CHOIX DE LES Y METTRE EST DELIBERE.
 *
 *  1. `NotificationService` — l'ECRITURE, inchangee. Cinq modules l'appellent
 *     pour deposer une notification ; il est exporte pour eux.
 *  2. `NotificationController` et `NotificationInboxService` — la LECTURE. La
 *     boite est la contrepartie directe du service d'ecriture : les separer
 *     ferait deux modules pour un seul sujet.
 *  3. `RealtimeGateway` — la DIFFUSION. Elle est declaree ICI et non dans
 *     `MessagingModule` pour une raison qui n'est pas esthetique : ce module est
 *     deja monte dans `app.module.ts`. La passerelle est donc vivante des le
 *     demarrage sans qu'aucun fichier interdit n'ait ete touche. Si elle etait
 *     declaree en plus dans `MessagingModule`, il y aurait DEUX instances sur le
 *     meme namespace `/rt`, donc deux serveurs socket.io concurrents sur le meme
 *     port — un bogue difficile a diagnostiquer, et qui n'apparaitrait qu'au
 *     demarrage de l'application reelle.
 *
 * `AuthModule` est importe parce que la passerelle a besoin des deux jetons
 * symboliques qu'il exporte (`ACCESS_TOKEN_VERIFIER`, `PRINCIPAL_LOADER`) : sans
 * une verification de jeton ecrite quelque part, un socket est protege par RIEN
 * — les gardes globaux laissent passer tout contexte non-HTTP.
 *
 * `EventEmitter2` vient d'`EventEmitterModule`, monte globalement dans
 * `app.module.ts`. `PrismaService` et `AuditService` viennent de modules
 * globaux : rien a declarer pour eux.
 */
@Module({
  imports: [AuthModule],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationInboxService, RealtimeGateway],
  exports: [NotificationService],
})
export class NotificationModule {}
