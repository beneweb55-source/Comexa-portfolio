/*
 * MODE CONCENTRATION — l'état et les statistiques, hors React.
 *
 * Ce module ne connaît ni React ni le minuteur : il lit et écrit un état dans
 * un stockage clé/valeur, et calcule des statistiques. Tout est PUR, donc
 * exerçable sans navigateur.
 *
 * POURQUOI CET ÉTAT VIT CÔTÉ CLIENT. Une session de concentration n'a pas
 * besoin d'être partagée entre les appareils : elle dure le temps d'un bloc de
 * travail et elle est déjà rattachée à un minuteur, lui piloté par le serveur.
 * Ce qui compte et qui DOIT survivre à un rechargement, c'est l'intention —
 * « je voulais 50 minutes sur cette tâche » — et l'historique, qui alimente les
 * statistiques. Les deux tiennent dans un seul objet JSON.
 *
 * CE QUI N'EST PAS STOCKÉ ICI : le temps réellement passé. Il vient du
 * minuteur (`useTimer().elapsedSeconds`), qui est la source de vérité — le
 * recopier ici donnerait deux horloges qui finissent par diverger.
 */

const STORAGE_KEY = "comexa.focus.v1";
const DAY_MS = 86_400_000;
/** Au-delà, les statistiques deviennent illisibles ; on garde les plus récentes. */
const MAX_HISTORY = 500;

/** Durées proposées, en minutes. Le dernier choix de l'utilisateur est rappelé. */
export const FOCUS_PRESETS = [25, 50, 90];

/** Bornes acceptées à la saisie manuelle. */
export const FOCUS_MIN_MINUTES = 5;
export const FOCUS_MAX_MINUTES = 240;

function defaultState() {
  return { session: null, history: [], dnd: false, lastMinutes: FOCUS_PRESETS[1] };
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isSession(value) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    isFiniteNumber(value.plannedMinutes) &&
    value.plannedMinutes > 0 &&
    typeof value.startedAt === "string"
  );
}

function isEntry(value) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof value.completedAt === "string" &&
    isFiniteNumber(value.focusedSeconds) &&
    value.focusedSeconds >= 0 &&
    typeof value.taskTitle === "string"
  );
}

function normalize(parsed) {
  const state = defaultState();
  if (!parsed || typeof parsed !== "object") return state;

  if (Array.isArray(parsed.history)) {
    state.history = parsed.history.filter(isEntry).slice(-MAX_HISTORY);
  }
  if (isSession(parsed.session)) {
    state.session = {
      taskId: typeof parsed.session.taskId === "string" ? parsed.session.taskId : null,
      taskTitle: typeof parsed.session.taskTitle === "string" ? parsed.session.taskTitle : "Sans tâche",
      projectName: typeof parsed.session.projectName === "string" ? parsed.session.projectName : null,
      plannedMinutes: clampMinutes(parsed.session.plannedMinutes),
      note: typeof parsed.session.note === "string" ? parsed.session.note : "",
      startedAt: parsed.session.startedAt,
    };
  }
  state.dnd = Boolean(parsed.dnd);
  if (isFiniteNumber(parsed.lastMinutes) && parsed.lastMinutes > 0) {
    state.lastMinutes = clampMinutes(parsed.lastMinutes);
  }
  return state;
}

/** Borne une durée à la plage autorisée (la saisie manuelle est libre mais bornée). */
export function clampMinutes(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return FOCUS_PRESETS[1];
  return Math.min(FOCUS_MAX_MINUTES, Math.max(FOCUS_MIN_MINUTES, number));
}

/** Lit l'état. Un stockage indisponible ou corrompu rend un état vierge. */
export function readFocusState(storage) {
  try {
    const raw = storage?.getItem?.(STORAGE_KEY);
    if (!raw) return defaultState();
    return normalize(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

/** Écrit l'état. Une écriture refusée (quota, mode privé) est silencieuse. */
export function writeFocusState(storage, state) {
  try {
    storage?.setItem?.(STORAGE_KEY, JSON.stringify(normalize(state)));
    return true;
  } catch {
    return false;
  }
}

/** Clé de jour locale (l'app et l'équipe raisonnent en journée locale). */
export function dayKey(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Statistiques de concentration, déduites de l'historique.
 *
 * `streak` compte les JOURS CONSÉCUTIFS qui finissent aujourd'hui ou hier :
 * une journée encore en cours ne casse pas la série, sinon personne n'aurait
 * jamais de série avant d'avoir terminé sa première session de la journée.
 */
export function focusStats(history, now = Date.now()) {
  const entries = (Array.isArray(history) ? history : []).filter(isEntry);
  const perDay = new Map();
  for (const entry of entries) {
    const key = dayKey(entry.completedAt);
    const current = perDay.get(key) ?? { seconds: 0, count: 0 };
    current.seconds += entry.focusedSeconds;
    current.count += 1;
    perDay.set(key, current);
  }

  const today = perDay.get(dayKey(now)) ?? { seconds: 0, count: 0 };

  // Semaine glissante : aujourd'hui et les six jours d'avant.
  const weekStart = startOfDay(now) - 6 * DAY_MS;
  let weekSeconds = 0;
  let weekCount = 0;
  for (const [key, value] of perDay) {
    const at = new Date(`${key}T00:00:00`).getTime();
    if (at >= weekStart) {
      weekSeconds += value.seconds;
      weekCount += value.count;
    }
  }

  let streak = 0;
  let cursor = startOfDay(now);
  // Si rien aujourd'hui, la série peut venir d'hier : on commence au jour
  // précédent plutôt que de la déclarer morte à minuit passé.
  if (!perDay.has(dayKey(cursor))) cursor -= DAY_MS;
  while (perDay.has(dayKey(cursor))) {
    streak += 1;
    cursor -= DAY_MS;
  }

  let bestSeconds = 0;
  for (const value of perDay.values()) bestSeconds = Math.max(bestSeconds, value.seconds);

  return {
    todaySeconds: today.seconds,
    todayCount: today.count,
    weekSeconds,
    weekCount,
    streak,
    bestSeconds,
    totalSeconds: entries.reduce((sum, entry) => sum + entry.focusedSeconds, 0),
    totalCount: entries.length,
  };
}

/** Formatage compact d'une durée en secondes : « 1 h 25 », « 45 min ». */
export function formatFocus(totalSeconds) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${String(minutes).padStart(2, "0")}`;
}

/** Libellé d'une durée planifiée : « 50 minutes », « 1 h 30 ». */
export function formatPlanned(minutes) {
  const value = clampMinutes(minutes);
  if (value < 60) return `${value} minutes`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, "0")}`;
}
