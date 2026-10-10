import { Module } from '@nestjs/common';
import { StorageModule } from '../../common/storage/storage.module.js';
import { ActivityModule } from '../activity/activity.module.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';

/**
 * MODULE DOCUMENTS.
 *
 * Trois dependances, et chacune a une raison precise :
 *
 *  - `StorageModule` fournit `STORAGE_DRIVER` et `STORAGE_CONFIG` par des jetons
 *    symboliques. Il n'est PAS global, donc il faut l'importer ici : c'est
 *    volontaire, tous les modules n'ont pas a pouvoir ecrire des fichiers ;
 *
 *  - `ActivityModule` fournit le fil d'activite, ou chaque depot et chaque
 *    suppression laissent une trace. On ne cree JAMAIS d'entree d'activite a la
 *    main : le service partage existe, et deux ecritures concurrentes vers la
 *    meme table finiraient par diverger sur les regles (visibilite client,
 *    format du message) ;
 *
 *  - `PrismaModule` n'est pas liste : il est global.
 *
 * `DocumentsService` est exporte parce que d'autres domaines y deposent des
 * fichiers — un message avec piece jointe, un justificatif de paiement. Ils
 * passent alors par la MEME porte : la liste blanche de types, la borne de
 * taille et la derivation de cle restent appliquees, au lieu d'etre reecrites
 * ailleurs avec un oubli.
 */
@Module({
  imports: [StorageModule, ActivityModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
