/*
 * Horodatage court et lisible (« il y a 12 min », « hier », « 3 mars »).
 */

export function formatRelativeTime(value, now = Date.now()) {
  if (!value) return "—";
  const date = new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return "—";

  const seconds = Math.round((now - time) / 1000);
  if (seconds < 60) return "à l’instant";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return "hier";
  if (days < 7) return `il y a ${days} j`;
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(date);
}

export const relativeFr = formatRelativeTime;
