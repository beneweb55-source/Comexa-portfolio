/**
 * Petites fonctions pures du guide — testables sans navigateur.
 *
 * Elles existent parce que trois écrans différents affichent « où l'on en est » :
 * la pastille, la page courte et la fiche d'étape. Une seule règle, donc, plutôt
 * que trois calculs qui divergent à la première étape terminée.
 */

/**
 * Prochaine étape : la première non faite, sinon la dernière (guide terminé).
 *
 * @param {Array<{ id: string, done?: boolean }>} steps
 * @returns {{ id: string, done?: boolean } | null}
 */
export function nextStep(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return null;
  return steps.find((step) => !step?.done) ?? steps[steps.length - 1] ?? null;
}

/** Rang affichable (1-based) d'une étape ; 0 si elle n'est pas dans la liste. */
export function stepPosition(steps, stepId) {
  if (!Array.isArray(steps)) return 0;
  const index = steps.findIndex((step) => step?.id === stepId);
  return index < 0 ? 0 : index + 1;
}

/** « 2 sur 5 », sans jamais afficher « NaN » ni « 0 sur 0 ». */
export function progressLabel(done, total) {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  const safeDone = Number.isFinite(done) ? Math.min(Math.max(0, Math.trunc(done)), safeTotal) : 0;
  if (safeTotal === 0) return "Aucune étape";
  return `${safeDone} sur ${safeTotal}`;
}

/** Page du guide d'un espace (`/espace-equipe/taches` -> `/espace-equipe/guide`). */
export function guideHrefFor(pathname) {
  const segment = String(pathname ?? "").split("/").filter(Boolean)[0];
  if (!segment || !segment.startsWith("espace-")) return null;
  return `/${segment}/guide`;
}

/**
 * Sélecteur CSS du contrôle à montrer (`data-coach-id`).
 *
 * L'identifiant vient du CATALOGUE serveur, pas de l'URL ni du DOM : il n'y a
 * donc pas d'injection possible. On échappe quand même les caractères spéciaux,
 * pour qu'une faute de frappe dans le catalogue ne casse pas le `querySelector`.
 */
export function spotlightSelector(target) {
  if (typeof target !== "string" || target.length === 0) return null;
  const escaped = target.replace(/["\\\]]/g, "\\$&");
  return `[data-coach-id="${escaped}"]`;
}

/** Espace de travail d'un chemin (`/espace-equipe/devis` -> `team`). */
const SPACE_BY_PREFIX = {
  "espace-personnel": "personal",
  "espace-equipe": "team",
  "espace-comexa": "comexa",
  "espace-client": "client",
};

export function spaceOfPathname(pathname) {
  const segment = String(pathname ?? "").split("/").filter(Boolean)[0];
  return SPACE_BY_PREFIX[segment] ?? null;
}
