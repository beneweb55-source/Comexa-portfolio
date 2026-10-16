import assert from "node:assert/strict";
import test from "node:test";
import {
  PROJECT_TASK_TRANSITIONS,
  TASK_STATUS_ORDER,
  canMoveTo,
  compareTasks,
  completionToggle,
  dueBucket,
  dueDayOf,
  groupByDue,
  isOverdue,
  nextStatuses,
} from "./task-status.mjs";

// Midi heure locale le 16 octobre 2026 : le jour local est le 16 dans tout fuseau
// raisonnable, ce qui rend les tests indépendants de la machine.
const NOW = new Date(2026, 9, 16, 12, 0, 0).getTime();

test("tâche de projet : exactement la machine à états du serveur", () => {
  for (const from of TASK_STATUS_ORDER) {
    assert.deepEqual(
      [...nextStatuses({ status: from, isPersonal: false })].sort(),
      [...PROJECT_TASK_TRANSITIONS[from]].sort(),
      `transitions depuis ${from}`,
    );
  }
  assert.equal(canMoveTo({ status: "BLOCKED", isPersonal: false }, "DONE"), false);
  assert.equal(canMoveTo({ status: "DONE", isPersonal: false }, "TODO"), false);
});

test("tâche personnelle : tous les autres statuts sont permis", () => {
  const next = nextStatuses({ status: "DONE", isPersonal: true });
  assert.equal(next.length, TASK_STATUS_ORDER.length - 1);
  assert.equal(next.includes("DONE"), false);
  assert.equal(canMoveTo({ status: "BLOCKED", isPersonal: true }, "DONE"), true);
});

test("case à cocher : terminer une tâche ouverte", () => {
  for (const status of ["TODO", "IN_PROGRESS", "IN_REVIEW"]) {
    const toggle = completionToggle({ status, isPersonal: false });
    assert.equal(toggle.checked, false);
    assert.equal(toggle.next, "DONE", status);
  }
});

test("case à cocher : décocher remet à faire (personnel) ou rouvre (projet)", () => {
  assert.equal(completionToggle({ status: "DONE", isPersonal: true }).next, "TODO");
  const project = completionToggle({ status: "DONE", isPersonal: false });
  assert.equal(project.checked, true);
  assert.equal(project.next, "IN_PROGRESS");
});

test("case à cocher : grisée avec une raison quand le serveur refuserait", () => {
  const blocked = completionToggle({ status: "BLOCKED", isPersonal: false });
  assert.equal(blocked.next, null);
  assert.match(blocked.reason, /bloquée/);
  const cancelled = completionToggle({ status: "CANCELLED", isPersonal: false });
  assert.equal(cancelled.next, null);
  assert.match(cancelled.reason, /annulée/);
  // Une tâche personnelle bloquée se coche quand même.
  assert.equal(completionToggle({ status: "BLOCKED", isPersonal: true }).next, "DONE");
});

test("échéance lue au jour UTC (saisie à midi ou minuit UTC)", () => {
  assert.equal(dueDayOf("2026-10-16T12:00:00Z"), "2026-10-16");
  assert.equal(dueDayOf("2026-10-16T00:00:00.000Z"), "2026-10-16");
  assert.equal(dueDayOf(null), null);
  assert.equal(dueDayOf("pas une date"), null);
});

test("tranches d'échéance au jour près", () => {
  assert.equal(dueBucket({ dueDate: "2026-10-15T12:00:00Z" }, NOW), "overdue");
  assert.equal(dueBucket({ dueDate: "2026-10-16T12:00:00Z" }, NOW), "today", "due aujourd'hui n'est pas en retard");
  assert.equal(dueBucket({ dueDate: "2026-10-20T12:00:00Z" }, NOW), "week");
  assert.equal(dueBucket({ dueDate: "2026-11-30T12:00:00Z" }, NOW), "later");
  assert.equal(dueBucket({ dueDate: null }, NOW), "none");
  assert.equal(isOverdue({ status: "DONE", dueDate: "2026-10-01T12:00:00Z" }, NOW), false, "une tâche close n'est pas en retard");
  assert.equal(isOverdue({ status: "TODO", dueDate: "2026-10-01T12:00:00Z" }, NOW), true);
});

test("groupByDue ordonne les tranches et omet les vides", () => {
  const groups = groupByDue(
    [
      { id: "b", title: "B", dueDate: "2026-10-16T12:00:00Z", priority: "LOW" },
      { id: "a", title: "A", dueDate: "2026-10-16T12:00:00Z", priority: "URGENT" },
      { id: "c", title: "C", dueDate: null },
      { id: "d", title: "D", dueDate: "2026-10-02T12:00:00Z" },
    ],
    NOW,
  );
  assert.deepEqual(groups.map((group) => group.id), ["overdue", "today", "none"]);
  assert.deepEqual(groups[1].tasks.map((task) => task.id), ["a", "b"], "priorité d'abord à échéance égale");
});

test("compareTasks place les tâches sans échéance en dernier", () => {
  const list = [{ title: "x", dueDate: null }, { title: "y", dueDate: "2026-12-01T00:00:00Z" }];
  assert.equal(list.sort(compareTasks)[0].title, "y");
});
