/**
 * « RÉPARTITION & SOLDES » — LE VOCABULAIRE COMMUN.
 *
 * Les bases, les types de bénéficiaire et les natures d'opération sont
 * énumérés ICI, une fois, et nulle part ailleurs. Une constante dupliquée
 * dans deux écrans finit toujours par diverger : l'un affiche « Montant
 * encaissé », l'autre « Encaissé », et l'utilisateur ne sait plus s'il
 * regarde la même chose.
 *
 * Les libellés ne sont pas décoratifs : ils disent ce que la base PRODUIT.
 * « Montant facturé » et « Montant encaissé » ne sont pas deux façons de
 * dire la même chose — l'un est une promesse, l'autre de l'argent.
 */

/** Les bases de calcul (`DistributionBaseType`). */
export const BASE_TYPES = [
  {
    value: "COLLECTED_AMOUNT",
    label: "Montant encaissé",
    short: "Encaissé",
    hint: "La part est calculée sur ce qui est réellement rentré : paiements réussis, acomptes et soldes comptés une fois chacun.",
  },
  {
    value: "INVOICED_AMOUNT",
    label: "Montant facturé",
    short: "Facturé",
    hint: "La part suit la facturation, encaissée ou non. Une facture émise n’est pas un paiement.",
  },
  {
    value: "PROJECT_AMOUNT",
    label: "Montant du projet",
    short: "Projet",
    hint: "La part suit le budget contractuel du projet, indépendamment de la facturation.",
  },
];

/** Les types de bénéficiaire (`BeneficiaryType`). */
export const BENEFICIARY_TYPES = [
  { value: "MEMBER", label: "Membre de l’équipe", needsMember: true },
  { value: "COMPANY", label: "Comexa", needsMember: false },
  { value: "RESERVE", label: "Réserve", needsMember: false },
];

/** Les natures d'opération de solde (`BalanceTransactionKind`). */
export const OPERATION_KINDS = [
  { value: "PAYMENT", label: "Versement", hint: "De l’argent remis au membre : son solde diminue." },
  { value: "ADVANCE", label: "Avance", hint: "De l’argent versé avant que la part ne soit acquise." },
  { value: "ADJUSTMENT", label: "Ajustement", hint: "Correction manuelle, dans un sens ou dans l’autre." },
  { value: "CORRECTION", label: "Correction", hint: "Contre-passation d’une opération déjà validée." },
  { value: "REGULARIZATION", label: "Régularisation", hint: "Écart entre deux règles de répartition." },
];

/** La base utilisée par défaut quand rien n'est précisé. */
export const DEFAULT_BASE = "COLLECTED_AMOUNT";

/** Le libellé d'une base, à partir de sa valeur. */
export function baseLabel(value) {
  return BASE_TYPES.find((entry) => entry.value === value)?.label ?? "Montant encaissé";
}

/** Le libellé d'une nature d'opération. */
export function kindLabel(value) {
  return OPERATION_KINDS.find((entry) => entry.value === value)?.label ?? "Opération";
}

/**
 * Somme des pourcentages, en nombre.
 *
 * Le pourcentage est lu comme une CHAÎNE : `Number("33.33")` puis
 * `toString()` peut rendre `33.330000000000002`, et la somme ne ferait plus
 * 100. La virgule est acceptée (saisie française).
 */
export function totalPercentage(rows) {
  return rows.reduce((sum, row) => {
    const value = Number(String(row?.percentage ?? "").replace(",", "."));
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
}

/** Le total est-il exactement 100 % ? */
export function isBalanced(rows) {
  return Math.abs(totalPercentage(rows) - 100) < 0.0001;
}

/** Un pourcentage, formaté à la française. */
export function formatPercent(value) {
  const number = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(number)) return "—";
  return `${number.toFixed(2).replace(".", ",")} %`;
}

/** Un montant, sans devise : la devise est affichee a cote. */
export function formatAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** La date du jour, au format `AAAA-MM-JJ` (les `<input type="date">`). */
export function today() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/** Une date dans le futur, pour une date d'effet. */
export function inDays(days) {
  const now = new Date();
  const local = new Date(now.getTime() + days * 86_400_000 - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
