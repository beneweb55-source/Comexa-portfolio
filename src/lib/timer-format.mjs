/**
 * Mise en forme du minuteur. Fonctions pures, testées sous `npm run test:unit`.
 */

/** `HH:MM:SS`, jamais négatif. */
export function formatElapsed(totalSeconds) {
  const value = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/** Morceaux d'affichage du cadran : heures-minutes en grand, secondes en petit. */
export function splitElapsed(totalSeconds) {
  const [h, m, s] = formatElapsed(totalSeconds).split(":");
  return { hours: h, minutes: m, seconds: s };
}

/** Durée lisible : « 45 min », « 1 h », « 2 h 05 ». */
export function formatMinutes(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(value / 60);
  const m = value % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/**
 * Avancement du cadran.
 *
 *  - avec une ESTIMATION : temps déjà saisi sur la tâche + session en cours,
 *    rapporté à l'estimation (au-delà de 1 : dépassement) ;
 *  - sans estimation : un tour de cadran par heure, pour que l'anneau vive.
 *
 * @returns {{ mode: "estimate" | "cycle", ratio: number, over: boolean, label: string | null }}
 */
export function timerProgress({ elapsedSeconds = 0, estimateMinutes = null, loggedMinutes = 0 } = {}) {
  const elapsed = Math.max(0, Number(elapsedSeconds) || 0);
  const estimate = Number(estimateMinutes) || 0;
  if (estimate > 0) {
    const spentSeconds = Math.max(0, Number(loggedMinutes) || 0) * 60 + elapsed;
    const ratio = spentSeconds / (estimate * 60);
    return {
      mode: "estimate",
      ratio,
      over: ratio > 1,
      label: `${formatMinutes(spentSeconds / 60)} sur ${formatMinutes(estimate)} estimées`,
    };
  }
  return { mode: "cycle", ratio: (elapsed % 3600) / 3600, over: false, label: null };
}

/** Le minuteur tourne-t-il depuis assez longtemps pour avoir été oublié ? */
export const LONG_RUNNING_SECONDS = 8 * 3600;

export function isLongRunning(elapsedSeconds) {
  return Number(elapsedSeconds) >= LONG_RUNNING_SECONDS;
}

const TITLE_PREFIX = /^(?:▶|⏸) \d{2,}:\d{2}:\d{2} · /;

/** Titre d'onglet avec le décompte en tête (ou sans, si `status` est nul). */
export function titleWithTimer(currentTitle, status, elapsedSeconds) {
  const base = String(currentTitle ?? "").replace(TITLE_PREFIX, "");
  if (status !== "RUNNING" && status !== "PAUSED") return base;
  const icon = status === "RUNNING" ? "▶" : "⏸";
  return `${icon} ${formatElapsed(elapsedSeconds)} · ${base}`;
}
