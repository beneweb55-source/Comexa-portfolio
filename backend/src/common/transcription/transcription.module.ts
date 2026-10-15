import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodeEnv, assertServiceUrl } from '../../config/env.validation.js';
import { DisabledTranscriptionProvider } from './disabled.provider.js';
import { OpenAiCompatibleTranscriptionProvider } from './openai-compatible.provider.js';
import {
  DEFAULT_TRANSCRIPTION_MAX_BYTES,
  DEFAULT_TRANSCRIPTION_TIMEOUT_MS,
  TRANSCRIPTION_CONFIG_TOKEN,
  TRANSCRIPTION_PROVIDER_TOKEN,
  normalizeLanguageCode,
  type TranscriptionConfig,
  type TranscriptionProvider,
  type TranscriptionProviderKind,
} from './transcription.types.js';

/**
 * MODULE DE TRANSCRIPTION — choisit le moteur A UN SEUL ENDROIT.
 *
 * Meme forme que `StorageModule`, et pour les memes raisons :
 *
 *  - deux jetons SYMBOLIQUES (`TRANSCRIPTION_PROVIDER_TOKEN`,
 *    `TRANSCRIPTION_CONFIG_TOKEN`), parce que les services dependent
 *    d'INTERFACES que TypeScript efface — sans symbole, Nest ne resout rien ;
 *  - une configuration RESOLUE exportee a cote du pilote, pour que la borne de
 *    taille ne soit pas relue depuis l'environnement dans deux modules
 *    differents : deux lectures, ce sont deux valeurs possibles le jour ou l'une
 *    est modifiee ;
 *  - un module NON GLOBAL : la transcription sert le bot Telegram aujourd'hui,
 *    pas tous les domaines. La rendre globale ferait croire a une transversalite
 *    qui n'existe pas.
 *
 * `resolveTranscriptionConfig` et `createTranscriptionProvider` sont EXPORTEES :
 * ce sont des regles (quelle configuration est coherente ? quel pilote pour quel
 * choix ?), et une regle qui ne vit que dans un `useFactory` ne se teste qu'en
 * montant tout Nest.
 */

export function resolveTranscriptionConfig(config: ConfigService): TranscriptionConfig {
  const kind = (config.get<string>('TRANSCRIPTION_PROVIDER') ??
    'none') as TranscriptionProviderKind;

  // Une URL est relue avec la meme regle que partout ailleurs (`assertServiceUrl`)
  // : sans barre oblique finale, protocole http/https, et jamais en clair vers un
  // hote public en production. `env.validation.ts` leve au demarrage si la valeur
  // est fausse ; l'appel ici borne la chaine (retire les `/` de fin) pour que
  // `transcriptionEndpoint` ne produise pas `//audio/transcriptions`.
  const rawBaseUrl = config.get<string>('TRANSCRIPTION_BASE_URL') ?? '';
  const nodeEnv = (config.get<string>('NODE_ENV') ?? 'development') as NodeEnv;
  const baseUrl =
    kind === 'none' || rawBaseUrl.trim().length === 0
      ? ''
      : assertServiceUrl(rawBaseUrl, 'TRANSCRIPTION_BASE_URL', nodeEnv);

  return {
    kind,
    baseUrl,
    apiKey: config.get<string>('TRANSCRIPTION_API_KEY') ?? '',
    model: config.get<string>('TRANSCRIPTION_MODEL') ?? 'whisper-large-v3-turbo',
    // `normalizeLanguageCode` LEVE sur une valeur mal formee : mieux vaut un
    // demarrage refuse qu'une langue fausse transmise au moteur.
    language: normalizeLanguageCode(config.get<string>('TRANSCRIPTION_LANGUAGE')),
    prompt: emptyToNull(config.get<string>('TRANSCRIPTION_PROMPT')),
    maxBytes: config.get<number>('TRANSCRIPTION_MAX_BYTES') ?? DEFAULT_TRANSCRIPTION_MAX_BYTES,
    timeoutMs: config.get<number>('TRANSCRIPTION_TIMEOUT_MS') ?? DEFAULT_TRANSCRIPTION_TIMEOUT_MS,
  };
}

/**
 * Construit le pilote.
 *
 * LE REFUS DE DEMARRER SUR UNE CONFIGURATION INCOMPLETE N'EST PAS ICI, et c'est
 * voulu : il est dans `env.validation.ts` (`assertExternalMessagingConfigured`).
 * Le controler aussi ici produirait deux messages pour une meme faute, et le
 * second serait lu apres le premier — donc jamais.
 */
export function createTranscriptionProvider(config: TranscriptionConfig): TranscriptionProvider {
  if (config.kind === 'none') {
    return new DisabledTranscriptionProvider();
  }

  if (config.kind === 'openai-compatible') {
    return new OpenAiCompatibleTranscriptionProvider(config);
  }

  // `TRANSCRIPTION_PROVIDER` est valide par `@IsIn`, donc ce cas ne devrait pas
  // arriver. Echouer explicitement plutot que de retomber sur le pilote
  // desactive : un moteur ajoute a l'enum sans implementation doit casser au
  // demarrage, pas faire croire que la transcription est inactive.
  throw new Error(
    `TRANSCRIPTION_PROVIDER="${String(config.kind)}" est inconnu. ` +
      'Valeurs acceptees : none, openai-compatible.',
  );
}

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

@Module({
  providers: [
    {
      provide: TRANSCRIPTION_CONFIG_TOKEN,
      inject: [ConfigService],
      useFactory: resolveTranscriptionConfig,
    },
    {
      provide: TRANSCRIPTION_PROVIDER_TOKEN,
      inject: [TRANSCRIPTION_CONFIG_TOKEN],
      useFactory: (config: TranscriptionConfig): TranscriptionProvider => {
        const provider = createTranscriptionProvider(config);

        // Trace de demarrage : c'est la premiere question devant un 503 sur la
        // route de transcription, et elle evite d'aller chercher la reponse dans
        // les variables d'environnement du conteneur. La CLE n'est jamais ecrite.
        const logger = new Logger('TranscriptionModule');
        logger.log(
          provider.configured
            ? `Transcription : ${config.kind} — modele "${config.model}" sur ${config.baseUrl}` +
                (config.language ? `, langue forcee ${config.language}` : ', langue detectee')
            : 'Transcription DESACTIVEE (TRANSCRIPTION_PROVIDER=none) : la route ' +
                '/api/v1/integrations/telegram/transcribe repondra 503.',
        );

        return provider;
      },
    },
  ],
  exports: [TRANSCRIPTION_PROVIDER_TOKEN, TRANSCRIPTION_CONFIG_TOKEN],
})
export class TranscriptionModule {}
