import { Module } from '@nestjs/common';
import { INTEGRATION_PRINCIPAL_RESOLVER } from '../../common/guards/access.guards.js';
import { IntegrationsController } from './integrations.controller.js';
import { IntegrationTokenService } from './integration-token.service.js';
import { TelegramLinkController } from './telegram-link.controller.js';
import { TelegramLinkService } from './telegram-link.service.js';

/**
 * INTEGRATIONS SERVEUR-A-SERVEUR.
 *
 * Deux rôles dans un seul module :
 *
 *  - `IntegrationsController` : l'administration des jetons `cxi_`.
 *  - `IntegrationTokenService` fourni sous le jeton
 *    `INTEGRATION_PRINCIPAL_RESOLVER` : la vérification d'un jeton, branchée sur
 *    le garde d'authentification.
 *  - `TelegramLinkController` + `TelegramLinkService` : l'appairage Telegram
 *    multi-utilisateur (routes `/me/telegram-link*` pour les membres et
 *    `/v1/integrations/telegram/*` pour le bot n8n).
 */
@Module({
  controllers: [IntegrationsController, TelegramLinkController],
  providers: [
    IntegrationTokenService,
    {
      provide: INTEGRATION_PRINCIPAL_RESOLVER,
      useExisting: IntegrationTokenService,
    },
    TelegramLinkService,
  ],
  exports: [IntegrationTokenService, TelegramLinkService, INTEGRATION_PRINCIPAL_RESOLVER],
})
export class IntegrationsModule {}
