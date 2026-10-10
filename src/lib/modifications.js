/** Libellés des demandes de modification (partagés entre l'espace client et l'espace équipe). */

export const MODIFICATION_STATUS = {
  SUBMITTED: "Envoyée",
  IN_PROGRESS: "En cours d’étude",
  APPROVED: "Acceptée",
  REJECTED: "Refusée",
  DONE: "Réalisée",
};

export const MODIFICATION_TONE = {
  SUBMITTED: "info",
  IN_PROGRESS: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  DONE: "success",
};

export const PRIORITY = {
  LOW: "Basse",
  NORMAL: "Normale",
  HIGH: "Haute",
  URGENT: "Urgente",
};
