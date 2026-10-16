import assert from "node:assert/strict";
import test from "node:test";
import {
  capitalizeFirst,
  countLabel,
  dayOf,
  daysOf,
  minutesOn,
  monthName,
  periodLabel,
  rangeLabelOf,
  shiftDay,
  summarizeSheet,
} from "./time-sheet.mjs";

const ENTRIES = [
  { id: "a", spentOn: "2026-10-16", minutes: 95, billable: true },
  { id: "b", spentOn: "2026-10-16T08:30:00.000Z", minutes: 45, billable: true },
  { id: "c", spentOn: "2026-10-15", minutes: 30, billable: false },
  { id: "d", spentOn: "2026-10-13", minutes: 60, billable: true },
];

test("dayOf : jour local, même si l'API renvoie un ISO complet", () => {
  assert.equal(dayOf({ spentOn: "2026-10-16" }), "2026-10-16");
  assert.equal(dayOf({ spentOn: "2026-10-16T08:30:00.000Z" }), "2026-10-16");
  assert.equal(dayOf(null), "");
});

test("minutesOn : additionne le jour demandé, jamais les voisins", () => {
  assert.equal(minutesOn(ENTRIES, "2026-10-16"), 140);
  assert.equal(minutesOn(ENTRIES, "2026-10-15"), 30);
  assert.equal(minutesOn(ENTRIES, "2026-10-14"), 0);
  assert.equal(minutesOn(ENTRIES, ""), 0);
  assert.equal(minutesOn(undefined, "2026-10-16"), 0);
});

test("shiftDay : décale au jour près, refuse une date invalide", () => {
  assert.equal(shiftDay("2026-10-16", -6), "2026-10-10");
  assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftDay("2026-01-01", -1), "2025-12-31");
  assert.equal(shiftDay("", -1), "");
  assert.equal(shiftDay("16/10/2026", -1), "");
});

test("daysOf : jours distincts, du plus récent au plus ancien", () => {
  assert.deepEqual(daysOf(ENTRIES), ["2026-10-16", "2026-10-15", "2026-10-13"]);
  assert.deepEqual(daysOf([]), []);
});

test("summarizeSheet : les cartes et le tableau lisent la même vérité", () => {
  const summary = summarizeSheet(ENTRIES, "2026-10-16");
  assert.equal(summary.count, 4);
  assert.equal(summary.total, 230);
  assert.equal(summary.billable, 200);
  assert.equal(summary.unbillable, 30);
  assert.equal(summary.todayMinutes, 140);
  assert.equal(summary.days, 3);
  assert.equal(summary.billableRatio, 87);
});

test("summarizeSheet : une liste vide ne divise pas par zéro", () => {
  const summary = summarizeSheet([], "2026-10-16");
  assert.deepEqual(
    { count: summary.count, total: summary.total, ratio: summary.billableRatio },
    { count: 0, total: 0, ratio: 0 },
  );
  assert.equal(summarizeSheet(undefined, "2026-10-16").total, 0);
});

test("periodLabel : nomme la période telle qu'elle est lue à l'écran", () => {
  const now = new Date("2026-10-16T12:00:00");
  assert.equal(periodLabel("today", now), "Aujourd’hui");
  assert.equal(periodLabel("week", now), "Cette semaine");
  assert.equal(periodLabel("month", now), "Octobre");
  assert.equal(periodLabel("all", now), "Tout l’historique");
  // Période inconnue : repli sur la semaine (même défaut que les préférences).
  assert.equal(periodLabel("trimestre", now), "Cette semaine");
  assert.equal(monthName(now), "Octobre");
});

test("rangeLabelOf : plage ouverte, plage fermée, aucune borne", () => {
  const format = (value) => value;
  assert.equal(rangeLabelOf({ from: "", to: "" }, format), "Toutes les dates");
  assert.equal(rangeLabelOf({ from: "2026-10-01", to: "2026-10-16" }, format), "2026-10-01 → 2026-10-16");
  assert.equal(rangeLabelOf({ from: "", to: "2026-10-16" }, format), "depuis le début → 2026-10-16");
  assert.equal(rangeLabelOf({ from: "2026-10-01", to: "" }, format), "2026-10-01 → aujourd’hui et après");
  assert.equal(rangeLabelOf(null, format), "Toutes les dates");
});

test("countLabel / capitalizeFirst : accords et majuscule initiale", () => {
  assert.equal(countLabel(1, "saisie", "saisies"), "1 saisie");
  assert.equal(countLabel(3, "saisie", "saisies"), "3 saisies");
  assert.equal(countLabel(0, "jour", "jours"), "0 jour");
  assert.equal(capitalizeFirst("octobre"), "Octobre");
  assert.equal(capitalizeFirst(""), "");
});
