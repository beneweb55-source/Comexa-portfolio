import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { forcesPathStyle } from '../../config/env.validation.js';
import { LocalStorageDriver } from './local.driver.js';
import { S3StorageDriver } from './s3.driver.js';
import {
  MAX_UPLOAD_BYTES as DEFAULT_MAX_UPLOAD_BYTES,
  STORAGE_DRIVER,
  type S3Config,
  type StorageConfig,
  type StorageDriver,
  type StorageKind,
} from './storage.types.js';

/**
 * MODULE DE STOCKAGE.
 *
 * Il choisit le pilote a UN SEUL endroit, et fournit deux choses :
 *
 *   STORAGE_DRIVER -> l'implementation, derriere un jeton symbolique
 *   STORAGE_CONFIG -> la configuration resolue (dont la borne d'envoi)
 *
 * DEUX JETONS POURQUOI. Le service de documents depend de l'INTERFACE
 * `StorageDriver`, qui n'existe pas au runtime : TypeScript efface les
 * interfaces, et la metadonnee `design:paramtypes` que Nest lit contient alors
 * `Object`. Nest ne peut rien resoudre et refuse de demarrer — c'est exactement
 * le defaut documente dans `common/guards/access.guards.ts`. Les deux
 * providers sont donc adresses par des `Symbol`, jamais par leur type.
 *
 * `StorageConfig` est exporte en plus du pilote pour que la borne d'envoi ne
 * soit pas relue depuis l'environnement dans deux modules differents : deux
 * lectures, ce sont deux valeurs possibles le jour ou l'une des deux est
 * modifiee.
 *
 * CE MODULE N'EST PAS GLOBAL. Contrairement a `PrismaModule` ou `AuditModule`,
 * le stockage n'est pas une dependance de tous les domaines : seuls les
 * documents s'en servent aujourd'hui. Le rendre global ferait croire a une
 * transversalite qui n'existe pas, et faciliterait l'ecriture de fichiers
 * depuis n'importe ou.
 */

export const STORAGE_CONFIG = Symbol('STORAGE_CONFIG');

/** Valeurs de `NODE_ENV` pour lesquelles le disque local est interdit. */
const PRODUCTION = 'production';

/**
 * Construit la configuration resolue a partir de l'environnement.
 *
 * Exportee pour etre testable : la construction du pilote et le refus de
 * demarrer en production sont des REGLES, et une regle qui ne vit que dans un
 * `useFactory` ne se teste qu'en montant un module Nest complet.
 */
export function resolveStorageConfig(config: ConfigService): StorageConfig {
  const kind = (config.get<string>('STORAGE_DRIVER') ?? 'local') as StorageKind;

  return {
    kind,
    localDir: config.get<string>('STORAGE_LOCAL_DIR') ?? './storage',
    maxUploadBytes: config.get<number>('MAX_UPLOAD_BYTES') ?? DEFAULT_MAX_UPLOAD_BYTES,
    s3: {
      endpoint: emptyToUndefined(config.get<string>('S3_ENDPOINT')),
      region: config.get<string>('S3_REGION') ?? '',
      bucket: config.get<string>('S3_BUCKET') ?? '',
      accessKeyId: config.get<string>('S3_ACCESS_KEY_ID') ?? '',
      secretAccessKey: config.get<string>('S3_SECRET_ACCESS_KEY') ?? '',
      // Traduite par `env.validation.ts`, qui LEVE sur une valeur inconnue : une
      // faute de frappe dans `S3_FORCE_PATH_STYLE` arrete donc le demarrage, au
      // lieu de produire des URL signees dans la mauvaise forme sans le dire. Le
      // defaut (`true`) est documente sur la declaration de la variable.
      forcePathStyle: forcesPathStyle(config.get<string>('S3_FORCE_PATH_STYLE')),
    },
  };
}

/**
 * Choisit et construit le pilote.
 *
 * LE REFUS EN PRODUCTION EST LE POINT IMPORTANT DE CETTE FONCTION.
 *
 * Sur le disque d'un conteneur, un fichier depose aujourd'hui disparait au
 * prochain redeploiement. La ligne en base, elle, survit : on obtient une
 * bibliotheque de documents dont chaque entree pointe vers un fichier absent.
 * Rien ne le signale au moment du depot, et personne ne s'en apercoit avant
 * qu'un client demande le document qu'il vient de partager.
 *
 * Le refus est donc AU DEMARRAGE, pas a la premiere ecriture : un serveur qui
 * demarre avec le mauvais pilote a deja accepte des requetes, et le premier
 * fichier perdu est celui qu'on ne peut pas recuperer.
 */
export function createStorageDriver(config: StorageConfig, nodeEnv: string): StorageDriver {
  if (config.kind === 'local' && nodeEnv === PRODUCTION) {
    throw new Error(
      'STORAGE_DRIVER=local est refuse en production. Sur le disque ephemere ' +
        "d'un conteneur, les fichiers disparaissent au premier redeploiement alors " +
        'que leurs lignes restent en base : chaque document pointerait vers un ' +
        'fichier absent. Renseigner STORAGE_DRIVER=s3 et les variables S3_*.',
    );
  }

  if (config.kind === 'local') {
    return new LocalStorageDriver(config.localDir);
  }

  if (config.kind === 's3') {
    assertS3Configured(config.s3);
    return new S3StorageDriver(config.s3);
  }

  // `STORAGE_DRIVER` est valide par `env.validation.ts` (`@IsIn(['local','s3'])`),
  // donc ce cas ne devrait pas arriver. On echoue quand meme explicitement :
  // ajouter un membre a l'enum sans implementer le pilote doit casser au
  // demarrage, pas ecrire dans un espace de noms vide.
  throw new Error(
    `STORAGE_DRIVER="${String(config.kind)}" est inconnu. Valeurs acceptees : local, s3.`,
  );
}

/**
 * Verifie que le stockage objet est utilisable.
 *
 * On refuse au demarrage plutot qu'a la premiere ecriture : sans ces valeurs,
 * le SDK echoue sur chaque envoi avec une erreur de signature ou de bucket, une
 * par requete, et le diagnostic demande de savoir laquelle des cinq variables
 * manque.
 *
 * `S3_ENDPOINT` est FACULTATIF, et c'est le seul : son absence signifie « AWS »,
 * ou le SDK deduit l'adresse de la region. Tous les autres stockages
 * S3-compatibles l'exigent.
 */
function assertS3Configured(s3: S3Config): void {
  const missing: string[] = [];

  if (!s3.region) missing.push('S3_REGION');
  if (!s3.bucket) missing.push('S3_BUCKET');
  if (!s3.accessKeyId) missing.push('S3_ACCESS_KEY_ID');
  if (!s3.secretAccessKey) missing.push('S3_SECRET_ACCESS_KEY');

  if (missing.length > 0) {
    throw new Error(
      `STORAGE_DRIVER=s3 exige les variables suivantes, absentes : ${missing.join(', ')}. ` +
        'Voir backend/.env.example, section « Stockage des fichiers ».',
    );
  }
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

@Module({
  providers: [
    {
      provide: STORAGE_CONFIG,
      inject: [ConfigService],
      useFactory: resolveStorageConfig,
    },
    {
      provide: STORAGE_DRIVER,
      inject: [STORAGE_CONFIG, ConfigService],
      useFactory: (config: StorageConfig, env: ConfigService): StorageDriver => {
        const driver = createStorageDriver(config, env.get<string>('NODE_ENV') ?? 'development');

        // Trace de demarrage : c'est la premiere question a se poser devant un
        // fichier introuvable, et elle evite d'aller la chercher en base.
        const logger = new Logger('StorageModule');
        logger.log(
          driver.kind === 's3'
            ? `Stockage objet : bucket "${config.s3.bucket}"` +
                (config.s3.endpoint ? ` sur ${config.s3.endpoint}` : ' (AWS, adresse deduite)') +
                `, adressage par chemin : ${config.s3.forcePathStyle ? 'oui' : 'non'}`
            : `Stockage local dans "${config.localDir}" (developpement uniquement)`,
        );

        return driver;
      },
    },
  ],
  exports: [STORAGE_DRIVER, STORAGE_CONFIG],
})
export class StorageModule {}
