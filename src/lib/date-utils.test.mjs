import assert from "node:assert/strict";
import test from "node:test";
import { isDeadlinePassed } from "./date-utils.mjs";

test("isDeadlinePassed changes only after the exact deadline instant", () => {
  const due = "2026-10-11T00:00:00.000Z";
  const dueAt = Date.parse(due);

  assert.equal(isDeadlinePassed(due, dueAt - 1), false);
  assert.equal(isDeadlinePassed(due, dueAt), false);
  assert.equal(isDeadlinePassed(due, dueAt + 1), true);
  assert.equal(isDeadlinePassed("invalid", dueAt + 1), false);
  assert.equal(isDeadlinePassed(null, dueAt + 1), false);
});
