import { Module } from '@nestjs/common';
import { MailModule } from '../../common/mail/mail.module.js';
import { WhatsAppGatewayModule } from './gateway/whatsapp-gateway.module.js';
import { WhatsAppAccountService } from './whatsapp-account.service.js';
import { WhatsAppController } from './whatsapp.controller.js';
import { WhatsAppIntegrationController } from './whatsapp-integration.controller.js';
import { WhatsAppMessagingService } from './whatsapp-messaging.service.js';

/**
 * MODULE WHATSAPP.
 *
 * -------------------------------------------------------------------------
 * DEUX CONTROLEURS, DEUX PUBLICS, MEMES SERVICES
 * -------------------------------------------------------------------------
 * `WhatsAppController` sert les membres et l'administration ;
 * `WhatsAppIntegrationController` sert le bot n8n avec un jeton `cxi_`. Les deux
 * appellent LES MEMES services : la regle d'envoi, le consentement et le journal
 * ne sont donc ecrits qu'une fois. Deux controleurs qui auraient chacun leur
 * service finiraient par ne plus refuser les memes envois — et l'ecart se verrait
 * sur le telephone d'un client.
 *
 * -------------------------------------------------------------------------
 * DEPENDANCES EXPLICITES
 * -------------------------------------------------------------------------
 * `MailModule` : l'invitation a un tiers part par courriel, avec le texte de
 * consentement. `WhatsAppGatewayModule` : il fournit le pilote (`WHATSAPP_GATEWAY_TOKEN`)
 * et la configuration resolue. Ni l'un ni l'autre n'est global, donc les importer
 * ici est ce qui rend la dependance lisible.
 *
 * `PrismaModule` et `AuditModule` sont globaux : rien a importer pour eux.
 *
 * -------------------------------------------------------------------------
 * CE QUI N'EST PAS ICI
 * -------------------------------------------------------------------------
 * Aucun client Telegram : le bot vit dans n8n, et ce module ne parle jamais a
 * Telegram. La liaison Telegram (`TelegramLinkService`) reste dans
 * `IntegrationsModule` ; c'est le workflow qui fait le pont entre les deux, en
 * resolvant d'abord l'identifiant Telegram puis en appelant ce module avec le
 * `userId` obtenu.
 */
@Module({
  imports: [MailModule, WhatsAppGatewayModule],
  controllers: [WhatsAppController, WhatsAppIntegrationController],
  providers: [WhatsAppAccountService, WhatsAppMessagingService],
  exports: [WhatsAppAccountService, WhatsAppMessagingService],
})
export class WhatsAppModule {}
