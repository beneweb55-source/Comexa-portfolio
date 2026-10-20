import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ACCESS_TOKEN_VERIFIER, PRINCIPAL_LOADER } from '../../common/guards/access.guards.js';
import { MailModule } from '../../common/mail/mail.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PrincipalService } from './principal.service.js';
import { TokenService } from './token.service.js';

/**
 * MODULE D'AUTHENTIFICATION.
 *
 * LE POINT IMPORTANT EST LE CABLAGE DES DEUX JETONS SYMBOLIQUES.
 *
 * Les gardes de `src/common/guards/` dependent d'interfaces
 * (`AccessTokenVerifier`, `PrincipalLoader`) et non de classes concretes. Ce
 * module est le seul endroit ou l'on decide QUI les implemente :
 *
 *     ACCESS_TOKEN_VERIFIER -> TokenService
 *     PRINCIPAL_LOADER      -> PrincipalService
 *
 * Deux consequences, et ce sont elles qui justifient l'indirection :
 *
 *  - `src/common/` n'importe rien de `src/modules/`. Le socle ne connait pas les
 *    modules metier ; ce sont les modules qui se branchent sur le socle. Sans
 *    cela, un garde qui importerait `AuthService` creerait un cycle des que
 *    `AuthService` voudrait utiliser ce garde.
 *  - la REGLE d'acces est verifiable sans monter de module Nest, sans base et
 *    sans JWT : on verifie la REGLE, pas la cryptographie.
 *
 * `JwtModule` est importe SANS secret global : chaque signature precise le sien.
 * Un secret au niveau du module serait un piege — rien n'empecherait un futur
 * service de signer un refresh token avec la cle d'access token, et la
 * validation d'environnement qui interdit deux secrets identiques ne servirait
 * plus a rien.
 *
 * Le module EXPORTE `TokenService` et `PrincipalService` : les autres modules
 * metier en auront besoin (invalider les sessions d'un compte que l'on suspend,
 * par exemple), et repasser par des providers locaux creerait des instances
 * distinctes — donc des etats distincts a maintenir coherents.
 */
@Module({
  imports: [JwtModule.register({}), MailModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    PrincipalService,
    { provide: ACCESS_TOKEN_VERIFIER, useExisting: TokenService },
    { provide: PRINCIPAL_LOADER, useExisting: PrincipalService },
  ],
  /**
   * `ACCESS_TOKEN_VERIFIER` et `PRINCIPAL_LOADER` sont exportes au meme titre
   * que les services : les gardes globaux sont declares dans `AppModule`, mais
   * c'est ICI que l'on decide qui les implemente. Sans cette exportation,
   * `AppModule` devrait instancier lui-meme `TokenService` pour construire le
   * garde — deux instances, deux etats, et le secret de signature lu deux fois.
   *
   * `AuditService` n'y figure plus : il est desormais fourni par `AuditModule`,
   * monte globalement dans `AppModule`. `AuthService` continue de l'injecter sans
   * rien declarer, et les modules metier y accedent sans dependre de
   * l'authentification.
   *
   * `MailService` n'y figure plus NON PLUS, pour la meme raison : il est fourni
   * par `MailModule`, importe ci-dessus. Le service a maintenant plusieurs
   * clients — mot de passe oublie, envoi d'un devis, envoi d'une facture — et le
   * declarer ici obligeait la facturation a importer ce module d'authentification
   * pour envoyer un courriel. `MailModule` est reexporte ci-dessous pour que la
   * surface publique de `AuthModule` reste inchangee.
   */
  exports: [
    AuthService,
    TokenService,
    PrincipalService,
    MailModule,
    ACCESS_TOKEN_VERIFIER,
    PRINCIPAL_LOADER,
  ],
})
export class AuthModule {}
