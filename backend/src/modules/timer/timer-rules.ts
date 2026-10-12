import { TimerSessionStatus } from '../../generated/prisma/enums.js';

/**
 * REGLES DU MINUTEUR — fonctions PURES, sans base ni horloge cachee.
 *
 * LE DECOMPTE EST UN CALCUL D'ETAT, PAS UNE SOMME DE TICKS. Un tick perdu, un
 * onglet en veille ou un navigateur ferme ne perdent pas de temps : la duree se
 * RECONSTRUIT depuis `accumulatedSeconds` (le solde des segments passes) et
 * `resumedAt` (le depart du segment en cours). C'est la meme propriete que la
 * regle du double demarrage : la base est la seule verite, le client n'a qu'a
 * l'interpreter.
 */

/** Ce dont les regles ont besoin d'une session. Un sous-ensemble volontairement. */
export interface TimerClock {
  readonly status: TimerSessionStatus;
  readonly resumedAt: Date | null;
  readonly accumulatedSeconds: number;
}

/**
 * Secondes ecoulees, arrondies a la seconde inferieure.
 *
 * Le plancher a zero protege d'une horloge serveur qui recule (NTP, migration
 * d'instance) : un delta negatif ne doit jamais RETRANCHER du temps deja
 * travaille, exactement comme `isFutureWorkDay` refuse une saisie du futur.
 */
export function elapsedSecondsOf(session: TimerClock, now: Date): number {
  const stored = Math.max(0, session.accumulatedSeconds);

  if (session.status !== TimerSessionStatus.RUNNING || !session.resumedAt) {
    return stored;
  }

  const deltaMs = now.getTime() - session.resumedAt.getTime();
  return stored + Math.max(0, Math.floor(deltaMs / 1000));
}

/** Borne superieure d'une saisie de temps, reprise de `time-rules`. */
const MAX_SAVED_MINUTES = 1440;

/**
 * Conversion des secondes en minutes SAISISSABLES, a l'arret seulement.
 *
 * PLANCHER A 1 : une session de 12 secondes ne produit pas une saisie de
 * 0 minute — le geste a eu lieu, et une ligne nulle serait une ligne perdue
 * pour les rapports. PLAFOND A 1440 (24 h) : la meme borne que la saisie
 * manuelle, parce que c'est exactement ce qu'une saisie manuelle serait. Un
 * minuteur oublie trois jours ne peut donc pas forcer une ligne de 4 320
 * minutes dans la feuille de temps ; au-dela, la duree se corrige a la main —
 * et le plafond, lui, ne ment jamais.
 */
export function minutesForSeconds(totalSeconds: number): number {
  const rounded = Math.round(totalSeconds / 60);
  return Math.min(MAX_SAVED_MINUTES, Math.max(1, rounded));
}

/** Un minuteur se met en pause depuis RUNNING. Un PAUSED mis en pause est un non-sens. */
export function canPauseTimer(status: TimerSessionStatus): boolean {
  return status === TimerSessionStatus.RUNNING;
}

/** La reprise symetrique : PAUSED seulement. */
export function canResumeTimer(status: TimerSessionStatus): boolean {
  return status === TimerSessionStatus.PAUSED;
}

/** L'arret accepte les deux etats actifs : on peut terminer sans repasser par la marche. */
export function canStopTimer(status: TimerSessionStatus): boolean {
  return status === TimerSessionStatus.RUNNING || status === TimerSessionStatus.PAUSED;
}
