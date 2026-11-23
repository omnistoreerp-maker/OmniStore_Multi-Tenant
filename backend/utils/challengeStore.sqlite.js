"use strict";

// Durable, single-use login challenge store backed by SQLite (better-sqlite3).
//
// Design constraints enforced here:
//   * Only SHA-256 hashes of challenge tokens are persisted — never raw JWTs.
//   * Uniqueness is enforced by the database (PRIMARY KEY on the hash).
//   * Each row is bound to one subject (`sub`) and one `purpose`; a challenge
//     minted for MFA cannot be redeemed for tenant selection or vice versa.
//   * Consumption is a SINGLE conditional DELETE statement, which SQLite
//     executes atomically. Exactly one concurrent consumer observes
//     `changes === 1`; every other consumer observes `changes === 0`.
//   * Expired challenges FAIL (fail closed) and are purged in bounded batches.
//   * Database errors are thrown, never swallowed — the caller must fail
//     closed rather than mint a session.
//   * There is no in-memory Map, JSON ledger or lock file fallback.
//
// ── Deployment provisioning (P6.66 M-1 / M-2) ──────────────────────────────
// The database path is NEVER guessed:
//   * `CHALLENGE_DB_PATH` is required in production-like environments
//     (`NODE_ENV=production` or `NODE_ENV=staging`). Boot fails without it.
//   * The parent directory must already exist and be writable by the service
//     account. This module deliberately does NOT create directories: a typo in
//     the path must fail loudly instead of silently creating a database
//     somewhere unintended.
//   * On POSIX, provision a dedicated directory owned by the service account
//     with mode 0700 (e.g. `install -d -m 0700 -o omnistore -g omnistore
//     /var/lib/omnistore/challenges`) and point CHALLENGE_DB_PATH at a file
//     inside it. SQLite also creates `<db>-wal` and `<db>-shm` in that
//     directory, so the directory — not just the file — must be writable.
//   * Only challenge hashes live in this file; it contains no reusable
//     credential and no plaintext token.
//   * `validateStartupConfiguration()` is called by `server.js` before the
//     process starts listening, so a misconfiguration fails at boot rather
//     than on the first Google Login request.

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const config = require("../config");

// ONE authoritative TTL: config derives this from LOGIN_CHALLENGE_TTL, which is
// also what signChallengeToken() uses for the JWT `exp`. The durable row and
// the signed token therefore always expire together (P6.66 L-3).
const DEFAULT_TTL_MS = config.loginChallengeTtlMs;

// Retention housekeeping is bounded and throttled: it must never scan or delete
// an unbounded set, and it must not run on every login request (P6.66 M-3).
const PURGE_INTERVAL_MS = 5 * 60 * 1000;
const PURGE_BATCH_LIMIT = 500;

// Environments where a temporary fallback path is never acceptable.
const PRODUCTION_LIKE_ENVS = new Set(["production", "staging"]);

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS challenges (
    hash      TEXT PRIMARY KEY,
    sub       TEXT NOT NULL,
    purpose   TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    expiresAt INTEGER NOT NULL,
    extra     TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_challenges_expiresAt ON challenges (expiresAt);
  CREATE TABLE IF NOT EXISTS oauth_login_transactions (
    stateHash TEXT PRIMARY KEY,
    browserBindingHash TEXT NOT NULL,
    payload TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    expiresAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_oauth_login_transactions_expiresAt ON oauth_login_transactions (expiresAt);
`;

class ChallengeStoreError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "ChallengeStoreError";
    this.cause = cause;
  }
}

/**
 * SHA-256 hex digest of a raw challenge token.
 * @param {string} token
 * @returns {string}
 */
function hashChallenge(token) {
  return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}

function _isProductionLike() {
  const env = String(process.env.NODE_ENV || "").trim().toLowerCase();
  return PRODUCTION_LIKE_ENVS.has(env);
}

/**
 * Resolve the database path.
 *
 * An explicit path always wins. In production-like environments the path MUST
 * be configured; a temporary directory is never silently used for a real
 * deployment.
 *
 * @returns {string}
 */
function resolveDefaultPath() {
  const configured = process.env.CHALLENGE_DB_PATH;
  if (configured && String(configured).trim()) return String(configured).trim();

  if (_isProductionLike()) {
    throw new ChallengeStoreError(
      "CHALLENGE_DB_PATH must be configured in production; refusing to use a temporary challenge database"
    );
  }

  const fallback = path.join(os.tmpdir(), "omnistore-login-challenges.sqlite");
  console.warn(
    `[challengeStore] CHALLENGE_DB_PATH is not set; using non-production path ${fallback}`
  );
  return fallback;
}

/**
 * Validate a database path WITHOUT creating anything.
 *
 * The parent directory must exist and be writable, and an existing database
 * file must be a writable regular file. Nothing is created, moved or deleted
 * here, so an invalid configuration fails before any I/O lands somewhere
 * unintended.
 *
 * @param {string} dbPath
 * @returns {string} the absolute, validated path
 */
function validateDbPath(dbPath) {
  if (dbPath === undefined || dbPath === null || String(dbPath).trim() === "") {
    throw new ChallengeStoreError("A challenge database path is required");
  }
  const resolved = path.resolve(String(dbPath).trim());
  const directory = path.dirname(resolved);

  let dirStat;
  try {
    dirStat = fs.statSync(directory);
  } catch (_) {
    throw new ChallengeStoreError(
      `Challenge database directory does not exist: ${directory}. ` +
        "Create it and grant the service account write access before starting; " +
        "the store never creates directories implicitly."
    );
  }
  if (!dirStat.isDirectory()) {
    throw new ChallengeStoreError(`Challenge database directory is not a directory: ${directory}`);
  }
  try {
    fs.accessSync(directory, fs.constants.W_OK);
  } catch (_) {
    throw new ChallengeStoreError(`Challenge database directory is not writable: ${directory}`);
  }

  if (fs.existsSync(resolved)) {
    let fileStat;
    try {
      fileStat = fs.statSync(resolved);
    } catch (err) {
      throw new ChallengeStoreError(`Challenge database path is not accessible: ${resolved}`, err);
    }
    if (!fileStat.isFile()) {
      throw new ChallengeStoreError(`Challenge database path is not a regular file: ${resolved}`);
    }
    try {
      fs.accessSync(resolved, fs.constants.W_OK);
    } catch (_) {
      throw new ChallengeStoreError(`Challenge database file is not writable: ${resolved}`);
    }
  }

  return resolved;
}

function _configure(db) {
  // WAL lets independent processes read while one writes; busy_timeout makes
  // concurrent writers wait instead of failing immediately.
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  // synchronous = FULL (P6.67): the security property is "a consumed challenge
  // can never be reused". With NORMAL, a power loss / OS crash could drop the
  // last committed DELETE and reopen a spent challenge inside its remaining
  // TTL. FULL fsyncs the WAL on commit, so consumption survives a crash. The
  // cost is one extra fsync per login step (two tiny commits per Google Login),
  // which is negligible at this volume and worth the strict guarantee.
  db.pragma("synchronous = FULL");
  db.exec(SCHEMA);
  _ensureChallengeExtraColumn(db);
  return db;
}

/**
 * Open (creating if needed) the challenge database at an explicit path.
 *
 * @param {string} dbPath
 * @returns {{db: import('better-sqlite3').Database, path: string}}
 */
function initialise(dbPath) {
  const resolved = validateDbPath(dbPath || resolveDefaultPath());
  try {
    const db = _configure(new Database(resolved));
    return { db, path: resolved };
  } catch (err) {
    if (err instanceof ChallengeStoreError) throw err;
    throw new ChallengeStoreError(
      `Could not open challenge database at ${resolved}: ${err.message}`,
      err
    );
  }
}

/**
 * Boot-time self-check used by server.js.
 *
 * Resolves the configured path, validates the directory/file permissions and
 * proves the database can actually be opened and closed. Throws a
 * ChallengeStoreError with an actionable message when the store is unusable, so
 * the process refuses to start instead of failing every login later.
 *
 * @returns {string} the resolved database path
 */
function validateStartupConfiguration() {
  const resolved = resolveDefaultPath();
  const opened = initialise(resolved);
  closeDb(opened.db);
  return opened.path;
}

/**
 * Open a private in-memory challenge database (tests / ephemeral use only).
 * @returns {import('better-sqlite3').Database}
 */
function openDbInMemory() {
  const db = new Database(":memory:");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA);
  return db;
}

function _requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ChallengeStoreError(`challenge ${name} is required`);
  }
  return value;
}

/**
 * Persist a new challenge. The raw token is hashed here; only the hash is stored.
 *
 * @param {object} db
 * @param {{token: string, sub: string, purpose: string, ttlMs?: number}} params
 * @returns {{hash: string, sub: string, purpose: string, createdAt: number, expiresAt: number}}
 */
function persistChallenge(db, { token, sub, purpose, ttlMs, extra } = {}) {
  _requireString(token, "token");
  _requireString(sub, "subject");
  _requireString(purpose, "purpose");

  const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? Number(ttlMs) : DEFAULT_TTL_MS;
  const hash = hashChallenge(token);
  const createdAt = Date.now();
  const expiresAt = createdAt + ttl;
  const encodedExtra = extra === undefined ? null : JSON.stringify(extra);

  try {
    db.prepare(
      "INSERT INTO challenges (hash, sub, purpose, createdAt, expiresAt, extra) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(hash, String(sub), String(purpose), createdAt, expiresAt, encodedExtra);
  } catch (err) {
    throw new ChallengeStoreError(
      `Could not persist challenge: ${err.message}`,
      err
    );
  }

  return { hash, sub: String(sub), purpose: String(purpose), createdAt, expiresAt };
}

function _ensureChallengeExtraColumn(db) {
  const columns = db.prepare("PRAGMA table_info(challenges)").all();
  if (!columns.some((column) => column.name === 'extra')) {
    db.exec('ALTER TABLE challenges ADD COLUMN extra TEXT');
  }
}

/**
 * Atomically consume a challenge and return its stored context only on success.
 *
 * The whole decision is one conditional DELETE, so there is no read-then-write
 * race: SQLite applies it atomically and the winner is whoever's DELETE removed
 * the row.
 *
 * @param {object} db
 * @param {{token: string, purpose: string, sub?: string}} params
 * @returns {{consumed: boolean, reason: string}}
 */
function consumeChallenge(db, { token, purpose, sub } = {}) {
  _requireString(token, "token");
  _requireString(purpose, "purpose");

  const hash = hashChallenge(token);
  const now = Date.now();

  // Read the stored context BEFORE the conditional delete; after deletion the
  // row is gone and the extra data would be lost.
  let stored;
  try {
    stored = db.prepare("SELECT sub, purpose, extra FROM challenges WHERE hash = ?").get(hash);
  } catch (err) {
    throw new ChallengeStoreError(`Could not read challenge: ${err.message}`, err);
  }

  let info;
  try {
    if (sub) {
      info = db
        .prepare(
          "DELETE FROM challenges WHERE hash = ? AND purpose = ? AND sub = ? AND expiresAt > ?"
        )
        .run(hash, String(purpose), String(sub), now);
    } else {
      info = db
        .prepare("DELETE FROM challenges WHERE hash = ? AND purpose = ? AND expiresAt > ?")
        .run(hash, String(purpose), now);
    }
  } catch (err) {
    // Database / lock / commit failure: fail closed by surfacing the error.
    throw new ChallengeStoreError(
      `Could not consume challenge: ${err.message}`,
      err
    );
  }

  if (info.changes === 1) {
    return {
      consumed: true,
      reason: "success",
      sub: stored && stored.sub,
      purpose: stored && stored.purpose,
      extra: stored && stored.extra ? JSON.parse(stored.extra) : undefined
    };
  }

  // Nothing was deleted. Diagnose without weakening the single-use guarantee.
  let row;
  try {
    row = db
      .prepare("SELECT sub, purpose, expiresAt FROM challenges WHERE hash = ?")
      .get(hash);
  } catch (_) {
    return { consumed: false, reason: "not_found" };
  }

  if (!row) return { consumed: false, reason: "not_found" };

  if (Number(row.expiresAt) <= now) {
    // Expired challenges never authenticate: purge the row and fail closed.
    try {
      db.prepare("DELETE FROM challenges WHERE hash = ? AND expiresAt <= ?").run(hash, now);
    } catch (_) {}
    return { consumed: false, reason: "expired" };
  }

  if (row.purpose !== String(purpose)) {
    return { consumed: false, reason: "purpose_mismatch" };
  }

  if (sub && row.sub !== String(sub)) {
    return { consumed: false, reason: "subject_mismatch" };
  }

  return { consumed: false, reason: "already_consumed" };
}

/**
 * Atomically validate every binding condition and consume a challenge.
 *
 * Unlike consumeChallenge(), all checks (hash, purpose, subject, expiry,
 * browser binding) happen INSIDE a single IMMEDIATE transaction. The row is
 * deleted only after every validation passes. A wrong-browser request can
 * therefore never burn a valid challenge, and concurrent attempts can never
 * both succeed. Database errors fail closed by throwing.
 *
 * Existing consumeChallenge() callers are unchanged and remain compatible.
 *
 * @returns {{consumed: boolean, reason: string, sub?: string, purpose?: string, extra?: object}}
 */
function consumeChallengeWithBinding(db, { token, purpose, sub, browserBindingHash } = {}) {
  _requireString(token, "token");
  _requireString(purpose, "purpose");

  const hash = hashChallenge(token);
  const now = Date.now();
  const tx = db.transaction(() => {
    const row = db
      .prepare("SELECT sub, purpose, extra, expiresAt FROM challenges WHERE hash = ?")
      .get(hash);
    if (!row) return { consumed: false, reason: "not_found" };
    if (Number(row.expiresAt) <= now) {
      db.prepare("DELETE FROM challenges WHERE hash = ? AND expiresAt <= ?").run(hash, now);
      return { consumed: false, reason: "expired" };
    }
    if (row.purpose !== String(purpose)) return { consumed: false, reason: "purpose_mismatch" };
    if (sub && row.sub !== String(sub)) return { consumed: false, reason: "subject_mismatch" };

    let extra = {};
    if (row.extra) {
      try {
        extra = JSON.parse(row.extra) || {};
      } catch (_) {
        return { consumed: false, reason: "malformed_context" };
      }
    }
    if (extra.browserBindingHash) {
      if (!browserBindingHash || typeof browserBindingHash !== "string") {
        return { consumed: false, reason: "browser_binding_mismatch" };
      }
      const a = Buffer.from(String(extra.browserBindingHash));
      const b = Buffer.from(browserBindingHash);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return { consumed: false, reason: "browser_binding_mismatch" };
      }
    }

    const deleted = db.prepare("DELETE FROM challenges WHERE hash = ?").run(hash);
    if (deleted.changes !== 1) return { consumed: false, reason: "already_consumed" };
    return { consumed: true, reason: "success", sub: row.sub, purpose: row.purpose, extra };
  }, "IMMEDIATE");

  try {
    return tx();
  } catch (err) {
    throw new ChallengeStoreError(`Could not consume challenge: ${err.message}`, err);
  }
}

function persistOAuthLoginTransaction(db, { state, browserBindingHash, payload, ttlMs } = {}) {
  _requireString(state, "state");
  _requireString(browserBindingHash, "browser binding hash");
  if (!payload || typeof payload !== "object") {
    throw new ChallengeStoreError("challenge payload is required");
  }

  const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS;
  const createdAt = Date.now();
  const expiresAt = createdAt + ttl;
  try {
    db.prepare(
      "INSERT INTO oauth_login_transactions (stateHash, browserBindingHash, payload, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?)"
    ).run(hashChallenge(state), String(browserBindingHash), JSON.stringify(payload), createdAt, expiresAt);
  } catch (err) {
    throw new ChallengeStoreError(`Could not persist OAuth login transaction: ${err.message}`, err);
  }
  return { createdAt, expiresAt };
}

function consumeOAuthLoginTransaction(db, { state, browserBindingHash } = {}) {
  _requireString(state, "state");
  _requireString(browserBindingHash, "browser binding hash");

  const stateHash = hashChallenge(state);
  const now = Date.now();
  const tx = db.transaction(() => {
    const row = db
      .prepare("SELECT browserBindingHash, payload, expiresAt FROM oauth_login_transactions WHERE stateHash = ?")
      .get(stateHash);
    if (!row) return { consumed: false, reason: "not_found" };
    if (Number(row.expiresAt) <= now) {
      db.prepare("DELETE FROM oauth_login_transactions WHERE stateHash = ? AND expiresAt <= ?").run(stateHash, now);
      return { consumed: false, reason: "expired" };
    }
    const a = Buffer.from(String(row.browserBindingHash));
    const b = Buffer.from(String(browserBindingHash));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { consumed: false, reason: "browser_binding_mismatch" };
    }
    const deleted = db
      .prepare("DELETE FROM oauth_login_transactions WHERE stateHash = ?")
      .run(stateHash);
    if (deleted.changes !== 1) return { consumed: false, reason: "already_consumed" };
    let payload;
    try {
      payload = JSON.parse(row.payload);
    } catch (_) {
      return { consumed: false, reason: "malformed_payload" };
    }
    return { consumed: true, reason: "success", payload };
  }, "IMMEDIATE");

  try {
    return tx();
  } catch (err) {
    throw new ChallengeStoreError(`Could not consume OAuth login transaction: ${err.message}`, err);
  }
}

/**
 * Delete expired rows in one BOUNDED batch.
 *
 * Only rows whose `expiresAt` is at or before `now` are eligible, and at most
 * `limit` rows are removed per call, so a large backlog can never turn one
 * login into an unbounded write. Active challenges are never touched: the
 * predicate is `expiresAt <= now`, matching the consumption rule exactly.
 *
 * @param {object} db
 * @param {{now?: number, limit?: number}} [options]
 * @returns {number} number of rows removed
 */
function purgeExpired(db, options) {
  const opts = options || {};
  const now = Number.isFinite(opts.now) ? Number(opts.now) : Date.now();
  const rawLimit = Number(opts.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : PURGE_BATCH_LIMIT;

  try {
    return db
      .prepare(
        "DELETE FROM challenges WHERE hash IN (" +
          "SELECT hash FROM challenges WHERE expiresAt <= ? ORDER BY expiresAt ASC LIMIT ?" +
          ")"
      )
      .run(now, limit).changes;
  } catch (_) {
    return 0;
  }
}

// Per-database throttle state, so unit tests with several databases and
// separate app instances never suppress each other's housekeeping.
const _purgeState = new WeakMap();

/**
 * Throttled housekeeping: at most one bounded purge per interval per database.
 *
 * @param {object} db
 * @param {{now?: number}} [options]
 * @returns {number} rows removed (0 when the call was throttled)
 */
function purgeExpiredIfDue(db, options) {
  const opts = options || {};
  const now = Number.isFinite(opts.now) ? Number(opts.now) : Date.now();
  const last = _purgeState.get(db) || 0;
  if (now - last < PURGE_INTERVAL_MS) return 0;

  const removed = purgeExpired(db, { now, limit: PURGE_BATCH_LIMIT });
  _purgeState.set(db, now);
  return removed;
}

/**
 * Close the database connection (best effort; never throws).
 * @param {object} db
 */
function closeDb(db) {
  try {
    if (db && db.open) db.close();
  } catch (_) {}
}

// ── Backup / restore / validation via the shared safe-SQLite primitive ──────
// The challenge database has its own schema (a single `challenges` table), so
// it cannot reuse the token store's schema validator. It reuses the generic
// WAL-consistent backup and the rollback-safe restore instead.
const sqliteSnapshot = require("./sqliteSnapshot");

function _challengeSchemaValidator(db, resolved) {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='challenges'")
    .get();
  if (!table) {
    throw new sqliteSnapshot.SqliteSnapshotError(
      `Schema mismatch at ${resolved}: missing table challenges`
    );
  }
}

/**
 * Validate an arbitrary SQLite file as a challenge database.
 * @param {string} dbPath
 * @returns {string} the resolved path
 */
function validateDatabaseFile(dbPath) {
  // Side-effect free, like the token-store validator: a read-only open of a WAL
  // database still creates -wal/-shm beside it, so the candidate and its
  // sidecars are copied to an isolated temporary directory and validated there.
  // This keeps validation safe for backup artifacts and read-only media.
  return sqliteSnapshot.validateSqliteIsolated(dbPath, _challengeSchemaValidator);
}

/**
 * WAL-consistent backup of the challenge database.
 * @param {string} sourcePath
 * @param {string} destPath
 * @returns {Promise<string>}
 */
async function backupDatabase(sourcePath, destPath) {
  return sqliteSnapshot.backupSqlite(sourcePath, destPath, {
    validate: _challengeSchemaValidator
  });
}

/**
 * Rollback-safe restore of the challenge database.
 * @param {string} backupPath
 * @param {string} targetPath
 * @returns {Promise<void>}
 */
function restoreDatabase(backupPath, targetPath) {
  return sqliteSnapshot.restoreSqlite(backupPath, targetPath, {
    validate: _challengeSchemaValidator
  });
}

module.exports = {
  initialise,
  validateStartupConfiguration,
  validateDbPath,
  validateDatabaseFile,
  backupDatabase,
  restoreDatabase,
  persistChallenge,
  consumeChallenge,
  consumeChallengeWithBinding,
  persistOAuthLoginTransaction,
  consumeOAuthLoginTransaction,
  purgeExpired,
  purgeExpiredIfDue,
  closeDb,
  openDbInMemory,
  hashChallenge,
  resolveDefaultPath,
  ChallengeStoreError,
  challengeSchemaValidator: _challengeSchemaValidator,
  DEFAULT_TTL_MS,
  PURGE_INTERVAL_MS,
  PURGE_BATCH_LIMIT
};
