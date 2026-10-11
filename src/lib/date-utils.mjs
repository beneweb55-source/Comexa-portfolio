/** Vrai seulement après l'instant d'échéance; les dates invalides restent neutres. */
export function isDeadlinePassed(value, now = Date.now()) {
  const dueAt = typeof value === "string" ? Date.parse(value) : value instanceof Date ? value.getTime() : NaN;
  return Number.isFinite(dueAt) && Number.isFinite(now) && dueAt < now;
}
