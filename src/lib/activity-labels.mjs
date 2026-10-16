/**
 * Présentation des entrées du fil d'activité des projets.
 *
 * Le serveur écrit ses phrases d'activité en ASCII (« Tache terminee : … »)
 * et y place les statuts bruts de la base (« IN_PROGRESS → COMPLETED »). Ces
 * phrases sont des DONNÉES déjà enregistrées : on ne les réécrit pas. Ce module
 * les AFFICHE en français correct, sans jamais toucher au contenu saisi par
 * l'équipe :
 *
 *  - seuls les mots des gabarits du serveur sont accentués, et uniquement hors
 *    des guillemets « … » et avant le premier « : » (là où commence, dans les
 *    gabarits, le texte libre : titre, nom de fichier, motif de refus) ;
 *  - les statuts bruts d'une transition (« A → B », « A -> B », « A vers B »,
 *    « statut A ») sont traduits avec les libellés de l'interface ;
 *  - une phrase inconnue est rendue telle quelle.
 */

import { INVOICE_STATUS, QUOTE_STATUS } from "./commercial.js";
import { MILESTONE_STATUS, PROJECT_STATUS, TASK_STATUS } from "./labels.js";
import { MODIFICATION_STATUS } from "./modifications.js";

const DOCUMENT_VISIBILITY = { INTERNAL: "Interne", CLIENT: "Client", PUBLIC: "Public" };

/* Mots des gabarits d'activité du serveur (voir `activity.record(...)`). */
const TEMPLATE_WORDS = [
  ["Tache", "Tâche"],
  ["tache", "tâche"],
  ["terminee", "terminée"],
  ["creee", "créée"],
  ["cree", "créé"],
  ["envoyee", "envoyée"],
  ["envoye", "envoyé"],
  ["annulee", "annulée"],
  ["annule", "annulé"],
  ["supprimee", "supprimée"],
  ["supprime", "supprimé"],
  ["ajoute", "ajouté"],
  ["retiree", "retirée"],
  ["retire", "retiré"],
  ["deposee", "déposée"],
  ["depose", "déposé"],
  ["recu", "reçu"],
  ["validee", "validée"],
  ["accepte", "accepté"],
  ["refuse", "refusé"],
  ["etablie", "établie"],
  ["passees", "passées"],
  ["demarre", "démarre"],
  ["quitte", "quitté"],
  ["renomme", "renommé"],
  ["Visibilite", "Visibilité"],
  ["echeance", "échéance"],
  ["desormais", "désormais"],
  ["partagee", "partagée"],
  ["ete", "été"],
  ["depassee", "dépassée"],
  ["orphelin apres", "orphelin après"],
];
const WORD_PATTERN = new RegExp(`(?<![\\p{L}\\p{N}])(${TEMPLATE_WORDS.map(([word]) => word).join("|")})(?![\\p{L}\\p{N}])`, "gu");
const WORD_MAP = Object.fromEntries(TEMPLATE_WORDS);

function statusLabels(message) {
  if (/^(La )?[Tt]ache\b/.test(message)) return TASK_STATUS;
  if (/^(Statut du projet|Le projet)\b/.test(message)) return PROJECT_STATUS;
  if (/^Jalon\b/.test(message)) return MILESTONE_STATUS;
  if (/^Visibilite du document\b/.test(message)) return DOCUMENT_VISIBILITY;
  if (/^Demande de modification\b/.test(message)) return MODIFICATION_STATUS;
  if (/^Facture\b/.test(message)) return INVOICE_STATUS;
  if (/^Devis\b/.test(message)) return QUOTE_STATUS;
  return { ...QUOTE_STATUS, ...INVOICE_STATUS, ...MILESTONE_STATUS, ...TASK_STATUS, ...PROJECT_STATUS };
}

/** Accentue les mots de gabarit d'un segment (jamais le texte entre guillemets). */
function accentTemplate(segment) {
  return segment
    .split(/(«[^»]*»)/u)
    .map((part) => (part.startsWith("«") ? part : part.replace(WORD_PATTERN, (word) => WORD_MAP[word] ?? word)))
    .join("");
}

/** Phrase d'activité lisible (français accentué, statuts traduits). */
export function activitySentence(message) {
  if (typeof message !== "string" || !message) return "";
  const labels = statusLabels(message);
  const label = (code) => labels[code] ?? code;

  // Seul gabarit dont le texte après « : » appartient encore au serveur.
  const overdue = /^Facture (\S+) en retard : l'echeance de paiement est depassee\.$/.exec(message);
  if (overdue) return `Facture ${overdue[1]} en retard : l’échéance de paiement est dépassée.`;

  const colon = message.indexOf(" : ");
  const head = colon === -1 ? message : message.slice(0, colon);
  const tail = colon === -1 ? "" : message.slice(colon);

  return `${accentTemplate(head)}${tail}`
    .replace(/\b([A-Z][A-Z_]{2,})(\s*)(→|->|vers)(\s*)([A-Z][A-Z_]{2,})\b/g, (_, from, s1, arrow, s2, to) => `${label(from)}${s1}${arrow === "->" ? "→" : arrow}${s2}${label(to)}`)
    .replace(/\bstatut ([A-Z][A-Z_]{2,})\b/g, (_, code) => `statut ${label(code)}`);
}
