import { Module } from '@nestjs/common';
import { ActivityService } from './activity.service.js';

/**
 * Module du fil d'activite.
 *
 * Il n'a AUCUN controleur, et c'est delibere : les entrees de ce fil sont
 * toujours servies dans le contexte de la ressource qu'elles decrivent
 * (`GET /projects/:id/activities`, `GET /me/activities`), jamais comme une
 * collection autonome. Exposer `GET /activities` sans perimetre obligatoire
 * reviendrait a publier l'activite de toute l'agence derriere une seule
 * permission.
 *
 * Le service est exporte pour que les modules prospects, projets et facturation
 * l'injectent. `PrismaModule` est global, il n'y a donc rien d'autre a importer.
 */
@Module({
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
