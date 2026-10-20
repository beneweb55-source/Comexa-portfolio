/**
 * Espaces de travail : Espace personnel, Espace équipe, Comexa Space.
 *
 * L'espace actif est porté par l'URL (`/espace-personnel`, `/espace-equipe`,
 * `/espace-comexa`) : il survit donc au rechargement, au partage d'un lien et à
 * la navigation arrière, sans état caché. Chaque requête envoyée depuis un
 * espace annonce ce dernier dans l'en-tête `X-Comexa-Space`, et c'est le
 * BACKEND qui restreint alors les droits de la requête (voir
 * `backend/src/common/spaces/space-policy.ts`). Ce fichier n'est qu'un miroir
 * d'affichage de cette politique : il évite un menu vide le temps que
 * `GET /me/spaces` réponde, et sert de repli si l'API ne la connaît pas encore.
 * Il n'est jamais une frontière de sécurité.
 */

export const SPACE_HEADER = "X-Comexa-Space";

export const SPACE_IDS = ["personal", "team", "comexa"];

export const SPACES = {
  personal: {
    id: "personal",
    label: "Espace personnel",
    shortLabel: "Personnel",
    prefix: "/espace-personnel",
    home: "/espace-personnel/tableau-de-bord",
    tone: "green",
    description: "Vos tâches, votre agenda, votre temps et vos rapports.",
  },
  team: {
    id: "team",
    label: "Espace équipe",
    shortLabel: "Équipe",
    prefix: "/espace-equipe",
    home: "/espace-equipe/tableau-de-bord",
    tone: "blue",
    description: "Commercial, facturation, projets et calendrier partagés.",
  },
  comexa: {
    id: "comexa",
    label: "Comexa Space",
    shortLabel: "Comexa",
    prefix: "/espace-comexa",
    home: "/espace-comexa/tableau-de-bord",
    tone: "lilac",
    description: "Site public, membres et rôles, intégrations, audit et paramètres.",
  },
};

/** Espace d'un chemin, ou `null` hors espaces (site public, espace client, connexion). */
export function spaceForPath(pathname) {
  if (typeof pathname !== "string") return null;
  for (const id of SPACE_IDS) {
    const { prefix } = SPACES[id];
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return id;
  }
  return null;
}

/**
 * Chemin équivalent dans un autre espace (même rubrique si elle y existe),
 * sinon l'accueil de cet espace. `/espace-equipe/calendrier` devient
 * `/espace-personnel/calendrier` ; `/espace-equipe/factures` devient l'accueil
 * personnel, faute d'équivalent.
 */
export function equivalentPath(pathname, targetSpace, availableHrefs = []) {
  const target = SPACES[targetSpace];
  if (!target) return "/";
  const current = spaceForPath(pathname);
  if (!current) return target.home;
  const rest = pathname.slice(SPACES[current].prefix.length);
  const section = rest.split("/").filter(Boolean)[0];
  if (!section) return target.home;
  const candidate = `${target.prefix}/${section}`;
  return availableHrefs.includes(candidate) ? candidate : target.home;
}

// ---------------------------------------------------------------------------
// Miroir de la politique serveur
// ---------------------------------------------------------------------------

const PERSONAL_KEEP = new Set([
  "user:read:own",
  "task:read:personal",
  "task:write:personal",
  "task:read:assigned",
  "task:read:own",
  "task:write:own",
  "time:read:own",
  "time:write:own",
  "calendar:read:own",
  "calendar:write:own",
  "notification:read:own",
  "notification:manage:own",
  "dashboard:read:own",
  // Son solde : ce que l'agence lui doit.
  "balance:read:own",
  "project:read:assigned",
  "project:read:own",
]);

const PERSONAL_DOWNGRADE = {
  "task:read:any": "task:read:assigned",
  "task:write:any": "task:write:own",
  "time:read:any": "time:read:own",
  "time:write:any": "time:write:own",
  "dashboard:read:any": "dashboard:read:own",
  "project:read:any": "project:read:assigned",
};

export const COMEXA_ONLY = new Set([
  "user:write:any",
  "user:manage:any",
  "role:manage:any",
  "permission:read:any",
  "audit:read:any",
  "integration:read:any",
  "integration:manage:any",
  "telegram:link:any",
  "setting:write:any",
  "service:write:any",
  "package:write:any",
  "casestudy:write:any",
  "testimonial:write:any",
  "testimonial:moderate:any",
  "partner:write:any",
  "faq:write:any",
  "currency:manage:any",
  "exchangerate:manage:any",
]);

const COMEXA_READS = new Set([
  "user:read:any",
  "user:read:own",
  "role:read:any",
  "setting:read:any",
  "service:read:any",
  "package:read:any",
  "casestudy:read:any",
  "testimonial:read:any",
  "partner:read:any",
  "faq:read:any",
  "notification:read:own",
  "notification:manage:own",
  // Son solde : une donnee « a moi », lisible partout ou l'on ouvre son compte.
  "balance:read:own",
  "currency:read:any",
  "exchangerate:read:any",
]);

const COMEXA_ENTRY = new Set([
  "user:read:any",
  "role:read:any",
  "audit:read:any",
  "integration:read:any",
  "integration:manage:any",
  "setting:read:any",
  "service:read:any",
  "package:read:any",
  "casestudy:read:any",
  "testimonial:read:any",
  "partner:read:any",
  "faq:read:any",
  "currency:read:any",
  "exchangerate:read:any",
]);

const PERSONAL_ONLY = new Set(["task:read:personal", "task:write:personal", "calendar:read:own"]);

const TEAM_ENTRY_PREFIXES = [
  "project:",
  "task:read:any",
  "task:read:assigned",
  "task:write:any",
  "prospect:",
  "client:read:any",
  "quote:read:any",
  "invoice:read:any",
  "order:read:any",
  "project_request:",
  "contactrequest:",
  "calendar:read:team",
  "conversation:",
  "dashboard:read:any",
  "report:",
  "modificationrequest:decide:any",
];

function rolesOf(user) {
  return (user?.roles ?? []).map((role) => (typeof role === "string" ? role : role?.code)).filter(Boolean);
}

/** Droits effectifs d'un espace : même calcul que le serveur. */
export function effectivePermissions(space, permissions = []) {
  const granted = permissions instanceof Set ? permissions : new Set(permissions);
  const out = new Set();
  if (space === "personal") {
    for (const code of granted) {
      if (PERSONAL_KEEP.has(code)) out.add(code);
      if (PERSONAL_DOWNGRADE[code]) out.add(PERSONAL_DOWNGRADE[code]);
    }
  } else if (space === "team") {
    for (const code of granted) {
      if (!COMEXA_ONLY.has(code) && !PERSONAL_ONLY.has(code)) out.add(code);
    }
  } else if (space === "comexa") {
    for (const code of granted) {
      if (COMEXA_ONLY.has(code) || COMEXA_READS.has(code)) out.add(code);
    }
    out.delete("telegram:link:any");
  }
  return out;
}

/** L'espace est-il ouvert à ce compte ? (membre de l'équipe et au moins un outil de l'espace) */
export function canEnterSpace(space, user) {
  const roles = rolesOf(user);
  if (!roles.some((role) => role !== "CLIENT")) return false;
  const effective = effectivePermissions(space, user?.permissions ?? []);
  if (space === "personal") {
    return ["task:read:personal", "task:read:assigned", "task:read:own", "calendar:read:own", "time:read:own", "time:write:own"]
      .some((code) => effective.has(code));
  }
  if (space === "team") {
    return [...effective].some((code) => TEAM_ENTRY_PREFIXES.some((prefix) => code === prefix || code.startsWith(prefix)));
  }
  if (space === "comexa") {
    return [...effective].some((code) => COMEXA_ENTRY.has(code));
  }
  return false;
}

/** Espaces accessibles, dans l'ordre du sélecteur. */
export function accessibleSpaces(user) {
  return SPACE_IDS.filter((space) => canEnterSpace(space, user));
}

// ---------------------------------------------------------------------------
// Dernier espace utilisé (confort : retour au bon espace après connexion)
// ---------------------------------------------------------------------------

const LAST_SPACE_KEY = "comexa:last-space";

export function rememberSpace(userId, space) {
  if (typeof window === "undefined" || !userId || !SPACES[space]) return;
  try {
    window.localStorage.setItem(`${LAST_SPACE_KEY}:${userId}`, space);
  } catch {
    // stockage indisponible : la préférence ne sera simplement pas retenue
  }
}

export function lastSpace(userId) {
  if (typeof window === "undefined" || !userId) return null;
  try {
    const value = window.localStorage.getItem(`${LAST_SPACE_KEY}:${userId}`);
    return SPACES[value] ? value : null;
  } catch {
    return null;
  }
}
