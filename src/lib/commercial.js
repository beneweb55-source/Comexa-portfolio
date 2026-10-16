/**
 * Libellés et règles du cycle commercial : demande de contact → prospect → devis → facture → paiement.
 * Un seul endroit pour les statuts, pour que l'espace équipe et l'espace client disent la même chose.
 */

export const CONTACT_STATUS = {
  NEW: "Nouvelle",
  IN_REVIEW: "En cours d'étude",
  CONVERTED: "Transformée en prospect",
  SPAM: "Spam",
  ARCHIVED: "Archivée",
};
export const CONTACT_STATUS_TONE = { NEW: "info", IN_REVIEW: "warning", CONVERTED: "success", SPAM: "neutral", ARCHIVED: "neutral" };

export const PROSPECT_STATUS = {
  NEW: "Nouveau",
  CONTACTED: "Contacté",
  QUALIFIED: "Qualifié",
  PROPOSAL_SENT: "Devis envoyé",
  NEGOTIATION: "Négociation",
  WON: "Gagné",
  LOST: "Perdu",
};
export const PROSPECT_STATUS_TONE = { NEW: "info", CONTACTED: "info", QUALIFIED: "warning", PROPOSAL_SENT: "warning", NEGOTIATION: "warning", WON: "success", LOST: "neutral" };

export const PROSPECT_SOURCE = {
  WEBSITE: "Site web",
  CONTACT_FORM: "Formulaire de contact",
  REFERRAL: "Recommandation",
  LINKEDIN: "LinkedIn",
  COLD_CALL: "Prospection",
  EVENT: "Événement",
  PARTNER: "Partenaire",
  OTHER: "Autre",
};

export const QUOTE_STATUS = {
  DRAFT: "Brouillon",
  SENT: "Envoyé",
  VIEWED: "Consulté",
  ACCEPTED: "Accepté",
  REJECTED: "Refusé",
  EXPIRED: "Expiré",
  CANCELLED: "Annulé",
};
export const QUOTE_STATUS_TONE = { DRAFT: "neutral", SENT: "info", VIEWED: "info", ACCEPTED: "success", REJECTED: "danger", EXPIRED: "neutral", CANCELLED: "neutral" };

export const INVOICE_STATUS = {
  DRAFT: "Brouillon",
  SENT: "Envoyée",
  PARTIALLY_PAID: "Partiellement réglée",
  PAID: "Réglée",
  OVERDUE: "En retard",
  CANCELLED: "Annulée",
  REFUNDED: "Remboursée",
};
export const INVOICE_STATUS_TONE = { DRAFT: "neutral", SENT: "info", PARTIALLY_PAID: "warning", PAID: "success", OVERDUE: "danger", CANCELLED: "neutral", REFUNDED: "neutral" };

export const PAYMENT_METHOD = {
  BANK_TRANSFER: "Virement bancaire",
  CARD: "Carte",
  CASH: "Espèces",
  CHECK: "Chèque",
  PAYPAL: "PayPal",
  CCP: "CCP (Algérie Poste)",
  BARIDIMOB: "BaridiMob",
  OTHER: "Autre",
};

export const PAYMENT_RECORD_STATUS = {
  PENDING: "En attente",
  SUCCEEDED: "Encaissé",
  FAILED: "Échoué",
  REFUNDED: "Remboursé",
};

/** Un devis peut être accepté ou refusé par le client tant qu'il n'a pas été tranché. */
export const QUOTE_OPEN_STATUSES = ["SENT", "VIEWED"];

/**
 * Destinataire d'un devis : le client s'il existe, sinon le prospect (signalé
 * comme tel). Même libellé dans la liste des devis et sur le tableau de bord.
 */
export function quoteRecipient(quote, fallback = "Destinataire non renseigné") {
  if (quote?.client?.companyName) return quote.client.companyName;
  if (quote?.prospect) {
    const name =
      quote.prospect.companyName ||
      [quote.prospect.contactFirstName, quote.prospect.contactLastName].filter(Boolean).join(" ") ||
      quote.prospect.email;
    if (name) return `${name} (prospect)`;
  }
  return fallback;
}

/** Montant restant à régler sur une facture (saisi par chaîne côté API). */
export function remainingDue(invoice) {
  const total = Number(invoice?.total ?? 0);
  const paid = Number(invoice?.amountPaid ?? 0);
  return Math.max(0, Math.round((total - paid) * 100) / 100);
}

/** Total d'une ligne de devis (même règle que le serveur : quantité × prix × (1 - remise)). */
export function lineTotal({ quantity, unitPrice, discountPercent }) {
  const q = Number(quantity) || 0;
  const p = Number(unitPrice) || 0;
  const d = Number(discountPercent) || 0;
  return Math.round(q * p * (1 - d / 100) * 100) / 100;
}

/** Date au format attendu par les champs `type="date"` (AAAA-MM-JJ). */
export function toDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

/** Ajoute `days` jours à aujourd'hui, au format AAAA-MM-JJ. */
export function daysFromToday(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Transitions autorisées du pipeline prospects. MIROIR de
 * `backend/src/modules/prospects/lead-pipeline.ts` : il sert seulement à griser
 * les cartes et à proposer les bonnes étapes. Le serveur reste la seule référence
 * et refuse toute transition absente de sa table (422).
 */
export const PROSPECT_TRANSITIONS = {
  NEW: ["CONTACTED", "QUALIFIED", "LOST"],
  CONTACTED: ["QUALIFIED", "PROPOSAL_SENT", "NEGOTIATION", "LOST"],
  QUALIFIED: ["PROPOSAL_SENT", "NEGOTIATION", "LOST"],
  PROPOSAL_SENT: ["NEGOTIATION", "WON", "LOST"],
  NEGOTIATION: ["PROPOSAL_SENT", "WON", "LOST"],
  WON: [],
  LOST: ["NEW"],
};

/** Colonnes du tableau, dans l'ordre du pipeline. Chaque statut a sa colonne : aucune fiche ne disparaît. */
export const PROSPECT_COLUMNS = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST"];
