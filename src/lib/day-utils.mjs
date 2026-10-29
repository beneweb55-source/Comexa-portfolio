/**
 * Dates « jour civil » de l'espace personnel.
 *
 * Le formulaire et l'API stockent une échéance sans heure à midi UTC : le jour
 * reste identique dans les fuseaux de -11 h à +11 h, et les écrans le lisent
 * avec la même clé UTC. Ce helper évite de recopier ce calcul dans la saisie
 * rapide, le report et les tests.
 */

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(value) {
  if (typeof value !== "string" || !DAY_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isoDayFromParts(year, month, day) {
  if (![year, month, day].every(Number.isInteger)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** Décale une clé `YYYY-MM-DD` sans passer par le fuseau local. */
export function addDaysToDay(day, count) {
  if (!isIsoDay(day) || !Number.isInteger(count)) return null;
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

/** Contrat existant de `POST /me/tasks` / `PATCH /tasks/:id`. */
export function dueDateForLocalDay(day) {
  return isIsoDay(day) ? new Date(`${day}T12:00:00Z`).toISOString() : null;
}
