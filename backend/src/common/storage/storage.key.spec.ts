import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';
import { AppException } from '../errors/app-error.js';
import {
  ALLOWED_MIME_TYPES,
  assertUploadSize,
  buildStorageKey,
  extensionForMimeType,
  isAllowedMimeType,
  isSafeStorageKey,
  isStoragePrefix,
  normalizeMimeType,
  resolveStoragePath,
  sanitizeOriginalName,
} from './storage.key.js';
import { MAX_UPLOAD_BYTES, STORAGE_PREFIXES } from './storage.types.js';

/**
 * CE QUE CES TESTS PROTEGENT.
 *
 * Trois regles, et chacune correspond a un incident reel dans ce genre de
 * module :
 *
 *   1. le nom fourni par le client n'entre pas dans la cle de stockage
 *      (traversee de chemin : `../../etc/passwd`, ou l'ecriture hors de la
 *      racine) ;
 *   2. le type de fichier vient d'une liste blanche, pas du client ;
 *   3. la taille est bornee avant l'ecriture.
 *
 * Aucun de ces tests n'a besoin de base de donnees ni de serveur : la logique
 * est pure, c'est precisement pour cela qu'elle est sortie des services.
 */

/** Date figee : une cle qui depend de l'horloge du processus n'est pas testable. */
const FIXED = new Date('2026-09-29T12:00:00.000Z');
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function codeOf(error: unknown): string {
  assert.ok(error instanceof AppException, `AppException attendue, recu : ${String(error)}`);
  return error.code;
}

describe('buildStorageKey — derivation de la cle', () => {
  it('produit <prefixe>/<annee>/<mois>/<uuid>.<ext>', () => {
    const key = buildStorageKey('documents', 'application/pdf', FIXED);

    assert.match(
      key,
      new RegExp(`^documents/2026/09/${UUID_V4.source.slice(1, -1)}\\.pdf$`),
      `forme inattendue : ${key}`,
    );
  });

  it('zero-pad le mois sur deux chiffres', () => {
    // Janvier produirait « 2026/1/ » sans padding : les cles ne se trieraient
    // plus correctement par prefixe, et un listage par mois manquerait des
    // objets.
    const key = buildStorageKey('documents', 'image/png', new Date('2026-01-05T00:00:00.000Z'));
    assert.ok(key.includes('/2026/01/'), `mois non padde : ${key}`);
  });

  it('utilise le mois UTC, pas le mois local', () => {
    // Le 1er du mois a 00h30 UTC est encore le mois precedent en heure locale
    // dans les fuseaux negatifs. Deux serveurs dans deux fuseaux produiraient
    // alors des chemins differents pour le meme instant.
    const key = buildStorageKey('documents', 'text/plain', new Date('2026-03-01T00:30:00.000Z'));
    assert.ok(key.includes('/2026/03/'), `mois UTC attendu : ${key}`);
  });

  it('genere une cle differente a chaque appel', () => {
    const first = buildStorageKey('documents', 'application/pdf', FIXED);
    const second = buildStorageKey('documents', 'application/pdf', FIXED);

    assert.notEqual(first, second, 'deux envois ne doivent jamais partager une cle');
  });

  it("n'inclut JAMAIS le nom fourni par le client", () => {
    // C'est le test central du fichier. `buildStorageKey` ne prend pas de nom en
    // parametre — c'est la protection elle-meme, et non un filtre qui pourrait
    // etre contourne par un encodage. On verifie que le resultat ne contient
    // aucun fragment d'un nom hostile.
    const hostile = '../../etc/passwd';
    const key = buildStorageKey('documents', 'image/jpeg', FIXED);

    assert.ok(!key.includes('..'), `remontee de chemin dans la cle : ${key}`);
    assert.ok(!key.includes('etc'), `chemin absolu dans la cle : ${key}`);
    assert.ok(!key.includes('passwd'), `fragment du nom client dans la cle : ${key}`);
    assert.ok(
      !sanitizeOriginalName(hostile).includes('/'),
      'le nom nettoye reste un nom, pas un chemin',
    );
  });

  it('refuse un prefixe hors de la liste fermee', () => {
    // Le prefixe est la seule partie de la cle qui vient d'un appelant : c'est
    // donc le seul endroit ou une chaine hostile pourrait rentrer. On la
    // revalide a l'execution meme si le type l'interdit deja.
    assert.throws(
      () => buildStorageKey('../../etc' as never, 'application/pdf', FIXED),
      (error) => codeOf(error) === 'INVALID_STORAGE_PREFIX',
    );
  });

  it('accepte tous les prefixes declares', () => {
    for (const prefix of STORAGE_PREFIXES) {
      assert.ok(isStoragePrefix(prefix), `${prefix} devrait etre reconnu`);
      assert.ok(buildStorageKey(prefix, 'application/pdf', FIXED).startsWith(`${prefix}/`));
    }
  });
});

describe('liste blanche des types MIME', () => {
  it('accepte un type de la liste et rend son extension', () => {
    assert.equal(extensionForMimeType('application/pdf'), 'pdf');
    assert.equal(extensionForMimeType('image/png'), 'png');
    assert.equal(extensionForMimeType('image/jpeg'), 'jpg');
    assert.equal(extensionForMimeType('text/csv'), 'csv');
    assert.equal(extensionForMimeType('application/zip'), 'zip');
  });

  it('ignore les parametres et la casse du type recu', () => {
    // Un navigateur envoie `text/plain; charset=utf-8`. Refuser ce fichier pour
    // un parametre en trop serait un faux rejet, vecu comme un bug.
    assert.equal(normalizeMimeType('TEXT/PLAIN; charset=utf-8'), 'text/plain');
    assert.equal(extensionForMimeType('text/plain; charset=utf-8'), 'txt');
    assert.ok(isAllowedMimeType('image/PNG'));
  });

  it('refuse un type hors liste', () => {
    for (const rejected of [
      'application/x-msdownload',
      'application/octet-stream',
      'application/javascript',
      '',
    ]) {
      assert.throws(
        () => extensionForMimeType(rejected),
        (error) => codeOf(error) === 'UNSUPPORTED_FILE_TYPE',
        `${rejected} devrait etre refuse`,
      );
    }
  });

  it('refuse le SVG et le HTML, qui portent du script', () => {
    // Servis depuis le domaine de stockage, ces deux formats hebergent du
    // JavaScript sous une origine de confiance : un XSS stocke, pas un simple
    // probleme de format.
    assert.equal(isAllowedMimeType('image/svg+xml'), false);
    assert.equal(isAllowedMimeType('text/html'), false);
  });

  it('refuse un type hostile au lieu de le laisser entrer dans la cle', () => {
    // Le point ou la traversee de chemin serait possible si l'extension venait
    // du client : elle vient de la table, donc ces entrees n'y trouvent rien.
    for (const hostile of ['../../etc/passwd', 'image/png/../../x', '..\\..\\windows']) {
      assert.throws(
        () => buildStorageKey('documents', hostile, FIXED),
        (error) => codeOf(error) === 'UNSUPPORTED_FILE_TYPE',
      );
    }
  });

  it('ne contient aucune extension porteuse de separateur', () => {
    // Invariant verifie sur toute la table : quelle que soit la ligne choisie,
    // la valeur greffee a la cle ne peut pas contenir de chemin.
    for (const mimeType of ALLOWED_MIME_TYPES) {
      const extension = extensionForMimeType(mimeType);
      assert.match(extension, /^[a-z0-9]+$/, `extension douteuse pour ${mimeType} : ${extension}`);
    }
  });
});

describe('borne de taille', () => {
  it('accepte une taille inferieure ou egale au maximum', () => {
    assert.doesNotThrow(() => assertUploadSize(0 + 1, 1024));
    assert.doesNotThrow(() => assertUploadSize(1024, 1024));
  });

  it('refuse un depassement avec PAYLOAD_TOO_LARGE et un statut 413', () => {
    try {
      assertUploadSize(MAX_UPLOAD_BYTES + 1);
      assert.fail('un depassement doit lever');
    } catch (error) {
      assert.equal(codeOf(error), 'PAYLOAD_TOO_LARGE');
      assert.equal((error as AppException).getStatus(), 413);
      // Le detail est exploitable par le frontend pour afficher la limite
      // reelle, au lieu d'un message generique.
      assert.deepEqual((error as AppException).details, {
        sizeBytes: MAX_UPLOAD_BYTES + 1,
        maxBytes: MAX_UPLOAD_BYTES,
      });
    }
  });

  it('refuse un fichier vide', () => {
    assert.throws(
      () => assertUploadSize(0),
      (error) => codeOf(error) === 'EMPTY_FILE',
    );
  });

  it('refuse une taille qui n est pas un nombre positif', () => {
    for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => assertUploadSize(invalid),
        (error) => codeOf(error) === 'INVALID_FILE_SIZE',
        `${String(invalid)} devrait etre refuse`,
      );
    }
  });

  it('respecte la borne passee, pas seulement le defaut', () => {
    assert.throws(
      () => assertUploadSize(2048, 1024),
      (error) => codeOf(error) === 'PAYLOAD_TOO_LARGE',
    );
  });
});

describe('cle de stockage — validation et resolution de chemin', () => {
  it('accepte les cles produites par buildStorageKey', () => {
    assert.ok(isSafeStorageKey(buildStorageKey('documents', 'application/pdf', FIXED)));
    assert.ok(isSafeStorageKey(buildStorageKey('documents', 'image/webp', FIXED)));
  });

  it('refuse une remontee de chemin', () => {
    for (const hostile of [
      'documents/2026/09/../../etc/passwd',
      '../../etc/passwd',
      'documents/./../../secret.pdf',
      'documents/2026/09/..%2f..%2fsecret.pdf',
    ]) {
      assert.equal(isSafeStorageKey(hostile), false, `${hostile} devrait etre refuse`);
    }
  });

  it('refuse un chemin absolu, une lettre de lecteur ou un anti-slash Windows', () => {
    for (const hostile of [
      '/etc/passwd',
      '\\windows\\system32\\config',
      'C:/windows/system32/config',
      'documents\\2026\\09\\x.pdf',
      'documents/2026/09/x.pdf\0',
    ]) {
      assert.equal(isSafeStorageKey(hostile), false, `${hostile} devrait etre refuse`);
    }
  });

  it('refuse une cle qui ne fait pas quatre segments', () => {
    for (const hostile of ['documents/2026/x.pdf', 'documents/x.pdf', 'documents/2026/09/10/x.pdf']) {
      assert.equal(isSafeStorageKey(hostile), false, `${hostile} devrait etre refuse`);
    }
  });

  it('resout une cle valide sous la racine', () => {
    const key = buildStorageKey('documents', 'application/pdf', FIXED);
    const root = resolve('C:/srv/comexa-storage');
    const target = resolveStoragePath(root, key);

    assert.ok(target.startsWith(root), `hors racine : ${target}`);
    assert.ok(target.endsWith('.pdf'));
  });

  it('refuse de resoudre une cle qui sortirait de la racine', () => {
    // Defense en profondeur : la cle vient de la base, ou seule
    // `buildStorageKey` l'ecrit. Mais une ecriture directe en base (correction
    // manuelle, import) ne doit pas se transformer en ecriture hors racine.
    for (const hostile of ['../../etc/passwd', '/etc/passwd', 'documents/../../x.pdf']) {
      assert.throws(
        () => resolveStoragePath(resolve('C:/srv/comexa-storage'), hostile),
        (error) => codeOf(error) === 'INVALID_STORAGE_KEY',
        `${hostile} devrait etre refuse`,
      );
    }
  });

  it('ne confond pas une racine avec un dossier qui partage son prefixe', () => {
    // Sans le separateur final, `/srv/store` accepterait `/srv/store-secret` :
    // la comparaison textuelle de prefixe laisserait passer un dossier voisin.
    assert.throws(
      () => resolveStoragePath(resolve('C:/srv/store'), '../../store-secret/x.pdf'),
      (error) => codeOf(error) === 'INVALID_STORAGE_KEY',
    );
  });
});

describe('sanitizeOriginalName — le nom reste un nom', () => {
  it('retire les separateurs et ne garde que le dernier segment', () => {
    assert.equal(sanitizeOriginalName('../../etc/passwd'), 'passwd');
    assert.equal(sanitizeOriginalName('C:\\Users\\x\\contrat.pdf'), 'contrat.pdf');
    assert.equal(sanitizeOriginalName('dossier/sous-dossier/plan.png'), 'plan.png');
  });

  it('retire les caracteres de controle et normalise les espaces', () => {
    assert.equal(sanitizeOriginalName('con\u0000trat\u001b  final.pdf'), 'contrat final.pdf');
    assert.equal(sanitizeOriginalName('  plan   final.png  '), 'plan final.png');
  });

  it('retombe sur un nom neutre plutot que sur une chaine vide', () => {
    for (const empty of ['', '   ', '..', './', '///']) {
      assert.equal(sanitizeOriginalName(empty), 'fichier');
    }
  });

  it('borne la longueur en conservant l extension', () => {
    const long = `${'a'.repeat(500)}.pdf`;
    const cleaned = sanitizeOriginalName(long);

    assert.ok(cleaned.length <= 200, `nom trop long : ${cleaned.length}`);
    assert.ok(cleaned.endsWith('.pdf'), "l'extension doit survivre a la troncature");
  });
});
