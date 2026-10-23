const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { OfflineStore } = require("../offline-store");

function createSecureStorage() {
  const key = crypto.randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "DPAPI",
    encryptString(value) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString(value) {
      const bytes = Buffer.from(value);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
    },
  };
}

async function makeStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "comexa-offline-test-"));
  const app = { getPath: () => directory };
  const safeStorage = createSecureStorage();
  const store = await new OfflineStore({ app, safeStorage }).initialize();
  return { directory, app, safeStorage, store, file: path.join(directory, "offline-data-v1.bin") };
}

const profile = { id: "user-test-01", email: "agent@example.test", permissions: ["task:read:own"] };

test("chiffre les données au repos, migre la base et restaure le cache après redémarrage", async (t) => {
  const fixture = await makeStore();
  let reopened;
  t.after(() => {
    try { reopened?.close(); } catch {}
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });
  fixture.store.rememberOnline({ email: profile.email, password: "Long-password-123!", user: profile });
  assert.equal(fixture.store.db.exec("PRAGMA user_version")[0].values[0][0], 3);
  fixture.store.cacheResponse({
    userId: profile.id,
    space: "personal",
    requestKey: "/me/tasks?perPage=100",
    response: { success: true, data: [{ id: "task-1", title: "Offline" }] },
  });

  const encrypted = fs.readFileSync(fixture.file);
  assert.ok(encrypted.subarray(0, 16).toString().startsWith("COMEXA-LOCAL"));
  assert.equal(encrypted.includes(Buffer.from(profile.email)), false);

  fixture.store.close();
  reopened = await new OfflineStore({ app: fixture.app, safeStorage: fixture.safeStorage }).initialize();
  reopened.authenticateOffline({ email: profile.email, password: "Long-password-123!" });
  assert.deepEqual(
    reopened.getCachedResponse({ userId: profile.id, space: "personal", requestKey: "/me/tasks?perPage=100" })?.response.data,
    [{ id: "task-1", title: "Offline" }],
  );
});

test("refuse le backend de chiffrement faible et ne crée pas une base", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "comexa-offline-weak-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const safeStorage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "basic_text" };
  const store = new OfflineStore({ app: { getPath: () => directory }, safeStorage });
  await assert.rejects(store.initialize(), /stockage sécurisé/);
  assert.equal(fs.readdirSync(directory).length, 0);
});

test("isole les données par compte et exige une authentification avant lecture", async (t) => {
  const fixture = await makeStore();
  t.after(() => {
    try { fixture.store.close(); } catch {}
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });
  fixture.store.rememberOnline({ email: profile.email, password: "Long-password-123!", user: profile });
  fixture.store.cacheResponse({ userId: profile.id, requestKey: "/projects", response: { success: true, data: [] } });
  fixture.store.clearActiveAccount();
  assert.throws(() => fixture.store.getCachedResponse({ userId: profile.id, requestKey: "/projects" }), /Accès local refusé/);
  fixture.store.authenticateOffline({ email: profile.email, password: "Long-password-123!" });
  assert.throws(() => fixture.store.getCachedResponse({ userId: "another-user", requestKey: "/projects" }), /Accès local refusé/);
});

test("expire explicitement l'autorisation locale et garde la base intacte si le fichier est altéré", async (t) => {
  const fixture = await makeStore();
  t.after(() => {
    try { fixture.store.close(); } catch {}
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });
  fixture.store.rememberOnline({ email: profile.email, password: "Long-password-123!", user: profile });
  fixture.store.db.run("UPDATE offline_accounts SET authorized_until=? WHERE user_id=?", [Date.now() - 1, profile.id]);
  fixture.store.persist();
  assert.throws(
    () => fixture.store.authenticateOffline({ email: profile.email, password: "Long-password-123!" }),
    /autorisation hors ligne a expiré/,
  );

  fixture.store.close();
  const bytes = fs.readFileSync(fixture.file);
  bytes[bytes.length - 1] ^= 0xff;
  fs.writeFileSync(fixture.file, bytes);
  const corrupted = new OfflineStore({ app: fixture.app, safeStorage: fixture.safeStorage });
  await assert.rejects(corrupted.initialize(), /Impossible de déchiffrer/);
  assert.ok(fs.existsSync(fixture.file), "Le fichier endommagé est conservé pour récupération");
});

test("bloque l'accès si l'horloge locale recule de manière significative", async (t) => {
  const fixture = await makeStore();
  t.after(() => {
    try { fixture.store.close(); } catch {}
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });
  fixture.store.rememberOnline({ email: profile.email, password: "Long-password-123!", user: profile });
  fixture.store.db.run("UPDATE offline_accounts SET last_seen_at=? WHERE user_id=?", [Date.now() + 10 * 60_000, profile.id]);
  fixture.store.persist();
  assert.throws(
    () => fixture.store.getCachedResponse({ userId: profile.id, requestKey: "/projects" }),
    /horloge système a reculé/,
  );
});

test("limite les tentatives locales et refuse les identifiants incorrects", async (t) => {
  const fixture = await makeStore();
  t.after(() => {
    try { fixture.store.close(); } catch {}
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });
  fixture.store.rememberOnline({ email: profile.email, password: "Long-password-123!", user: profile });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.throws(() => fixture.store.authenticateOffline({ email: profile.email, password: "wrong-password" }), /incorrect/);
  }
  assert.throws(() => fixture.store.authenticateOffline({ email: profile.email, password: "Long-password-123!" }), /Trop de tentatives/);
});
