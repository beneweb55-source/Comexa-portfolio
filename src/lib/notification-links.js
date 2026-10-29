/**
 * Lien d'une notification vers une VRAIE page du frontend.
 *
 * Le serveur enregistre des liens courts, indépendants du frontend
 * (`/factures/:id`, `/taches/:id`, `/espace/messages/:id`, `/admin/projets/:id`…).
 * Aucun n'est une route Next : les suivre tels quels menait à une page 404
 * (bouton « Traiter » du panneau de suivi). On les traduit ici, selon l'espace
 * où l'on se trouve, vers la fiche quand elle existe, sinon vers la liste
 * correspondante, sinon vers la page Notifications de l'espace.
 */

const NOTIFICATIONS_PAGE = {
  personal: "/espace-personnel/notifications",
  team: "/espace-equipe/notifications",
  comexa: "/espace-comexa/notifications",
  client: "/espace-client/notifications",
};

/* [motif du lien serveur, destination(id)] par espace. */
const ROUTES = {
  team: [
    [/^\/factures\/([^/?#]+)/, (id) => `/espace-equipe/factures/${id}`],
    [/^\/devis\/([^/?#]+)/, (id) => `/espace-equipe/devis/${id}`],
    [/^\/(?:admin\/)?projets\/([^/?#]+)/, (id) => `/espace-equipe/projets/${id}`],
    [/^\/clients\/([^/?#]+)/, (id) => `/espace-equipe/clients/${id}`],
    // « Nouvelle piste issue du formulaire de contact » émet une notification
    // SYSTEM avec /prospects/:id. Sans cette route, le lien retombait sur la
    // page Notifications au lieu du prospect concerné.
    [/^\/prospects\/([^/?#]+)/, (id) => `/espace-equipe/prospects/${id}`],
    [/^\/prospects(?:\/|$)/, () => "/espace-equipe/prospects"],
    // La tâche visée s'ouvre dans son projet, sur le tableau (`?tache=`).
    [/^\/taches\/([^/?#]+)/, (id) => `/espace-equipe/taches?tache=${id}`],
    [/^\/taches(?:\/|$)/, () => "/espace-equipe/taches"],
    [/^\/espace\/messages(?:\/|$)/, () => "/espace-equipe/messagerie"],
    [/^\/espace\/demandes(?:\/|$)/, () => "/espace-equipe/modifications"],
    [/^\/admin\/demandes(?:\/|$)/, () => "/espace-equipe/demandes"],
  ],
  personal: [
    // « Une tâche vous est assignée » : la liste s'ouvre sur CETTE tâche.
    [/^\/taches\/([^/?#]+)/, (id) => `/espace-personnel/taches?tache=${id}`],
    [/^\/taches(?:\/|$)/, () => "/espace-personnel/taches"],
  ],
  comexa: [],
  client: [
    [/^\/devis\/([^/?#]+)/, (id) => `/espace-client/devis/${id}`],
    [/^\/projets\/([^/?#]+)/, (id) => `/espace-client/projets/${id}`],
    [/^\/espace\/messages(?:\/|$)/, () => "/espace-client/messagerie"],
    [/^\/espace\/demandes(?:\/|$)/, () => "/espace-client/modifications"],
    // Il n'existe pas de page de détail facture côté client : la destination
    // utile est la liste des factures, pas le tableau de bord generique.
    [/^\/factures(?:\/|$)/, () => "/espace-client/factures"],
  ],
};

/** Espace d'affichage : `personal` | `team` | `comexa` | `client` (booléen historique : vrai = équipe). */
function normalizeArea(area) {
  if (area === true) return "team";
  if (area === false) return "client";
  return NOTIFICATIONS_PAGE[area] ? area : "team";
}

function safeSegment(value) {
  try {
    return encodeURIComponent(decodeURIComponent(value));
  } catch {
    return encodeURIComponent(value);
  }
}

export function notificationsPageFor(area) {
  return NOTIFICATIONS_PAGE[normalizeArea(area)];
}

export function resolveNotificationHref(link, area = "team") {
  const key = normalizeArea(area);
  if (typeof link !== "string" || !link.startsWith("/") || link.startsWith("//")) return NOTIFICATIONS_PAGE[key];
  // Déjà une route du frontend (lien écrit par une version plus récente du serveur).
  if (/^\/espace-(personnel|equipe|comexa|client)(\/|$)/.test(link)) return link;
  for (const [pattern, target] of ROUTES[key]) {
    const match = pattern.exec(link);
    if (match) return target(match[1] ? safeSegment(match[1]) : undefined);
  }
  return NOTIFICATIONS_PAGE[key];
}
