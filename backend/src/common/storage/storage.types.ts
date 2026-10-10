import type { Readable } from 'node:stream';

/**
 * CONTRAT DE STOCKAGE DES FICHIERS.
 *
 * Aucun binaire ne traverse PostgreSQL. La base ne conserve que des
 * METADONNEES (nom d'origine, type MIME, taille) et une CLE de stockage ; le
 * contenu vit dans un espace objet. C'est l'exigence explicite du client, et
 * elle a une consequence mesurable : la sauvegarde de la base reste petite et
 * se restaure en quelques secondes, quel que soit le volume de fichiers.
 *
 * Ce fichier ne contient AUCUN code Nest : il ne depend que de `node:stream`.
 * C'est ce qui permet de tester les regles de nommage et de taille sans monter
 * de module ni de conteneur d'injection.
 */

/** Les deux backends supportes. La valeur est recopiee dans `Document.storageDriver`. */
export type StorageKind = 'local' | 's3';

/**
 * Prefixes autorises en tete de cle de stockage.
 *
 * La liste et le type vivent cote a cote parce que le type en DERIVE : ecrire
 * l'union a la main laisserait ajouter un membre a la liste sans que le type
 * suive, ou l'inverse, et le compilateur ne dirait rien.
 */
export const STORAGE_PREFIXES = ['documents'] as const;

export type StoragePrefix = (typeof STORAGE_PREFIXES)[number];

/**
 * JETON D'INJECTION.
 *
 * Un `Symbol`, et pas la classe `LocalStorageDriver` : les services dependent de
 * l'INTERFACE `StorageDriver`, qui est effacee a la compilation. TypeScript ne
 * laisse alors rien dans la metadonnee `design:paramtypes`, et Nest tente
 * d'injecter `Object` — l'injection echoue, ou pire, resout autre chose. C'est
 * exactement le piege documente dans `common/guards/access.guards.ts`. Le jeton
 * symbolique est la seule adresse stable pour une interface.
 */
export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');

/**
 * Ce qu'un pilote accepte d'ecrire.
 *
 * `Readable` est volontairement absent : ecrire un flux demande de gerer les
 * erreurs en cours de route et la taille reelle, qui n'est connue qu'a la fin.
 * Or la taille est verifiee AVANT l'ecriture (voir la borne d'envoi), et un flux
 * la rendrait invérifiable. Les appelants fournissent donc un `Buffer`.
 */
export type StorageBody = Buffer | Uint8Array | string;

/**
 * LE PILOTE.
 *
 * Quatre operations, et pas une de plus. Toute la logique metier — droits,
 * visibilite, nom de la cle — vit au-dessus, dans les services : un pilote qui
 * connaitrait les permissions serait impossible a tester sans base.
 */
export interface StorageDriver {
  /** Recopie dans `Document.storageDriver`, pour savoir qui detient l'objet. */
  readonly kind: StorageKind;

  /**
   * Vrai si `getSignedUrl` rend une URL utilisable telle quelle par un
   * navigateur.
   *
   * Faux pour le pilote local : il n'y a rien a signer, et un fichier sur le
   * disque du serveur n'est pas joignable par le client. Le service de
   * telechargement lit ce drapeau et sert alors un FLUX a la place. Sans lui, il
   * faudrait deviner le pilote — ou appeler `getSignedUrl` sur un pilote qui ne
   * sait pas signer.
   */
  readonly supportsSignedUrl: boolean;

  put(key: string, body: StorageBody, contentType: string): Promise<void>;

  delete(key: string): Promise<void>;

  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;

  exists(key: string): Promise<boolean>;
}

/**
 * Pilote capable de rendre le contenu.
 *
 * Interface SEPAREE, et non une cinquieme methode sur `StorageDriver` : un
 * stockage objet n'a aucune raison d'exposer une lecture qui ferait transiter
 * les octets par l'API — le tout interet de l'URL signee est justement de
 * l'eviter. Seul le pilote local en a besoin.
 */
export interface StreamingStorageDriver extends StorageDriver {
  readStream(key: string): Promise<Readable>;
}

/**
 * Vrai si ce pilote sait rendre un flux.
 *
 * On teste la capacite plutot que `kind === 'local'` : le jour ou un troisieme
 * pilote apparait (une passerelle compatible S3 sans URL signee, par exemple),
 * c'est lui qui declare ce qu'il sait faire, et aucun appelant ne bouge.
 */
export function isStreamingDriver(driver: StorageDriver): driver is StreamingStorageDriver {
  return typeof (driver as Partial<StreamingStorageDriver>).readStream === 'function';
}

/**
 * Duree de vie d'une URL signee. Cinq minutes.
 *
 * Assez pour qu'un navigateur suive le lien et telecharge le fichier a debit
 * normal, trop court pour qu'un lien colle dans une conversation reste
 * exploitable jusqu'au lendemain. C'est la seule barriere quand l'URL fuite :
 * elle porte sa propre autorisation, et quiconque la detient peut lire l'objet
 * sans jeton.
 */
export const SIGNED_URL_TTL_SECONDS = 300;

/**
 * Taille maximale d'un envoi, en octets (25 Mo).
 *
 * C'est un DEFAUT, pas la source de verite : la valeur effective vient de la
 * variable d'environnement `MAX_UPLOAD_BYTES`, lue par `StorageModule`. Ce nom
 * reste celui de la borne basse partagee, notamment par les tests, qui doivent
 * pouvoir raisonner sans configuration.
 */
export const MAX_UPLOAD_BYTES = 26_214_400;

/** Configuration resolue d'un pilote. */
export interface StorageConfig {
  readonly kind: StorageKind;
  /** Racine des fichiers quand `kind` vaut `local`. */
  readonly localDir: string;
  readonly s3: S3Config;
  readonly maxUploadBytes: number;
}

/** Parametres du stockage compatible S3. */
export interface S3Config {
  readonly endpoint?: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /**
   * Force l'adressage par chemin (`endpoint/bucket/cle`) au lieu de
   * `bucket.endpoint/cle`.
   *
   * Ce n'est pas un detail de confort : la plupart des stockages
   * S3-compatibles (MinIO, Scaleway, OVH) n'ont pas de DNS par bucket et
   * repondent une erreur de resolution si on les adresse par sous-domaine.
   * Seul AWS se comporte bien dans les deux modes.
   */
  readonly forcePathStyle: boolean;
}
