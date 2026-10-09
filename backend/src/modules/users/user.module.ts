import { Module } from '@nestjs/common';
import { UserController } from './user.controller.js';
import { UserService } from './user.service.js';

/**
 * ADMINISTRATION DES COMPTES.
 *
 * AUCUN `imports`, ET C'EST VOLONTAIRE.
 *
 * `PrismaService` et `AuditService` viennent de modules GLOBAUX (`PrismaModule`,
 * `AuditModule`, montes une fois dans `app.module.ts`) : les injecter ne demande
 * donc aucun import. C'est precisement l'interet de ce montage — un module metier
 * n'a pas a connaitre l'authentification pour ecrire une ligne de journal.
 *
 * Ce module N'IMPORTE PAS `AuthModule` non plus. Il en a pourtant l'air : la
 * suspension doit revoquer les sessions, et c'est `TokenService` qui sait le
 * faire. Mais `TokenService` travaille avec son propre client Prisma, donc hors
 * de la transaction de `UserService`, et la revocation cesserait d'etre atomique
 * avec le changement de statut. `UserService` ecrit donc `refreshToken` lui-meme,
 * dans sa transaction (`revokeSessions`). Le cout est une requete dupliquee ; le
 * gain est qu'une suspension ne peut pas reussir a moitie. Importer `AuthModule`
 * pour autant aurait en plus tire `AuthController`, `JwtModule` et `MailService`
 * dans le graphe de ce module.
 */
@Module({
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
