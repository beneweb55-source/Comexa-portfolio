import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AppException } from '../errors/app-error.js';
import { resolveStoragePath } from './storage.key.js';
import type {
  StorageBody,
  StorageKind,
  StreamingStorageDriver,
} from './storage.types.js';

/**
 * PILOTE LOCAL — ecrit sous `STORAGE_LOCAL_DIR`.
 *
 * Il sert au DEVELOPPEMENT, et a rien d'autre. En production, les fichiers vont
 * dans un stockage objet : sur le disque d'un conteneur, ils disparaitraient au
 * premier redeploiement, sans erreur ni avertissement. C'est `StorageModule`
 * qui refuse de demarrer si ce pilote est selectionne en production, pas ce
 * fichier — un pilote n'a pas a connaitre l'environnement.
 *
 * `supportsSignedUrl` vaut faux, et c'est structurel : il n'y a rien a signer.
 * Un fichier pose sur le disque du serveur n'est pas joignable par un
 * navigateur, et fabriquer une URL qui pointerait vers son chemin divulguerait
 * l'arborescence du serveur. Le service de telechargement lit ce drapeau et
 * sert un flux a la place.
 */
export class LocalStorageDriver implements StreamingStorageDriver {
  readonly kind: StorageKind = 'local';
  readonly supportsSignedUrl = false;

  constructor(private readonly root: string) {}

  async put(key: string, body: StorageBody, _contentType: string): Promise<void> {
    // Le type MIME n'est pas utilise ici : un systeme de fichiers ne stocke pas
    // de metadonnee de type. Il reste dans la signature parce que le pilote S3
    // en a besoin, et que l'appelant ne doit pas avoir deux chemins d'appel
    // selon le pilote.
    const target = resolveStoragePath(this.root, key);

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, toBuffer(body));

    // Ecriture puis verification de la taille reelle : c'est la seule mesure
    // qui prouve que l'objet est complet. Un `writeFile` interrompu laisse un
    // fichier tronque, et une ligne en base qui annonce une taille fausse est
    // pire qu'une ligne absente — elle fait croire au succes.
    const written = await stat(target);
    const expected = byteLength(body);

    if (written.size !== expected) {
      // On ne laisse pas de moitie de fichier derriere : il serait servi plus
      // tard comme s'il etait entier.
      await rm(target, { force: true });
      throw AppException.unprocessable(
        'STORAGE_WRITE_INCOMPLETE',
        "Le fichier n'a pas ete ecrit en entier. Rien n'a ete conserve.",
        { expectedBytes: expected, writtenBytes: written.size },
      );
    }
  }

  async delete(key: string): Promise<void> {
    const target = resolveStoragePath(this.root, key);
    // `force: true` : supprimer un objet deja absent est un succes, pas une
    // erreur. Le cas arrive naturellement quand on rejoue un nettoyage.
    await rm(target, { force: true });
  }

  /**
   * Refuse, bruyamment.
   *
   * Le pilote local ne signe rien. Si un appelant arrive ici, c'est qu'il a
   * ignore `supportsSignedUrl` : c'est un defaut de programmation, et il doit
   * se voir tout de suite. Renvoyer le chemin du fichier sur le disque ferait
   * passer une erreur de conception pour une reponse valide — et divulguerait
   * l'arborescence du serveur au passage.
   */
  getSignedUrl(_key: string, _expiresInSeconds: number): Promise<string> {
    return Promise.reject(
      AppException.unprocessable(
        'STORAGE_SIGNED_URL_UNSUPPORTED',
        "Le pilote de stockage local ne produit pas d'URL signee. Servir le fichier en flux.",
      ),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(resolveStoragePath(this.root, key));
      return true;
    } catch {
      // On ne distingue pas « absent » de « illisible » : du point de vue de
      // l'appelant, les deux signifient « pas de contenu a servir ». Un refus
      // de permission remonterait ici comme une absence, et il vaut mieux cela
      // qu'une exception sur une simple verification d'existence.
      return false;
    }
  }

  /**
   * Rend le contenu, pour la route de telechargement.
   *
   * On verifie l'existence AVANT d'ouvrir le flux : `createReadStream` ne
   * signale un fichier absent qu'en emettant une erreur sur le flux, donc
   * APRES que l'en-tete HTTP 200 est parti. Le client recevrait alors une
   * reponse tronquee et un navigateur afficherait un fichier vide plutot
   * qu'une erreur.
   */
  async readStream(key: string): Promise<ReadStream> {
    const target = resolveStoragePath(this.root, key);

    if (!(await this.exists(key))) {
      throw AppException.notFound('STORAGE_OBJECT_NOT_FOUND', 'Le fichier est introuvable.');
    }

    return createReadStream(target);
  }
}

function toBuffer(body: StorageBody): Buffer {
  return typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
}

function byteLength(body: StorageBody): number {
  return typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.byteLength;
}
