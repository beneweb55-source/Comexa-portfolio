const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { OfflineStore } = require("../offline-store");

function makeStorage() {
  const key = crypto.randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "DPAPI",
    encryptString(value) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]);
    },
    decryptString(value) {
      const data = Buffer.from(value);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
    },
  };
}

async function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "comexa-conflict-"));
  const app = { getPath: () => directory };
  const storage = makeStorage();
  const store = await new OfflineStore({ app, safeStorage: storage }).initialize();
  store.rememberOnline({ email: "owner@example.test", password: "Safe-pass-456!", user: { id: "conflict-user", email: "owner@example.test" } });
  return { directory, store };
}

test("conserve local/serveur et n'efface rien lors de la résolution explicite", async (t) => {
  const f = await setup();
  t.after(() => { try { f.store.close(); } catch {} fs.rmSync(f.directory, { recursive: true, force: true }); });
  f.store.cacheResponse({ userId: "conflict-user", space: "team", requestKey: "/projects?page=1", resourceKey: "projects", response: { success: true, data: [{ id: "p-1", name: "Initial", status: "ACTIVE" }] } });
  const operation = f.store.enqueueMutation({ userId: "conflict-user", space: "team", method: "PATCH", requestPath: "/projects/p-1", body: { name: "Modification locale" }, entityType: "project", entityId: "p-1", resourceKey: "projects" });
  const conflictId = f.store.recordConflict({ userId: "conflict-user", operationId: operation.operationId, serverSnapshot: { id: "p-1", name: "Modification serveur", status: "ACTIVE" }, changedFields: ["name"] });
  assert.equal(f.store.status({ userId: "conflict-user" }).conflicts, 1);
  assert.equal(f.store.listConflicts({ userId: "conflict-user" })[0].local.name, "Modification locale");
  f.store.resolveConflict({ userId: "conflict-user", conflictId, resolution: "local" });
  assert.equal(f.store.status({ userId: "conflict-user" }).conflicts, 0);
  assert.equal(f.store.listPendingOperations({ userId: "conflict-user" })[0].state, "pending");
  assert.deepEqual(JSON.parse(f.store.db.exec("SELECT local_json,server_json FROM sync_conflict_resolutions WHERE conflict_id=?", [conflictId])[0].values[0][0]), { name: "Modification locale", id: "p-1", offlineState: "pending", offlineOperationId: operation.operationId });
});

test("rebasa la prochaine modification de la même entité après succès confirmé", async (t) => {
  const f = await setup();
  t.after(() => { try { f.store.close(); } catch {} fs.rmSync(f.directory, { recursive: true, force: true }); });
  f.store.cacheResponse({ userId: "conflict-user", requestKey: "/tasks/t-1", resourceKey: "tasks", response: { success: true, data: { id: "t-1", title: "Avant", status: "TODO", updatedAt: "2026-10-01T10:00:00.000Z" } } });
  const first = f.store.enqueueMutation({ userId: "conflict-user", method: "PATCH", requestPath: "/tasks/t-1", body: { title: "Titre local" }, entityType: "task", entityId: "t-1", resourceKey: "tasks" });
  const second = f.store.enqueueMutation({ userId: "conflict-user", method: "PATCH", requestPath: "/tasks/t-1", body: { status: "IN_PROGRESS" }, entityType: "task", entityId: "t-1", resourceKey: "tasks" });
  assert.deepEqual(second.dependsOn, [first.operationId]);
  f.store.updateOperation({ userId: "conflict-user", operationId: first.operationId, state: "synced", serverResult: { data: { id: "t-1", title: "Titre local", status: "TODO", updatedAt: "2026-10-01T11:00:00.000Z" } } });
  const rebased = f.store.listPendingOperations({ userId: "conflict-user" }).find((operation) => operation.operationId === second.operationId);
  assert.deepEqual(rebased.dependsOn, []);
  assert.equal(rebased.baseSnapshot.title, "Titre local");
  assert.equal(rebased.baseVersion, "2026-10-01T11:00:00.000Z");
});

test("conserve une relation temporaire puis remplace l'identifiant après confirmation serveur", async (t) => {
  const f = await setup();
  t.after(() => { try { f.store.close(); } catch {} fs.rmSync(f.directory, { recursive: true, force: true }); });
  const project = f.store.enqueueMutation({ userId: "conflict-user", space: "team", method: "POST", requestPath: "/projects", body: { name: "Projet" }, entityType: "project", resourceKey: "projects" });
  const child = f.store.enqueueMutation({ userId: "conflict-user", space: "team", method: "POST", requestPath: `/projects/${project.localResult.id}/tasks`, body: { title: "Tâche", projectId: project.localResult.id }, entityType: "task", resourceKey: `tasks:${project.localResult.id}` });
  f.store.updateOperation({ userId: "conflict-user", operationId: project.operationId, state: "synced", serverResult: { data: { id: "server-project-42", name: "Projet" } } });
  assert.equal(f.store.listLocalIdMappings({ userId: "conflict-user" })[project.localResult.id], "server-project-42");
  const pending = f.store.listPendingOperations({ userId: "conflict-user" }).find((item) => item.operationId === child.operationId);
  assert.deepEqual(pending.dependsOn, []);
  assert.ok(pending.path.includes(project.localResult.id), "la clé temporaire reste intacte et est réécrite uniquement au rejeu");
});
