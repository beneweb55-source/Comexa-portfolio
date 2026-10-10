import { randomUUID } from 'node:crypto';
import { extname, resolve, sep } from 'node:path';
import { HttpStatus } from '@nestjs/common';
import { AppException, ErrorCode } from '../errors/app-error.js';
import { MAX_UPLOAD_BYTES, STORAGE_PREFIXES, type StoragePrefix } from './storage.types.js';

/**
 * LE CONTRAT D'ENVOI — ce qui est accepte, et ce que devient un envoi.
 *
 * Tout ce fichier est PUR : ni Nest, ni Prisma, ni acces disque. C'est
 * deliberе. Les trois regles ci-dessous sont celles qu'on ne peut pas se
 * permettre de casser, et elles doivent donc etre verifiables en une seconde,
 * sans base de donnees :
 *
 *   1. LE NOM FOURNI PAR LE CLIENT N'ENTRE JAMAIS DANS LA CLE.
 *   2. LE TYPE MIME VIENT D'UNE LISTE BLANCHE, jamais du client.
 *   3. LA TAILLE EST BORNEE AVANT L'ECRITURE.
 *
 * Le point 1 n'est pas une precaution de style. Si le nom du client entrait
 * dans la cle, `../../../etc/passwd` — ou `..%2f..%2f` selon l'encodage —
 * designerait un chemin hors de la racine de stockage, et le pilote local
 * ecrirait la ou le processus a le droit d'ecrire. La parade n'est pas un
 * filtre sur le nom : c'est de ne JAMAIS lire le nom. La cle est construite a
 * partir de la date du serveur et d'un UUID, et son extension vient d'une table
 * fermee indexee par le type MIME. Il n'existe donc aucun chemin de code par
 * lequel une chaine fournie par l'appelant atteint la cle.
 */

/**
 * Vrai si cette chaine est un prefixe connu.
 *
 * L'ensemble des prefixes (`STORAGE_PREFIXES`, dans `storage.types.ts`) est
 * FERME : sans cela, un prefixe libre venu de l'appelant serait le trou par
 * lequel le nom du client rentrerait a nouveau dans la cle. Un nouveau domaine
 * qui range ses fichiers ajoute un membre la-bas — une ligne, visible en revue.
 */
export function isStoragePrefix(value: string): value is StoragePrefix {
  return (STORAGE_PREFIXES as readonly string[]).includes(value);
}

/**
 * LISTE BLANCHE DES TYPES MIME, et l'extension associee.
 *
 * L'extension est DERIVEE de cette table, jamais du nom de fichier. C'est ce
 * qui rend la traversee de chemin impossible par construction : la valeur
 * greffee a la cle appartient a une liste de quatorze chaines litterales, et
 * aucune d'elles ne contient de separateur.
 *
 * Deux absences sont deliberees :
 *
 *  - `image/svg+xml`. Un SVG est un document XML qui peut porter du script. Le
 *    servir depuis le domaine de stockage revient a heberger du JavaScript sous
 *    une origine de confiance : c'est un XSS stocke. Un client qui veut un
 *    logo vectoriel l'envoie en PNG ou en PDF.
 *  - `text/html`. Meme raison, en plus direct.
 */
const MIME_EXTENSIONS: Readonly<Record<string, string>> = Object.freeze({
  'application/pdf': 'pdf',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/zip': 'zip',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'text/csv': 'csv',
  'text/markdown': 'md',
  'text/plain': 'txt',
});

/** Tous les types acceptes, tries — l'ordre sert aux messages d'erreur. */
export const ALLOWED_MIME_TYPES: readonly string[] = Object.freeze(
  Object.keys(MIME_EXTENSIONS).sort(),
);

/**
 * Normalise un type MIME recu.
 *
 * Un navigateur envoie `text/plain; charset=utf-8`, et certains clients
 * ajoutent des espaces. Sans normalisation, un fichier parfaitement legitime
 * serait refuse pour une majuscule ou un parametre — et le message d'erreur
 * n'expliquerait rien.
 */
export function normalizeMimeType(raw: string): string {
  return (raw.split(';')[0] ?? '').trim().toLowerCase();
}

/** Vrai si ce type MIME est accepte. */
export function isAllowedMimeType(raw: string): boolean {
  return Object.prototype.hasOwnProperty.call(MIME_EXTENSIONS, normalizeMimeType(raw));
}

/**
 * Extension associee au type MIME.
 *
 * Leve `UNSUPPORTED_FILE_TYPE` pour tout ce qui n'est pas dans la liste. On
 * leve plutot que de retomber sur `bin` : un type inconnu ecrit sur le disque
 * avec une extension generique serait servi plus tard, et le refus doit tomber
 * au moment de l'envoi, quand l'appelant peut encore corriger.
 */
export function extensionForMimeType(raw: string): string {
  const mimeType = normalizeMimeType(raw);
  const extension = MIME_EXTENSIONS[mimeType];

  if (!extension) {
    throw AppException.unprocessable(
      'UNSUPPORTED_FILE_TYPE',
      `Type de fichier non accepte : ${mimeType || 'inconnu'}. ` +
        `Types acceptes : ${ALLOWED_MIME_TYPES.join(', ')}.`,
      { mimeType, allowed: ALLOWED_MIME_TYPES },
    );
  }

  return extension;
}

/**
 * Borne de taille, verifiee AVANT l'ecriture.
 *
 * `MAX_UPLOAD_BYTES` est le defaut de la variable d'environnement du meme nom,
 * pas une seconde source de verite : l'appelant passe la valeur resolue par la
 * configuration. Le controle existe ici, et pas seulement dans le `limits` de
 * multer, parce que la route de depot n'est pas le seul chemin d'ecriture (un
 * import, une tache planifiee, un script) et qu'un garde qui ne tient qu'a un
 * middleware est un garde qu'on contourne sans le vouloir.
 */
export function assertUploadSize(sizeBytes: number, maxBytes: number = MAX_UPLOAD_BYTES): void {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    throw AppException.badRequest(
      'INVALID_FILE_SIZE',
      "La taille du fichier n'a pas pu etre determinee.",
    );
  }

  if (sizeBytes === 0) {
    throw AppException.unprocessable('EMPTY_FILE', 'Le fichier envoye est vide.');
  }

  if (sizeBytes > maxBytes) {
    // `PAYLOAD_TOO_LARGE` existe deja dans le catalogue des codes d'erreur : le
    // frontend sait deja le traduire, inutile d'inventer un code voisin. Le
    // statut 413 est celui d'Express pour ce cas, on reste aligne.
    throw new AppException(
      ErrorCode.PAYLOAD_TOO_LARGE,
      `Fichier trop volumineux : ${formatBytes(sizeBytes)} pour un maximum de ${formatBytes(maxBytes)}.`,
      HttpStatus.PAYLOAD_TOO_LARGE,
      { sizeBytes, maxBytes },
    );
  }
}

/** Rendu lisible d'une taille, pour les messages d'erreur. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Construit la cle de stockage : `<prefixe>/<annee>/<mois>/<uuid>.<ext>`.
 *
 * L'arborescence par annee et par mois n'est pas cosmetique : elle evite le
 * dossier unique qui rassemble des dizaines de milliers d'entrees, ou les
 * listages de stockage objet deviennent lents et couteux a mesure que l'agence
 * produit des fichiers.
 *
 * `now` est un parametre et non un appel direct a `Date.now()` : c'est ce qui
 * rend la fonction testable sans figer l'horloge du processus.
 */
export function buildStorageKey(
  prefix: StoragePrefix,
  mimeType: string,
  now: Date = new Date(),
): string {
  // Le prefixe est revalide a l'execution meme s'il est type : une valeur venue
  // d'un appelant non typé (script, test, donnee de configuration) ne doit pas
  // pouvoir glisser un chemin ici.
  if (!isStoragePrefix(prefix)) {
    throw AppException.badRequest('INVALID_STORAGE_PREFIX', `Prefixe de stockage inconnu : ${prefix}`);
  }

  const extension = extensionForMimeType(mimeType);
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');

  return `${prefix}/${year}/${month}/${randomUUID()}.${extension}`;
}

/**
 * Verifie qu'une cle est bien formee, et reste sous la racine.
 *
 * Ce controle est une DEFENSE EN PROFONDEUR, pas la protection principale : la
 * cle vient de la base, ou seule `buildStorageKey` l'a ecrite. Mais un pilote
 * qui joint une chaine a un chemin sans la relire transforme la moindre
 * ecriture directe en base (migration, correction manuelle, import) en
 * traversee de chemin. On refuse donc tout ce qui n'a pas la forme attendue :
 * segments alphanumeriques, separateur `/`, aucune remontee `..`, aucun
 * encodage pourcent, aucun chemin absolu, aucune lettre de lecteur Windows.
 */
export function isSafeStorageKey(key: string): boolean {
  if (key.length === 0 || key.length > 512) return false;
  if (key.startsWith('/') || key.startsWith('\\')) return false;
  if (key.includes('..') || key.includes('%') || key.includes('\\')) return false;
  if (key.includes('\0') || key.includes(':')) return false;

  const segments = key.split('/');
  if (segments.length !== 4) return false;

  return segments.every((segment) => /^[A-Za-z0-9._-]+$/.test(segment) && segment !== '.' && segment !== '');
}

/**
 * Resout le chemin disque d'une cle sous une racine, ou refuse.
 *
 * C'est la derniere barriere avant l'ecriture ou la lecture. Elle compare les
 * chemins RESOLUS, pas les chaines : `resolve` normalise `..`, les liens
 * symboliques de Windows et les separateurs, ce qu'aucune comparaison de
 * prefixe textuelle ne fait correctement.
 */
export function resolveStoragePath(root: string, key: string): string {
  if (!isSafeStorageKey(key)) {
    throw AppException.badRequest('INVALID_STORAGE_KEY', 'Cle de stockage invalide.');
  }

  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, key);

  // `resolvedRoot + sep` : sans le separateur final, une racine `/data/store`
  // accepterait `/data/store-secret`. Le detail parait mineur jusqu'au jour ou
  // deux dossiers partagent un prefixe.
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + sep)) {
    throw AppException.badRequest(
      'INVALID_STORAGE_KEY',
      "La cle de stockage sort de la racine autorisee.",
    );
  }

  return target;
}

/**
 * Nettoie le nom d'origine avant de le stocker en base.
 *
 * Ce nom est une METADONNEE, jamais un chemin : il sert a afficher le fichier
 * dans une liste. On lui retire donc tout ce qui pourrait etre reinterprete
 * plus tard — separateurs, remontees, caracteres de controle — parce qu'un nom
 * conserve tel quel finit toujours par etre reutilise un jour dans un
 * `Content-Disposition` ou un chemin de telechargement temporaire.
 *
 * Ce n'est PAS ce qui protege la cle de stockage : celle-ci n'est jamais
 * construite a partir de ce nom. Les deux barrieres sont independantes.
 */
export function sanitizeOriginalName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? '';
  const ext = extname(base);

  const withoutControls = Array.from(base)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

  const cleaned = withoutControls.replace(/^\.+/, '').trim();

  if (cleaned.length === 0) {
    return 'fichier';
  }

  // On borne a 200 caracteres en gardant l'extension : le champ est un
  // `String` sans limite en base, mais un nom de 4000 caracteres est une
  // tentative de remplissage, pas un nom de fichier.
  if (cleaned.length <= 200) {
    return cleaned;
  }

  const head = cleaned.slice(0, Math.max(1, 200 - ext.length));
  return `${head}${ext}`;
}
