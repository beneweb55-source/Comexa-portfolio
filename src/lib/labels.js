/**
 * Libelles affiches. Trois etats distincts, a ne jamais confondre :
 * - statut de la commande (avancement du projet) ;
 * - etat du paiement (encaissements, independant du statut) ;
 * - statut de la demande de projet.
 */

export const ORDER_STATUS = {
  ORDERED: "Commande reçue",
  IN_REVIEW: "En cours de validation",
  IN_PREPARATION: "En préparation",
  IN_PROGRESS: "Projet en cours",
  COMPLETED: "Terminée",
  CANCELLED: "Annulée",
};

export const PAYMENT_STATUS = {
  UNPAID: "Paiement en attente",
  PARTIALLY_PAID: "Partiellement réglée",
  PAID: "Réglée",
  FAILED: "Échec du paiement",
  REFUNDED: "Remboursée",
};

export const PROJECT_REQUEST_STATUS = {
  NEW: "Nouvelle",
  IN_REVIEW: "En cours d'étude",
  CONVERTED: "Transformée en projet",
  CLOSED: "Close",
};

export const PROJECT_STATUS = {
  DRAFT: "Brouillon",
  PLANNED: "Planifié",
  IN_PROGRESS: "En cours",
  ON_HOLD: "En pause",
  IN_REVIEW: "En revue",
  COMPLETED: "Terminé",
  CANCELLED: "Annulé",
  ARCHIVED: "Archivé",
};

export const MILESTONE_STATUS = {
  PLANNED: "Prévu",
  REACHED: "Atteint",
  MISSED: "En retard",
  CANCELLED: "Annulé",
};

export const TASK_STATUS = {
  TODO: "À faire",
  IN_PROGRESS: "En cours",
  BLOCKED: "Bloquée",
  IN_REVIEW: "En revue",
  DONE: "Terminée",
  CANCELLED: "Annulée",
};

/** Motifs renvoyes par GET /orders/offer quand la commande en ligne n'est pas possible. */
export const OFFER_REASON = {
  COUNTRY_UNKNOWN:
    "Nous ne pouvons pas déterminer le tarif applicable à votre pays. Envoyez une demande de projet : notre équipe revient vers vous.",
  NO_CURRENT_RATE:
    "Aucun tarif en vigueur n'est publié pour ce pack dans votre devise pour le moment. Envoyez une demande de projet.",
  NO_COMPATIBLE_PAYMENT_METHOD:
    "Le paiement en ligne n'est pas encore disponible pour votre pays. Envoyez une demande de projet, nous vous proposerons une solution de règlement.",
};

/** Ce que le client doit faire ensuite, selon le statut et le paiement. */
export function nextStepFor(order) {
  if (order.status === "CANCELLED") return "Cette commande a été annulée. Contactez l'équipe si besoin.";
  if (order.status === "COMPLETED") return "Projet livré. Merci de votre confiance.";
  if (order.status === "ORDERED") {
    return "Notre équipe examine votre commande. Vous serez informé dès sa validation.";
  }
  if (order.status === "IN_REVIEW") return "Votre commande est en cours de validation par notre équipe.";
  if (order.status === "IN_PREPARATION") return "Le projet est en préparation. Son suivi apparaîtra ici.";
  if (order.paymentStatus === "UNPAID" || order.paymentStatus === "PARTIALLY_PAID") {
    return `Règlement à effectuer par ${order.paymentMethod}. Le paiement sera enregistré par l'équipe.`;
  }
  return "Projet en cours. Suivez son avancement ci-dessous.";
}

/**
 * Étapes affichées au client. Une étape n'est « faite » que si le serveur l'a
 * atteinte : « Projet démarré » n'apparaît qu'après le démarrage par l'équipe.
 */
export const ORDER_FLOW = [
  { key: "ORDERED", label: "Commande reçue", state: "Enregistrée" },
  { key: "IN_REVIEW", label: "Validation", state: "Par l'équipe" },
  { key: "IN_PREPARATION", label: "Préparation", state: "Projet créé" },
  { key: "IN_PROGRESS", label: "Projet démarré", state: "En cours" },
  { key: "COMPLETED", label: "Livraison", state: "Terminé" },
];

export function orderFlowStates(status) {
  if (status === "CANCELLED") return null;
  const index = ORDER_FLOW.findIndex((step) => step.key === status);
  return ORDER_FLOW.map((step, position) => ({
    ...step,
    state: position < index ? "done" : position === index ? "current" : "todo",
  }));
}
