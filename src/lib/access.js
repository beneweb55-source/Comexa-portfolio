/**
 * Helpers de navigation côté client. Ils améliorent les parcours, mais ne sont
 * jamais une frontière de sécurité : les contrôleurs Nest et les services
 * vérifient les mêmes permissions sur chaque requête.
 */

const TEAM_ROLES = new Set([
  "ADMIN",
  "COMMUNICATION_MANAGER",
  "PROJECT_MANAGER",
  "DEVELOPER",
  "DESIGNER",
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

const TEAM_ROUTE_ACCESS = [
  ["/espace-equipe/tableau-de-bord", ["dashboard:read:any", "dashboard:read:own"]],
  ["/espace-equipe/notifications", ["notification:read:own"]],
  ["/espace-equipe/contacts", ["contactrequest:read:any"]],
  ["/espace-equipe/prospects", ["prospect:read:any", "prospect:read:own"]],
  ["/espace-equipe/devis/nouveau", ["quote:write:any"]],
  ["/espace-equipe/devis", ["quote:read:any"]],
  ["/espace-equipe/factures", ["invoice:read:any"]],
  ["/espace-equipe/commandes", ["order:read:any"]],
  ["/espace-equipe/demandes", ["project_request:read:any"]],
  ["/espace-equipe/projets", ["project:read:any", "project:read:own", "project:read:assigned"]],
  ["/espace-equipe/clients", ["client:read:any"]],
  ["/espace-equipe/taches", ["task:read:any", "task:read:assigned", "task:read:own", "task:read:personal", "task:write:any", "task:write:own", "task:write:personal"]],
  ["/espace-equipe/calendrier", ["task:read:any", "task:read:assigned", "task:read:own", "project:read:any", "project:read:assigned", "project:read:own", "calendar:read:own", "calendar:read:team"]],
  ["/espace-equipe/rapports-journaliers", ["time:write:own", "time:read:any"]],
  ["/espace-equipe/analytique", ["report:read:any"]],
  ["/espace-equipe/temps", ["time:write:own", "time:read:own", "time:read:any"]],
  ["/espace-equipe/modifications", ["modificationrequest:decide:any"]],
  ["/espace-equipe/rapports", ["report:read:any", "report:read:own"]],
  ["/espace-equipe/messagerie", ["conversation:read:own"]],
  ["/espace-equipe/contenu", ["service:read:any", "package:read:any", "testimonial:read:any", "partner:read:any", "faq:read:any", "casestudy:read:any"]],
  ["/espace-equipe/membres", ["user:read:any"]],
  ["/espace-equipe/roles", ["role:read:any"]],
  ["/espace-equipe/journal", ["audit:read:any"]],
  ["/espace-equipe/parametres", ["setting:read:any"]],
  ["/espace-equipe/compte", ["user:read:own"]],
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

/** Destination de connexion et repli sûr pour une route d'équipe non autorisée. */
export function homeFor(user) {
  if (!hasTeamAccess(user)) return "/espace-client";

  const destinations = [
    ["/espace-equipe/tableau-de-bord", ["dashboard:read:any", "dashboard:read:own"]],
    ["/espace-equipe/commandes", ["order:read:any"]],
    ["/espace-equipe/projets", ["project:read:any", "project:read:own", "project:read:assigned"]],
    ["/espace-equipe/taches", ["task:read:any", "task:read:assigned", "task:read:own", "task:read:personal", "task:write:own", "task:write:personal"]],
    ["/espace-equipe/contacts", ["contactrequest:read:any"]],
    ["/espace-equipe/compte", ["user:read:own"]],
  ];
  return destinations.find(([, permissions]) => canAny(user, permissions))?.[0] ?? "/espace-equipe/compte";
}

/**
 * Vérifie le rôle et la permission d'entrée de la route. C'est un confort UX,
 * pas une protection des données : le backend reste l'autorité.
 */
export function allowedPath(user, pathname) {
  if (!pathname?.startsWith("/espace-equipe")) return true;
  if (!hasTeamAccess(user)) return false;

  const rule = TEAM_ROUTE_ACCESS.find(([path]) => pathname === path || pathname.startsWith(`${path}/`));
  return !rule || canAny(user, rule[1]);
}
