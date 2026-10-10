import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module.js';
import { ClientsModule } from '../clients/clients.module.js';
import { CountersModule } from '../counters/counters.module.js';
import { NotificationModule } from '../notifications/notification.module.js';
import { ContactRequestConversionController } from './contact-request-conversion.controller.js';
import { ProspectsController } from './prospects.controller.js';
import { ProspectsService } from './prospects.service.js';

/**
 * MODULE DU PIPELINE COMMERCIAL.
 *
 * QUATRE IMPORTS, ET CHACUN A UNE RAISON PRECISE.
 *
 *  - `ClientsModule` : la conversion d'un prospect cree un client. L'appel se
 *    fait DANS la transaction de la conversion (`ClientsService.createFromProspect`
 *    recoit le `tx`), donc aucun des deux modules ne peut se contenter d'un
 *    appel HTTP interne : c'est le meme commit, ou aucun.
 *
 *  - `CountersModule` : `Prospect.reference` est `@unique` et NON nullable,
 *    comme `Client.reference`. Un prospect se cree donc avec une reference, et
 *    cette reference vient du compteur partage — jamais d'un compteur local.
 *    Deux implementations concurrentes produiraient deux facons d'attribuer un
 *    numero, et le schema n'a aucune contrainte d'unicite sur l'e-mail ou la
 *    raison sociale : la reference est le SEUL critere de dedoublonnage.
 *
 *  - `ActivityModule` et `NotificationModule` : la conversion et le changement
 *    d'etape ecrivent un temoin dans le fil et previennent le responsable. Ces
 *    ecritures passent par les services partages, avec le `tx`, et jamais par
 *    un `prisma.activity.create` local — sinon `isClientVisible` varierait selon
 *    l'auteur du code, et une note interne finirait par s'afficher au client.
 *
 * `PrismaModule` et `AuditModule` sont globaux : rien a declarer pour eux.
 *
 * DEUX CONTROLEURS, DEUX CHEMINS, UN SEUL SERVICE.
 *
 *  - `ProspectsController` porte `/prospects` : la fiche et son pipeline ;
 *  - `ContactRequestConversionController` porte `POST /contact-requests/:id/convert` :
 *    l'entree dans le pipeline depuis le formulaire public. Ce chemin appartient
 *    a la ressource DEMANDE, mais le geste cree un PROSPECT — donc il vit ici,
 *    avec la numerotation et l'audit du commercial, exactement comme
 *    `POST /quotes/:id/invoice` vit dans le module factures (`app.module.ts`).
 *
 * Les deux appellent le meme `ProspectsService` : la conversion d'une demande et
 * la creation manuelle d'une fiche partagent la numerotation, le journal
 * d'etapes et l'audit, et deux services finiraient par en diverger.
 *
 * AUCUN IMPORT SUPPLEMENTAIRE POUR AUTANT : les dependances de la conversion
 * sont exactement celles deja listees ci-dessus — `CountersModule` pour la
 * reference `PRO-`, `ActivityModule` pour le temoin, `NotificationModule` pour
 * prevenir le responsable. `ClientsModule` n'est pas concerne : cette conversion
 * ouvre une PISTE, pas un dossier client.
 *
 * LE MODULE EST MONTE dans `app.module.ts`, avec `ClientsModule`. Ce bloc a dit
 * le contraire : il annoncait un montage restant a faire, et des routes qui
 * n'existaient pas encore.
 *
 * `ProspectsService` est exporte pour les modules qui voudront convertir depuis
 * un autre point d'entree.
 */
@Module({
  imports: [ActivityModule, NotificationModule, CountersModule, ClientsModule],
  controllers: [ProspectsController, ContactRequestConversionController],
  providers: [ProspectsService],
  exports: [ProspectsService],
})
export class ProspectsModule {}
