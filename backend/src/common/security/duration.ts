/**
 * Conversion d'une duree textuelle en millisecondes.
 *
 * Pourquoi un fichier pour si peu : `JWT_REFRESH_TTL=30d` finit dans
 * `RefreshToken.expiresAt`. Se tromper d'un facteur 1000 produit une session de
 * 30 millisecondes ou de 30 jours, et les deux se ressemblent a l'ecran tant
 * qu'on ne regarde pas `expiresAt` en base. Le calcul est donc isole, teste, et
 * refuse tout ce qu'il ne comprend pas au lieu de retourner `NaN`.
 *
 * Formes acceptees :
 *   - `30d`, `15m`, `2h`, `45s`, `1w` — un entier suivi d'une unite ;
 *   - un entier nu, interprete comme des SECONDES (convention jsonwebtoken, deja
 *     utilisee par `JWT_ACCESS_TTL`).
 *
 * `NaN` est le vrai danger ici : `new Date(NaN)` est une date invalide, et
 * Prisma l'accepte parfois jusqu'a la base. On leve donc plutot que de laisser
 * passer une valeur non numerique.
 */

const UNIT_MS: Readonly<Record<string, number>> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

export function parseDurationMs(value: string, label = 'duree'): number {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`La ${label} est vide.`);
  }

  // Entier nu : des secondes.
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isSafeInteger(seconds) || seconds <= 0) {
      throw new Error(`La ${label} "${value}" doit etre strictement positive.`);
    }
    return seconds * 1_000;
  }

  const match = /^(\d+)([smhdw])$/.exec(trimmed);
  if (!match) {
    throw new Error(
      `La ${label} "${value}" est invalide. Formes acceptees : 45s, 15m, 2h, 30d, 1w, ` +
        'ou un entier nu interprete comme des secondes.',
    );
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? '';
  const factor = UNIT_MS[unit];

  if (factor === undefined) {
    throw new Error(`Unite de ${label} inconnue : "${unit}".`);
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(`La ${label} "${value}" doit etre strictement positive.`);
  }

  return amount * factor;
}
