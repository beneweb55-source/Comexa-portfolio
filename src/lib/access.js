/**
 * Redirections selon les droits. Le serveur reste la seule source de verite :
 * ces helpers ne servent qu'a choisir l'espace a afficher. Chaque page de
 * l'espace equipe re-verifie ses donnees, et l'API refuse de toute facon.
 */

// Permissions qui ouvrent l'espace equipe (voir backend/src/common/auth/permissions.catalogue.ts).
const TEAM_PERMISSIONS = ["order:read:any", "project_request:read:any"];

export function hasTeamAccess(user) {
  return Boolean(user?.permissions?.some((permission) => TEAM_PERMISSIONS.includes(permission)));
}

export function can(user, permission) {
  return Boolean(user?.permissions?.includes(permission));
}

/** Espace d'accueil apres connexion : l'equipe va a son espace, les autres au leur. */
export function homeFor(user) {
  return hasTeamAccess(user) ? "/espace-equipe/commandes" : "/espace-client";
}

/** Le chemin demande est-il autorise pour cet utilisateur ? */
export function allowedPath(user, pathname) {
  if (pathname.startsWith("/espace-equipe")) return hasTeamAccess(user);
  return true;
}
