const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { OfflineStore } = require("../offline-store");

function storage() {
  const key = crypto.randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "DPAPI",
    encryptString(value) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", key, iv); const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), encrypted]); },
    decryptString(value) { const data = Buffer.from(value); const decipher = crypto.createDecipheriv("aes-256-gcm", key, data.subarray(0, 12)); decipher.setAuthTag(data.subarray(12, 28)); return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8"); },
  };
}

async function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "comexa-query-"));
  const store = await new OfflineStore({ app: { getPath: () => directory }, safeStorage: storage() }).initialize();
  store.rememberOnline({ email: "owner@example.test", password: "Safe-pass-456!", user: { id: "query-user", email: "owner@example.test" } });
  return { directory, store };
}

test("met en surbrillance le rapport journalier par date et respecte les filtres serveur en cache", async (t) => {
  const f = await setup();
  t.after(() => { try { f.store.close(); } catch {} fs.rmSync(f.directory, { recursive: true, force: true }); });
  const userId = "query-user";
  f.store.cacheResponse({ userId, requestKey: "/daily-reports/mine", resourceKey: "daily-reports", response: { success: true, data: { items: [{ id: "report-1", date: "2026-10-20T00:00:00.000Z", notes: "Avant", updatedAt: "2026-10-20T12:00:00.000Z" }] } } });
  f.store.enqueueMutation({ userId, method: "PUT", requestPath: "/daily-reports/2026-10-20", body: { notes: "Modifié hors ligne" }, entityType: "daily-report", entityId: "2026-10-20", resourceKey: "daily-reports" });
  const cached = f.store.getCachedResponse({ userId, requestKey: "/daily-reports/mine", resourceKey: "daily-reports" });
  assert.equal(cached.response.data.items[0].notes, "Modifié hors ligne");
  assert.equal(cached.response.data.items[0].id, "report-1");
});

test("ne montre pas une création locale dans une autre ressource projet filtrée", async (t) => {
  const f = await setup();
  t.after(() => { try { f.store.close(); } catch {} fs.rmSync(f.directory, { recursive: true, force: true }); });
  const userId = "query-user";
  f.store.cacheResponse({ userId, requestKey: "/projects/p-1/tasks?status=TODO", resourceKey: "tasks:p-1", response: { success: true, data: { items: [{ id: "existing", title: "À faire", status: "TODO" }] } } });
  f.store.cacheResponse({ userId, requestKey: "/projects/p-2/tasks?status=TODO", resourceKey: "tasks:p-2", response: { success: true, data: { items: [{ id: "other", title: "Autre projet", status: "TODO", projectId: "p-2" }] } } });
  f.store.enqueueMutation({ userId, method: "POST", requestPath: "/projects/p-1/tasks", body: { title: "Nouvelle tâche", status: "TODO" }, entityType: "task", resourceKey: "tasks:p-1", isCreate: true });
  const p1 = f.store.getCachedResponse({ userId, requestKey: "/projects/p-1/tasks?status=TODO", resourceKey: "tasks:p-1" }).response.data.items;
  const p2 = f.store.getCachedResponse({ userId, requestKey: "/projects/p-2/tasks?status=TODO", resourceKey: "tasks:p-2" }).response.data.items;
  assert.equal(p1.length, 2);
  assert.equal(p2.length, 1);
});
