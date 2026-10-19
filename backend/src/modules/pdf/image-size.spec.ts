import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fittedImageSize, readImageSize } from './image-size.js';

/**
 * La hauteur du logo décide de la hauteur de l'en-tête, donc de la place qui
 * reste pour le reste de la facture. L'ancien rendu réservait 140 pt quel que
 * soit le fichier ; ces tests verrouillent la lecture des dimensions réelles.
 */

const LOGO_PATH = fileURLToPath(new URL('../../../assets/comexa-logo.png', import.meta.url));

/** En-tête PNG minimal : signature + IHDR portant largeur et hauteur. */
function pngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

/**
 * JPEG minimal : SOI, un segment APP0 à ignorer, puis SOF0 avec les dimensions.
 *
 * Dans un segment JPEG, le champ longueur (2 octets) compte ses propres octets :
 * le segment suivant commence donc à `marqueur + 2 + longueur`. Le lecteur doit
 * enjamber APP0 pour trouver SOF0 — c'est précisément ce que vérifie ce test.
 */
function jpegHeader(width: number, height: number): Buffer {
  const app0Length = 2 + 4; // longueur déclarée = ses 2 octets + 4 octets de donnée
  const sof0 = 2 + 2 + app0Length; // après SOI et le segment APP0 entier
  const buffer = Buffer.alloc(sof0 + 11);

  buffer.writeUInt16BE(0xffd8, 0); // SOI
  buffer.writeUInt16BE(0xffe0, 2); // APP0
  buffer.writeUInt16BE(app0Length, 4);
  buffer.fill(0x4a, 6, 6 + 4); // donnée du segment, sans signification

  buffer.writeUInt16BE(0xffc0, sof0); // SOF0 : début d'image, sans balayage progressif
  buffer.writeUInt16BE(11, sof0 + 2); // longueur : 8 + 3 × 1 composante
  buffer[sof0 + 4] = 8; // précision en bits
  buffer.writeUInt16BE(height, sof0 + 5);
  buffer.writeUInt16BE(width, sof0 + 7);
  return buffer;
}

describe('Dimensions d’image', () => {
  it('lit les dimensions du logo réel du dépôt', () => {
    const size = readImageSize(readFileSync(LOGO_PATH));
    assert.deepEqual(size, { width: 1131, height: 261 });
  });

  it('lit un PNG synthétique', () => {
    assert.deepEqual(readImageSize(pngHeader(800, 600)), { width: 800, height: 600 });
  });

  it('lit un JPEG en enjambant les segments qui précèdent SOF0', () => {
    assert.deepEqual(readImageSize(jpegHeader(1024, 512)), { width: 1024, height: 512 });
  });

  it('rend la main sur un fichier qui n’est pas une image', () => {
    assert.equal(
      readImageSize(Buffer.from('Ceci n’est pas une image, mais alors pas du tout.')),
      null,
    );
    assert.equal(readImageSize(Buffer.alloc(4)), null);
    assert.equal(readImageSize(null), null);
    assert.equal(readImageSize(pngHeader(0, 0)), null);
  });

  it('ramène un bandeau large dans la boîte sans le déformer', () => {
    // Le logo Comexa (1131 × 261) dans une boîte de 172 × 48 : c'est la largeur
    // qui commande, la hauteur suit le ratio — 40 pt, pas les 140 pt réservés
    // par l'ancien rendu.
    assert.deepEqual(fittedImageSize({ width: 1131, height: 261 }, { width: 172, height: 48 }), {
      width: 172,
      height: 39.69,
    });
  });

  it('ramène une image haute par sa hauteur', () => {
    assert.deepEqual(fittedImageSize({ width: 200, height: 400 }, { width: 172, height: 48 }), {
      width: 24,
      height: 48,
    });
  });

  it('remplit la boîte quand les dimensions sont inconnues, sans jamais déborder', () => {
    assert.deepEqual(fittedImageSize(null, { width: 172, height: 48 }), { width: 172, height: 48 });
  });
});
