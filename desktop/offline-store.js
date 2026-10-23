"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const STORE_HEADER = Buffer.from("COMEXA-LOCAL-DB\0v1\n", "utf8");
const MAX_PROFILE_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_CACHE_ENTRIES_PER_USER = 1_000;
const MAX_CACHE_BYTES_PER_USER = 128 * 1024 * 1024;
const OFFLINE_AUTH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000;
const SCRYPT_OPTIONS = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const MIGRATIONS = [
  `CREATE TABLE offline_accounts (
    user_id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    profile_json TEXT NOT NULL,
    password_salt BLOB NOT NULL,
    password_verifier BLOB NOT NULL,
    authorized_until INTEGER NOT NULL,
    last_online_at INTEGER NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    lock_level INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE cached_responses (
    user_id TEXT NOT NULL,
    space TEXT NOT NULL DEFAULT '',
    request_key TEXT NOT NULL,
    response_json TEXT NOT NULL,
    cached_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, space, request_key),
    FOREIGN KEY (user_id) REFERENCES offline_accounts(user_id) ON DELETE CASCADE
  );
  CREATE TABLE pending_operations (
    operation_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    space TEXT NOT NULL DEFAULT '',
    operation_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    base_version TEXT,
    depends_on TEXT,
    state TEXT NOT NULL DEFAULT 'pending'
      CHECK (state IN ('pending','in_progress','synced','conflict','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_error TEXT,
    FOREIGN KEY (user_id) REFERENCES offline_accounts(user_id) ON DELETE CASCADE
  );
  CREATE INDEX pending_operations_ready
    ON pending_operations(user_id, state, next_attempt_at, created_at);
  CREATE TABLE sync_conflicts (
    conflict_id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    base_json TEXT,
    local_json TEXT NOT NULL,
    server_json TEXT,
    fields_json TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','resolved')),
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    FOREIGN KEY (operation_id) REFERENCES pending_operations(operation_id),
    FOREIGN KEY (user_id) REFERENCES offline_accounts(user_id) ON DELETE CASCADE
  );
  CREATE TABLE sync_state (
    user_id TEXT NOT NULL,
    space TEXT NOT NULL DEFAULT '',
    cursor TEXT,
    last_success_at INTEGER,
    PRIMARY KEY(user_id, space),
    FOREIGN KEY (user_id) REFERENCES offline_accounts(user_id) ON DELETE CASCADE
  );`,
  `CREATE TABLE offline_auth_attempts (
    email TEXT PRIMARY KEY,
    failures INTEGER NOT NULL DEFAULT 0,
    lock_level INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );`,
  `ALTER TABLE offline_accounts ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;`,
];

function normalizeEmail(value) {
  return typeof value === "string"
    ? value.trim().toLowerCase().slice(0, 320)
    : "";
}

function validateUser(user) {
  if (!user || typeof user !== "object" || Array.isArray(user))
    throw new Error("Profil hors ligne invalide.");
  const id = typeof user.id === "string" ? user.id.trim() : "";
  if (!id || id.length > 128)
    throw new Error("Identifiant utilisateur hors ligne invalide.");
  const profile = JSON.stringify(user);
  if (Buffer.byteLength(profile, "utf8") > MAX_PROFILE_BYTES)
    throw new Error("Profil utilisateur trop volumineux.");
  return { id, profile };
}

function verifyPassword(password, salt, expected) {
  const actual = crypto.scryptSync(
    password,
    salt,
    expected.length,
    SCRYPT_OPTIONS,
  );
  return (
    actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected)
  );
}

class OfflineStore {
  constructor({ app, safeStorage }) {
    this.app = app;
    this.safeStorage = safeStorage;
    this.db = null;
    this.filePath = path.join(app.getPath("userData"), "offline-data-v1.bin");
    this.activeUserId = null;
    this.cacheFlushTimer = null;
  }

  secureStorageAvailable() {
    if (!this.safeStorage?.isEncryptionAvailable?.()) return false;
    const backend = this.safeStorage.getSelectedStorageBackend?.();
    // Electron's Linux fallback encrypts with a hard-coded key. It is not
    // acceptable protection for cached customer or financial records.
    return backend !== "basic_text";
  }

  async initialize() {
    if (!this.secureStorageAvailable()) {
      throw new Error(
        "Le stockage sécurisé du système est indisponible ; le mode hors ligne est désactivé.",
      );
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    let databaseBytes = null;
    if (fs.existsSync(this.filePath)) {
      const encoded = fs.readFileSync(this.filePath);
      if (
        encoded.length <= STORE_HEADER.length ||
        !encoded.subarray(0, STORE_HEADER.length).equals(STORE_HEADER)
      ) {
        throw new Error(
          "Le fichier de données hors ligne est invalide ; aucune donnée n'a été remplacée.",
        );
      }
      try {
        const plaintext = this.safeStorage.decryptString(
          encoded.subarray(STORE_HEADER.length),
        );
        databaseBytes = Buffer.from(plaintext, "base64");
        if (!databaseBytes.length) throw new Error("Base locale vide.");
      } catch {
        throw new Error(
          "Impossible de déchiffrer la base locale. Le fichier original est conservé.",
        );
      }
    }

    const initSqlJs = require("sql.js");
    const wasmPath = path.join(
      path.dirname(require.resolve("sql.js")),
      "sql-wasm.wasm",
    );
    const SQL = await initSqlJs({ locateFile: () => wasmPath });
    this.db = databaseBytes
      ? new SQL.Database(databaseBytes)
      : new SQL.Database();
    this.db.run("PRAGMA foreign_keys = ON");
    this.runMigrations();
    if (!databaseBytes) this.persist();
    return this;
  }

  runMigrations() {
    const current =
      this.db.exec("PRAGMA user_version")[0]?.values?.[0]?.[0] ?? 0;
    if (current > MIGRATIONS.length)
      throw new Error(
        "La base locale a une version plus récente que cette application.",
      );
    for (let index = current; index < MIGRATIONS.length; index += 1) {
      this.db.run("BEGIN IMMEDIATE");
      try {
        this.db.run(MIGRATIONS[index]);
        this.db.run(`PRAGMA user_version = ${index + 1}`);
        this.db.run("COMMIT");
      } catch (error) {
        this.db.run("ROLLBACK");
        throw error;
      }
      this.persist();
    }
  }

  scheduleCachePersist() {
    if (this.cacheFlushTimer) return;
    this.cacheFlushTimer = setTimeout(() => {
      this.cacheFlushTimer = null;
      try {
        this.persist();
      } catch (error) {
        console.warn(
          `[comexa-offline] Écriture du cache local impossible : ${error.message}`,
        );
      }
    }, 100);
    this.cacheFlushTimer.unref?.();
  }

  persist() {
    if (this.cacheFlushTimer) clearTimeout(this.cacheFlushTimer);
    this.cacheFlushTimer = null;
    if (!this.db) throw new Error("La base locale n'est pas initialisée.");
    const encodedDb = Buffer.from(this.db.export()).toString("base64");
    const encrypted = this.safeStorage.encryptString(encodedDb);
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, Buffer.concat([STORE_HEADER, encrypted]), {
      mode: 0o600,
    });
    try {
      fs.renameSync(tempPath, this.filePath);
    } catch (error) {
      try {
        fs.unlinkSync(tempPath);
      } catch {}
      throw error;
    }
  }

  assertUser(userId) {
    if (!this.activeUserId || userId !== this.activeUserId) {
      throw new Error("Accès local refusé : aucun compte actif ne correspond.");
    }
    const row = this.db.exec(
      "SELECT authorized_until,last_seen_at FROM offline_accounts WHERE user_id=?",
      [userId],
    )[0]?.values?.[0];
    if (!row) {
      this.activeUserId = null;
      throw new Error("Autorisation locale introuvable.");
    }
    const now = Date.now();
    const authorizedUntil = Number(row[0]);
    const lastSeenAt = Number(row[1]);
    if (now + CLOCK_ROLLBACK_TOLERANCE_MS < lastSeenAt) {
      this.activeUserId = null;
      throw new Error(
        "L'horloge système a reculé. Corrigez la date puis reconnectez-vous.",
      );
    }
    const trustedNow = Math.max(now, lastSeenAt);
    if (trustedNow >= authorizedUntil) {
      this.activeUserId = null;
      throw new Error(
        "L'autorisation hors ligne a expiré. Reconnectez-vous à Internet.",
      );
    }
    if (trustedNow - lastSeenAt >= 60_000) {
      this.db.run(
        "UPDATE offline_accounts SET last_seen_at=? WHERE user_id=?",
        [trustedNow, userId],
      );
      this.persist();
    }
  }

  rememberOnline({ email, password, user }) {
    if (
      typeof password !== "string" ||
      password.length < 1 ||
      password.length > 512
    ) {
      throw new Error(
        "Mot de passe invalide pour initialiser l'accès hors ligne.",
      );
    }
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || normalizedEmail.length > 320)
      throw new Error("Adresse e-mail invalide.");
    const { id, profile } = validateUser(user);
    const salt = crypto.randomBytes(16);
    const verifier = crypto.scryptSync(password, salt, 32, SCRYPT_OPTIONS);
    const now = Date.now();
    this.db.run(
      `INSERT INTO offline_accounts
        (user_id,email,profile_json,password_salt,password_verifier,authorized_until,last_online_at,failed_attempts,lock_level,locked_until,last_seen_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET email=excluded.email, profile_json=excluded.profile_json,
         password_salt=excluded.password_salt,password_verifier=excluded.password_verifier,
         authorized_until=excluded.authorized_until,last_online_at=excluded.last_online_at,
         failed_attempts=0,lock_level=0,locked_until=0,last_seen_at=excluded.last_seen_at`,
      [
        id,
        normalizedEmail,
        profile,
        salt,
        verifier,
        now + OFFLINE_AUTH_TTL_MS,
        now,
        0,
        0,
        0,
        now,
      ],
    );
    // Update the email uniqueness if a user changed email while retaining id.
    const collisions = this.db.exec(
      "SELECT user_id FROM offline_accounts WHERE email = ?",
      [normalizedEmail],
    );
    const owner = collisions[0]?.values?.[0]?.[0];
    if (owner !== id)
      throw new Error(
        "Ce compte hors ligne est déjà associé à un autre utilisateur local.",
      );
    this.db.run("DELETE FROM offline_auth_attempts WHERE email=?", [
      normalizedEmail,
    ]);
    this.activeUserId = id;
    this.persist();
    return {
      user: JSON.parse(profile),
      authorizedUntil: now + OFFLINE_AUTH_TTL_MS,
    };
  }

  activateOnline({ user }) {
    const { id, profile } = validateUser(user);
    const now = Date.now();
    const existing = this.db.exec(
      "SELECT user_id FROM offline_accounts WHERE user_id=?",
      [id],
    )[0]?.values?.[0];
    if (!existing) return false;
    this.db.run(
      "UPDATE offline_accounts SET profile_json=?,authorized_until=?,last_online_at=?,failed_attempts=0,locked_until=0,last_seen_at=? WHERE user_id=?",
      [profile, now + OFFLINE_AUTH_TTL_MS, now, now, id],
    );
    this.activeUserId = id;
    this.persist();
    return true;
  }

  recordOfflineFailure(email) {
    const now = Date.now();
    const previous = this.db.exec(
      "SELECT failures,lock_level FROM offline_auth_attempts WHERE email=?",
      [email],
    )[0]?.values?.[0];
    const failures = Number(previous?.[0] ?? 0) + 1;
    let level = Number(previous?.[1] ?? 0);
    let lockedUntil = 0;
    let remaining = failures;
    if (failures >= 5) {
      lockedUntil = now + Math.min(60_000 * 2 ** level, 24 * 60 * 60 * 1000);
      level = Math.min(level + 1, 10);
      remaining = 0;
    }
    this.db.run(
      `INSERT INTO offline_auth_attempts(email,failures,lock_level,locked_until,updated_at) VALUES(?,?,?,?,?)
       ON CONFLICT(email) DO UPDATE SET failures=excluded.failures,lock_level=excluded.lock_level,
         locked_until=excluded.locked_until,updated_at=excluded.updated_at`,
      [email, remaining, level, lockedUntil, now],
    );
    this.persist();
  }

  authenticateOffline({ email, password }) {
    const normalizedEmail = normalizeEmail(email);
    if (
      !normalizedEmail ||
      typeof password !== "string" ||
      password.length < 1 ||
      password.length > 512
    ) {
      throw new Error("Identifiants hors ligne invalides.");
    }
    const now = Date.now();
    const throttle = this.db.exec(
      "SELECT locked_until FROM offline_auth_attempts WHERE email=?",
      [normalizedEmail],
    )[0]?.values?.[0];
    if (throttle && now < Number(throttle[0]))
      throw new Error("Trop de tentatives. Réessayez plus tard.");

    const result = this.db.exec(
      `SELECT user_id,email,profile_json,password_salt,password_verifier,authorized_until
       FROM offline_accounts WHERE email = ?`,
      [normalizedEmail],
    );
    const row = result[0]?.values?.[0];
    if (!row) {
      // A bounded KDF keeps unknown-account timing closer to wrong-password timing.
      crypto.scryptSync(password, Buffer.alloc(16), 32, SCRYPT_OPTIONS);
      this.recordOfflineFailure(normalizedEmail);
      throw new Error(
        "Adresse e-mail ou mot de passe incorrect, ou compte non autorisé hors ligne.",
      );
    }
    const [userId, , profileJson, salt, verifier, authorizedUntil] = row;
    if (!verifyPassword(password, Buffer.from(salt), Buffer.from(verifier))) {
      this.recordOfflineFailure(normalizedEmail);
      throw new Error("Adresse e-mail ou mot de passe incorrect.");
    }
    if (now >= Number(authorizedUntil)) {
      throw new Error(
        "L'autorisation hors ligne a expiré. Reconnectez-vous à Internet.",
      );
    }

    this.db.run("DELETE FROM offline_auth_attempts WHERE email=?", [
      normalizedEmail,
    ]);
    this.db.run(
      "UPDATE offline_accounts SET failed_attempts=0,locked_until=0 WHERE user_id=?",
      [userId],
    );
    this.activeUserId = userId;
    this.assertUser(userId);
    this.persist();
    return {
      user: JSON.parse(profileJson),
      authorizedUntil: Number(authorizedUntil),
      offline: true,
    };
  }

  pruneCache(userId) {
    let stats = this.db.exec(
      "SELECT COUNT(*),COALESCE(SUM(length(CAST(response_json AS BLOB))),0) FROM cached_responses WHERE user_id=?",
      [userId],
    )[0]?.values?.[0] ?? [0, 0];
    let count = Number(stats[0]);
    let bytes = Number(stats[1]);
    while (
      count > MAX_CACHE_ENTRIES_PER_USER ||
      bytes > MAX_CACHE_BYTES_PER_USER
    ) {
      const batch = Math.max(1, Math.ceil(count * 0.1));
      this.db.run(
        `DELETE FROM cached_responses WHERE rowid IN (
          SELECT rowid FROM cached_responses WHERE user_id=? ORDER BY cached_at ASC LIMIT ?
        )`,
        [userId, batch],
      );
      stats = this.db.exec(
        "SELECT COUNT(*),COALESCE(SUM(length(CAST(response_json AS BLOB))),0) FROM cached_responses WHERE user_id=?",
        [userId],
      )[0]?.values?.[0] ?? [0, 0];
      count = Number(stats[0]);
      bytes = Number(stats[1]);
    }
  }

  cacheResponse({ userId, space = "", requestKey, response }) {
    this.assertUser(userId);
    if (
      typeof requestKey !== "string" ||
      !requestKey.startsWith("/") ||
      requestKey.length > 2048
    ) {
      throw new Error("Clé de cache invalide.");
    }
    if (typeof space !== "string" || space.length > 64)
      throw new Error("Espace de travail invalide.");
    const json = JSON.stringify(response);
    if (Buffer.byteLength(json, "utf8") > MAX_RESPONSE_BYTES)
      throw new Error("Réponse trop volumineuse pour le cache hors ligne.");
    this.db.run(
      `INSERT INTO cached_responses(user_id,space,request_key,response_json,cached_at) VALUES(?,?,?,?,?)
       ON CONFLICT(user_id,space,request_key) DO UPDATE SET response_json=excluded.response_json,cached_at=excluded.cached_at`,
      [userId, space, requestKey, json, Date.now()],
    );
    this.pruneCache(userId);
    // Les réponses GET sont immuables depuis le serveur et peuvent être mises
    // en lot sur une courte fenêtre pour ne pas réexporter toute la base par
    // requête ; close() force un flush avant la sortie normale.
    this.scheduleCachePersist();
  }

  getCachedResponse({ userId, space = "", requestKey }) {
    this.assertUser(userId);
    if (
      typeof requestKey !== "string" ||
      !requestKey.startsWith("/") ||
      requestKey.length > 2048
    ) {
      throw new Error("Clé de cache invalide.");
    }
    const result = this.db.exec(
      "SELECT response_json,cached_at FROM cached_responses WHERE user_id=? AND space=? AND request_key=?",
      [userId, space, requestKey],
    );
    const row = result[0]?.values?.[0];
    return row
      ? { response: JSON.parse(row[0]), cachedAt: Number(row[1]) }
      : null;
  }

  status({ userId }) {
    this.assertUser(userId);
    const account = this.db.exec(
      "SELECT authorized_until,last_online_at FROM offline_accounts WHERE user_id=?",
      [userId],
    )[0]?.values?.[0];
    const pending =
      this.db.exec(
        "SELECT COUNT(*) FROM pending_operations WHERE user_id=? AND state IN ('pending','in_progress')",
        [userId],
      )[0]?.values?.[0]?.[0] ?? 0;
    const conflicts =
      this.db.exec(
        "SELECT COUNT(*) FROM sync_conflicts WHERE user_id=? AND state='open'",
        [userId],
      )[0]?.values?.[0]?.[0] ?? 0;
    return {
      authorizedUntil: Number(account?.[0] ?? 0),
      lastOnlineAt: Number(account?.[1] ?? 0),
      pending: Number(pending),
      conflicts: Number(conflicts),
    };
  }

  clearActiveAccount() {
    this.activeUserId = null;
  }

  close() {
    if (this.db) {
      this.persist();
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = { OfflineStore, OFFLINE_AUTH_TTL_MS };
