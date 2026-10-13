import { Module } from '@nestjs/common';
import { INTEGRATION_PRINCIPAL_RESOLVER } from '../../common/guards/access.guards.js';
import { IntegrationsController } from './integrations.controller.js';
import { IntegrationTokenService } from './integration-token.service.js';

/**
 * INTEGRATIONS SERVEUR-A-SERVEUR.
 *
 * Deux roles dans un seul module, et c'est la raison d'etre du fichier :
 *
 *  - `IntegrationsController` : l'administration (creer, renouveler, revoquer),
 *    reservee aux administrateurs ;
 *  - `IntegrationTokenService` fourni SOUS LE JETON `INTEGRATION_PRINCIPAL_RESOLVER`
 *    : la verification d'un jeton, branchee sur le garde d'authentification.
 *
 * Ce second point est tout l'interet du montage. Le garde vit dans
 * `src/common/` et n'a pas le droit d'importer un module metier — sinon
 * `common/` dependrait de tout, et un test de garde obligerait a monter
 * l'application entiere. Le garde ne connait donc qu'une INTERFACE, et c'est ce
 * module qui la realise. L'inversion coute un symbole et evite un cycle.
 */
@Module({
  controllers: [IntegrationsController],
  providers: [
    IntegrationTokenService,
    {
      provide: INTEGRATION_PRINCIPAL_RESOLVER,
      useExisting: IntegrationTokenService,
    },
  ],
  exports: [IntegrationTokenService, INTEGRATION_PRINCIPAL_RESOLVER],
})
export class IntegrationsModule {}
