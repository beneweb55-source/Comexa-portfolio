import assert from "node:assert/strict";
import test from "node:test";
import { goalCountdown, goalProgressOf, goalTone } from "./goals.mjs";

const NOW = new Date(2026, 9, 16, 12, 0, 0).getTime();

test("avancement : les tâches annulées sortent du dénominateur", () => {
  assert.deepEqual(goalProgressOf(["DONE", "TODO", "CANCELLED"]), { total: 3, done: 1, cancelled: 1, open: 1, percent: 50 });
  assert.equal(goalProgressOf([]).percent, 0);
  assert.equal(goalProgressOf(["CANCELLED"]).percent, 0);
});

test("compte à rebours vers la date cible", () => {
  assert.deepEqual(goalCountdown("2026-10-16T00:00:00.000Z", NOW), { label: "Aujourd’hui", tone: "soon" });
  assert.deepEqual(goalCountdown("2026-10-17T00:00:00.000Z", NOW), { label: "Demain", tone: "soon" });
  assert.deepEqual(goalCountdown("2026-10-20T00:00:00.000Z", NOW), { label: "J-4", tone: "soon" });
  assert.deepEqual(goalCountdown("2026-12-15T00:00:00.000Z", NOW), { label: "J-60", tone: "ok" });
  assert.deepEqual(goalCountdown("2026-10-13T00:00:00.000Z", NOW), { label: "Dépassé de 3 j", tone: "late" });
  assert.equal(goalCountdown(null, NOW), null);
});

test("teinte inconnue : repli sur le bleu de la charte", () => {
  assert.equal(goalTone("lilac"), "lilac");
  assert.equal(goalTone("red"), "blue");
});
