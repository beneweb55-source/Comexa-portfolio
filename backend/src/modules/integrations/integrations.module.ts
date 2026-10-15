import { Module } from '@nestjs/common';
import { INTEGRATION_PRINCIPAL_RESOLVER } from '../../common/guards/access.guards.js';
import { TranscriptionModule } from '../../common/transcription/transcription.module.js';
import { IntegrationsController } from './integrations.controller.js';
import { IntegrationTokenService } from './integration-token.service.js';
import { TelegramLinkController } from './telegram-link.controller.js';
import { TelegramLinkService } from './telegram-link.service.js';
import { TelegramVoiceController } from './telegram-voice.controller.js';
import { TelegramVoiceService } from './telegram-voice.service.js';

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
 *  - `TelegramVoiceController` + `TelegramVoiceService` : la transcription des
 *    vocaux (`POST /v1/integrations/telegram/transcribe`), derriere
 *    `TranscriptionModule` — donc derriere un moteur configurable, eteignable, et
 *    jamais obligatoire pour que le reste demarre.
 *
 * `TranscriptionModule` est importe ici et non rendu global : la transcription ne
 * sert que cette route, et un module global laisserait croire qu'elle traverse
 * tout le backend.
 */
@Module({
  imports: [TranscriptionModule],
  controllers: [IntegrationsController, TelegramLinkController, TelegramVoiceController],
  providers: [
    IntegrationTokenService,
    {
      provide: INTEGRATION_PRINCIPAL_RESOLVER,
      useExisting: IntegrationTokenService,
    },
    TelegramLinkService,
    TelegramVoiceService,
  ],
  exports: [
    IntegrationTokenService,
    TelegramLinkService,
    TelegramVoiceService,
    INTEGRATION_PRINCIPAL_RESOLVER,
  ],
})
export class IntegrationsModule {}
