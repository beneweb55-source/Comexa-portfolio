import assert from "node:assert/strict";
import test from "node:test";
import { isWorkspaceMutation, notifyWorkspaceUpdate, WORKSPACE_UPDATED } from "./workspace-updates.mjs";

test("only writes invalidate the workspace", () => {
  for (const method of ["POST", "patch", "PUT", "DELETE"]) assert.equal(isWorkspaceMutation(method), true);
  for (const method of [undefined, "GET", "HEAD", "OPTIONS"]) assert.equal(isWorkspaceMutation(method), false);
});

test("successful writes publish their resource and space, reads do not loop", () => {
  const previous = globalThis.window;
  const events = [];
  globalThis.window = { dispatchEvent: (event) => events.push(event) };
  try {
    notifyWorkspaceUpdate("/tasks/123/status", { method: "PATCH", space: "personal" });
    notifyWorkspaceUpdate("/me/tasks");
    assert.equal(events.length, 1);
    assert.equal(events[0].type, WORKSPACE_UPDATED);
    assert.deepEqual(events[0].detail, { path: "/tasks/123/status", space: "personal" });
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
