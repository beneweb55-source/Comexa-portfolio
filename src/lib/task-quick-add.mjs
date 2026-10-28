/**
 * Saisie rapide déterministe d'une tâche personnelle, en français.
 *
 * Ce module ne devine rien avec un LLM et ne contacte aucune API : il retire
 * seulement des motifs explicites d'une phrase, puis retourne des valeurs que
 * L'UTILISATEUR VOIT ET PEUT MODIFIER avant l'envoi. En cas de conflit ou
 * d'objectif ambigu, aucune valeur n'est imposée : un avertissement demande une
 * correction. Le serveur reste la source de vérité des champs acceptés.
 *
 * Syntaxe volontairement limitée :
 *   - dates : aujourd'hui, demain, après-demain, dans N jours, JJ/MM[/AAAA],
 *     AAAA-MM-JJ, « 12 novembre [2026] » ;
 *   - priorité : « priorité haute », « haute priorité », p1…p4 ;
 *   - durée : « pendant 2 h », « pour 1 h 30 », « durée 90 min » ;
 *   - objectif ACTIF : `#examen-final`, `objectif:examen-final` ou
 *     `objectif:"Examen final"`.
 *
 * Aucun statut, projet, assigné ou récurrence n'est interprété : le carnet
 * personnel de Comexa n'expose pas ces notions à la création.
 */

import { addDaysToDay, dueDateForLocalDay, isIsoDay, isoDayFromParts } from "./day-utils.mjs";
import { localDay } from "./task-status.mjs";

/** Même borne que `CreatePersonalTaskDto` (`MAX_ESTIMATE_MINUTES`). */
export const QUICK_ADD_MAX_ESTIMATE_MINUTES = 60_000;
export const QUICK_ADD_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];

const PRIORITY_LABEL = { LOW: "Basse", NORMAL: "Normale", HIGH: "Haute", URGENT: "Urgente" };

const MONTHS = {
  janvier: 1,
  fevrier: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
};

function fold(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR");
}

function goalKey(value, quoted = false) {
  const cleaned = fold(value).replace(/['’]/g, " ").trim();
  return quoted ? cleaned.replace(/\s+/g, " ") : cleaned.replace(/[^a-z0-9]+/g, "");
}

function formatterDay(day) {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
}

export function formatQuickMinutes(minutes) {
  const value = Math.round(Number(minutes) || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 min";
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function parseDurationText(value) {
  const compact = fold(value).replace(/\s+/g, " ").trim();
  const hours = /^(\d+(?:[.,]\d+)?)\s*(?:h|heures?|hrs?)\s*(?:(\d{1,2})\s*(?:m|min|minutes)?)?$/.exec(compact);
  if (hours) {
    const whole = Number(hours[1].replace(",", "."));
    const extra = Number(hours[2] ?? 0);
    return Math.round(whole * 60) + extra;
  }
  const minutes = /^(\d+(?:[.,]\d+)?)\s*(?:m|min|minutes)$/.exec(compact);
  if (minutes) return Math.round(Number(minutes[1].replace(",", ".")));
  return null;
}

function priorityFromToken(value, shorthand) {
  if (shorthand) return ["URGENT", "HIGH", "NORMAL", "LOW"][Number(shorthand) - 1] ?? null;
  const token = fold(value);
  if (token.startsWith("urgent")) return "URGENT";
  if (token.startsWith("haut")) return "HIGH";
  if (token.startsWith("normal")) return "NORMAL";
  if (token.startsWith("bas")) return "LOW";
  return null;
}

function collectDates(text, baseDay, ranges, warnings) {
  const values = [];
  const push = (match, value, assumption = null) => {
    ranges.push({ start: match.index, end: match.index + match[0].length, field: "date" });
    if (value) values.push({ value, raw: match[0], label: formatterDay(value), assumption });
  };

  const relative = /\b(?:aujourd['’]?hui|apr(?:è|e)s[\s-]demain|demain|dans\s+(\d{1,3})\s+jours?)\b/giu;
  for (const match of text.matchAll(relative)) {
    const token = fold(match[0]);
    let offset = 1;
    if (token.includes("aujourd")) offset = 0;
    else if (token.includes("apres")) offset = 2;
    else if (token.includes("dans")) offset = Number(match[1] ?? 0);
    const value = addDaysToDay(baseDay, offset);
    if (!value) warnings.push(`La date « ${match[0]} » n'a pas pu être calculée.`);
    push(match, value);
  }

  const numeric = /\b(?:le\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/giu;
  for (const match of text.matchAll(numeric)) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const explicitYear = match[3] ? Number(match[3]) : null;
    let year = explicitYear ?? Number(baseDay.slice(0, 4));
    let value = isoDayFromParts(year, month, day);
    let assumption = null;
    if (value && !explicitYear && value < baseDay) {
      year += 1;
      value = isoDayFromParts(year, month, day);
      assumption = `« ${match[0]} » sans année a été comprise comme le ${formatterDay(value)} ${year}.`;
    }
    if (!value) warnings.push(`La date « ${match[0]} » est invalide ; choisissez-la dans le calendrier.`);
    push(match, value, assumption);
  }

  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/giu;
  for (const match of text.matchAll(iso)) {
    const value = isoDayFromParts(Number(match[1]), Number(match[2]), Number(match[3]));
    if (!value) warnings.push(`La date « ${match[0]} » est invalide ; choisissez-la dans le calendrier.`);
    push(match, value);
  }

  const monthNames = Object.keys(MONTHS).join("|");
  const named = new RegExp(`\\b(?:le\\s+)?(\\d{1,2})\\s+(${monthNames})\\.?\\s*(\\d{4})?\\b`, "giu");
  for (const match of text.matchAll(named)) {
    const day = Number(match[1]);
    const month = MONTHS[fold(match[2])];
    const explicitYear = match[3] ? Number(match[3]) : null;
    let year = explicitYear ?? Number(baseDay.slice(0, 4));
    let value = isoDayFromParts(year, month, day);
    let assumption = null;
    if (value && !explicitYear && value < baseDay) {
      year += 1;
      value = isoDayFromParts(year, month, day);
      assumption = `« ${match[0].trim() } » sans année a été comprise comme le ${formatterDay(value)} ${year}.`;
    }
    if (!value) warnings.push(`La date « ${match[0].trim() } » est invalide ; choisissez-la dans le calendrier.`);
    push(match, value, assumption);
  }
  return values;
}

function collectPriorities(text, ranges, warnings) {
  const values = [];
  const pattern = /\b(?:priorit(?:é|e)\s*[:=]?\s*(urgente?|haute?|normal(?:e)?|basse?)|(urgente?|haute?|basse?)\s+priorit(?:é|e)|p([1-4]))\b/giu;
  for (const match of text.matchAll(pattern)) {
    const priority = priorityFromToken(match[1] ?? match[2], match[3]);
    ranges.push({ start: match.index, end: match.index + match[0].length, field: "priority" });
    if (!priority) warnings.push(`La priorité « ${match[0]} » n'a pas été reconnue.`);
    else values.push({ value: priority, raw: match[0], label: PRIORITY_LABEL[priority] });
  }
  return values;
}

function collectDurations(text, ranges, warnings) {
  const values = [];
  const pattern =
    /\b(?:pendant|dur(?:ée|e)e?|pour|prévoir|prevoir|prévu\s+pour|prevu\s+pour|estimation)\s*:?\s*((?:\d+(?:[.,]\d+)?\s*(?:h|heures?|hrs?)(?:\s*\d{1,2}\s*(?:m|min|minutes)?)?)|(?:\d+(?:[.,]\d+)?\s*(?:min|minutes?|m)))/giu;
  for (const match of text.matchAll(pattern)) {
    const minutes = parseDurationText(match[1]);
    ranges.push({ start: match.index, end: match.index + match[0].length, field: "duration" });
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > QUICK_ADD_MAX_ESTIMATE_MINUTES) {
      warnings.push(`L'estimation « ${match[0].trim() } » est invalide : indiquez de 1 à ${QUICK_ADD_MAX_ESTIMATE_MINUTES} min.`);
      continue;
    }
    values.push({ value: minutes, raw: match[0], label: formatQuickMinutes(minutes) });
  }
  return values;
}

function collectGoals(text, goals, ranges, warnings) {
  const active = (Array.isArray(goals) ? goals : []).filter((goal) => goal?.id && goal?.status === "ACTIVE");
  const values = [];
  const pattern = /\b(?:objectif|goal)\s*[:=]\s*(?:"([^"]{1,80})"|([^\s,;:]+))|#([^\s,;:]+)/giu;
  for (const match of text.matchAll(pattern)) {
    const quoted = Boolean(match[1]);
    const candidate = match[1] ?? match[2] ?? match[3];
    const key = goalKey(candidate, quoted);
    const matches = active.filter((goal) => goalKey(goal.title ?? "", quoted) === key);
    ranges.push({ start: match.index, end: match.index + match[0].length, field: "goal" });
    if (matches.length === 1) {
      values.push({ value: matches[0].id, raw: match[0], label: matches[0].title });
    } else if (matches.length > 1) {
      warnings.push(`Plusieurs objectifs actifs correspondent à « ${candidate} » ; choisissez-le dans la liste.`);
    } else {
      warnings.push(`Objectif « ${candidate} » introuvable ou non actif ; choisissez un objectif actif dans la liste.`);
    }
  }
  return values;
}

/** Ne garde qu'une valeur quand toutes les expressions reconnues concordent. */
function settle(values, fieldLabel, warnings) {
  const unique = [...new Set(values.map((entry) => entry.value))];
  if (!unique.length) return null;
  if (unique.length > 1) {
    warnings.push(`Plusieurs ${fieldLabel} différentes sont présentes dans la phrase ; choisissez la bonne valeur avant d'ajouter la tâche.`);
    return null;
  }
  return values.find((entry) => entry.value === unique[0]) ?? null;
}

function cleanTitle(text, ranges) {
  const ordered = [...ranges]
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .filter((range, index, list) => index === 0 || range.start >= list[index - 1].end);
  const pieces = [];
  let cursor = 0;
  for (const range of ordered) {
    if (range.start > cursor) pieces.push(text.slice(cursor, range.start));
    cursor = Math.max(cursor, range.end);
  }
  pieces.push(text.slice(cursor));
  return pieces
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,;:!?.])/g, "$1")
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "")
    .replace(/[,;:]\s*[,;:]/g, ", ")
    .trim();
}

/**
 * @returns {{
 *   title: string,
 *   dueDate: string | null,
 *   priority: string | null,
 *   estimateMinutes: number | null,
 *   goalId: string | null,
 *   detected: Array<{field:string,label:string,value:string}>,
 *   warnings: string[],
 *   assumptions: string[],
 *   hasRecognition: boolean
 * }}
 */
export function parseQuickAddPhrase(input, { now = Date.now(), goals = [] } = {}) {
  const text = typeof input === "string" ? input : "";
  const baseDay = localDay(now) ?? new Date(now).toISOString().slice(0, 10);
  const ranges = [];
  const warnings = [];
  const assumptions = [];

  const dates = collectDates(text, baseDay, ranges, warnings);
  const priorities = collectPriorities(text, ranges, warnings);
  const durations = collectDurations(text, ranges, warnings);
  const goalValues = collectGoals(text, goals, ranges, warnings);

  const date = settle(dates, "dates", warnings);
  const priority = settle(priorities, "priorités", warnings);
  const duration = settle(durations, "durées", warnings);
  const goal = settle(goalValues, "objectifs", warnings);
  if (date?.assumption) assumptions.push(date.assumption);

  const detected = [];
  if (date) detected.push({ field: "dueDate", label: "Échéance", value: date.label, raw: date.raw });
  if (priority) detected.push({ field: "priority", label: "Priorité", value: priority.label, raw: priority.raw });
  if (duration) detected.push({ field: "estimateMinutes", label: "Estimation", value: duration.label, raw: duration.raw });
  if (goal) detected.push({ field: "goalId", label: "Objectif", value: goal.label, raw: goal.raw });

  return {
    title: cleanTitle(text, ranges),
    dueDate: date?.value ?? null,
    priority: priority?.value ?? null,
    estimateMinutes: duration?.value ?? null,
    goalId: goal?.value ?? null,
    detected,
    warnings,
    assumptions,
    hasRecognition: ranges.length > 0,
  };
}

/** Signature stable des valeurs reconnues, pour ne pas écraser une correction manuelle. */
export function quickAddRecognitionKey(parsed) {
  return JSON.stringify([
    parsed?.dueDate ?? null,
    parsed?.priority ?? null,
    parsed?.estimateMinutes ?? null,
    parsed?.goalId ?? null,
  ]);
}

/** Erreur locale avant appel réseau : l'API reste l'autorité, mais on évite un 400 évitable. */
export function quickAddFormError({ title, dueDate, estimateMinutes }) {
  if (String(title ?? "").trim().length < 2) return "Le titre doit contenir au moins 2 caractères.";
  if (String(title ?? "").trim().length > 300) return "Le titre ne doit pas dépasser 300 caractères.";
  if (dueDate && !isIsoDay(dueDate)) return "Choisissez une échéance valide.";
  if (estimateMinutes !== "" && estimateMinutes !== null && estimateMinutes !== undefined) {
    const value = Number(estimateMinutes);
    if (!Number.isInteger(value) || value < 1 || value > QUICK_ADD_MAX_ESTIMATE_MINUTES) {
      return `L'estimation doit être un nombre entier de 1 à ${QUICK_ADD_MAX_ESTIMATE_MINUTES} minutes.`;
    }
  }
  return null;
}

/** Corps exact de `POST /me/tasks` : aucun statut, projet ou assigné inventé. */
export function personalTaskPayload({ title, dueDate, priority, estimateMinutes, goalId }) {
  const payload = {
    title: String(title ?? "").trim(),
    priority: QUICK_ADD_PRIORITIES.includes(priority) ? priority : "NORMAL",
  };
  if (dueDate) payload.dueDate = dueDateForLocalDay(dueDate);
  if (estimateMinutes !== "" && estimateMinutes !== null && estimateMinutes !== undefined) {
    payload.estimateMinutes = Number(estimateMinutes);
  }
  if (goalId) payload.goalId = String(goalId);
  return payload;
}
