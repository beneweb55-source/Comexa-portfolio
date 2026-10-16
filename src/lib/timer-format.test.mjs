import assert from "node:assert/strict";
import test from "node:test";
import { formatElapsed, formatMinutes, isLongRunning, splitElapsed, timerProgress, titleWithTimer } from "./timer-format.mjs";

test("formatElapsed : HH:MM:SS, jamais négatif", () => {
  assert.equal(formatElapsed(0), "00:00:00");
  assert.equal(formatElapsed(3661), "01:01:01");
  assert.equal(formatElapsed(-5), "00:00:00");
  assert.equal(formatElapsed(36 * 3600), "36:00:00");
  assert.deepEqual(splitElapsed(754), { hours: "00", minutes: "12", seconds: "34" });
});

test("formatMinutes : lisible en français", () => {
  assert.equal(formatMinutes(0), "0 min");
  assert.equal(formatMinutes(45), "45 min");
  assert.equal(formatMinutes(60), "1 h");
  assert.equal(formatMinutes(125), "2 h 05");
});

test("timerProgress : rapporte le temps total de la tâche à son estimation", () => {
  const progress = timerProgress({ elapsedSeconds: 30 * 60, estimateMinutes: 120, loggedMinutes: 30 });
  assert.equal(progress.mode, "estimate");
  assert.equal(progress.ratio, 0.5);
  assert.equal(progress.over, false);
  assert.equal(progress.label, "1 h sur 2 h estimées");
  assert.equal(timerProgress({ elapsedSeconds: 3600, estimateMinutes: 30 }).over, true);
});

test("timerProgress : sans estimation, un tour de cadran par heure", () => {
  const progress = timerProgress({ elapsedSeconds: 5400 });
  assert.equal(progress.mode, "cycle");
  assert.equal(progress.ratio, 0.5);
  assert.equal(progress.label, null);
});

test("titleWithTimer : préfixe le titre de l'onglet et le retire proprement", () => {
  const running = titleWithTimer("Mes tâches · Comexa", "RUNNING", 75);
  assert.equal(running, "▶ 00:01:15 · Mes tâches · Comexa");
  assert.equal(titleWithTimer(running, "PAUSED", 80), "⏸ 00:01:20 · Mes tâches · Comexa", "pas de double préfixe");
  assert.equal(titleWithTimer(running, null, 0), "Mes tâches · Comexa");
});

test("isLongRunning : alerte au-delà de 8 h", () => {
  assert.equal(isLongRunning(7 * 3600), false);
  assert.equal(isLongRunning(8 * 3600), true);
});
