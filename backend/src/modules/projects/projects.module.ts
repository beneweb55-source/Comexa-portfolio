import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module.js';
import { CountersModule } from '../counters/counters.module.js';
import { NotificationModule } from '../notifications/notification.module.js';
import { ProjectAccessService } from './project-access.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

/**
 * MODULE PROJETS.
 *
 * Il EXPORTE deux choses, et la seconde est ce qui rend l'architecture tenable :
 *
 *  - `ProjectsService` : le domaine projet lui-meme ;
 *  - `ProjectAccessService` : le point de passage unique qui repond a « ce
 *    porteur a-t-il le droit de toucher CE projet ». Les modules TACHES, JALONS
 *    et TEMPS l'importent au lieu de reecrire chacun leur filtre de perimetre.
 *
 * `ActivityModule` et `NotificationModule` sont importes et non reecrits : le fil
 * d'activite et les notifications sont des services PARTAGES, montees une fois
 * dans `AppModule`. Ecrire `prisma.activity.create` ici aurait contourne la
 * garantie centrale de `isClientVisible` (faux par defaut) et laisse passer une
 * note interne dans l'espace client.
 *
 * `CountersModule` fournit la numerotation des documents (`PRJ-2026-0001`). Elle
 * est partagee avec les clients et la facturation, et c'est justifie : deux
 * compteurs separes finiraient par produire le meme numero le jour ou une portee
 * serait reutilisee, et `Project.reference` est unique. L'appelant ne fournit que
 * la portee (`{ scope: 'PROJECT' }`) : le prefixe et le format restent dans
 * `CounterService`, seul endroit ou ils peuvent rester coherents.
 *
 * `PrismaModule` et `AuditModule` sont globaux : rien a importer pour les avoir.
 */
@Module({
  imports: [ActivityModule, NotificationModule, CountersModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectAccessService],
  exports: [ProjectsService, ProjectAccessService],
})
export class ProjectsModule {}
