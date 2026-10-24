const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { OfflineStore } = require("../offline-store");

function secureStorage() {
  const key = crypto.randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "DPAPI",
    encryptString(text) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString(data) {
      const bytes = Buffer.from(data);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
    },
  };
}

async function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comexa-outbox-"));
  const app = { getPath: () => dir };
  const storage = secureStorage();
  const store = await new OfflineStore({ app, safeStorage: storage }).initialize();
  store.rememberOnline({ email: "ops@example.test", password: "Secure-pass-123!", user: { id: "user-ops", email: "ops@example.test" } });
  return { dir, app, storage, store };
}

test("persiste une modification optimiste, l'idempotence et son snapshot de base après redémarrage", async (t) => {
  const f = await fixture();
  let reopened;
  t.after(() => {
    try { reopened?.close(); } catch {}
    try { f.store.close(); } catch {}
    fs.rmSync(f.dir, { recursive: true, force: true });
  });
  f.store.cacheResponse({ userId: "user-ops", space: "team", requestKey: "/projects?page=1", resourceKey: "projects", response: { success: true, data: [{ id: "project-1", name: "Avant", status: "ACTIVE" }] } });
  const queued = f.store.enqueueMutation({
    userId: "user-ops", space: "team", method: "PATCH", requestPath: "/projects/project-1",
    body: { name: "Après" }, entityType: "project", entityId: "project-1", resourceKey: "projects",
    idempotencyKey: "offline-operation-0001",
  });
  assert.ok(queued.operationId);
  assert.equal(queued.idempotencyKey, "offline-operation-0001");
  const cached = f.store.getCachedResponse({ userId: "user-ops", space: "team", requestKey: "/projects?page=1", resourceKey: "projects" });
  assert.equal(cached.response.data[0].name, "Après");
  assert.equal(cached.response.data[0].offlineState, "pending");
  const pending = f.store.listPendingOperations({ userId: "user-ops" })[0];
  assert.equal(pending.baseSnapshot.name, "Avant");
  assert.equal(pending.baseRequestKey, "/projects?page=1");

  f.store.close();
  reopened = await new OfflineStore({ app: f.app, safeStorage: f.storage }).initialize();
  reopened.authenticateOffline({ email: "ops@example.test", password: "Secure-pass-123!" });
  const afterRestart = reopened.listPendingOperations({ userId: "user-ops" });
  assert.equal(afterRestart.length, 1);
  assert.equal(afterRestart[0].idempotencyKey, "offline-operation-0001");
  assert.equal(afterRestart[0].body.name, "Après");
});

test("relie les créations locales dépendantes et refuse les routes administratives non autorisées", async (t) => {
  const f = await fixture();
  t.after(() => {
    try { f.store.close(); } catch {}
    fs.rmSync(f.dir, { recursive: true, force: true });
  });
  const project = f.store.enqueueMutation({ userId: "user-ops", space: "team", method: "POST", requestPath: "/projects", body: { name: "Projet local" }, entityType: "project", resourceKey: "projects" });
  const localProjectId = project.localResult.id;
  const task = f.store.enqueueMutation({ userId: "user-ops", space: "team", method: "POST", requestPath: `/projects/${localProjectId}/tasks`, body: { title: "Tâche enfant", projectId: localProjectId }, entityType: "task", resourceKey: `tasks:${localProjectId}` });
  assert.deepEqual(task.dependsOn, [project.operationId]);
  assert.throws(() => f.store.enqueueMutation({ userId: "user-ops", method: "POST", requestPath: "/users/user-2/reset-password", body: {}, entityType: "user", resourceKey: "users" }), /pas autorisée/);
});

test("conserve localement l'association et le retrait d'une tâche à un objectif personnel", async (t) => {
  const f = await fixture();
  t.after(() => { try { f.store.close(); } catch {} fs.rmSync(f.dir, { recursive: true, force: true }); });
  f.store.cacheResponse({ userId: "user-ops", requestKey: "/me/tasks", resourceKey: "personal-tasks", response: { success: true, data: [{ id: "task-1", title: "Tâche", goalId: null, goal: null }] } });
  f.store.enqueueMutation({ userId: "user-ops", method: "PUT", requestPath: "/me/goals/goal-1/tasks/task-1", body: null, entityType: "goal-task-link", entityId: "task-1", resourceKey: "personal-tasks", localResult: { id: "task-1", goalId: "goal-1", goal: { id: "goal-1" } } });
  assert.equal(f.store.getCachedResponse({ userId: "user-ops", requestKey: "/me/tasks", resourceKey: "personal-tasks" }).response.data[0].goalId, "goal-1");
  f.store.enqueueMutation({ userId: "user-ops", method: "DELETE", requestPath: "/me/goals/goal-1/tasks/task-1", body: null, entityType: "goal-task-link", entityId: "task-1", resourceKey: "personal-tasks", localResult: { id: "task-1", goalId: null, goal: null } });
  assert.equal(f.store.getCachedResponse({ userId: "user-ops", requestKey: "/me/tasks", resourceKey: "personal-tasks" }).response.data[0].goalId, null);
});

test("autorise les mutations Contacts et la génération de rapports du catalogue réel", async (t) => {
  const f = await fixture();
  t.after(() => { try { f.store.close(); } catch {} fs.rmSync(f.dir, { recursive: true, force: true }); });
  const contact = f.store.enqueueMutation({ userId: "user-ops", method: "PATCH", requestPath: "/contacts/contact-7", body: { firstName: "Nouveau prénom" }, entityType: "contact", entityId: "contact-7", resourceKey: "contacts" });
  const report = f.store.enqueueMutation({ userId: "user-ops", method: "POST", requestPath: "/reports", body: { period: "MONTH" }, entityType: "report", resourceKey: "reports", isCreate: true });
  assert.equal(contact.localResult.id, "contact-7");
  assert.ok(report.localResult.id.startsWith("local:"));
  assert.deepEqual(f.store.listPendingOperations({ userId: "user-ops" }).map((item) => item.path), ["/contacts/contact-7", "/reports"]);
});
