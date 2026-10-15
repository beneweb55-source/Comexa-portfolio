import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodeEnv, assertServiceUrl } from '../../../config/env.validation.js';
import { parseDurationMs } from '../../../common/security/duration.js';
import { EvolutionGateway } from './evolution.gateway.js';
import { DisabledWhatsAppGateway } from './disabled.gateway.js';
import { WahaGateway } from './waha.gateway.js';
import {
  WHATSAPP_GATEWAY_CONFIG_TOKEN,
  WHATSAPP_GATEWAY_TOKEN,
  type WhatsAppGateway,
  type WhatsAppGatewayConfig,
  type WhatsAppGatewayDriver,
} from '../whatsapp.types.js';

/**
 * MODULE DE LA PASSERELLE WHATSAPP — choisit le pilote A UN SEUL ENDROIT.
 *
 * Meme forme que `StorageModule` et `TranscriptionModule`, pour les memes
 * raisons : deux jetons SYMBOLIQUES (les services dependent d'interfaces effacees
 * a la compilation), une configuration RESOLUE exportee a cote du pilote, et un
 * module NON GLOBAL — la passerelle ne sert qu'au module WhatsApp, et la rendre
 * globale ferait croire a une transversalite qui n'existe pas.
 *
 * `resolveWhatsAppGatewayConfig` et `createWhatsAppGateway` sont exportees : ce
 * sont des regles, testables sans monter Nest.
 */

export function resolveWhatsAppGatewayConfig(config: ConfigService): WhatsAppGatewayConfig {
  const driver = (config.get<string>('WHATSAPP_GATEWAY_DRIVER') ?? 'none') as WhatsAppGatewayDriver;
  const nodeEnv = (config.get<string>('NODE_ENV') ?? 'development') as NodeEnv;

  const rawUrl = config.get<string>('WHATSAPP_GATEWAY_URL') ?? '';
  const baseUrl =
    driver === 'none' || rawUrl.trim().length === 0
      ? ''
      : assertServiceUrl(rawUrl, 'WHATSAPP_GATEWAY_URL', nodeEnv);

  return {
    driver,
    baseUrl,
    apiKey: config.get<string>('WHATSAPP_GATEWAY_API_KEY') ?? '',
    timeoutMs: config.get<number>('WHATSAPP_GATEWAY_TIMEOUT_MS') ?? 20_000,
    sessionPrefix: config.get<string>('WHATSAPP_SESSION_PREFIX') ?? 'comexa',
    maxMessagesPerHour: config.get<number>('WHATSAPP_MAX_MESSAGES_PER_HOUR') ?? 40,
    maxBodyLength: config.get<number>('WHATSAPP_MAX_BODY_LENGTH') ?? 1_024,
    sessionCacheMs: config.get<number>('WHATSAPP_SESSION_CACHE_MS') ?? 5_000,
    contactCacheMinutes: config.get<number>('WHATSAPP_CONTACT_CACHE_MINUTES') ?? 30,
    defaultCountryCode: config.get<string>('WHATSAPP_DEFAULT_COUNTRY_CODE') ?? 'DZ',
    delegationCodeTtlMs: parseDurationMs(
      config.get<string>('WHATSAPP_DELEGATION_CODE_TTL') ?? '72h',
      'WHATSAPP_DELEGATION_CODE_TTL',
    ),
    consentTtlMs: readOptionalDuration(config.get<string>('WHATSAPP_CONSENT_TTL')),
  };
}

/** Duree facultative : vide signifie « sans limite », et une valeur fausse LEVE. */
function readOptionalDuration(raw: string | undefined): number | null {
  const value = (raw ?? '').trim();
  if (value.length === 0) return null;
  return parseDurationMs(value, 'WHATSAPP_CONSENT_TTL');
}

export function createWhatsAppGateway(config: WhatsAppGatewayConfig): WhatsAppGateway {
  if (config.driver === 'none') {
    return new DisabledWhatsAppGateway();
  }

  if (config.driver === 'waha') {
    return new WahaGateway(config);
  }

  if (config.driver === 'evolution') {
    return new EvolutionGateway(config);
  }

  // `@IsIn` valide la variable, donc ce cas ne devrait pas arriver. Echouer
  // explicitement plutot que de retomber sur la passerelle desactivee : un pilote
  // ajoute a l'enum sans implementation doit casser au demarrage, pas faire
  // croire que WhatsApp est inactive alors qu'une session est appairee ailleurs.
  throw new Error(
    `WHATSAPP_GATEWAY_DRIVER="${String(config.driver)}" est inconnu. ` +
      'Valeurs acceptees : none, waha, evolution.',
  );
}

@Module({
  providers: [
    {
      provide: WHATSAPP_GATEWAY_CONFIG_TOKEN,
      inject: [ConfigService],
      useFactory: resolveWhatsAppGatewayConfig,
    },
    {
      provide: WHATSAPP_GATEWAY_TOKEN,
      inject: [WHATSAPP_GATEWAY_CONFIG_TOKEN],
      useFactory: (config: WhatsAppGatewayConfig): WhatsAppGateway => {
        const gateway = createWhatsAppGateway(config);

        // Trace de demarrage. La CLE n'est jamais ecrite : ce qu'elle ouvre est
        // l'acces aux comptes WhatsApp de l'equipe, et un journal se lit plus
        // largement qu'un fichier `.env`.
        const logger = new Logger('WhatsAppGatewayModule');
        logger.log(
          gateway.configured
            ? `Passerelle WhatsApp : ${config.driver} sur ${config.baseUrl} ` +
                `(prefixe de session "${config.sessionPrefix}", ` +
                `${config.maxMessagesPerHour} envois/heure/compte)`
            : 'Passerelle WhatsApp DESACTIVEE (WHATSAPP_GATEWAY_DRIVER=none) : les routes ' +
                '/api/v1/integrations/whatsapp/* repondront 503.',
        );

        return gateway;
      },
    },
  ],
  exports: [WHATSAPP_GATEWAY_TOKEN, WHATSAPP_GATEWAY_CONFIG_TOKEN],
})
export class WhatsAppGatewayModule {}
