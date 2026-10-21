/**
 * JETON DE FORMATION — le contrat entre le garde d'authentification et le
 * module de formation.
 *
 * Même inversion que les jetons d'intégration (`integration-token.ts`) : le
 * garde vit dans `src/common/`, qui n'importe rien de `src/modules/`. Il
 * déclare donc une interface résolue par `TrainingModule`. Sans cette
 * inversion, un test du garde obligerait à monter l'application entière.
 *
 * ---------------------------------------------------------------------------
 * CE QU'UN JETON DE FORMATION EST, ET CE QU'IL N'EST PAS
 * ---------------------------------------------------------------------------
 * C'est un JWT signé par le serveur (clé d'accès), de `typ` STRICTEMENT
 * `training`, qui porte l'identité du membre réel et l'identifiant d'une
 * `TrainingSession` active en base de production.
 *
 * Ce n'est PAS un access token : `typ` est vérifié dans les deux sens. Un
 * jeton de formation refusé comme access token (et réciproquement) — sans ce
 * contrôle, un jeton de formation ouvrirait l'API de production et un access
 * token basculerait une requête métier dans la base fictive.
 *
 * La résolution fait UNE chose : vérifier la signature, `typ`, et l'existence
 * d'une session de formation active (révocation = écriture en base, immédiate),
 * puis rendre les identifiants. C'est le GARDE qui marque ensuite le scope de
 * formation (`markTrainingScope`), après avoir rechargé le porteur depuis la
 * base de production — l'identité et les permissions d'un membre réel sont
 * toujours lues côté réel, jamais dans le miroir de formation.
 */

/** Valeur exacte du claim `typ` d'un jeton de formation. */
export const TRAINING_TOKEN_TYPE = 'training';

/** Ce que la résolution attache à la requête, en plus du porteur courant. */
export interface TrainingTokenInfo {
  /** `TrainingSession.id` (base de production). */
  readonly sessionId: string;
  /** Utilisateur réel porteur de la session. */
  readonly userId: string;
}

/**
 * Contrat de résolution d'un jeton de formation.
 *
 * `resolve` doit :
 *  - refuser (exception `UNAUTHENTICATED` / `TOKEN_INVALID`) tout jeton dont le
 *    `typ` n'est pas `training`, toute signature invalide, toute session
 *    inconnue, révoquée ou échue ;
 *  - ne RIEN marquer elle-même : le scope de formation est posé par le garde,
 *    après rechargement du porteur en base de production.
 */
export interface TrainingTokenResolver {
  resolveTrainingToken(token: string): Promise<TrainingTokenInfo>;
}

/** Jeton d'injection (voir `JwtAuthGuard`). */
export const TRAINING_TOKEN_RESOLVER = Symbol('TRAINING_TOKEN_RESOLVER');

/**
 * Décode le corps d'un JWT SANS vérifier la signature.
 *
 * Ce n'est PAS une décision de sécurité : le routage choisit seulement quel
 * vérificateur appeler. La signature est vérifiée ensuite par le résolveur
 * réel, et un `typ` falsifié ne trompe personne — il envoie le jeton vers le
 * vérificateur qui le refusera.
 */
export function peekJwtClaims(token: string): unknown {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1] as string, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/** Lit le claim `typ` sans vérifier la signature (routage du vérificateur). */
export function peekTokenType(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const typ = (payload as { typ?: unknown }).typ;
  return typeof typ === 'string' ? typ : null;
}
