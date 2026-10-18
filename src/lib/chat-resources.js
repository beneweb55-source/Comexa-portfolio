/**
 * RESSOURCES PARTAGEES DANS LE CHAT — catalogue partageable.
 *
 * Ce fichier est le MIROIR FRONTEND d'une regle ecrite cote serveur
 * (`backend/src/modules/messaging/shared-resource-card.ts`). Il sait trois
 * choses, et rien d'autre :
 *
 *  1. CE QUI PEUT ETRE PARTAGE. Une ressource = un type + un identifiant
 *     interne. Jamais une URL, jamais un texte copie : un renommage ne casse
 *     pas la carte, un deplacement de page ne casse pas le lien.
 *
 *  2. OU LA RECHERCHER, ET SI ON EN A LE DROIT. Chaque type declare l'ENDPOINT
 *     DE LISTE DEJA UTILISE par sa rubrique du dashboard (`/projects?search=`,
 *     `/invoices?search=`…) et la PERMISSION qui l'ouvre. Le picker n'invente
 *     aucune route : ce qu'il montre, le dashboard peut deja le montrer.
 *     Absence de droit = source retiree de l'interface, pas une requete 403
 *     a afficher comme un bug.
 *
 *  3. COMMENT LA NOMMER. Les libelles de statut sont repris des cartes
 *     existantes (`labels.js`, `commercial.js`) — la messagerie ne cree pas un
 *     deuxieme vocabulaire FR. Les liens courts suivent la grammaire des
 *     notifications (`/projets/:id`…) et passent par `resolveNotificationHref`
 *     : l'espace courant (equipe, personnel, client) decide de la destination.
 */

import { resolveNotificationHref } from "./notification-links.js";

/** Types partageables — memes cles que l'enum `SharedResourceType` cote API. */
export const SHARED_RESOURCE_META = {
  PROJECT: { label: "Projet", tone: "blue" },
  TASK: { label: "Tâche", tone: "green" },
  CLIENT: { label: "Client", tone: "lilac" },
  QUOTE: { label: "Devis", tone: "yellow" },
  INVOICE: { label: "Facture", tone: "pink" },
  PAYMENT: { label: "Paiement", tone: "plain" },
  DOCUMENT: { label: "Document", tone: "plain" },
};

export const SHARED_RESOURCE_TYPES = Object.keys(SHARED_RESOURCE_META);

export function resourceTypeLabel(type) {
  return SHARED_RESOURCE_META[type]?.label ?? "Ressource";
}

/**
 * Libelles de statut par type. On REUTILISE les tables des rubriques concernees
 * (un seul FR pour tout Comexa) ; les seules tables absentes du projet (le
 * statut d'un paiement au sens `PaymentStatus`, les dossiers clients) sont
 * definies ici, dans la meme grammaire.
 */
export const RESOURCE_STATUS_LABELS = {
  PROJECT: {
    DRAFT: "Brouillon",
    PLANNED: "Planifié",
    IN_PROGRESS: "En cours",
    ON_HOLD: "En pause",
    IN_REVIEW: "En revue",
    COMPLETED: "Terminé",
    CANCELLED: "Annulé",
    ARCHIVED: "Archivé",
  },
  TASK: {
    TODO: "À faire",
    IN_PROGRESS: "En cours",
    BLOCKED: "Bloquée",
    IN_REVIEW: "En revue",
    DONE: "Terminée",
    CANCELLED: "Annulée",
  },
  CLIENT: {
    ACTIVE: "Actif",
    INACTIVE: "Inactif",
    ARCHIVED: "Archivé",
  },
  QUOTE: {
    DRAFT: "Brouillon",
    SENT: "Envoyé",
    VIEWED: "Consulté",
    ACCEPTED: "Accepté",
    REJECTED: "Refusé",
    EXPIRED: "Expiré",
    CANCELLED: "Annulé",
  },
  INVOICE: {
    DRAFT: "Brouillon",
    SENT: "Envoyée",
    PARTIALLY_PAID: "Partiellement réglée",
    PAID: "Réglée",
    OVERDUE: "En retard",
    CANCELLED: "Annulée",
    REFUNDED: "Remboursée",
  },
  PAYMENT: {
    PENDING: "En attente",
    SUCCEEDED: "Encaissé",
    FAILED: "Échoué",
    REFUNDED: "Remboursé",
  },
};

/** Tonalite de la pilule de statut, par type puis par statut. */
export const RESOURCE_STATUS_TONES = {
  PROJECT: { DRAFT: "neutral", PLANNED: "info", IN_PROGRESS: "info", ON_HOLD: "warning", IN_REVIEW: "warning", COMPLETED: "success", CANCELLED: "neutral", ARCHIVED: "neutral" },
  TASK: { TODO: "neutral", IN_PROGRESS: "info", BLOCKED: "danger", IN_REVIEW: "warning", DONE: "success", CANCELLED: "neutral" },
  CLIENT: { ACTIVE: "success", INACTIVE: "neutral", ARCHIVED: "neutral" },
  QUOTE: { DRAFT: "neutral", SENT: "info", VIEWED: "info", ACCEPTED: "success", REJECTED: "danger", EXPIRED: "neutral", CANCELLED: "neutral" },
  INVOICE: { DRAFT: "neutral", SENT: "info", PARTIALLY_PAID: "warning", PAID: "success", OVERDUE: "danger", CANCELLED: "neutral", REFUNDED: "neutral" },
  PAYMENT: { PENDING: "warning", SUCCEEDED: "success", FAILED: "danger", REFUNDED: "neutral" },
};

export function resourceStatusLabel(type, statusKey) {
  if (!statusKey) return null;
  return RESOURCE_STATUS_LABELS[type]?.[statusKey] ?? statusKey;
}

export function resourceStatusTone(type, statusKey) {
  if (!statusKey) return "neutral";
  return RESOURCE_STATUS_TONES[type]?.[statusKey] ?? "neutral";
}

/** Cle unique d'une ressource : `TYPE:id`, identique a la cle du serveur. */
export function resourceKey(ref) {
  return `${ref.resourceType}:${ref.resourceId}`;
}

/** Deduplique une liste de references, dans l'ordre. */
export function dedupeResourceRefs(refs) {
  const seen = new Set();
  const out = [];
  for (const ref of refs ?? []) {
    if (!ref?.resourceType || !ref?.resourceId) continue;
    const key = resourceKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ resourceType: ref.resourceType, resourceId: ref.resourceId });
  }
  return out;
}

/**
 * Ou le picker cherche, et pour qui.
 *
 * Chaque source pointe l'ENDPOINT DE LISTE de sa rubrique — le picker n'ouvre
 * donc jamais une porte que le dashboard n'ouvre pas : le serveur filtre les
 * lignes selon le porteur, comme partout ailleurs. La permission listee est le
 * DROIT D'ENTREE de la rubrique ; sans lui, la source n'est pas proposee.
 */
export const RESOURCE_SEARCH_SOURCES = [
  {
    type: "PROJECT",
    permissions: ["project:read:any", "project:read:assigned", "project:read:own"],
    path: (term) => `/projects?perPage=5&search=${encodeURIComponent(term)}`,
    mapRow: (row) => ({
      title: row.name,
      subtitle: row.client?.companyName ?? null,
      statusKey: row.status ?? null,
    }),
  },
  {
    type: "TASK",
    permissions: ["task:read:any", "task:read:assigned", "task:read:own", "task:read:personal"],
    // La route des taches du porteur est `GET /me/tasks` (toutes les taches
    // qui lui sont assignees, tous projets confondus). L'ecriture precedente
    // `/projects/me/tasks` ne correspondait a aucune route du controleur : le
    // picker renvoyait un 404 et la source « Tache » etait donc muette.
    path: (term) => `/me/tasks?perPage=5&search=${encodeURIComponent(term)}`,
    mapRow: (row) => ({
      title: row.title,
      subtitle: row.project?.name ?? null,
      statusKey: row.status ?? null,
    }),
  },
  {
    type: "CLIENT",
    permissions: ["client:read:any"],
    path: (term) => `/clients?perPage=5&search=${encodeURIComponent(term)}`,
    mapRow: (row) => ({
      title: row.companyName,
      subtitle: null,
      statusKey: row.status ?? null,
    }),
  },
  {
    type: "QUOTE",
    permissions: ["quote:read:any", "quote:read:own"],
    path: (term) => `/quotes?perPage=5&search=${encodeURIComponent(term)}`,
    mapRow: (row) => ({
      title: `${row.reference} — ${row.subject ?? "Devis"}`,
      subtitle: row.client?.companyName ?? null,
      statusKey: row.status ?? null,
    }),
  },
  {
    type: "INVOICE",
    permissions: ["invoice:read:any", "invoice:read:own"],
    path: (term) => `/invoices?perPage=5&search=${encodeURIComponent(term)}`,
    mapRow: (row) => ({
      title: row.reference,
      subtitle: row.client?.companyName ?? null,
      statusKey: row.status ?? null,
    }),
  },
  {
    type: "DOCUMENT",
    permissions: ["document:read:any", "document:read:own", "document:read:client"],
    path: (term) => `/documents?perPage=5&search=${encodeURIComponent(term)}`,
    mapRow: (row) => ({
      title: row.name,
      subtitle: row.sizeBytes ? `${Math.round(row.sizeBytes / 1024)} Ko` : null,
      statusKey: null,
    }),
  },
];

/** Les sources accessibles a CE porteur (au moins une permission sur la liste). */
export function searchableResourceSources(user) {
  const permissions = new Set(user?.permissions ?? []);
  return RESOURCE_SEARCH_SOURCES.filter((source) =>
    source.permissions.some((permission) => permissions.has(permission)),
  );
}

/**
 * Ou la carte mene quand on clique dessus.
 *
 * Le lien vient de la REPONSE DU SERVEUR (resolu dans le perimetre du
 * lecteur), sous sa forme courte de notification ; la destination concrete
 * depend de l'espace ou l'on est. Une ressource `available: false` n'a pas de
 * destination : la carte reste muette.
 */
export function resourceHref(card, area) {
  if (!card?.available || !card.link) return null;
  return resolveNotificationHref(card.link, area);
}
