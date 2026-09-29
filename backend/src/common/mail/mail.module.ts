import { Module } from '@nestjs/common';
import { MailService } from './mail.service.js';

/**
 * Module d'envoi de courriels transactionnels.
 *
 * POURQUOI UN MODULE, ALORS QUE `MailService` ETAIT JUSQU'ICI UN PROVIDER
 * D'`AuthModule`. Parce que le service n'a plus un seul client. Tant que seul le
 * mot de passe oublie envoyait un courriel, declarer le service dans
 * `AuthModule` ne coutait rien : la facturation ne l'utilisait pas. Maintenant
 * que l'envoi d'un devis et d'un envoi de facture passent aussi par la, deux
 * solutions existaient, et une seule est correcte :
 *
 *  - importer `AuthModule` depuis `InvoicesModule` et `QuotesModule`. C'est
 *    exactement la dependance que `common/audit/audit.module.ts` documente comme
 *    la raison d'etre de son passage en global : un module de facturation ne
 *    doit pas tirer `AuthController`, `JwtModule` et la gestion des sessions
 *    pour envoyer un courriel ;
 *  - declarer `MailService` une seconde fois dans chaque module consommateur. Le
 *    projet aurait alors DEUX ou TROIS instances du service, donc plusieurs
 *    transports SMTP ouverts en parallele — l'inverse de ce que sa propre
 *    documentation annonce (« UN SEUL POINT DE VERITE SUR LE TRANSPORT »).
 *
 * `MailModule` est l'implementation unique, non globale : Nest dedoublonne par
 * reference de classe, donc importer ce module depuis `AuthModule`,
 * `InvoicesModule` et `QuotesModule` donne UNE SEULE instance de `MailService`
 * pour toute l'application. Le rendre `@Global()` aurait ete possible, mais il
 * aurait fallu l'inscrire dans les `imports` de `AppModule` ; la facturation
 * declare donc explicitement sa dependance, ce qui la rend lisible.
 *
 * `ConfigService` vient de `ConfigModule`, monte globalement dans `AppModule` :
 * rien a importer pour lui.
 */
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
