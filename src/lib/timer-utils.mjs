export const TIMER_STORAGE_PREFIX = "comexa.timer.v2:";

export function timerStorageKey(ownerId) {
  if (typeof ownerId !== "string" || ownerId.length === 0) return null;
  return `${TIMER_STORAGE_PREFIX}${encodeURIComponent(ownerId)}`;
}

/** Valeur d'un champ `date` selon le calendrier local de l'utilisateur. */
export function localDateInputValue(date = new Date()) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return "";
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Lit et valide un enregistrement local sans jamais accepter un minuteur d'un autre compte. */
export function parseStoredTimer(raw, ownerId) {
  if (typeof raw !== "string" || !raw || typeof ownerId !== "string" || ownerId.length === 0) return null;

  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!value || value.stopped === true || value.ownerId !== ownerId) return null;
  if (typeof value.taskId !== "string" || value.taskId.length === 0) return null;
  if (typeof value.startedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt))) return null;

  return {
    ownerId,
    taskId: value.taskId,
    title: typeof value.title === "string" && value.title.trim() ? value.title : "Tâche",
    startedAt: value.startedAt,
  };
}

/** Retourne la durée arrondie en minutes, ou null si la date de départ est invalide. */
export function elapsedMinutes(startedAt, now = Date.now()) {
  if (typeof startedAt !== "string") return null;
  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.round((now - startedAtMs) / 60_000));
}

/** Jour civil du porteur, au format attendu par les saisies de temps. */
export function localWorkDay(startedAt) {
  if (typeof startedAt !== "string") return null;
  const date = new Date(startedAt);
  if (!Number.isFinite(date.getTime())) return null;
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** Découpe un minuteur en saisies journalières conformes au plafond API de 1 440 minutes. */
export function splitTimerDuration(startedAt, totalMinutes, maxEntries = 7) {
  if (typeof startedAt !== "string" || !Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(totalMinutes)) return null;

  let cursor = Date.parse(startedAt);
  let remainingMinutes = Math.max(0, Math.floor(totalMinutes));
  const requestedLimit = Math.floor(Number(maxEntries));
  const entryLimit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(7, requestedLimit))
    : 7;
  const chunks = [];

  while (remainingMinutes > 0 && chunks.length < entryLimit) {
    const cursorDate = new Date(cursor);
    const nextLocalMidnight = new Date(cursorDate);
    nextLocalMidnight.setHours(24, 0, 0, 0);
    const minutesToMidnight = Math.max(1, Math.ceil((nextLocalMidnight.getTime() - cursor) / 60_000));
    const minutes = Math.min(1440, remainingMinutes, minutesToMidnight);
    const resumeAt = new Date(cursor + minutes * 60_000).toISOString();

    chunks.push({ minutes, spentOn: localWorkDay(cursorDate.toISOString()), resumeAt });
    cursor += minutes * 60_000;
    remainingMinutes -= minutes;
  }

  return { chunks, remainingMinutes, resumeAt: new Date(cursor).toISOString() };
}
