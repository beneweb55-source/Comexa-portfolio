/**
 * Helpers de navigation côté client. Ils améliorent les parcours, mais ne sont
 * jamais une frontière de sécurité : les contrôleurs Nest et les services
 * vérifient les mêmes permissions sur chaque requête — et, dans un espace de
 * travail, les restreignent à cet espace (en-tête `X-Comexa-Space`).
 */

import { SPACES, canEnterSpace, effectivePermissions, lastSpace, spaceForPath } from "./spaces.js";

const TEAM_ROLES = new Set([
  "ADMIN",
  "COMMUNICATION_MANAGER",
  "PROJECT_MANAGER",
  "DEVELOPER",
  "SOCIAL_MEDIA_MANAGER",
  "SALES",
]);

// Repli si un profil ancien ne contient pas encore `roles`. Ne retenir que des
// permissions d'équipe explicites : `notification:read:own` et
// `dashboard:read:own` sont aussi données aux clients.
const TEAM_PERMISSIONS = [
  "order:read:any",
  "project_request:read:any",
  "contactrequest:read:any",
  "service:read:any",
  "package:read:any",
  "casestudy:read:any",
  "testimonial:read:any",
  "partner:read:any",
  "faq:read:any",
  "user:read:any",
  "role:read:any",
  "audit:read:any",
  "setting:read:any",
  "integration:read:any",
  "integration:manage:any",
  "project:read:any",
  "project:read:assigned",
  "task:read:any",
  "task:read:assigned",
  "task:write:own",
  "task:read:personal",
  "task:write:personal",
  "time:write:own",
  "report:read:any",
  "report:read:own",
  "prospect:read:any",
  "client:read:any",
  "quote:read:any",
  "invoice:read:any",
];

const TASK_READ = ["task:read:any", "task:read:assigned", "task:read:own"];
const PROJECT_READ = ["project:read:any", "project:read:own", "project:read:assigned"];
const CONTENT_READ = ["service:read:any", "package:read:any", "testimonial:read:any", "partner:read:any", "faq:read:any", "casestudy:read:any"];

/**
 * Droit d'entrée de chaque rubrique, évalué avec les droits EFFECTIFS de son
 * espace (une rubrique sans règle est ouverte à tout membre de l'espace).
 */
const ROUTE_ACCESS = [
  // Espace personnel : uniquement ce qui appartient au compte.
  ["/espace-personnel/taches", [...TASK_READ, "task:read:personal", "task:write:personal"]],
  ["/espace-personnel/calendrier", ["calendar:read:own", ...TASK_READ, "task:read:personal"]],
  ["/espace-personnel/temps", ["time:read:own", "time:write:own"]],
  ["/espace-personnel/rapports-journaliers", ["time:write:own", "time:read:own"]],
  ["/espace-personnel/notifications", ["notification:read:own"]],
  ["/espace-personnel/compte", ["user:read:own"]],

  // Espace équipe : le travail partagé.
  ["/espace-equipe/tableau-de-bord", ["dashboard:read:any", "dashboard:read:own"]],
  ["/espace-equipe/notifications", ["notification:read:own"]],
  ["/espace-equipe/contacts", ["contactrequest:read:any"]],
  ["/espace-equipe/prospects", ["prospect:read:any", "prospect:read:own"]],
  ["/espace-equipe/devis/nouveau", ["quote:write:any"]],
  ["/espace-equipe/devis", ["quote:read:any"]],
  ["/espace-equipe/factures", ["invoice:read:any"]],
  ["/espace-equipe/commandes", ["order:read:any"]],
  ["/espace-equipe/demandes", ["project_request:read:any"]],
  ["/espace-equipe/projets", PROJECT_READ],
  ["/espace-equipe/clients", ["client:read:any"]],
  ["/espace-equipe/taches", [...TASK_READ, "task:write:any", "task:write:own"]],
  ["/espace-equipe/calendrier", ["calendar:read:team", ...TASK_READ, ...PROJECT_READ]],
  // Les feuilles et rapports de TOUTE l'équipe ; chacun remplit les siens dans
  // son espace personnel.
  ["/espace-equipe/rapports-journaliers", ["time:read:any"]],
  ["/espace-equipe/temps", ["time:read:any"]],
  ["/espace-equipe/analytique", ["report:read:any"]],
  ["/espace-equipe/modifications", ["modificationrequest:decide:any"]],
  ["/espace-equipe/rapports", ["report:read:any", "report:read:own"]],
  ["/espace-equipe/messagerie", ["conversation:read:own"]],
  ["/espace-equipe/compte", ["user:read:own"]],

  // Comexa Space : l'organisation.
  ["/espace-comexa/contenu", CONTENT_READ],
  ["/espace-comexa/membres", ["user:read:any"]],
  ["/espace-comexa/roles", ["role:read:any"]],
  ["/espace-comexa/integrations", ["integration:read:any", "integration:manage:any"]],
  ["/espace-comexa/journal", ["audit:read:any"]],
  ["/espace-comexa/parametres", ["setting:read:any"]],
  ["/espace-comexa/notifications", ["notification:read:own"]],
  ["/espace-comexa/compte", ["user:read:own"]],
].sort(([a], [b]) => b.length - a.length);

export function can(user, permission) {
  return Boolean(user?.permissions?.includes(permission));
}

export function canAny(user, permissions = []) {
  return permissions.some((permission) => can(user, permission));
}

/** Les rôles CRM distinguent l'espace équipe du rôle client sans ambiguïté. */
export function hasTeamAccess(user) {
  const roles = user?.roles ?? [];
  if (roles.some((role) => TEAM_ROLES.has(typeof role === "string" ? role : role?.code))) return true;
  return TEAM_PERMISSIONS.some((permission) => can(user, permission));
}

/** Profil ancien sans `roles` : on le considère membre s'il porte des droits d'équipe. */
function withRoles(user) {
  if ((user?.roles ?? []).length > 0 || !hasTeamAccess(user)) return user;
  return { ...user, roles: ["TEAM_MEMBER"] };
}

/** L'espace est-il ouvert à ce compte (droits du rôle, non restreints) ? */
export function canOpenSpace(user, space) {
  return canEnterSpace(space, withRoles(user));
}

/**
 * Destination de connexion : le dernier espace utilisé s'il est encore ouvert,
 * sinon l'espace équipe, puis l'espace personnel, puis Comexa Space. Un client
 * retrouve son espace client.
 */
export function homeFor(user) {
  if (!hasTeamAccess(user)) return "/espace-client";
  const remembered = lastSpace(user?.id);
  const order = [remembered, "team", "personal", "comexa"].filter(Boolean);
  const space = order.find((candidate) => canOpenSpace(user, candidate));
  return space ? SPACES[space].home : "/espace-equipe/compte";
}

/**
 * Vérifie le rôle, l'accès à l'espace et la permission d'entrée de la route,
 * avec les droits EFFECTIFS de l'espace. C'est un confort UX, pas une
 * protection des données : le backend reste l'autorité.
 */
export function allowedPath(user, pathname) {
  const space = spaceForPath(pathname);
  if (!space) return true;
  if (!hasTeamAccess(user)) return false;
  if (!canOpenSpace(user, space)) return false;

  const effective = { ...user, permissions: [...effectivePermissions(space, user?.permissions ?? [])] };
  const rule = ROUTE_ACCESS.find(([path]) => pathname === path || pathname.startsWith(`${path}/`));
  return !rule || canAny(effective, rule[1]);
}
