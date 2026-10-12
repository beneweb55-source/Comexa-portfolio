/**
 * Tâches : chemins d'API et profil du créateur.
 *
 * Fonctions pures, testées sous `npm run test:unit`. Elles portent la règle du
 * filtre « par personne » à un seul endroit : le filtre est un IDENTIFIANT de
 * compte (`reporterId`), jamais un nom — deux homonymes restent deux personnes,
 * et un renommage ne déplace pas les tâches.
 *
 * Le filtrage lui-même est fait par le serveur : `/projects/:id/tasks` combine
 * `reporterId` en `AND` avec le projet et avec le périmètre du porteur, donc la
 * liste ne peut pas contenir les tâches d'un autre projet. Refaire ce tri dans le
 * navigateur créerait une seconde vérité, et c'est celle du client qui serait la
 * plus permissive.
 */

/** Valeur du filtre qui n'en est pas un : « Tous ». */
export const EVERY_CREATOR = null;

/**
 * Chemin de la liste des tâches d'un projet.
 *
 * `reporterId` est absent du chemin quand le filtre vaut « Tous » : la requête
 * est alors celle d'origine, et l'API rend les tâches du projet quel que soit
 * leur auteur.
 */
export function taskListPath(projectId, { page = 1, perPage = 100, reporterId = EVERY_CREATOR } = {}) {
  const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
  if (typeof reporterId === "string" && reporterId) params.set("reporterId", reporterId);
  return `/projects/${encodeURIComponent(projectId)}/tasks?${params.toString()}`;
}

/** Chemin des profils à afficher dans le filtre : ceux qui ont créé des tâches du projet. */
export function taskCreatorsPath(projectId) {
  return `/projects/${encodeURIComponent(projectId)}/tasks/creators`;
}

/** « Prénom Nom », avec repli sur l'e-mail puis sur un libellé neutre. */
export function creatorNameOf(profile) {
  if (!profile) return "Créateur inconnu";
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  return name || profile.email || "Créateur inconnu";
}

/** Initiales affichées quand il n'y a pas de photo. Jamais plus de deux lettres. */
export function creatorInitialsOf(profile) {
  if (!profile) return "?";
  const first = profile.firstName?.trim()?.[0] ?? "";
  const last = profile.lastName?.trim()?.[0] ?? "";
  const initials = `${first}${last}`.toLocaleUpperCase("fr-FR");
  if (initials) return initials;
  return creatorNameOf(profile).slice(0, 2).toLocaleUpperCase("fr-FR");
}

/**
 * URL de la photo de profil, ou `null`.
 *
 * `avatarKey` est la clé de stockage du fichier (voir `User.avatarKey` côté API),
 * pas une adresse : tant qu'elle n'est pas résolue par le serveur, il n'y a rien
 * à afficher et l'interface montre les initiales. Une valeur qui est déjà une
 * adresse (URL absolue, ou chemin servi par l'application) est utilisée telle
 * quelle — c'est le cas le jour où l'API renverra `avatarUrl`.
 */
export function creatorAvatarUrlOf(profile) {
  const candidate = profile?.avatarUrl ?? profile?.avatarKey;
  if (typeof candidate !== "string") return null;
  const value = candidate.trim();
  if (!value) return null;
  return /^(https?:\/\/|\/)/.test(value) ? value : null;
}
