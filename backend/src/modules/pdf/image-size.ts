/**
 * DIMENSIONS D'UNE IMAGE, SANS DÉCODER L'IMAGE.
 *
 * POURQUOI CE FICHIER EXISTE. La mise en page du document doit connaître la
 * HAUTEUR réelle du logo avant de la dessiner : l'ancien rendu réservait 140 pt
 * de blanc sous un logo qui, lui, en fait 35 (le fichier `comexa-logo.png` est
 * un bandeau 1131 × 261). Résultat : un trou de 100 pt en haut de chaque
 * facture — assez, à lui seul, pour pousser la signature et le pied de page sur
 * une deuxième page presque vide.
 *
 * `pdfkit` sait redimensionner une image, mais ne renvoie pas la hauteur qu'il
 * a choisie. Plutôt que de fouiller dans ses internals (`doc.openImage`, non
 * typé), on lit l'en-tête du fichier : PNG et JPEG portent leurs dimensions en
 * clair dans les premiers octets. C'est une lecture d'en-tête, pas un décodage —
 * aucune dépendance, aucun coût.
 */

export interface ImageSize {
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(buffer: Buffer): boolean {
  return PNG_SIGNATURE.every((byte, index) => buffer[index] === byte);
}

function isJpeg(buffer: Buffer): boolean {
  return buffer[0] === 0xff && buffer[1] === 0xd8;
}

/**
 * JPEG : les dimensions vivent dans un segment SOFn (0xC0–0xCF, sauf 0xC4, 0xC8
 * et 0xCC qui sont des tables). On parcourt les segments jusqu'à le trouver.
 */
function jpegSize(buffer: Buffer): ImageSize | null {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1] ?? 0;
    // Remplissage : des 0xFF en série avant un vrai marqueur.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (isStartOfFrame) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + segmentLength;
  }
  return null;
}

/** Dimensions d'une image PNG ou JPEG, ou `null` si le format n'est pas reconnu. */
export function readImageSize(buffer: Buffer | null | undefined): ImageSize | null {
  // Le minimum absolu : une signature de format tient en 4 octets. Les 24 octets
  // nécessaires à l'IHDR d'un PNG sont vérifiés par `isPng`, et la boucle JPEG
  // garde elle-même ses lectures dans les limites du tampon — imposer 24 octets
  // à tout le monde rejetait un JPEG synthétique valide de 21 octets.
  if (!buffer || buffer.length < 4) return null;

  if (isPng(buffer)) {
    // IHDR : largeur puis hauteur, en big-endian, aux octets 16 et 20.
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (isJpeg(buffer)) return jpegSize(buffer);

  return null;
}

/**
 * Dimensions d'affichage d'une image contenue dans une boîte, en conservant son
 * ratio. Une image dont on ne connaît pas les dimensions remplit la boîte :
 * c'est le repli le plus sûr, puisqu'il ne peut pas déborder la mise en page.
 */
export function fittedImageSize(size: ImageSize | null, box: ImageSize): ImageSize {
  if (!size) return box;
  const scale = Math.min(box.width / size.width, box.height / size.height);
  if (!Number.isFinite(scale) || scale <= 0) return box;
  return {
    width: Math.round(size.width * scale * 100) / 100,
    height: Math.round(size.height * scale * 100) / 100,
  };
}
