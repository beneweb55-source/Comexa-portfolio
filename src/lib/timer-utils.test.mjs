import assert from "node:assert/strict";
import test from "node:test";
import { elapsedMinutes, localWorkDay, parseStoredTimer, splitTimerDuration, timerStorageKey } from "./timer-utils.mjs";

test("timerStorageKey scopes browser state to the authenticated user", () => {
  assert.notEqual(timerStorageKey("user-a"), timerStorageKey("user-b"));
  assert.equal(timerStorageKey(null), null);
  assert.equal(timerStorageKey("user/a"), "comexa.timer.v2:user%2Fa");
});

test("parseStoredTimer accepts only valid records owned by the current user", () => {
  const value = { ownerId: "user-a", taskId: "task-1", title: "Conception", startedAt: "2026-10-11T08:00:00.000Z" };
  assert.deepEqual(parseStoredTimer(JSON.stringify(value), "user-a"), value);
  assert.equal(parseStoredTimer(JSON.stringify(value), "user-b"), null);
  assert.equal(parseStoredTimer("not-json", "user-a"), null);
  assert.equal(parseStoredTimer(JSON.stringify({ ...value, startedAt: "invalid" }), "user-a"), null);
  assert.equal(parseStoredTimer(JSON.stringify({ ...value, taskId: "" }), "user-a"), null);
  assert.equal(parseStoredTimer(JSON.stringify({ ...value, stopped: true }), "user-a"), null);
});

test("splitTimerDuration preserves long durations within the API entry limit", () => {
  const totalMinutes = 3 * 1440 + 120;
  const plan = splitTimerDuration("2026-10-10T12:00:00.000Z", totalMinutes, 20);
  assert.ok(plan);
  assert.ok(plan.chunks.length > 1);
  assert.ok(plan.chunks.every((chunk) => chunk.minutes >= 1 && chunk.minutes <= 1440));
  assert.ok(plan.chunks.every((chunk) => /^\d{4}-\d{2}-\d{2}$/.test(chunk.spentOn)));
  assert.equal(plan.chunks.reduce((sum, chunk) => sum + chunk.minutes, 0) + plan.remainingMinutes, totalMinutes);
  assert.equal(plan.remainingMinutes, 0);
});

test("splitTimerDuration caps work per stop and returns a precise resumable remainder", () => {
  const totalMinutes = 20 * 1440 + 45;
  const plan = splitTimerDuration("2026-10-10T12:00:00.000Z", totalMinutes, 2);
  assert.ok(plan);
  const savedMinutes = plan.chunks.reduce((sum, chunk) => sum + chunk.minutes, 0);
  assert.equal(plan.chunks.length, 2);
  assert.equal(savedMinutes + plan.remainingMinutes, totalMinutes);
  assert.equal(Date.parse(plan.resumeAt) - Date.parse("2026-10-10T12:00:00.000Z"), savedMinutes * 60_000);

  const bounded = splitTimerDuration("2026-10-10T12:00:00.000Z", totalMinutes, Infinity);
  assert.equal(bounded.chunks.length, 7);
  assert.ok(bounded.remainingMinutes > 0);
});

test("elapsedMinutes validates dates and never returns a negative duration", () => {
  const start = "2026-10-11T08:00:00.000Z";
  assert.equal(elapsedMinutes(start, Date.parse("2026-10-11T08:00:29.000Z")), 0);
  assert.equal(elapsedMinutes(start, Date.parse("2026-10-11T08:00:31.000Z")), 1);
  assert.equal(elapsedMinutes(start, Date.parse("2026-10-11T07:59:00.000Z")), 0);
  assert.equal(elapsedMinutes("invalid", Date.now()), null);
  assert.equal(localWorkDay("invalid"), null);
});
