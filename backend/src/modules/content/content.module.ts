import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module.js';
import { CountersModule } from '../counters/counters.module.js';
import { NotificationModule } from '../notifications/notification.module.js';
import { ContactRequestController } from './contact-request.controller.js';
import { ContactRequestService } from './contact-request.service.js';
import { ContentAdminController } from './content-admin.controller.js';
import { ContentPublicController } from './content-public.controller.js';
import { ContentService } from './content.service.js';
import { ModificationRequestController } from './modification-request.controller.js';
import { ModificationRequestService } from './modification-request.service.js';

/**
 * MODULE CONTENU PUBLIC.
 *
 * QUATRE CONTROLEURS, PARCE QU'ILS N'ONT PAS LES MEMES REGLES D'ACCES :
 *
 *  - `ContentPublicController`  : tout est `@Public()`, lecture seule, sauf le
 *    formulaire de contact ;
 *  - `ContentAdminController`   : `*:read:any` / `*:write:any` sur le contenu ;
 *  - `ContactRequestController` : la file de traitement, cote agence ;
 *  - `ModificationRequestController` : deux publics sur les memes routes de
 *    lecture — l'agence voit tout, le client voit son dossier.
 *
 * TROIS DEPENDANCES, ET AUCUNE N'EST DECORATIVE :
 *
 *  - `CountersModule` fournit la numerotation des deux ressources a reference
 *    sequentielle — une demande de contact, une demande de modification. Le
 *    numero est reserve DANS la transaction qui cree la ligne : c'est la seule
 *    facon d'eviter un trou dans la suite annuelle si l'ecriture echoue ;
 *
 *  - `ActivityModule` fournit le fil d'activite, ou chaque demande de
 *    modification deposee et chaque decision laissent une trace visible du
 *    client concerne. On n'ecrit jamais une ligne d'activite a la main : les
 *    regles de visibilite vivent dans le service partage ;
 *
 *  - `NotificationModule` previent l'agence d'un lead et le client d'une
 *    decision. La aussi, une seule porte.
 *
 * `PrismaModule` n'est pas liste : il est global.
 *
 * RIEN N'EST EXPORTE, et c'est different du module documents. `DocumentsService`
 * est exporte parce que d'autres domaines y deposent des fichiers ; ici, aucune
 * autre partie du backend n'a besoin de lire le contenu public — le site le lit
 * par HTTP, comme n'importe quel visiteur. Exporter un service sans appelant
 * laisserait croire qu'un couplage existe.
 */
@Module({
  imports: [CountersModule, ActivityModule, NotificationModule],
  controllers: [
    ContentPublicController,
    ContentAdminController,
    ContactRequestController,
    ModificationRequestController,
  ],
  providers: [ContentService, ContactRequestService, ModificationRequestService],
})
export class ContentModule {}
