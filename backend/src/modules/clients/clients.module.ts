import { Module } from '@nestjs/common';
import { CountersModule } from '../counters/counters.module.js';
import { ClientsController } from './clients.controller.js';
import { ClientsService } from './clients.service.js';
import { ContactsController } from './contacts.controller.js';

/**
 * MODULE DES DOSSIERS CLIENTS ET DE LEURS CONTACTS.
 *
 * `CountersModule` est importe parce que `Client.reference` est `@unique` et NON
 * nullable : un dossier se cree avec une reference, produite par le compteur
 * partage et consommee DANS la transaction qui cree la ligne. Aucun compteur
 * local — deux implementations concurrentes attribueraient deux fois le meme
 * numero, et le schema n'a aucune contrainte d'unicite sur la raison sociale :
 * la reference est le SEUL critere de dedoublonnage.
 *
 * Les deux controleurs vivent dans le meme module parce qu'ils partagent le
 * meme service et le meme perimetre : `ClientsController` porte les routes sous
 * `/clients`, `ContactsController` celles sous `/contacts`. Les separer
 * dupliquerait le perimetre des contacts, qui est exactement l'endroit ou une
 * divergence ferait fuiter un contact d'un autre client.
 *
 * `ClientsService` est exporte : le module prospects l'appelle pour la
 * conversion (`createFromProspect`, dans SA transaction). Le sens de dependance
 * est volontairement a sens unique — clients n'importe pas prospects — pour
 * qu'aucun cycle n'apparaisse le jour ou la conversion sera declenchee depuis la
 * facturation.
 *
 * LE MODULE EST MONTE dans `app.module.ts`, ou il figure avec `ProspectsModule`.
 * Ce bloc a dit le contraire : il annoncait que `app.module.ts` etait hors
 * perimetre et que les routes n'existeraient qu'une fois le montage fait. C'est
 * fait, et la phrase est corrigee plutot que laissee mentir.
 */
@Module({
  imports: [CountersModule],
  controllers: [ClientsController, ContactsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
