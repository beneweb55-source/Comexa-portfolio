/**
 * CONTRAT D'UNE ÉTAPE DE MISSION — la seule lecture autorisée côté navigateur.
 *
 * Le catalogue serveur décrit une étape avec `navigateTo` (chemin réel) et un
 * indice structuré `hint: { text, docPath }`. L'interface, elle, a longtemps lu
 * `step.page` et affiché `step.hint` comme une chaîne :
 *
 *   - `step.page` n'existe pas → `router.push(undefined)` levait
 *     « Cannot read properties of undefined (reading 'startsWith') » dans le
 *     routeur, et l'étape 1 ne pouvait jamais avancer (le chemin attendu valait
 *     `undefined`, donc la page courante ne correspondait jamais) ;
 *   - `step.hint` est un objet → React refuse de rendre un objet
 *     (« Objects are not valid as a React child »).
 *
 * Ces fonctions centralisent la lecture : un seul endroit à corriger si le
 * contrat évolue, et le serveur PEUT désormais envoyer `page` (forme
 * normalisée) sans casser les anciens catalogues qui n'envoient que
 * `navigateTo`. PURE, testable sans navigateur.
 */

/** Libellés des écrans réels cités par les missions. */
const PAGE_LABELS = {
  "/espace-personnel/taches": "Mes tâches",
  "/espace-personnel/temps": "Mon temps",
  "/espace-personnel/tableau-de-bord": "Mon tableau de bord",
  "/espace-equipe/prospects": "Prospects",
  "/espace-equipe/devis": "Devis",
  "/espace-equipe/projets": "Projets",
  "/espace-equipe/taches": "Tâches de l’équipe",
  "/espace-comexa/contenu": "Contenus",
  "/espace-comexa/membres": "Membres",
  "/espace-client": "Mes devis",
  "/espace-client/modifications": "Mes demandes",
};

/** « /espace-personnel/temps » → « Mon temps ». Repli lisible sinon. */
export function pageLabel(page) {
  if (typeof page !== "string" || !page) return "l’espace de travail";
  const known = PAGE_LABELS[page];
  if (known) return known;
  const last = page.split("/").filter(Boolean).pop();
  if (!last) return "l’espace de travail";
  return last.replace(/-/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

/**
 * Chemin réel d'une étape, ou `null` si le catalogue n'en fournit aucun.
 * JAMAIS `undefined` : tout appelant peut tester `if (!page)` sans planter.
 */
export function stepPage(step, mission) {
  const raw = step?.page ?? step?.navigateTo;
  if (typeof raw === "string" && raw.startsWith("/")) return raw;
  const fallback = mission?.realModuleHref;
  if (typeof fallback === "string" && fallback.startsWith("/")) return fallback;
  return null;
}

/** Texte de l'indice, quel que soit le format servi (chaîne ou objet). */
export function stepHintText(step) {
  const hint = step?.hint;
  if (typeof hint === "string") return hint || null;
  if (hint && typeof hint.text === "string") return hint.text || null;
  return null;
}

/**
 * Indice de l'étape, toujours un entier valide.
 *
 * Un instantané de reprise corrompu (valeur absente, `null`, chaîne, `NaN`)
 * affichait « ÉTAPE NaN SUR 5 ». On borne : jamais négatif, jamais au-delà de la
 * dernière étape.
 */
export function toStepIndex(value, stepCount) {
  const count = Number.isFinite(stepCount) && stepCount > 0 ? Math.floor(stepCount) : 0;
  const index = Number(value);
  if (!Number.isFinite(index)) return 0;
  const bounded = Math.max(0, Math.floor(index));
  return count > 0 ? Math.min(bounded, count - 1) : 0;
}

/** La page courante est-elle la page de l'étape (ou une de ses sous-pages) ? */
export function isOnPage(pathname, page) {
  if (typeof pathname !== "string" || typeof page !== "string" || !page) return false;
  if (pathname === page) return true;
  return pathname.startsWith(`${page.replace(/\/$/, "")}/`);
}
