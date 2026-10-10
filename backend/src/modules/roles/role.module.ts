import { Module } from '@nestjs/common';
import { RoleController } from './role.controller.js';
import { RoleService } from './role.service.js';

/**
 * ROLES ET PERMISSIONS.
 *
 * Aucun `imports`, comme `UserModule` : `PrismaService` et `AuditService`
 * viennent de modules globaux (`PrismaModule`, `AuditModule`). Ce module ne
 * depend d'aucun autre module metier — il n'a besoin ni des comptes, ni de
 * l'authentification, ni des notifications.
 *
 * Il importe en revanche `identity-rules.js` depuis `modules/users/`, et c'est
 * volontaire : `assertRoleIsMutable` est LA definition de « le role ADMIN n'est
 * pas modifiable », et elle doit rester unique. La dupliquer ici ferait deux
 * endroits ou corriger la regle le jour ou elle change — donc un endroit qu'on
 * oubliera. Un fichier de regles pures partage entre deux modules vaut mieux que
 * deux copies qui divergent.
 */
@Module({
  controllers: [RoleController],
  providers: [RoleService],
  exports: [RoleService],
})
export class RoleModule {}
