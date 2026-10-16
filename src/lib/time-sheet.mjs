/*
 * Feuille de temps — calculs purs de la page « Mon temps » / « Suivi du temps ».
 *
 * Aucune dépendance à React ni à l'API : ces fonctions transforment une liste
 * de saisies (celles que l'API a déjà bornées au périmètre du porteur) en
 * chiffres affichés par les cartes de la page. Testées sous `npm run test:unit`.
 */

import { localDateInputValue } from "./timer-utils.mjs";

/** Jour local d'une saisie (`spentOn` arrive en `AAAA-MM-JJ` ou en ISO complet). */
export function dayOf(entry) {
  return String(entry?.spentOn ?? "").slice(0, 10);
}

/** Minutes saisies un jour donné. */
export function minutesOn(items, day) {
  if (!day) return 0;
  return (items ?? []).reduce(
    (sum, entry) => (dayOf(entry) === day ? sum + (Number(entry.minutes) || 0) : sum),
    0,
  );
}

/** Jour décalé de `delta` jours, au format `AAAA-MM-JJ` (heure locale). */
export function shiftDay(day, delta) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? "")) return "";
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + Number(delta || 0));
  return localDateInputValue(date);
}

/** Jours distincts représentés dans la liste, du plus récent au plus ancien. */
export function daysOf(items) {
  return [...new Set((items ?? []).map(dayOf).filter(Boolean))].sort().reverse();
}

/**
 * Agrégats de la période affichée.
 *
 * `total` et `billable` sont la somme des lignes affichées (donc la même vérité
 * que le tableau), `todayMinutes` isole le jour courant, `days` compte les jours
 * réellement travaillés et `billableRatio` alimente la pastille de la carte.
 */
export function summarizeSheet(items, today) {
  const list = items ?? [];
  let total = 0;
  let billable = 0;
  for (const entry of list) {
    const minutes = Number(entry.minutes) || 0;
    total += minutes;
    if (entry.billable) billable += minutes;
  }
  const days = daysOf(list).length;
  return {
    count: list.length,
    total,
    billable,
    unbillable: total - billable,
    todayMinutes: minutesOn(list, today),
    days,
    billableRatio: total ? Math.round((billable / total) * 100) : 0,
  };
}

/**
 * Libellé de la période : « Aujourd'hui », « Cette semaine », le mois en cours
 * en toutes lettres, ou « Tout l'historique ». Une période inconnue retombe sur
 * la semaine, comme `DEFAULT_TIME_PREFERENCES`.
 */
export function periodLabel(period, now = new Date()) {
  if (period === "today") return "Aujourd’hui";
  if (period === "month") return capitalizeFirst(monthName(now));
  if (period === "all") return "Tout l’historique";
  return "Cette semaine";
}

/** Nom du mois en cours (« octobre » → « Octobre »). */
export function monthName(now = new Date()) {
  return capitalizeFirst(new Intl.DateTimeFormat("fr-FR", { month: "long" }).format(now));
}

/** Libellé de la plage : « 1 oct. 2026 → 16 oct. 2026 », « Toutes les dates »… */
export function rangeLabelOf(range, formatDate = (value) => String(value)) {
  const from = String(range?.from ?? "").slice(0, 10);
  const to = String(range?.to ?? "").slice(0, 10);
  if (!from && !to) return "Toutes les dates";
  return `${from ? formatDate(from) : "depuis le début"} → ${to ? formatDate(to) : "aujourd’hui et après"}`;
}

/** Accords français des pastilles : « 3 saisies · 2 jours ». */
export function countLabel(count, one, many) {
  return `${count} ${count > 1 ? many : one}`;
}

export function capitalizeFirst(value) {
  const text = String(value ?? "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
