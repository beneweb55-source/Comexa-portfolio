"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const STORE_HEADER = Buffer.from("COMEXA-LOCAL-DB\0v1\n", "utf8");
const MAX_PROFILE_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_CACHE_ENTRIES_PER_USER = 1_000;
const MAX_CACHE_BYTES_PER_USER = 128 * 1024 * 1024;
const MAX_PENDING_OPERATIONS_PER_USER = 10_000;
const MAX_PENDING_BYTES_PER_USER = 64 * 1024 * 1024;
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
  `ALTER TABLE cached_responses ADD COLUMN resource_key TEXT NOT NULL DEFAULT '';
   ALTER TABLE pending_operations ADD COLUMN request_path TEXT NOT NULL DEFAULT '';
   ALTER TABLE pending_operations ADD COLUMN http_method TEXT NOT NULL DEFAULT 'POST';
   ALTER TABLE pending_operations ADD COLUMN idempotency_key TEXT NOT NULL DEFAULT '';
   ALTER TABLE pending_operations ADD COLUMN resource_key TEXT NOT NULL DEFAULT '';
   ALTER TABLE pending_operations ADD COLUMN local_result_json TEXT;
   ALTER TABLE pending_operations ADD COLUMN base_json TEXT;
   ALTER TABLE pending_operations ADD COLUMN base_request_key TEXT;
   ALTER TABLE pending_operations ADD COLUMN is_create INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE pending_operations ADD COLUMN server_result_json TEXT;
   CREATE TABLE local_id_mappings (
     user_id TEXT NOT NULL,
     local_id TEXT NOT NULL,
     server_id TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     PRIMARY KEY(user_id, local_id),
     FOREIGN KEY(user_id) REFERENCES offline_accounts(user_id) ON DELETE CASCADE
   );
   CREATE TABLE sync_conflict_resolutions (
     conflict_id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     resolution TEXT NOT NULL CHECK(resolution IN ('local','server')),
     local_json TEXT NOT NULL,
     server_json TEXT,
     created_at INTEGER NOT NULL,
     FOREIGN KEY(user_id) REFERENCES offline_accounts(user_id) ON DELETE CASCADE
   );`,
];

const QUEUEABLE_OFFLINE_ROUTES = [
  ["POST", /^\/projects$/], ["PATCH", /^\/projects\/[^/]+(?:\/status)?$/], ["DELETE", /^\/projects\/[^/]+$/],
  ["POST", /^\/projects\/[^/]+\/tasks$/], ["POST", /^\/me\/tasks$/],
  ["PATCH", /^\/tasks\/[^/]+(?:\/(?:status|assign))?$/], ["DELETE", /^\/tasks\/[^/]+$/],
  ["POST", /^\/me\/goals$/], ["PATCH", /^\/me\/goals\/[^/]+$/], ["DELETE", /^\/me\/goals\/[^/]+$/],
  ["PUT", /^\/me\/goals\/[^/]+\/tasks\/[^/]+$/], ["DELETE", /^\/me\/goals\/[^/]+\/tasks\/[^/]+$/],
  ["POST", /^\/me\/calendar\/events$/], ["PATCH", /^\/me\/calendar\/events\/[^/]+$/], ["DELETE", /^\/me\/calendar\/events\/[^/]+$/],
  ["POST", /^\/tasks\/[^/]+\/time-entries$/], ["PATCH", /^\/time-entries\/[^/]+$/], ["DELETE", /^\/time-entries\/[^/]+$/],
  ["PUT", /^\/daily-reports\/\d{4}-\d{2}-\d{2}$/], ["DELETE", /^\/daily-reports\/\d{4}-\d{2}-\d{2}$/],
  ["POST", /^\/clients$/], ["PATCH", /^\/clients\/[^/]+$/], ["DELETE", /^\/clients\/[^/]+$/], ["POST", /^\/clients\/[^/]+\/contacts$/],
  ["PATCH", /^\/contacts\/[^/]+$/], ["DELETE", /^\/contacts\/[^/]+$/], ["POST", /^\/reports$/],
  ["POST", /^\/prospects$/], ["PATCH", /^\/prospects\/[^/]+$/], ["DELETE", /^\/prospects\/[^/]+$/], ["POST", /^\/prospects\/[^/]+\/status$/],
  ["POST", /^\/projects\/[^/]+\/milestones$/], ["PATCH", /^\/milestones\/[^/]+$/], ["DELETE", /^\/milestones\/[^/]+$/],
  ["PATCH", /^\/documents\/[^/]+$/], ["DELETE", /^\/documents\/[^/]+$/],
  ["POST", /^\/notifications\/read-all$/], ["POST", /^\/notifications\/[^/]+\/read$/], ["DELETE", /^\/notifications\/[^/]+$/],
];

function isQueueableOfflineRoute(method, requestPath) {
  const pathname = String(requestPath).split("?", 1)[0].replace(/\/$/, "") || "/";
  return QUEUEABLE_OFFLINE_ROUTES.some(([verb, pattern]) => verb === method && pattern.test(pathname));
}

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

  findEntitySnapshot(value, entityId) {
    if (!value || typeof value !== "object") return null;
    if (!Array.isArray(value) && [value.id, value.date, value.eventDate].some((candidate) => candidate != null && (String(candidate) === String(entityId) || (/^\d{4}-\d{2}-\d{2}$/.test(String(entityId)) && String(candidate).slice(0, 10) === String(entityId))))) return value;
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      const found = this.findEntitySnapshot(child, entityId);
      if (found) return found;
    }
    return null;
  }

  enqueueMutation({
    userId,
    space = "",
    method,
    requestPath,
    body,
    entityType,
    entityId = null,
    resourceKey,
    localResult = null,
    idempotencyKey = null,
    isCreate = false,
  }) {
    this.assertUser(userId);
    const verb = typeof method === "string" ? method.toUpperCase() : "";
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(verb)) throw new Error("Méthode hors ligne interdite.");
    if (typeof requestPath !== "string" || !requestPath.startsWith("/") || requestPath.length > 2048 || /[\r\n#]/.test(requestPath) || !isQueueableOfflineRoute(verb, requestPath)) {
      throw new Error("Cette route n'est pas autorisée dans l'outbox hors ligne.");
    }
    if (typeof entityType !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(entityType)) throw new Error("Type d'entité hors ligne invalide.");
    if (typeof resourceKey !== "string" || resourceKey.length > 256) throw new Error("Ressource hors ligne invalide.");
    const bodyJson = body === undefined ? "null" : JSON.stringify(body);
    if (Buffer.byteLength(bodyJson, "utf8") > 2 * 1024 * 1024) throw new Error("Cette modification dépasse la taille autorisée hors ligne.");
    const operationId = crypto.randomUUID();
    const stableIdempotencyKey = idempotencyKey || crypto.randomUUID();
    if (typeof stableIdempotencyKey !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(stableIdempotencyKey)) throw new Error("Clé d'idempotence invalide.");
    let local = localResult;
    if (verb === "POST" && isCreate && (!local || typeof local !== "object")) {
      local = { ...(body && typeof body === "object" ? body : {}), id: `local:${operationId}`, offlineState: "pending" };
      const projectTask = requestPath.match(/^\/projects\/([^/?]+)\/tasks(?:\?|$)/);
      if (projectTask) local.projectId = projectTask[1];
    } else if (!isCreate && ["POST", "PATCH", "PUT"].includes(verb) && (!local || typeof local !== "object")) {
      local = { ...(body && typeof body === "object" ? body : {}), ...(entityId ? { id: String(entityId) } : {}) };
      if (resourceKey === "notifications") local.readAt = new Date().toISOString();
    }
    if (local) {
      local = { ...local, id: local.id ?? `local:${operationId}`, offlineState: "pending", offlineOperationId: operationId };
      if (Buffer.byteLength(JSON.stringify(local), "utf8") > MAX_RESPONSE_BYTES) throw new Error("La modification locale est trop volumineuse.");
    }
    let base = null;
    let baseRequestKey = null;
    if (entityId) {
      const cachedRows = this.db.exec("SELECT request_key,response_json FROM cached_responses WHERE user_id=? AND space=? ORDER BY cached_at DESC", [userId, space])[0]?.values ?? [];
      for (const [cacheKey,json] of cachedRows) {
        try {
          base = this.findEntitySnapshot(JSON.parse(json), entityId);
          if (base) { baseRequestKey = cacheKey; break; }
        } catch {}
      }
    }
    const operationText = `${requestPath}\n${bodyJson}`;
    const pendingCreates = this.db.exec(
      "SELECT operation_id,local_result_json FROM pending_operations WHERE user_id=? AND state IN ('pending','in_progress','failed') AND http_method='POST' AND local_result_json IS NOT NULL",
      [userId],
    )[0]?.values ?? [];
    const dependencies = [];
    for (const [creatorId, resultJson] of pendingCreates) {
      try {
        const created = JSON.parse(resultJson);
        if (created.id && operationText.includes(String(created.id)) && creatorId !== operationId) dependencies.push(creatorId);
      } catch {}
    }
    if (entityId != null) {
      const priorEntityOperations = this.db.exec(
        "SELECT operation_id FROM pending_operations WHERE user_id=? AND entity_id=? AND state IN ('pending','in_progress','failed','conflict') ORDER BY created_at,operation_id",
        [userId,String(entityId)],
      )[0]?.values ?? [];
      for (const [priorId] of priorEntityOperations) if (priorId !== operationId) dependencies.push(priorId);
    }
    const orderedDependencies = [...new Set(dependencies)];
    const pendingStats = this.db.exec(
      "SELECT COUNT(*),COALESCE(SUM(length(CAST(payload_json AS BLOB))+COALESCE(length(CAST(local_result_json AS BLOB)),0)),0) FROM pending_operations WHERE user_id=? AND state IN ('pending','in_progress','failed','conflict')",
      [userId],
    )[0]?.values?.[0] ?? [0, 0];
    if (Number(pendingStats[0]) >= MAX_PENDING_OPERATIONS_PER_USER || Number(pendingStats[1]) + Buffer.byteLength(bodyJson, "utf8") > MAX_PENDING_BYTES_PER_USER) {
      throw new Error("La file de modifications hors ligne a atteint sa limite de sécurité. Synchronisez-la avant de continuer.");
    }
    const now = Date.now();
    this.db.run("BEGIN IMMEDIATE");
    try {
      this.db.run(
        `INSERT INTO pending_operations
         (operation_id,user_id,space,operation_type,entity_type,entity_id,payload_json,base_version,depends_on,state,attempts,next_attempt_at,created_at,updated_at,last_error,request_path,http_method,idempotency_key,resource_key,local_result_json,base_json,base_request_key,is_create)
         VALUES(?,?,?,?,?,?,?,?,?,'pending',0,0,?,?,?,?,?,?,?,?,?,?,?)`,
        [operationId,userId,space,verb,entityType,String(entityId ?? local?.id ?? operationId),bodyJson,base?.updatedAt == null ? null : String(base.updatedAt),JSON.stringify(orderedDependencies),now,now,null,requestPath,verb,stableIdempotencyKey,resourceKey,local ? JSON.stringify(local) : null,base ? JSON.stringify(base) : null,baseRequestKey,isCreate?1:0],
      );
      this.db.run("COMMIT");
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    }
    this.persist();
    return { operationId, idempotencyKey: stableIdempotencyKey, localResult: local, dependsOn: orderedDependencies, baseSnapshot: base };
  }

  listPendingOperations({ userId, includeFailed = true }) {
    this.assertUser(userId);
    const states = includeFailed ? "('pending','failed','in_progress')" : "('pending')";
    const rows = this.db.exec(
      `SELECT operation_id,space,operation_type,entity_type,entity_id,payload_json,depends_on,state,attempts,next_attempt_at,last_error,request_path,http_method,idempotency_key,resource_key,local_result_json,base_json,server_result_json,created_at,base_request_key,is_create,base_version FROM pending_operations WHERE user_id=? AND state IN ${states} ORDER BY created_at,operation_id`,
      [userId],
    )[0]?.values ?? [];
    return rows.map((row) => ({
      operationId: row[0], space: row[1], method: row[2], entityType: row[3], entityId: row[4],
      body: JSON.parse(row[5]), dependsOn: JSON.parse(row[6] || "[]"), state: row[7], attempts: Number(row[8]),
      nextAttemptAt: Number(row[9]), lastError: row[10], path: row[11], idempotencyKey: row[13],
      resourceKey: row[14], localResult: row[15] ? JSON.parse(row[15]) : null,
      baseSnapshot: row[16] ? JSON.parse(row[16]) : null,
      serverResult: row[17] ? JSON.parse(row[17]) : null, createdAt: Number(row[18]), baseRequestKey: row[19], isCreate: Boolean(row[20]), baseVersion: row[21],
    }));
  }

  listLocalIdMappings({ userId }) {
    this.assertUser(userId);
    const rows = this.db.exec("SELECT local_id,server_id FROM local_id_mappings WHERE user_id=?", [userId])[0]?.values ?? [];
    return Object.fromEntries(rows.map(([localId, serverId]) => [localId, serverId]));
  }

  updateOperation({ userId, operationId, state, lastError = null, nextAttemptAt = 0, serverResult = null }) {
    this.assertUser(userId);
    if (!["pending","in_progress","synced","conflict","failed"].includes(state)) throw new Error("État de synchronisation invalide.");
    const row = this.db.exec("SELECT local_result_json FROM pending_operations WHERE user_id=? AND operation_id=?", [userId, operationId])[0]?.values?.[0];
    if (!row) throw new Error("Opération locale introuvable.");
    const local = row[0] ? JSON.parse(row[0]) : null;
    const remote = serverResult && typeof serverResult === "object" ? (serverResult.data ?? serverResult) : null;
    this.db.run(
      "UPDATE pending_operations SET state=?,attempts=attempts+CASE WHEN ? IN ('synced','failed','pending') THEN 1 ELSE 0 END,next_attempt_at=?,updated_at=?,last_error=?,server_result_json=? WHERE user_id=? AND operation_id=?",
      [state,state,nextAttemptAt,Date.now(),lastError,remote ? JSON.stringify(remote) : null,userId,operationId],
    );
    if (state === "synced" && local?.id?.startsWith("local:") && remote?.id) {
      this.db.run("INSERT OR REPLACE INTO local_id_mappings(user_id,local_id,server_id,created_at) VALUES(?,?,?,?)", [userId,local.id,String(remote.id),Date.now()]);
    }
    if (state === "synced") {
      const dependents = this.db.exec("SELECT operation_id,depends_on,entity_id FROM pending_operations WHERE user_id=? AND state IN ('pending','failed')", [userId])[0]?.values ?? [];
      for (const [dependentId, dependencyJson, dependentEntityId] of dependents) {
        let dependencies;
        try { dependencies = JSON.parse(dependencyJson || "[]"); } catch { dependencies = []; }
        if (!dependencies.includes(operationId)) continue;
        dependencies = dependencies.filter((id) => id !== operationId);
        const sameEntity = local?.id && String(dependentEntityId) === String(local.id) && remote;
        this.db.run("UPDATE pending_operations SET depends_on=?,base_json=CASE WHEN ? THEN ? ELSE base_json END,base_version=CASE WHEN ? THEN ? ELSE base_version END WHERE operation_id=? AND user_id=?", [JSON.stringify(dependencies),sameEntity?1:0,sameEntity?JSON.stringify(remote):null,sameEntity?1:0,sameEntity&&remote?.updatedAt!=null?String(remote.updatedAt):null,dependentId,userId]);
      }
    }
    this.persist();
  }

  recordConflict({ userId, operationId, serverSnapshot, changedFields = [], message = "Les données ont changé sur le serveur." }) {
    this.assertUser(userId);
    const row = this.db.exec("SELECT entity_type,entity_id,local_result_json,base_json FROM pending_operations WHERE user_id=? AND operation_id=?", [userId,operationId])[0]?.values?.[0];
    if (!row) throw new Error("Opération locale introuvable.");
    const conflictId = crypto.randomUUID();
    const local = row[2] ? JSON.parse(row[2]) : JSON.parse(this.db.exec("SELECT payload_json FROM pending_operations WHERE operation_id=?", [operationId])[0].values[0][0]);
    const base = row[3] ? JSON.parse(row[3]) : null;
    const server = serverSnapshot ?? null;
    this.db.run("BEGIN IMMEDIATE");
    let committed = false;
    try {
      this.db.run("UPDATE pending_operations SET state='conflict',updated_at=?,last_error=? WHERE user_id=? AND operation_id=?", [Date.now(),message,userId,operationId]);
      this.db.run(
        `INSERT OR REPLACE INTO sync_conflicts(conflict_id,operation_id,user_id,entity_type,entity_id,base_json,local_json,server_json,fields_json,state,created_at,resolved_at)
         VALUES(?,?,?,?,?,?,?,?,?,'open',?,NULL)`,
        [conflictId,operationId,userId,row[0],row[1],base ? JSON.stringify(base) : null,JSON.stringify(local),server ? JSON.stringify(server) : null,JSON.stringify(changedFields),Date.now()],
      );
      this.db.run("COMMIT");
      committed = true;
    } catch (error) {
      if (!committed) this.db.run("ROLLBACK");
      throw error;
    }
    this.persist();
    return conflictId;
  }

  listConflicts({ userId }) {
    this.assertUser(userId);
    const rows = this.db.exec("SELECT conflict_id,operation_id,entity_type,entity_id,base_json,local_json,server_json,fields_json,created_at FROM sync_conflicts WHERE user_id=? AND state='open' ORDER BY created_at", [userId])[0]?.values ?? [];
    return rows.map((row) => ({ conflictId:row[0],operationId:row[1],entityType:row[2],entityId:row[3],base:row[4]?JSON.parse(row[4]):null,local:JSON.parse(row[5]),server:row[6]?JSON.parse(row[6]):null,fields:JSON.parse(row[7]),createdAt:Number(row[8]) }));
  }

  resolveConflict({ userId, conflictId, resolution }) {
    this.assertUser(userId);
    if (!["local","server"].includes(resolution)) throw new Error("Résolution de conflit invalide.");
    const row = this.db.exec("SELECT operation_id,server_json,local_json,entity_id FROM sync_conflicts WHERE conflict_id=? AND user_id=? AND state='open'", [conflictId,userId])[0]?.values?.[0];
    if (!row) throw new Error("Conflit introuvable.");
    const server = row[1] ? JSON.parse(row[1]) : null;
    const local = JSON.parse(row[2]);
    this.db.run("BEGIN IMMEDIATE");
    let committed = false;
    try {
      this.db.run("INSERT INTO sync_conflict_resolutions(conflict_id,user_id,resolution,local_json,server_json,created_at) VALUES(?,?,?,?,?,?)", [conflictId,userId,resolution,JSON.stringify(local),server?JSON.stringify(server):null,Date.now()]);
      this.db.run("UPDATE sync_conflicts SET state='resolved',resolved_at=? WHERE conflict_id=?", [Date.now(),conflictId]);
      if (resolution === "local") {
        this.db.run("UPDATE pending_operations SET state='pending',base_json=?,base_version=?,attempts=0,next_attempt_at=0,last_error=NULL,updated_at=? WHERE operation_id=? AND user_id=?", [server?JSON.stringify(server):null,server?.updatedAt==null?null:String(server.updatedAt),Date.now(),row[0],userId]);
      } else {
        this.db.run("UPDATE pending_operations SET state='synced',server_result_json=?,updated_at=?,last_error=NULL WHERE operation_id=? AND user_id=?", [server?JSON.stringify(server):null,Date.now(),row[0],userId]);
        const dependents = this.db.exec("SELECT operation_id,depends_on,entity_id FROM pending_operations WHERE user_id=? AND state IN ('pending','failed')", [userId])[0]?.values ?? [];
        for (const [dependentId, dependencyJson, dependentEntityId] of dependents) {
          let dependencies;
          try { dependencies = JSON.parse(dependencyJson || "[]"); } catch { dependencies = []; }
          if (!dependencies.includes(row[0])) continue;
          dependencies = dependencies.filter((id) => id !== row[0]);
          const sameEntity = String(dependentEntityId) === String(row[3] ?? "") && server;
          this.db.run("UPDATE pending_operations SET depends_on=?,base_json=CASE WHEN ? THEN ? ELSE base_json END,base_version=CASE WHEN ? THEN ? ELSE base_version END WHERE operation_id=? AND user_id=?", [JSON.stringify(dependencies),sameEntity?1:0,sameEntity?JSON.stringify(server):null,sameEntity?1:0,sameEntity&&server?.updatedAt!=null?String(server.updatedAt):null,dependentId,userId]);
        }
      }
      this.db.run("COMMIT");
      committed = true;
    } catch(error) {
      if (!committed) this.db.run("ROLLBACK");
      throw error;
    }
    this.persist();
  }

  listCachedEntries({ userId }) {
    this.assertUser(userId);
    return (this.db.exec("SELECT space,request_key,cached_at,resource_key FROM cached_responses WHERE user_id=? ORDER BY cached_at ASC", [userId])[0]?.values ?? []).map((row) => ({space:row[0],requestKey:row[1],cachedAt:Number(row[2]),resourceKey:row[3]}));
  }

  findCachedEntity({ userId, space = "", entityId }) {
    this.assertUser(userId);
    const rows = this.db.exec("SELECT request_key,response_json FROM cached_responses WHERE user_id=? AND space=? ORDER BY cached_at DESC", [userId,space])[0]?.values ?? [];
    for (const [requestKey,json] of rows) {
      try {
        const result = this.findEntitySnapshot(JSON.parse(json),entityId);
        if (result) return {requestKey,entity:result};
      } catch {}
    }
    return null;
  }

  renameCachedRequest({ userId, space = "", oldRequestKey, newRequestKey }) {
    this.assertUser(userId);
    if (!oldRequestKey.startsWith("/") || !newRequestKey.startsWith("/")) throw new Error("Clé de cache invalide.");
    const existing = this.db.exec("SELECT response_json,cached_at,resource_key FROM cached_responses WHERE user_id=? AND space=? AND request_key=?", [userId,space,oldRequestKey])[0]?.values?.[0];
    if (!existing) return false;
    this.db.run("DELETE FROM cached_responses WHERE user_id=? AND space=? AND request_key=?", [userId,space,oldRequestKey]);
    this.db.run("INSERT OR REPLACE INTO cached_responses(user_id,space,request_key,response_json,cached_at,resource_key) VALUES(?,?,?,?,?,?)", [userId,space,newRequestKey,existing[0],existing[1],existing[2]]);
    this.persist();
    return true;
  }

  deleteCachedEntry({ userId, space = "", requestKey }) {
    this.assertUser(userId);
    this.db.run("DELETE FROM cached_responses WHERE user_id=? AND space=? AND request_key=?", [userId,space,requestKey]);
    this.persist();
  }

  cacheResponse({ userId, space = "", requestKey, response, resourceKey = "" }) {
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
      `INSERT INTO cached_responses(user_id,space,request_key,response_json,cached_at,resource_key) VALUES(?,?,?,?,?,?)
       ON CONFLICT(user_id,space,request_key) DO UPDATE SET response_json=excluded.response_json,cached_at=excluded.cached_at,resource_key=excluded.resource_key`,
      [userId, space, requestKey, json, Date.now(), String(resourceKey).slice(0, 256)],
    );
    this.pruneCache(userId);
    // Les réponses GET sont immuables depuis le serveur et peuvent être mises
    // en lot sur une courte fenêtre pour ne pas réexporter toute la base par
    // requête ; close() force un flush avant la sortie normale.
    this.scheduleCachePersist();
  }

  matchesEntity(item, entityId) {
    if (!item || typeof item !== "object") return false;
    return [item.id, item.date, item.eventDate].some((candidate) => candidate != null && (String(candidate) === String(entityId) || (/^\d{4}-\d{2}-\d{2}$/.test(String(entityId)) && String(candidate).slice(0, 10) === String(entityId))));
  }

  mergeOptimisticEntity(item, localResult) {
    const { id: localId, ...fields } = localResult;
    return { ...item, ...fields, id: item.id ?? localId, offlineState: "pending" };
  }

  matchesCachedQuery(item, requestKey) {
    const query = String(requestKey).split("?", 2)[1];
    if (!query || !item || typeof item !== "object") return true;
    const params = new URLSearchParams(query);
    const exact = ["status", "priority", "assigneeId", "reporterId", "clientId", "projectId", "category", "visibility"];
    for (const key of exact) {
      const expected = params.get(key);
      if (!expected) continue;
      const nestedKey = key.endsWith("Id") ? key.slice(0, -2) : "";
      const actual = item[key] ?? (nestedKey ? item[nestedKey]?.id : undefined);
      if (String(actual ?? "") !== expected) return false;
    }
    const search = params.get("q") || params.get("search");
    if (search && !JSON.stringify(item).toLocaleLowerCase().includes(search.toLocaleLowerCase())) return false;
    const read = params.get("read");
    if (read === "false" && item.readAt) return false;
    if (read === "true" && !item.readAt) return false;
    return true;
  }

  applyOptimisticOperation(value, operation, isRoot = false, requestKey = "") {
    if (Array.isArray(value)) {
      let next = value.map((item) => this.applyOptimisticOperation(item, operation, false, requestKey));
      const id = String(operation.entityId ?? "");
      if (operation.method === "DELETE") {
        if (operation.entityType === "goal-task-link" && operation.localResult) {
          return next.map((item) => this.matchesEntity(item, id) ? this.mergeOptimisticEntity(item, operation.localResult) : item);
        }
        return next.filter((item) => !this.matchesEntity(item, id));
      }
      if (operation.method === "POST" && !operation.isCreate && operation.localResult) {
        return operation.entityId === "*"
          ? next.map((item) => this.mergeOptimisticEntity(item, operation.localResult)).filter((item) => this.matchesCachedQuery(item, requestKey))
          : next.map((item) => this.matchesEntity(item, id) ? this.mergeOptimisticEntity(item, operation.localResult) : item).filter((item) => this.matchesCachedQuery(item, requestKey));
      }
      if (["PATCH", "PUT"].includes(operation.method)) return next.filter((item) => this.matchesCachedQuery(item, requestKey));
      if (operation.method === "POST" && operation.isCreate && operation.localResult && isRoot && !next.some((item) => String(item?.id ?? "") === String(operation.localResult.id)) && this.matchesCachedQuery(operation.localResult, requestKey)) {
        next = [operation.localResult, ...next];
      }
      return next;
    }
    if (!value || typeof value !== "object") return value;
    const id = String(operation.entityId ?? "");
    if (this.matchesEntity(value, id)) {
      if (operation.method === "DELETE") {
        if (operation.entityType === "goal-task-link" && operation.localResult) return this.mergeOptimisticEntity(value, operation.localResult);
        return null;
      }
      if ((["PATCH", "PUT"].includes(operation.method) || (operation.method === "POST" && !operation.isCreate)) && operation.localResult) return this.mergeOptimisticEntity(value, operation.localResult);
    }
    const allowedArrays = new Set(["items","results","records","data","projects","tasks","goals","events","timeEntries","entries","reports","clients","contacts","prospects","milestones","notifications"]);
    const result = { ...value };
    for (const [key, child] of Object.entries(value)) {
      if (Array.isArray(child) && allowedArrays.has(key)) result[key] = this.applyOptimisticOperation(child, operation, true, requestKey);
      else if (child && typeof child === "object" && !Array.isArray(child)) result[key] = this.applyOptimisticOperation(child, operation, false, requestKey);
    }
    return result;
  }

  getCachedResponse({ userId, space = "", requestKey, resourceKey = "" }) {
    this.assertUser(userId);
    if (
      typeof requestKey !== "string" ||
      !requestKey.startsWith("/") ||
      requestKey.length > 2048
    ) {
      throw new Error("Clé de cache invalide.");
    }
    const result = this.db.exec(
      "SELECT response_json,cached_at,resource_key FROM cached_responses WHERE user_id=? AND space=? AND request_key=?",
      [userId, space, requestKey],
    );
    const row = result[0]?.values?.[0];
    if (row) {
      let response = JSON.parse(row[0]);
      const key = resourceKey || row[2];
      if (key) {
        const operations = this.db.exec(
          "SELECT operation_id,http_method,entity_id,local_result_json,resource_key,is_create,entity_type FROM pending_operations WHERE user_id=? AND space=? AND state IN ('pending','in_progress','failed','conflict') ORDER BY created_at,operation_id",
          [userId,space],
        )[0]?.values ?? [];
        for (const operation of operations) {
          if (operation[1] === "POST" && operation[5] && operation[4] !== key) continue;
          response = this.applyOptimisticOperation(response, {operationId:operation[0],method:operation[1],entityId:operation[2],localResult:operation[3]?JSON.parse(operation[3]):null,isCreate:Boolean(operation[5]),entityType:operation[6]}, true, requestKey);
        }
      }
      return { response, cachedAt: Number(row[1]) };
    }
    const localId = requestKey.split("?")[0].split("/").at(-1);
    const local = this.db.exec(
      "SELECT local_result_json,created_at FROM pending_operations WHERE user_id=? AND space=? AND entity_id=? AND http_method='POST' AND is_create=1 AND state IN ('pending','in_progress','failed','conflict') ORDER BY created_at DESC LIMIT 1",
      [userId,space,localId],
    )[0]?.values?.[0];
    return local ? {response:{success:true,data:JSON.parse(local[0])},cachedAt:Number(local[1]),offline:true}:null;
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
    const failed = this.db.exec("SELECT COUNT(*) FROM pending_operations WHERE user_id=? AND state='failed'", [userId])[0]?.values?.[0]?.[0] ?? 0;
    const conflicts =
      this.db.exec(
        "SELECT COUNT(*) FROM sync_conflicts WHERE user_id=? AND state='open'",
        [userId],
      )[0]?.values?.[0]?.[0] ?? 0;
    const lastSyncAt = this.db.exec("SELECT MAX(last_success_at) FROM sync_state WHERE user_id=?", [userId])[0]?.values?.[0]?.[0] ?? null;
    return {
      authorizedUntil: Number(account?.[0] ?? 0),
      lastOnlineAt: Number(account?.[1] ?? 0),
      lastSyncAt: lastSyncAt == null ? null : Number(lastSyncAt),
      pending: Number(pending),
      failed: Number(failed),
      conflicts: Number(conflicts),
    };
  }

  markSyncSuccess({ userId, space = "", syncedAt = Date.now() }) {
    this.assertUser(userId);
    this.db.run(
      `INSERT INTO sync_state(user_id,space,cursor,last_success_at) VALUES(?,?,NULL,?)
       ON CONFLICT(user_id,space) DO UPDATE SET last_success_at=excluded.last_success_at`,
      [userId,space,syncedAt],
    );
    this.persist();
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
