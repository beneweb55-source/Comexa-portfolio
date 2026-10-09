import { Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppException } from '../errors/app-error.js';
import { isSafeStorageKey } from './storage.key.js';
import type { S3Config, StorageBody, StorageDriver, StorageKind } from './storage.types.js';

/**
 * PILOTE S3-COMPATIBLE.
 *
 * Un seul client, partage par toutes les operations : le SDK gere un pool de
 * connexions HTTP, et le reconstruire a chaque appel ouvrirait une poignee de
 * connexions par fichier depose.
 *
 * Ce pilote est ecrit pour un stockage COMPATIBLE S3, pas pour AWS en
 * particulier. La difference tient a une ligne : `forcePathStyle`. La plupart
 * des implementations (MinIO, Scaleway, OVH, Garage) n'ont pas de DNS par
 * bucket, donc `bucket.exemple.com/cle` ne se resout pas ; il faut
 * `exemple.com/bucket/cle`. AWS accepte les deux. Le drapeau vient de
 * `S3_FORCE_PATH_STYLE`, avec `true` par defaut — c'est-a-dire le reglage qui
 * marche partout, y compris chez AWS.
 *
 * RIEN N'EST MIS EN CACHE ET RIEN N'EST JOURNALISE DU CONTENU : les cles
 * d'acces ne doivent jamais apparaitre dans un journal, et c'est pour cela que
 * ce fichier ne journalise que des cles de stockage, qui sont des identifiants
 * opaques sans valeur de secret.
 */
export class S3StorageDriver implements StorageDriver {
  readonly kind: StorageKind = 's3';
  readonly supportsSignedUrl = true;

  private readonly logger = new Logger(S3StorageDriver.name);
  private readonly client: S3Client;

  constructor(private readonly config: S3Config) {
    this.client = new S3Client({
      region: config.region,
      // `endpoint` est omis pour AWS : le SDK resout alors l'adresse a partir de
      // la region. Le passer vide produirait une URL invalide plutot qu'un
      // repli, d'ou le `undefined` explicite.
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(key: string, body: StorageBody, contentType: string): Promise<void> {
    this.assertKey(key);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: toBuffer(body),
        ContentType: contentType,
        // Le contenu est immuable : la cle porte un UUID, une reecriture cree
        // une nouvelle cle, jamais un ecrasement. Un cache long est donc sur, et
        // l'objet n'est jamais revalide pour rien.
        CacheControl: 'private, max-age=31536000, immutable',
      }),
    );
  }

  async delete(key: string): Promise<void> {
    this.assertKey(key);

    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  /**
   * URL signee, valable `expiresInSeconds`.
   *
   * C'est ce qui evite de faire transiter les octets par l'API : le client
   * demande l'URL, puis telecharge directement depuis le stockage. La signature
   * porte sa propre autorisation, ce qui explique la duree courte — voir
   * `SIGNED_URL_TTL_SECONDS`.
   */
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    this.assertKey(key);

    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      // Le maximum du SDK est de sept jours ; une duree nulle ou negative
      // produit une URL immediatement invalide, donc un 403 inexplicable chez
      // le client.
      { expiresIn: Math.max(1, Math.trunc(expiresInSeconds)) },
    );
  }

  async exists(key: string): Promise<boolean> {
    this.assertKey(key);

    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return true;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;

      if (status === 404 || (error as { name?: string }).name === 'NotFound') {
        return false;
      }

      // Toute autre erreur — droits refuses, bucket inexistant, reseau — est
      // RELANCEE. La confondre avec une absence ferait croire a un fichier
      // perdu, et un nettoyage automatique supprimerait la ligne en base d'un
      // objet qui existe toujours : une perte de donnees silencieuse.
      this.logger.error(
        `Verification d'existence impossible pour une cle de stockage : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  /**
   * Refuse une cle qui n'a pas la forme produite par `buildStorageKey`.
   *
   * Le SDK n'interprete pas `..` — une cle S3 est une chaine opaque — mais un
   * objet range sous `../../` serait invisible aux listages par prefixe et
   * resterait facture sans jamais etre nettoye. Le controle coute une
   * comparaison et ferme cette porte.
   */
  private assertKey(key: string): void {
    if (!isSafeStorageKey(key)) {
      throw AppException.badRequest('INVALID_STORAGE_KEY', 'Cle de stockage invalide.');
    }
  }
}

function toBuffer(body: StorageBody): Buffer {
  return typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
}
