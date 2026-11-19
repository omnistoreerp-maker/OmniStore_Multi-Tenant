"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const config = require("../config");

const TOKEN_STORE_PATH = config.tokenStorePath;

const INITIALIZED_FLAG = path.join(path.dirname(TOKEN_STORE_PATH), ".token_store_initialized");

// Internal database connection (initialized on first use or via initialise())
let _db = null;

function _getDb() {
  if (!_db) {
    const resolved = resolveTokenStorePath();
    _db = _configure(new Database(resolved));
  }
  return _db;
}

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS session_families (
  familyId       TEXT PRIMARY KEY,
  sub            TEXT NOT NULL,
  tenantId       TEXT,
  createdAt      INTEGER NOT NULL,
  revokedAt      INTEGER,
  revocationReason TEXT
);

CREATE INDEX IF NOT EXISTS idx_session_families_sub ON session_families(sub);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  jti            TEXT PRIMARY KEY,
  familyId       TEXT NOT NULL,
  sub            TEXT NOT NULL,
  ver            INTEGER NOT NULL,
  tenantId       TEXT,
  issuedAt       INTEGER NOT NULL,
  expiresAt      INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('active','consumed','revoked','expired')),
  consumedAt     INTEGER,
  replacedByJti  TEXT,
  FOREIGN KEY (familyId) REFERENCES session_families(familyId) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(familyId);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_sub ON refresh_tokens(sub);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expiresAt);

CREATE TABLE IF NOT EXISTS access_token_denylist (
  jti         TEXT PRIMARY KEY,
  expiresAt   INTEGER NOT NULL,
  revokedAt   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_access_token_denylist_expires ON access_token_denylist(expiresAt);

CREATE TABLE IF NOT EXISTS legacy_revocations (
  hash         TEXT PRIMARY KEY,
  expiresAt    INTEGER,
  migratedAt   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_legacy_revocations_expires ON legacy_revocations(expiresAt);

CREATE TABLE IF NOT EXISTS replay_audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  familyId     TEXT NOT NULL,
  sub          TEXT NOT NULL,
  replayedJti  TEXT NOT NULL,
  timestamp    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_replay_audit_family ON replay_audit(familyId);
CREATE INDEX IF NOT EXISTS idx_replay_audit_timestamp ON replay_audit(timestamp);
`;

class TokenStoreError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "TokenStoreError";
    this.cause = cause;
  }
}

function resolveTokenStorePath() {
  return config.tokenStorePath;
}

function validateDbPath(dbPath) {
  if (dbPath === undefined || dbPath === null || String(dbPath).trim() === "") {
    throw new TokenStoreError("A token store database path is required");
  }
  const resolved = path.resolve(String(dbPath).trim());
  const directory = path.dirname(resolved);

  let dirStat;
  try {
    dirStat = fs.statSync(directory);
  } catch (_) {
    throw new TokenStoreError(
      `Token store database directory does not exist: ${directory}. ` +
        "Create it and grant the service account write access before starting."
    );
  }
  if (!dirStat.isDirectory()) {
    throw new TokenStoreError(`Token store database directory is not a directory: ${directory}`);
  }
  try {
    fs.accessSync(directory, fs.constants.W_OK);
  } catch (_) {
    throw new TokenStoreError(`Token store database directory is not writable: ${directory}`);
  }

  if (fs.existsSync(resolved)) {
    let fileStat;
    try {
      fileStat = fs.statSync(resolved);
    } catch (err) {
      throw new TokenStoreError(`Token store database path is not accessible: ${resolved}`, err);
    }
    if (!fileStat.isFile()) {
      throw new TokenStoreError(`Token store database path is not a regular file: ${resolved}`);
    }
    try {
      fs.accessSync(resolved, fs.constants.W_OK);
    } catch (_) {
      throw new TokenStoreError(`Token store database file is not writable: ${resolved}`);
    }
  }

  return resolved;
}

function _configure(db) {
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = FULL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

function initialise(dbPath) {
  const resolved = validateDbPath(dbPath || resolveTokenStorePath());
  try {
    const db = _configure(new Database(resolved));
    _db = db;
    if (!fs.existsSync(INITIALIZED_FLAG)) {
      fs.writeFileSync(INITIALIZED_FLAG, String(Date.now()));
    }
    return { db, path: resolved };
  } catch (err) {
    if (err instanceof TokenStoreError) throw err;
    throw new TokenStoreError(
      `Could not open token store database at ${resolved}: ${err.message}`,
      err
    );
  }
}

function validateStartupConfiguration() {
  const resolved = resolveTokenStorePath();
  const directory = path.dirname(resolved);

  if (!fs.existsSync(directory)) {
    throw new TokenStoreError(`Token store directory missing: ${directory}`);
  }
  if (!fs.statSync(directory).isDirectory()) {
    throw new TokenStoreError(`Token store path is not a directory: ${directory}`);
  }
  try {
    fs.accessSync(directory, fs.constants.W_OK);
  } catch (_) {
    throw new TokenStoreError(`Token store directory not writable: ${directory}`);
  }

  const dbExists = fs.existsSync(resolved);
  const wasInitialized = fs.existsSync(INITIALIZED_FLAG);

  if (dbExists) {
    try {
      fs.accessSync(resolved, fs.constants.R_OK | fs.constants.W_OK);
    } catch (_) {
      throw new TokenStoreError(`Token store database not accessible: ${resolved}`);
    }

    // Fail closed on corruption. This never recreates or overwrites the file.
    validateDatabaseFile(resolved);
  } else if (wasInitialized) {
    throw new TokenStoreError(
      "Token store database missing after initialization. Restore from backup or investigate data loss."
    );
  }

  return resolved;
}

function _hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function _decodePayload(token) {
  try {
    const parts = String(token).split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload;
  } catch (_) {
    return null;
  }
}

// better-sqlite3 returns row-valued pragmas as arrays of row objects, e.g.
// db.pragma("integrity_check") -> [{ integrity_check: "ok" }]. Treat any
// non-"ok" row (and any thrown error) as corruption so callers fail closed.
function _integrityCheckOk(db) {
  try {
    const rows = db.pragma("integrity_check");
    if (Array.isArray(rows)) {
      if (rows.length === 0) return false;
      return rows.every((row) => String(row && Object.values(row)[0]).toLowerCase() === "ok");
    }
    return String(rows).toLowerCase() === "ok";
  } catch (_) {
    return false;
  }
}

function _requiredTablesPresent(db) {
  const required = ["session_families", "refresh_tokens", "access_token_denylist", "legacy_revocations", "replay_audit"];
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table'"
  ).all().map((t) => t.name);
  const missing = required.filter((t) => !tables.includes(t));
  return { ok: missing.length === 0, missing };
}

// Schema check run by the shared restore primitive against a candidate file.
// Receives the readonly connection opened by validateSqliteFile.
function _tokenSchemaValidator(db, resolved) {
  const schema = _requiredTablesPresent(db);
  if (!schema.ok) {
    throw new TokenStoreError(
      `Schema mismatch at ${resolved}: missing table(s) ${schema.missing.join(", ")}`
    );
  }
}

// Validate an arbitrary SQLite file (used for startup configuration and for
// the actual restored file after a restore). Throws TokenStoreError when the
// file is not an intact, schema-compatible token store. Never creates or
// overwrites an existing database: a corrupt file makes open() throw.
function validateDatabaseFile(dbPath) {
  if (!dbPath) throw new TokenStoreError("A token store database path is required");
  const resolved = path.resolve(String(dbPath));
  if (!fs.existsSync(resolved)) {
    throw new TokenStoreError(`Token store database missing: ${resolved}`);
  }
  // Validation must not modify the artifact at all. Even a read-only open of a
  // WAL database creates -wal/-shm next to it (and a read-write open can
  // checkpoint a stray -wal and rewrite the main file), so the file and its
  // sidecars are copied to an isolated temporary directory and validated there.
  // This also works when the artifact sits on read-only media.
  const sqliteSnapshot = require("./sqliteSnapshot");
  try {
    return sqliteSnapshot.validateSqliteIsolated(resolved, _tokenSchemaValidator);
  } catch (err) {
    throw new TokenStoreError(
      `Token store database not usable at ${resolved}: ${err.message}`,
      err
    );
  }
}

function createSessionFamily(db, sub, tenantId) {
  const familyId = crypto.randomUUID();
  const createdAt = Date.now();
  db.prepare(`
    INSERT INTO session_families (familyId, sub, tenantId, createdAt)
    VALUES (?, ?, ?, ?)
  `).run(familyId, String(sub), tenantId ? String(tenantId) : null, createdAt);
  return { familyId, createdAt };
}

function createRefreshToken(db, familyId, sub, ver, tenantId, expiresAt) {
  const jti = crypto.randomUUID();
  const issuedAt = Date.now();
  db.prepare(`
    INSERT INTO refresh_tokens (jti, familyId, sub, ver, tenantId, issuedAt, expiresAt, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
  `).run(jti, familyId, String(sub), ver, tenantId ? String(tenantId) : null, issuedAt, expiresAt);
  return { jti, issuedAt };
}

function getRefreshToken(db, jti) {
  return db.prepare(`
    SELECT rt.jti, rt.familyId, rt.sub, rt.ver, rt.tenantId, rt.issuedAt, rt.expiresAt, rt.status,
           rt.consumedAt, rt.replacedByJti,
           sf.revokedAt as familyRevokedAt, sf.revocationReason as familyRevocationReason
    FROM refresh_tokens rt
    LEFT JOIN session_families sf ON rt.familyId = sf.familyId
    WHERE rt.jti = ?
  `).get(jti);
}

function _isFamilyRevoked(db, familyId, sub) {
  if (!familyId) {
    throw new Error("familyId required");
  }
  const row = db.prepare(`
    SELECT revokedAt FROM session_families WHERE familyId = ? AND sub = ?
  `).get(familyId, String(sub));
  if (!row) {
    return true;
  }
  return row.revokedAt !== null;
}

function _isAccessTokenRevoked(db, jti) {
  const row = db.prepare(`SELECT 1 FROM access_token_denylist WHERE jti = ?`).get(jti);
  return !!row;
}

function _isTokenRevoked(db, token) {
  if (!token) return false;
  const hash = _hashToken(token);
  const legacy = db.prepare(`
    SELECT 1 FROM legacy_revocations WHERE hash = ? AND (expiresAt IS NULL OR expiresAt > ?)
  `).get(hash, Date.now());
  if (legacy) return true;
  const payload = _decodePayload(token);
  if (payload && payload.jti) {
    return _isAccessTokenRevoked(db, payload.jti);
  }
  return false;
}

function _revokeAccessToken(db, token) {
  if (!token) return;
  const payload = _decodePayload(token);
  if (!payload || !payload.jti) return;
  const exp = payload.exp ? payload.exp * 1000 : Date.now() + 86400000;
  db.prepare(`
    INSERT OR IGNORE INTO access_token_denylist (jti, expiresAt, revokedAt)
    VALUES (?, ?, ?)
  `).run(payload.jti, exp, Date.now());
}

function _rotateRefreshToken(db, oldJti, newTokenData, user) {
  const rotateTx = db.transaction((oldJti, newTokenData, user) => {
    const oldToken = db.prepare(`
      SELECT rt.jti, rt.familyId, rt.sub, rt.ver, rt.status, rt.expiresAt,
             sf.revokedAt as familyRevokedAt
      FROM refresh_tokens rt
      LEFT JOIN session_families sf ON rt.familyId = sf.familyId
      WHERE rt.jti = ?
    `).get(oldJti);

    if (!oldToken) {
      const err = new Error("TOKEN_UNKNOWN");
      err.code = "TOKEN_UNKNOWN";
      err.status = 401;
      throw err;
    }
    if (oldToken.status !== "active") {
      const code = oldToken.status === "consumed"
        ? "REPLAY_DETECTED"
        : oldToken.status === "revoked"
          ? "SESSION_REVOKED"
          : oldToken.status.toUpperCase();
      const err = new Error(code);
      err.code = code;
      err.status = 401;
      throw err;
    }
    if (oldToken.expiresAt && oldToken.expiresAt < Date.now()) {
      const err = new Error("TOKEN_EXPIRED");
      err.code = "TOKEN_EXPIRED";
      err.status = 401;
      throw err;
    }
    if (oldToken.familyRevokedAt) {
      const err = new Error("SESSION_REVOKED");
      err.code = "SESSION_REVOKED";
      err.status = 401;
      throw err;
    }
    const effectiveVer = Number(user && user.tokenVersion) || 0;
    if (oldToken.sub !== String(user.id)) {
      const err = new Error("TOKEN_SUB_MISMATCH");
      err.code = "TOKEN_SUB_MISMATCH";
      err.status = 401;
      throw err;
    }
    if (oldToken.familyId !== newTokenData.familyId) {
      const err = new Error("FAMILY_ID_MISMATCH");
      err.code = "FAMILY_ID_MISMATCH";
      err.status = 401;
      throw err;
    }
    if (oldToken.ver !== effectiveVer) {
      const err = new Error("TOKEN_VERSION_MISMATCH");
      err.code = "TOKEN_VERSION_MISMATCH";
      err.status = 401;
      throw err;
    }
    if (newTokenData.tenantId && user.tenantIds && !user.tenantIds.includes(newTokenData.tenantId)) {
      const err = new Error("TENANT_MISMATCH");
      err.code = "TENANT_MISMATCH";
      err.status = 403;
      throw err;
    }

    const consumeResult = db.prepare(`
      UPDATE refresh_tokens
      SET status = 'consumed', consumedAt = ?, replacedByJti = ?
      WHERE jti = ? AND status = 'active'
    `).run(Date.now(), newTokenData.jti, oldJti);

    if (consumeResult.changes === 0) {
      const err = new Error("CONCURRENT_CONSUME");
      err.code = "CONCURRENT_CONSUME";
      err.status = 401;
      throw err;
    }

    db.prepare(`
      INSERT INTO refresh_tokens (jti, familyId, sub, ver, tenantId, issuedAt, expiresAt, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(
      newTokenData.jti,
      newTokenData.familyId,
      newTokenData.sub,
      Number(newTokenData.ver) || 0,
      newTokenData.tenantId ? String(newTokenData.tenantId) : null,
      newTokenData.issuedAt,
      newTokenData.expiresAt
    );

    return { ...newTokenData, familyId: newTokenData.familyId };
  }, "IMMEDIATE");

  return rotateTx(oldJti, newTokenData, user);
}

function revokeFamilyOnReplay(db, replayedJti) {
  const revokeTx = db.transaction((replayedJti) => {
    const token = db.prepare(`
      SELECT jti, familyId, sub, status FROM refresh_tokens WHERE jti = ?
    `).get(replayedJti);

    if (!token || token.status !== "consumed") {
      return { revoked: false, reason: token?.status || "not_found" };
    }

    const famResult = db.prepare(`
      UPDATE session_families SET revokedAt = ?, revocationReason = 'replay'
      WHERE familyId = ? AND revokedAt IS NULL
    `).run(Date.now(), token.familyId);

    if (famResult.changes !== 1) {
      const err = new Error("FAMILY_REVOKE_FAILED");
      err.code = "FAMILY_REVOKE_FAILED";
      throw err;
    }

    db.prepare(`
      UPDATE refresh_tokens SET status = 'revoked' WHERE familyId = ? AND status = 'active'
    `).run(token.familyId);

    db.prepare(`
      INSERT INTO replay_audit (familyId, sub, replayedJti, timestamp)
      VALUES (?, ?, ?, ?)
    `).run(token.familyId, token.sub, replayedJti, Date.now());

    return { revoked: true, familyId: token.familyId, sub: token.sub };
  }, "IMMEDIATE");

  return revokeTx(replayedJti);
}

function _revokeFamily(db, familyId, reason) {
  return db.transaction((familyId, reason) => {
    const famResult = db.prepare(`
      UPDATE session_families SET revokedAt = ?, revocationReason = ?
      WHERE familyId = ? AND revokedAt IS NULL
    `).run(Date.now(), reason, familyId);

    if (famResult.changes !== 1) {
      return { revoked: false, reason: "not_found_or_already_revoked" };
    }

    db.prepare(`
      UPDATE refresh_tokens SET status = 'revoked' WHERE familyId = ? AND status = 'active'
    `).run(familyId);

    return { revoked: true, familyId };
  }, "IMMEDIATE")(familyId, reason);
}

function _revokeAllUserFamilies(db, sub, reason) {
  return db.transaction((sub, reason) => {
    const families = db.prepare(`
      SELECT familyId FROM session_families WHERE sub = ? AND revokedAt IS NULL
    `).all(sub).map(r => r.familyId);

    if (families.length === 0) return { revoked: 0 };

    db.prepare(`
      UPDATE session_families SET revokedAt = ?, revocationReason = ?
      WHERE sub = ? AND revokedAt IS NULL
    `).run(Date.now(), reason, sub);

    db.prepare(`
      UPDATE refresh_tokens SET status = 'revoked'
      WHERE familyId IN (${families.map(() => "?").join(",")}) AND status = 'active'
    `).run(...families);

    return { revoked: families.length };
  }, "IMMEDIATE")(sub, reason);
}

// Housekeeping cadence for the token store: at most one bounded batch per
// interval. Kept in parity with the login-challenge store so a single login or
// refresh cycle never runs an unbounded delete.
const PURGE_INTERVAL_MS = 5 * 60 * 1000;
const PURGE_BATCH_LIMIT = 500;

// Delete expired rows in bounded batches.
//
// Only rows whose `expiresAt` is at or before `now` are eligible, so active
// credentials can never be removed. At most `limit` rows per table are deleted
// per call, which keeps the write small even when a backlog has accumulated.
//
// Retention policy:
//   - refresh_tokens: removed once expired (all statuses; an expired row can no
//     longer rotate or authenticate).
//   - access_token_denylist: removed once expired; the access token it denied
//     has expired too, so revocation state is no longer needed.
//   - legacy_revocations: removed once their recorded expiry has passed. Rows
//     imported without an expiry are retained indefinitely (unknown lifetime).
//   - session_families: NEVER removed here. Families are the revocation ledger
//     and the FK parent of refresh_tokens.
//   - replay_audit: NEVER removed here. Replay incidents are audit records and
//     follow their own retention policy.
function purgeExpired(db, options = {}) {
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
  const rawLimit = Number(options.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : PURGE_BATCH_LIMIT;

  const deletedAccess = db.prepare(`
    DELETE FROM access_token_denylist WHERE jti IN (
      SELECT jti FROM access_token_denylist
      WHERE expiresAt <= ? ORDER BY expiresAt ASC LIMIT ?
    )
  `).run(now, limit).changes;

  const deletedRefresh = db.prepare(`
    DELETE FROM refresh_tokens WHERE jti IN (
      SELECT jti FROM refresh_tokens
      WHERE expiresAt <= ? ORDER BY expiresAt ASC LIMIT ?
    )
  `).run(now, limit).changes;

  const deletedLegacy = db.prepare(`
    DELETE FROM legacy_revocations WHERE hash IN (
      SELECT hash FROM legacy_revocations
      WHERE expiresAt IS NOT NULL AND expiresAt <= ?
      ORDER BY expiresAt ASC LIMIT ?
    )
  `).run(now, limit).changes;

  return { access: deletedAccess, refresh: deletedRefresh, legacy: deletedLegacy };
}

// Per-database throttle state. Uses the connection object as the key so unit
// tests with several databases and separate app instances never suppress each
// other's housekeeping.
const _purgeState = new WeakMap();

// Throttled housekeeping: at most one bounded purge per interval per database.
// Never throws — a cleanup failure is advisory and must never influence the
// outcome of the authentication request that triggered it.
function purgeExpiredIfDue(db, options = {}) {
  let target = db;
  let opts = options;
  // Allow the no-argument wrapper form used by controllers: purgeExpiredIfDue().
  if (!target || typeof target.prepare !== "function") {
    opts = db || {};
    target = null;
  }
  const now = Number.isFinite(opts.now) ? Number(opts.now) : Date.now();
  try {
    const handle = target || _getDb();
    const last = _purgeState.get(handle) || 0;
    if (now - last < PURGE_INTERVAL_MS) {
      return { throttled: true, access: 0, refresh: 0, legacy: 0 };
    }
    // Record the attempt before running it so a persistently failing database
    // is retried once per interval instead of on every request.
    _purgeState.set(handle, now);
    const removed = purgeExpired(handle, { now, limit: PURGE_BATCH_LIMIT });
    return { throttled: false, ...removed };
  } catch (_) {
    return { throttled: false, access: 0, refresh: 0, legacy: 0, error: true };
  }
}

function _migrateLegacyRevocations(db, jsonPath) {
  if (!fs.existsSync(jsonPath)) {
    return { imported: 0, rejected: 0, duplicates: 0, missing: true };
  }

  let raw;
  try {
    raw = fs.readFileSync(jsonPath, "utf8");
  } catch (_) {
    return { imported: 0, rejected: 0, duplicates: 0, missing: false, error: "read_failed" };
  }

  let entries;
  try {
    entries = JSON.parse(raw);
  } catch (_) {
    return { imported: 0, rejected: 0, duplicates: 0, missing: false, error: "parse_failed" };
  }

  if (!Array.isArray(entries)) {
    return { imported: 0, rejected: 0, duplicates: 0, missing: false, error: "not_array" };
  }

  const now = Date.now();
  let imported = 0, rejected = 0, duplicates = 0;

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO legacy_revocations (hash, expiresAt, migratedAt)
    VALUES (?, ?, ?)
  `);

  const tx = db.transaction((entries) => {
    for (const entry of entries) {
      if (!entry || !entry.hash || !/^[a-f0-9]{64}$/.test(entry.hash)) {
        rejected++;
        continue;
      }
      const exp = entry.exp ? entry.exp * 1000 : null;
      const result = stmt.run(entry.hash, exp, now);
      if (result.changes === 1) {
        imported++;
      } else {
        duplicates++;
      }
    }
  });

  tx(entries);

  // Verify the import landed before archiving the source. On verification
  // failure the JSON is left in place (recoverable, idempotent re-run).
  const verifyStmt = db.prepare(`SELECT 1 FROM legacy_revocations WHERE hash = ?`);
  let acceptedTotal = 0;
  let verifiedCount = 0;
  for (const entry of entries) {
    if (!entry || !entry.hash || !/^[a-f0-9]{64}$/.test(entry.hash)) continue;
    acceptedTotal++;
    if (verifyStmt.get(entry.hash)) verifiedCount++;
  }
  if (verifiedCount !== acceptedTotal) {
    return {
      imported,
      rejected,
      duplicates,
      verified: false,
      error: "verification_failed",
      archivePath: null
    };
  }

  const archivePath = jsonPath + ".migrated." + new Date().toISOString().replace(/[:.]/g, "-");
  try {
    fs.renameSync(jsonPath, archivePath);
  } catch (_) {}

  return { imported, rejected, duplicates, verified: true, archivePath };
}

function verifyParity(db, jsonPath) {
  if (!fs.existsSync(jsonPath)) return { match: true, reason: "no_json_file" };

  const raw = fs.readFileSync(jsonPath, "utf8");
  const entries = JSON.parse(raw);
  if (!Array.isArray(entries)) return { match: false, reason: "not_array" };

  let mismatches = 0;
  for (const entry of entries) {
    if (!entry || !entry.hash) continue;
    const hash = entry.hash;
    const exp = entry.exp ? entry.exp * 1000 : null;
    const row = db.prepare(`
      SELECT 1 FROM legacy_revocations WHERE hash = ? AND (expiresAt IS NULL OR expiresAt > ?)
    `).get(hash, Date.now());
    const inDb = !!row;
    const inJson = !(exp && exp <= Date.now());
    if (inDb !== inJson) mismatches++;
  }
  return { match: mismatches === 0, mismatches };
}

async function backupDatabase(sourcePath, destPath) {
  if (!sourcePath || !destPath) {
    throw new TokenStoreError("backupDatabase requires a source path and a destination path");
  }
  if (!fs.existsSync(sourcePath)) {
    throw new TokenStoreError(`Backup source missing: ${sourcePath}`);
  }
  if (fs.existsSync(destPath)) {
    throw new TokenStoreError(`Backup destination already exists: ${destPath}`);
  }

  // Validate the source before opening it read-write: SQLite treats a short
  // non-database file as an empty database and could otherwise initialise it.
  // The read-only primitive is used here (not the isolated variant) because the
  // source is a live database and a snapshot copy could be torn mid-write.
  // Careful: "read-only" only means SQLite opens the file without write access.
  // Opening a closed WAL database read-only still creates -wal/-shm beside it, so
  // this validation is not side-effect free; the read-write open below then
  // checkpoints and leaves the source clean.
  require("./sqliteSnapshot").validateSqliteFile(sourcePath, _tokenSchemaValidator);

  // Open read-write so a WAL checkpoint can complete and report busy state.
  const sourceDb = new Database(sourcePath);
  try {
    const cp = sourceDb.pragma("wal_checkpoint(FULL)");
    const row = Array.isArray(cp) ? cp[0] : cp;
    if (row && Number(row.busy) > 0) {
      throw new TokenStoreError("WAL checkpoint failed: database busy");
    }
    // better-sqlite3: the SOURCE database creates the backup at the given
    // destination filename. Never pass a Database instance here.
    await sourceDb.backup(destPath);
  } finally {
    try { sourceDb.close(); } catch (_) {}
  }

  const verifyDb = new Database(destPath, { readonly: true });
  try {
    if (!_integrityCheckOk(verifyDb)) {
      throw new TokenStoreError(`Backup integrity check failed: ${destPath}`);
    }
    const schema = _requiredTablesPresent(verifyDb);
    if (!schema.ok) {
      throw new TokenStoreError(`Backup schema incomplete: missing ${schema.missing.join(", ")}`);
    }
  } catch (err) {
    try { verifyDb.close(); } catch (_) {}
    try { fs.unlinkSync(destPath); } catch (_) {}
    throw err instanceof TokenStoreError ? err : new TokenStoreError(`Backup verification failed: ${err.message}`, err);
  }
  try { verifyDb.close(); } catch (_) {}
  return destPath;
}

// Restore a verified token-store backup over `targetPath`.
//
// Delegates to the shared rollback-safe primitive so the token store gets the same
// protection as the challenge store and the CLI restore:
//   * the backup is integrity- and schema-validated before the target is touched;
//   * an active writer is refused up front via isDatabaseInUse (fail closed);
//   * the authoritative file plus -wal/-shm sidecars move aside and are rolled back
//     on any failure; the original database is never deleted before final validation.
//
// Limitations: the in-use probe only observes a live write lock — it cannot see an idle
// open connection or detect service shutdown. Callers must still document that the service
// is stopped before restoring.
function restoreDatabase(backupPath, targetPath) {
  if (!backupPath || !targetPath) {
    throw new TokenStoreError("restoreDatabase requires a backup path and a target path");
  }
  if (!fs.existsSync(backupPath)) {
    throw new TokenStoreError(`Backup file missing: ${backupPath}`);
  }
  const sqliteSnapshot = require("./sqliteSnapshot");
  return sqliteSnapshot.restoreSqlite(backupPath, targetPath, {
    validate: _tokenSchemaValidator
  });
}
function openDbInMemory() {
  const db = new Database(":memory:");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = FULL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

function closeDb(db) {
  try {
    if (db && db.open) db.close();
  } catch (_) {}
  if (_db && _db.open) {
    try { _db.close(); } catch (_) {}
    _db = null;
  }
}

// Test helper: clear all token store data (for test isolation)
function _reset() {
  const db = _getDb();
  try {
    db.prepare(`DELETE FROM refresh_tokens`).run();
    db.prepare(`DELETE FROM session_families`).run();
    db.prepare(`DELETE FROM access_token_denylist`).run();
    db.prepare(`DELETE FROM legacy_revocations`).run();
    db.prepare(`DELETE FROM replay_audit`).run();
  } finally {
    // Don't close the global db
  }
}

// Backward-compatible functions for legacy callers that pass raw JWT strings
// These decode the JWT to extract jti/exp and delegate to the new SQLite functions.

function _decodeJwtPayload(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload;
  } catch (_) {
    return null;
  }
}

function revokeToken(token) {
  if (!token) return;
  const payload = _decodeJwtPayload(token);
  if (!payload || !payload.jti) return;
  const hash = _hashToken(token);
  const exp = payload.exp ? payload.exp * 1000 : null;
  const sub = payload.sub;

  // For backward compatibility, we add to the access token denylist
  // using the hash as the identifier. The new store uses jti, but we
  // can also check legacy_revocations table which stores the hash.
  const db = _getDb();
  try {
    const now = Date.now();
    db.prepare(`
      INSERT OR IGNORE INTO legacy_revocations (hash, expiresAt, migratedAt)
      VALUES (?, ?, ?)
    `).run(hash, exp, now);
  } finally {
    // Don't close the global db
  }
}

function isRevoked(token) {
  if (!token) return false;
  const payload = _decodeJwtPayload(token);
  if (!payload || !payload.jti) return false;
  const hash = _hashToken(token);

  // Check both the new access token denylist (by jti) and legacy table (by hash)
  const db = _getDb();
  try {
    // Check access token denylist by jti
    const byJti = db.prepare(`SELECT 1 FROM access_token_denylist WHERE jti = ? AND (expiresAt IS NULL OR expiresAt > ?)`).get(payload.jti, Date.now());
    if (byJti) return true;

    // Check legacy revocations by hash
    const byHash = db.prepare(`SELECT 1 FROM legacy_revocations WHERE hash = ? AND (expiresAt IS NULL OR expiresAt > ?)`).get(hash, Date.now());
    if (byHash) return true;

    return false;
  } finally {
    // Don't close the global db
  }
}

// Wrapper functions for callers that don't pass a db connection
// These use the internal _getDb() to get the global connection.

function isFamilyRevoked(familyId, sub) {
  if (!familyId || !sub) return false;
  const db = _getDb();
  try {
    const row = db.prepare(`
      SELECT revokedAt FROM session_families WHERE familyId = ? AND sub = ?
    `).get(familyId, String(sub));
    if (!row) return true;
    return row.revokedAt !== null;
  } finally {
    // Don't close the global db
  }
}

function isAccessTokenRevoked(jti) {
  if (!jti) return false;
  const db = _getDb();
  try {
    const row = db.prepare(`SELECT 1 FROM access_token_denylist WHERE jti = ?`).get(jti);
    return !!row;
  } finally {
    // Don't close the global db
  }
}

// Legacy (pre-F4) revocations are stored as SHA-256 hashes of the exact token
// string. Middleware uses this to keep already-revoked legacy access tokens
// rejected after migration. This is a revocation lookup only; it never grants
// identity.
function isLegacyTokenRevoked(token) {
  if (!token) return false;
  const db = _getDb();
  const row = db.prepare(`
    SELECT 1 FROM legacy_revocations
    WHERE hash = ? AND (expiresAt IS NULL OR expiresAt > ?)
  `).get(_hashToken(token), Date.now());
  return !!row;
}

// Authoritative lookup for a refresh token presented as a cookie. Returns the
// row (including familyRevokedAt) or null. Throws on storage failures so
// callers fail closed.
function inspectRefreshToken(jti) {
  if (!jti) return null;
  const db = _getDb();
  return getRefreshToken(db, jti) || null;
}

// isTokenRevoked wrapper - checks if an access token (by jti) is revoked
// This is what middleware.auth.js calls with the jti from the access token
function isTokenRevoked(jti) {
  return isAccessTokenRevoked(jti);
}

function _normalizeExpiryMs(expiresAt, fallbackMs) {
  if (expiresAt === undefined || expiresAt === null) return Date.now() + fallbackMs;
  const parsed = Number(expiresAt);
  if (!Number.isFinite(parsed) || parsed <= 0) return Date.now() + fallbackMs;
  // JWT exp is seconds (~1.7e9); callers may also pass milliseconds (~1.7e12).
  return parsed < 1e12 ? parsed * 1000 : parsed;
}

// revokeRefreshToken wrapper - revokes a refresh token by jti. Refresh tokens
// are identified by their own jti and tracked by status; they are NOT written
// to the access-token denylist (different identifier space).
function revokeRefreshToken(jti, sub, expiresAt) {
  if (!jti) return { revoked: false, reason: "missing_jti" };
  const db = _getDb();
  const result = db.prepare(`
    UPDATE refresh_tokens SET status = 'revoked' WHERE jti = ? AND status = 'active'
  `).run(jti);
  return { revoked: result.changes > 0, reason: result.changes > 0 ? "revoked" : "not_active" };
}

// revokeAccessToken wrapper - revokes an access token by jti (for logout, etc.)
function revokeAccessToken(jti, sub, expiresAt) {
  if (!jti) return { revoked: false, reason: "missing_jti" };
  const db = _getDb();
  const exp = _normalizeExpiryMs(expiresAt, 86400000);
  const result = db.prepare(`
    INSERT OR IGNORE INTO access_token_denylist (jti, expiresAt, revokedAt)
    VALUES (?, ?, ?)
  `).run(jti, exp, Date.now());
  return { revoked: result.changes > 0 };
}

function revokeFamily(familyId, subOrReason) {
  if (!familyId) return { revoked: false };
  const db = _getDb();
  try {
    const reason = (typeof subOrReason === 'string' && subOrReason !== subOrReason.trim() ? 'manual' : subOrReason) || 'manual';
    const famResult = db.prepare(`
      UPDATE session_families SET revokedAt = ?, revocationReason = ?
      WHERE familyId = ? AND revokedAt IS NULL
    `).run(Date.now(), reason, familyId);
    if (famResult.changes === 1) {
      db.prepare(`
        UPDATE refresh_tokens SET status = 'revoked' WHERE familyId = ? AND status = 'active'
      `).run(familyId);
      return { revoked: true, familyId };
    }
    return { revoked: false };
  } finally {
    // Don't close the global db
  }
}

function revokeAllUserFamilies(sub) {
  if (!sub) return { revokedCount: 0 };
  const db = _getDb();
  try {
    const families = db.prepare(`
      SELECT familyId FROM session_families WHERE sub = ? AND revokedAt IS NULL
    `).all(String(sub));
    if (families.length === 0) return { revokedCount: 0 };
    let revokedCount = 0;
    const now = Date.now();
    for (const fam of families) {
      const result = db.prepare(`
        UPDATE session_families SET revokedAt = ?, revocationReason = 'user_invalidated'
        WHERE familyId = ? AND revokedAt IS NULL
      `).run(now, fam.familyId);
      if (result.changes === 1) {
        db.prepare(`
          UPDATE refresh_tokens SET status = 'revoked' WHERE familyId = ? AND status = 'active'
        `).run(fam.familyId);
        revokedCount++;
      }
    }
    return { revokedCount };
  } finally {
    // Don't close the global db
  }
}

// Alias for backward compatibility
const revokeAllFamiliesForUser = revokeAllUserFamilies;

// Wrapper for controllers to create a session family using global DB
function createSessionFamilyWrapper(sub, tenantId) {
  if (!sub) throw new Error("createSessionFamily requires sub");
  const db = _getDb();
  try {
    const familyId = crypto.randomUUID();
    const createdAt = Date.now();
    db.prepare(`
      INSERT INTO session_families (familyId, sub, tenantId, createdAt)
      VALUES (?, ?, ?, ?)
    `).run(familyId, String(sub), tenantId ? String(tenantId) : null, createdAt);
    return { familyId, createdAt };
  } finally {
    // Don't close the global db
  }
}

// Wrapper for controllers that pass jti and token data object
function issueRefreshToken(jti, tokenData) {
  if (!jti || !tokenData || !tokenData.familyId || !tokenData.sub) {
    throw new Error("issueRefreshToken requires jti, familyId, and sub");
  }
  const db = _getDb();
  try {
    const { familyId, sub, ver, tenantId, issuedAt, expiresAt } = tokenData;
    db.prepare(`
      INSERT INTO refresh_tokens (jti, familyId, sub, ver, tenantId, issuedAt, expiresAt, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(jti, familyId, String(sub), ver || 0, tenantId ? String(tenantId) : null, issuedAt || Date.now(), expiresAt);
    return { jti, familyId, sub, ver: ver || 0, tenantId, issuedAt: issuedAt || Date.now(), expiresAt };
  } finally {
    // Don't close the global db
  }
}

// Wrapper for refresh rotation using the global DB connection
function rotateRefreshToken(oldJti, newTokenData, user) {
  const db = _getDb();
  try {
    return _rotateRefreshToken(db, oldJti, newTokenData, user);
  } catch (err) {
    // A replay means the presented token was already rotated; revoke the whole
    // family so the attacker cannot keep using the successor token.
    if (err && err.code === "REPLAY_DETECTED") {
      try {
        revokeFamilyOnReplay(db, oldJti);
      } catch (_) {}
    }
    throw err;
  }
}

// Wrapper for migrateLegacyRevocations (no db parameter needed)
function migrateLegacyRevocations(jsonPath) {
  const db = _getDb();
  try {
    return _migrateLegacyRevocations(db, jsonPath);
  } finally {
    // Don't close the global db
  }
}

module.exports = {
  initialise,
  validateStartupConfiguration,
  validateDbPath,
  validateDatabaseFile,
  createSessionFamily: createSessionFamilyWrapper,
  createRefreshToken,
  getRefreshToken,
  issueRefreshToken,
  isFamilyRevoked,
  isAccessTokenRevoked,
  isTokenRevoked,
  isLegacyTokenRevoked,
  inspectRefreshToken,
  revokeAccessToken,
  revokeToken,
  isRevoked,
  rotateRefreshToken,
  revokeFamilyOnReplay,
  revokeFamily,
  revokeRefreshToken,
  revokeAllUserFamilies,
  revokeAllFamiliesForUser,
  purgeExpired,
  purgeExpiredIfDue,
  PURGE_INTERVAL_MS,
  PURGE_BATCH_LIMIT,
  migrateLegacyRevocations,
  verifyParity,
  backupDatabase,
  restoreDatabase,
  openDbInMemory,
  closeDb,
  _reset,
  resolveTokenStorePath,
  TokenStoreError,
  tokenSchemaValidator: _tokenSchemaValidator, _tokenSchemaValidator,
  _hashToken,
  _decodePayload,
  INITIALIZED_FLAG,
  TOKEN_STORE_PATH
};