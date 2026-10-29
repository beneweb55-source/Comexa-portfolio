/**
 * Mission 3 — garde-fous de la première tranche « Espace équipe ».
 *
 * Deux familles de tests :
 *  - des fonctions pures (projection Kanban, attention commerciale) ;
 *  - un contrat de source : l'ancien écran ne doit pas pouvoir passer pour le
 *    nouveau. Avec `COMEXA_TEST_SOURCE_ROOT` pointant sur les fichiers de HEAD,
 *    ces tests-ci doivent échouer — c'est la preuve que le changement est
 *    réellement testé, pas seulement documenté.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  KANBAN_COLUMNS,
  kanbanColumnOf,
  kanbanStatusLabel,
  kanbanStatusOptions,
  splitKanbanTasks,
} from "../src/lib/kanban-board.mjs";
import {
  QUOTE_FOLLOWUP_WINDOW_DAYS,
  quoteFollowup,
  quotesNeedingFollowup,
} from "../src/lib/quote-attention.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ROOT = process.env.COMEXA_TEST_SOURCE_ROOT ?? REPO_ROOT;
const NOW = Date.parse("2026-10-28T10:00:00.000Z");

function day(offset) {
  const date = new Date(NOW);
  date.setUTCDate(date.getUTCDate() + offset);
  return `${date.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

async function source(relativePath) {
  return readFile(join(SOURCE_ROOT, relativePath), "utf8");
}

test("Kanban : BLOCKED est une tâche réelle affichée dans la colonne En cours", () => {
  assert.equal(kanbanColumnOf("BLOCKED"), "IN_PROGRESS");
  assert.equal(kanbanColumnOf("TODO"), "TODO");
  assert.equal(kanbanColumnOf("DONE"), "DONE");
  assert.equal(kanbanColumnOf("CANCELLED"), null);
  assert.equal(kanbanColumnOf("UNKNOWN_FUTURE_STATUS"), null);
  assert.deepEqual(KANBAN_COLUMNS.map((column) => column.id), ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"]);
  assert.equal(kanbanStatusLabel("CANCELLED"), "Annulée");
});

test("Kanban : les statuts hors colonnes ne sont plus invisibles", () => {
  const result = splitKanbanTasks([
    { id: "todo", status: "TODO" },
    { id: "blocked", status: "BLOCKED" },
    { id: "done", status: "DONE" },
    { id: "cancelled", status: "CANCELLED" },
    { id: "future", status: "UNKNOWN_FUTURE_STATUS" },
  ]);
  assert.deepEqual(result.columns.TODO.map((task) => task.id), ["todo"]);
  assert.deepEqual(result.columns.IN_PROGRESS.map((task) => task.id), ["blocked"]);
  assert.deepEqual(result.columns.DONE.map((task) => task.id), ["done"]);
  assert.deepEqual(result.others.map((task) => task.id), ["cancelled", "future"]);
  assert.equal(result.columns.TODO.length + result.columns.IN_PROGRESS.length + result.columns.IN_REVIEW.length + result.columns.DONE.length + result.others.length, 5);
});

test("Kanban : le select n'offre que les transitions backend des tâches de projet", () => {
  const values = (status, writable = true) => kanbanStatusOptions({ status }, writable).map((option) => option.value);
  assert.deepEqual(values("TODO"), ["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"]);
  assert.deepEqual(values("BLOCKED"), ["BLOCKED", "TODO", "IN_PROGRESS", "CANCELLED"]);
  assert.deepEqual(values("IN_REVIEW"), ["IN_REVIEW", "IN_PROGRESS", "DONE"]);
  assert.deepEqual(values("DONE"), ["DONE", "IN_PROGRESS"]);
  assert.deepEqual(values("CANCELLED"), ["CANCELLED", "TODO"]);
  assert.deepEqual(values("TODO", false), ["TODO"]);
  assert.deepEqual(values("UNKNOWN_FUTURE_STATUS"), ["UNKNOWN_FUTURE_STATUS"]);
  assert.equal(kanbanStatusOptions({ status: "TODO" }, true)[0].current, true);
  assert.equal(kanbanStatusOptions({ status: "TODO" }, true)[1].label, "En cours");
});

test("Devis : l'attention ne concerne que les devis envoyés ou consultés, dans la fenêtre de 3 jours", () => {
  assert.equal(QUOTE_FOLLOWUP_WINDOW_DAYS, 3);
  assert.deepEqual(
    quoteFollowup({ status: "SENT", validUntil: day(0) }, NOW)?.label,
    "Expire aujourd’hui",
  );
  assert.deepEqual(
    quoteFollowup({ status: "VIEWED", validUntil: day(1) }, NOW)?.label,
    "Expire demain",
  );
  assert.deepEqual(
    quoteFollowup({ status: "SENT", validUntil: day(3) }, NOW)?.label,
    "Expire dans 3 jours",
  );
  assert.equal(quoteFollowup({ status: "SENT", validUntil: day(4) }, NOW), null);
  assert.equal(quoteFollowup({ status: "SENT", validUntil: day(-1) }, NOW), null);
  assert.equal(quoteFollowup({ status: "DRAFT", validUntil: day(0) }, NOW), null);
  assert.equal(quoteFollowup({ status: "ACCEPTED", validUntil: day(0) }, NOW), null);
  assert.equal(quoteFollowup({ status: "EXPIRED", validUntil: day(-1) }, NOW), null);
  assert.equal(quoteFollowup({ status: "SENT", validUntil: null }, NOW), null);
  assert.equal(quoteFollowup({ status: "SENT", validUntil: "date-invalide" }, NOW), null);
});

test("Devis : la validité du dernier jour reste inclusive jusqu'à la fin du jour UTC", () => {
  assert.ok(quoteFollowup({ status: "SENT", validUntil: day(0) }, Date.parse("2026-10-28T23:59:00.000Z")));
  // Le statut EXPIRED renvoyé par l'API n'est jamais remis en cause ici.
  assert.equal(quoteFollowup({ status: "EXPIRED", validUntil: day(-1) }, Date.parse("2026-10-29T00:01:00.000Z")), null);
});

test("Devis : la liste à relancer est triée par urgence et ne modifie pas les données", () => {
  const quotes = [
    { id: "later", reference: "D-104", status: "SENT", validUntil: day(3) },
    { id: "draft", reference: "D-100", status: "DRAFT", validUntil: day(0) },
    { id: "tomorrow", reference: "D-102", status: "VIEWED", validUntil: day(1) },
    { id: "today", reference: "D-101", status: "SENT", validUntil: day(0) },
    { id: "accepted", reference: "D-103", status: "ACCEPTED", validUntil: day(0) },
  ];
  const result = quotesNeedingFollowup(quotes, NOW);
  assert.deepEqual(result.map((entry) => entry.quote.id), ["today", "tomorrow", "later"]);
  assert.deepEqual(result.map((entry) => entry.followup.days), [0, 1, 3]);
  assert.deepEqual(quotes.map((quote) => quote.id), ["later", "draft", "tomorrow", "today", "accepted"]);
});

test("Contrat écran : le Kanban expose un contrôle de statut explicite et une section pour les statuts hors colonnes", async () => {
  const page = await source("src/app/(session)/espace-equipe/taches/page.jsx");
  assert.match(page, /data-testid="task-status-select"/, "Un select de statut doit être visible sur chaque carte modifiable.");
  assert.match(page, /kanban-other-statuses/, "Les statuts sans colonne doivent rester accessibles.");
  assert.match(page, /statusBusyRef/, "Un garde-fou doit empêcher deux PATCH concurrents sur la même tâche.");
  assert.match(page, /tasks\.reload\(\)/, "Le serveur doit être rechargé après une transition ou un conflit.");
  assert.match(page, /task-drag-handle/, "Le glisser-déposer doit passer par une poignée clavier, pas par toute la carte.");
  assert.doesNotMatch(page, /canWrite \? "cursor-grab touch-none"/, "La carte entière ne doit plus bloquer le tactile.");
});

test("Contrat écran : les devis proches de l'échéance sont signalés sans créer de nouveau statut", async () => {
  const devis = await source("src/app/(session)/espace-equipe/devis/page.jsx");
  const dashboard = await source("src/components/dashboard/ControlCenter.jsx");
  assert.match(devis, /quote-followup-banner/);
  assert.match(devis, /quoteFollowup/);
  assert.match(dashboard, /quote-followup-banner/);
  assert.match(dashboard, /quotesNeedingFollowup/);
  assert.doesNotMatch(devis, /status:\s*"EXPIRING_SOON"/, "Aucun statut d'expiration proche ne doit être inventé.");
  assert.doesNotMatch(dashboard, /status:\s*"EXPIRING_SOON"/);
});

test("Contrat écran : le CSS prévoit des cibles tactiles et un formulaire adaptatif", async () => {
  const css = await source("src/styles/softui.productivity.css");
  assert.match(css, /\.sui-kcard__drag\s*\{/);
  assert.match(css, /min-height:\s*40px/);
  assert.match(css, /@container newtask/);
  assert.match(css, /\.sui-kanban-others/);
});
