import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';

/**
 * Module du journal d'audit.
 *
 * GLOBAL, et ce n'est pas un raccourci de confort. Le journal est ecrit par
 * TOUS les domaines : creation de compte, changement de role, suspension,
 * validation de devis, enregistrement de paiement, acces refuse a la donnee
 * d'autrui. Le declarer dans `AuthModule`, comme c'etait le cas au depart,
 * obligeait un module de facturation a importer le module d'authentification —
 * donc son controleur, `JwtModule` et `MailService` — pour ecrire une ligne dans
 * une table. C'est le genre de dependance qui, un an plus tard, empeche de
 * toucher a l'authentification sans casser la facturation.
 *
 * Le rendre global fait l'inverse : un seul `AuditService` pour toute
 * l'application, injectable partout, et aucune arete de dependance entre
 * domaines.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
