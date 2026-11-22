"use strict";

// Shared backup / verify / restore logic for backend/scripts/*.js.
//
// Extracted from the CLI scripts so the behaviour is unit-testable without
// spawning child processes or binding ports. The CLI wrappers only translate
// results into exit codes; every guarantee lives here.
//
// Guarantees:
//   * JSON stores are snapshotted byte-for-byte and re-read afterwards; if a
//     file changed while it was being copied the backup ABORTS rather than
//     record a torn snapshot. JSON and SQLite are NOT covered by a shared
//     transaction — this is documented best-effort consistency, not a claim of
//     cross-format atomicity.
//   * SQLite databases (token store and login-challenge store) are copied with
//     the WAL-consistent online backup API, never a raw file copy.
//   * A configured-but-missing database makes the backup FAIL, not silently
//     succeed with a partial manifest.
//   * The backup directory is created atomically (`mkdir` without `recursive`,
//     retried only on EEXIST) so two concurrent backups can never share or
//     overwrite one directory.
//   * Verification is side-effect free: SQLite artifacts are validated on an
//     isolated temporary copy, so verifying never creates -wal/-shm/-journal
//     files next to the artifact and works on read-only media.
//   * Restore validates the manifest and every artifact BEFORE any destination
//     is modified, refuses databases an active writer holds (and refuses when a
//     destination file is still held open, translating the OS error into an
//     actionable "stop the service" message), and applies all targets
//     as one operation-level transaction: every original (JSON file, SQLite file
//     and its sidecars) is preserved next to its own target, and only removed
//     after the whole operation validates. Any failure rolls every applied
//     target back, in reverse order.
//   * Each target is staged on its OWN filesystem: the incoming copy and the
//     preserved original live in the target's directory, so a relocated
//     TOKEN_STORE_PATH / CHALLENGE_DB_PATH on another volume works. A rename is
//     used where possible; EXDEV falls back to a size-verified copy+unlink that
//     removes only its own partial destination.
//   * Restores are serialised by a LOCK SET over the destinations they actually
//     replace — `.restore.lock` in the data directory plus one
//     `<database>.restore-lock` beside each SQLite target. Targets are
//     canonicalised (realpath) before locking and the locks are acquired in a
//     sorted global order, so restores that share even one database contend
//     (even from different --dir values) and a partial overlap cannot deadlock.
//     Every acquired lock is released on every success and failure path. Lock
//     names end in "-lock"/".lock", so they are never mistaken for stores.
//   * POSIX permissions travel with the databases. A backup records each SQLite
//     artifact's permission bits in the manifest, and a restore re-applies them,
//     so a hardened 0600 token/challenge database is not widened to SQLite's
//     default 0644. Manifests written before this field restore exactly as
//     before. OWNERSHIP IS NOT RESTORED: a restored file belongs to the user
//     that ran the restore, so run it as the service account; restoring as root
//     can leave files the application user cannot write.
//
// LIMITS — stated precisely so they are not over-claimed:
//   * Reconciliation is OPERATION-LEVEL only: it covers an error thrown while
//     restoring in this process. It is NOT crash-atomic. There is no durable
//     recovery journal; if the process is killed mid-apply, the originals
//     survive on disk beside their targets as `<artifact>.origin.<nonce>` (with
//     `<artifact>.origin.<nonce>-wal|-shm|-journal` sidecars) and need manual
//     reconciliation. A crash between moving the main file and moving its
//     sidecars leaves the main file in the origin name while the sidecars still
//     sit beside the target; DISASTER_RECOVERY.md §3 documents how to match them
//     by operation tag and why sidecars from different generations must never
//     be combined. There is no automatic crash recovery.
//   * The in-use probe only observes a live write lock. An open-but-idle
//     connection or a reader cannot be detected. STOPPING THE SERVICE BEFORE A
//     RESTORE IS MANDATORY — the probe narrows the window, it does not prove
//     the database is idle.
//   * The restore lock serialises restores among themselves; it cannot stop an
//     application process from writing unless that process is stopped.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class BackupRestoreError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "BackupRestoreError";
    this.cause = cause;
  }
}

// Raised when the destination file cannot be replaced because another process
// still holds it open (Windows reports EBUSY/EPERM for a rename over an open
// file, even when no writer lock is being held, so the SQLite probe cannot see
// it). Keeps the OS error code and the original error as `cause` so operators
// can still diagnose the underlying failure.
class DatabaseInUseError extends BackupRestoreError {
  constructor(message, original) {
    super(message, original);
    this.name = "DatabaseInUseError";
    this.code = original && original.code ? original.code : undefined;
    this.fsPath = original && original.path ? original.path : undefined;
    this.inUse = true;
  }
}

// Windows-only: an open handle makes rename fail with EBUSY, and a locked or
// in-use file can also surface as EPERM. EACCES (permissions) and ENOENT (gone)
// are deliberately NOT treated as "in use".
const LOCKED_FILE_CODES = new Set(["EBUSY", "EPERM"]);

function isLockedFileError(err) {
  return !!err && LOCKED_FILE_CODES.has(String(err.code || ""));
}

// Raised when an operation-level rollback itself failed: originals are not all
// back in place and a human must reconcile them.
class RecoveryRequiredError extends BackupRestoreError {
  constructor(message, originalError, failures) {
    super(message, originalError);
    this.name = "RecoveryRequiredError";
    this.originalError = originalError;
    this.rollbackFailures = failures || [];
    this.recoveryRequired = true;
  }
}

const PRODUCTION_LIKE_ENVS = new Set(["production", "staging"]);
// Every companion file of a database. -journal covers non-WAL databases; a
// stale journal must never be left beside a replaced file.
const SIDECARS = ["-wal", "-shm", "-journal"];
// Stable lock file for the destination. Not a managed artifact (not .json /
// .sqlite) so backups and the unlisted-artifact check ignore it.
const RESTORE_LOCK_NAME = ".restore.lock";
// Per-destination lock, created next to the database it protects. The suffix
// ends in "-lock" (never .json/.sqlite) so a lock file can never be mistaken for
// a managed store by backup, verification or the unlisted-artifact check.
const TARGET_LOCK_SUFFIX = ".restore-lock";
const INCOMING_TAG = ".incoming.";
const ORIGIN_TAG = ".origin.";
// Legacy staging-directory prefix from the previous implementation. Retained as
// an export because tests reference it; the current implementation stages each
// artifact beside its own target instead.
const STAGING_PREFIX = ".restore-stage-";
// Allowed manifest artifact names: flat names only. `.json` stores plus the two
// known databases. Anything else is an unknown artifact.
const ARTIFACT_NAME = /^(?:tokenStore\.sqlite|challengeStore\.sqlite|[A-Za-z0-9._-]+\.json)$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const DATA_ARTIFACT = /\.(json|sqlite)$/i;

// P7: manifest schema version. Manifests written by this release carry version 2.
// Legacy manifests with no `version` field continue to verify (backward
// compatibility). A `version` field present but not equal to MANIFEST_VERSION
// (including version 1) is rejected. Unknown future versions are rejected.
const MANIFEST_VERSION = 2;
// P7: prefix for in-flight backup directories. A partial backup never matches the
// `backup-` discovery pattern, so it is never mistaken for a completed backup.
const PARTIAL_PREFIX = ".partial-";
// P7: default allowlist of authoritative JSON store names. When a caller supplies
// `jsonInventory`, only listed files that exist in the source directory are backed
// up. When omitted, every `*.json` file in the directory is captured (the legacy
// behaviour, retained for backward compatibility).
const AUTHORITATIVE_JSON_STORES = [
  "apiKeys.json",
  "auditLog.json",
  "companies.json",
  "companyProfile.json",
  "customers.json",
  "marketConfig.json",
  "platformActivity.json",
  "platformAdmins.json",
  "platformPublic.json",
  "playstationDevices.json",
  "presence.json",
  "products.json",
  "purchases.json",
  "reelsCache.json",
  "reports.json",
  "revoked-tokens.json",
  "sales.json",
  "suppliers.json",
  "tenantAddons.json",
  "tenantCustomDomains.json",
  "tenantNotifications.json",
  "tenantPaymentTransactions.json",
  "tenantTransactionFees.json",
  "updateManifest.json",
  "users.json"
];

function isProductionLike(env) {
  return PRODUCTION_LIKE_ENVS.has(String(env || process.env.NODE_ENV || "").trim().toLowerCase());
}

function stamp(now) {
  // Keep the milliseconds so two backups in the same second never collide.
  return new Date(now || Date.now()).toISOString().replace(/:/g, "-");
}

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function _stores() {
  return {
    tokenStore: require("../../utils/tokenStore.sqlite"),
    challengeStore: require("../../utils/challengeStore.sqlite"),
    sqliteSnapshot: require("../../utils/sqliteSnapshot")
  };
}

// ── Configured paths (F2) ───────────────────────────────────────────────────
// One resolver used by backup, verify and restore so all three address the same
// physical databases. An explicit environment path always wins over the data
// directory default.
// `overrides` lets a caller state the database paths explicitly instead of
// inheriting them from the environment. It exists so a scheduled job never
// depends on ambient variables, and `undefined` keeps the historical
// environment-first behaviour byte-for-byte.
function resolveConfiguredPaths(dir, overrides) {
  const own = overrides || {};
  const tokenEnv = own.tokenPath !== undefined ? own.tokenPath : process.env.TOKEN_STORE_PATH;
  const challengeEnv = own.challengePath !== undefined ? own.challengePath : process.env.CHALLENGE_DB_PATH;
  const tokenConfigured = !!(tokenEnv && String(tokenEnv).trim());
  const challengeConfigured = !!(challengeEnv && String(challengeEnv).trim());
  return {
    dir: dir ? path.resolve(dir) : null,
    tokenConfigured,
    challengeConfigured,
    tokenPath: tokenConfigured
      ? path.resolve(String(tokenEnv).trim())
      : dir ? path.join(dir, "tokenStore.sqlite") : null,
    challengePath: challengeConfigured
      ? path.resolve(String(challengeEnv).trim())
      : dir ? path.join(dir, "challengeStore.sqlite") : null
  };
}

function resolveTokenStorePath(dir) {
  return resolveConfiguredPaths(dir).tokenPath;
}

function resolveChallengeDbPath(dir) {
  return resolveConfiguredPaths(dir).challengePath;
}

// Validate one backing SQLite file using the schema-appropriate validator. The
// validators are read-only, so validating a staged/incoming copy cannot modify
// it.
function validateSqliteByName(name, file) {
  const { tokenStore, challengeStore, sqliteSnapshot } = _stores();
  if (name === "tokenStore.sqlite") return tokenStore.validateDatabaseFile(file);
  if (name === "challengeStore.sqlite") return challengeStore.validateDatabaseFile(file);
  return sqliteSnapshot.validateSqliteFile(file);
}

// Validate a backup artifact WITHOUT modifying the backup directory: the file
// and its sidecars are copied to an isolated temp dir and validated there.
function validateSqliteArtifact(name, file) {
  const { tokenStore, challengeStore, sqliteSnapshot } = _stores();
  if (name === "tokenStore.sqlite") {
    return sqliteSnapshot.validateSqliteIsolated(file, tokenStore.tokenSchemaValidator);
  }
  if (name === "challengeStore.sqlite") {
    return sqliteSnapshot.validateSqliteIsolated(file, challengeStore.challengeSchemaValidator);
  }
  return sqliteSnapshot.validateSqliteIsolated(file);
}

// ── Manifest validation (F6/F7) ─────────────────────────────────────────────
// JSON.parse keeps the last duplicate key silently, so duplicate detection has
// to look at the raw text.
function _filesBlockText(raw) {
  const key = /"files"\s*:\s*\{/.exec(raw);
  if (!key) return null;
  let depth = 1;
  let i = key.index + key[0].length;
  const start = i;
  for (; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i);
    }
  }
  return null;
}

function _duplicateManifestKeys(raw) {
  const block = _filesBlockText(raw);
  if (!block) return [];
  const counts = new Map();
  let depth = 0;
  let i = 0;
  while (i < block.length) {
    const ch = block[i];
    if (ch === '"') {
      // Read the whole string literal, then look at what follows it.
      let j = i + 1;
      let name = "";
      while (j < block.length) {
        if (block[j] === "\\") { name += block[j + 1]; j += 2; continue; }
        if (block[j] === '"') break;
        name += block[j];
        j++;
      }
      let k = j + 1;
      while (k < block.length && /\s/.test(block[k])) k++;
      // Only keys of the files object itself are artifact names; nested
      // metadata keys (bytes/sha256) repeat legitimately.
      if (depth === 0 && block[k] === ":") counts.set(name, (counts.get(name) || 0) + 1);
      i = j + 1;
      continue;
    }
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
    i++;
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name);
}

function _isContained(root, candidate) {
  const base = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved === base) return true;
  return resolved.startsWith(base + path.sep);
}

// Validate the whole manifest before any file operation. Returns an array of
// {name, reason}; empty means the manifest is acceptable.
function validateManifest(manifest, dir, rawText) {
  const failures = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return [{ name: "manifest.json", reason: "not a JSON object" }];
  }
  const files = manifest.files;
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    return [{ name: "manifest.json", reason: "missing files map" }];
  }
  const names = Object.keys(files);
  if (names.length === 0) {
    return [{ name: "manifest.json", reason: "manifest is empty (no artifacts declared)" }];
  }
  if (typeof rawText === "string") {
    for (const dup of _duplicateManifestKeys(rawText)) {
      failures.push({ name: dup, reason: "duplicate manifest entry" });
    }
  }

  for (const name of names) {
    const meta = files[name];
    if (typeof name !== "string" || name.length === 0) {
      failures.push({ name: String(name), reason: "empty artifact name" });
      continue;
    }
    if (name.includes("/") || name.includes("\\")) {
      failures.push({ name, reason: "artifact name contains a path separator" });
      continue;
    }
    if (name === "." || name === ".." || name.split("/").includes("..")) {
      failures.push({ name, reason: "artifact name contains a traversal component" });
      continue;
    }
    if (path.isAbsolute(name) || /^[A-Za-z]:/.test(name) || name.startsWith("\\\\")) {
      failures.push({ name, reason: "artifact name is an absolute or drive-prefixed path" });
      continue;
    }
    if (!ARTIFACT_NAME.test(name)) {
      failures.push({ name, reason: "unknown artifact name" });
      continue;
    }
    if (dir && !_isContained(dir, path.join(dir, name))) {
      failures.push({ name, reason: "resolved path escapes the backup directory" });
      continue;
    }
    if (!meta || typeof meta !== "object") {
      failures.push({ name, reason: "missing manifest metadata" });
      continue;
    }
    if (!Number.isInteger(meta.bytes) || meta.bytes < 0) {
      failures.push({ name, reason: "invalid byte count" });
      continue;
    }
    if (typeof meta.sha256 !== "string" || !SHA256_HEX.test(meta.sha256)) {
      failures.push({ name, reason: "invalid sha256" });
      continue;
    }
    // Optional POSIX permission bits. Only SQLite artifacts may carry them, and
    // only as an integer in range: strings, floats, negatives and values with
    // bits outside 0..0o777 are rejected rather than coerced.
    if (Object.prototype.hasOwnProperty.call(meta, "mode")) {
      if (!name.endsWith(".sqlite")) {
        failures.push({ name, reason: "mode is only valid for SQLite artifacts" });
        continue;
      }
      const mode = meta.mode;
      if (typeof mode !== "number" || !Number.isInteger(mode) || mode < 0 || mode > 0o777) {
        failures.push({ name, reason: "invalid mode (integer 0..0o777 required)" });
        continue;
      }
    }
  }
  return failures;
}

// Verify a backup directory against its manifest. Returns
// { ok, failures: [{name, reason}], manifest }. Never throws for a bad backup,
// and never modifies the backup directory (SQLite is validated on a copy).
function verifyBackupDir(dir) {
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, failures: [{ name: "manifest.json", reason: "missing manifest" }], manifest: null };
  }

  let raw;
  let manifest;
  try {
    raw = fs.readFileSync(manifestPath, "utf8");
    manifest = JSON.parse(raw);
  } catch (err) {
    return { ok: false, failures: [{ name: "manifest.json", reason: "invalid JSON: " + err.message }], manifest: null };
  }

  const structural = validateManifest(manifest, dir, raw);
  if (structural.length > 0) {
    return { ok: false, failures: structural, manifest };
  }

  const failures = [];

  // P7: manifest schema version. A missing version means a legacy manifest
  // (pre-P7) which continues to verify. Any non-matching version is rejected.
  if (typeof manifest.version === "number" && manifest.version !== MANIFEST_VERSION) {
    failures.push({ name: "manifest.json", reason: `unsupported manifest version ${manifest.version}` });
    return { ok: false, failures, manifest };
  }

  for (const [name, meta] of Object.entries(manifest.files)) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) {
      failures.push({ name, reason: "missing" });
      continue;
    }
    const bytes = fs.statSync(file).size;
    const hash = sha256File(file);
    if (bytes !== meta.bytes || hash !== meta.sha256) {
      failures.push({ name, reason: "checksum/size mismatch" });
      continue;
    }
    if (name.endsWith(".json")) {
      try { JSON.parse(fs.readFileSync(file, "utf8")); } catch (err) {
        failures.push({ name, reason: "invalid JSON: " + err.message });
        continue;
      }
    } else if (name.endsWith(".sqlite")) {
      try { validateSqliteArtifact(name, file); } catch (err) {
        failures.push({ name, reason: "invalid SQLite: " + err.message });
        continue;
      }
    }
  }

  return { ok: failures.length === 0, failures, manifest };
}

// ── Atomic backup directory (F4) ────────────────────────────────────────────
// `mkdir` without `recursive` is atomic: exactly one caller wins. Losers retry
// the next suffix and only EEXIST is treated as retryable.
function createUniqueBackupDir(out, now) {
  const base = path.join(out, "backup-" + stamp(now));
  for (let i = 0; i < 1000; i++) {
    const candidate = i === 0 ? base : `${base}-${i}`;
    try {
      fs.mkdirSync(candidate);
      return candidate;
    } catch (err) {
      if (err && err.code === "EEXIST") continue;
      throw new BackupRestoreError(
        `Could not create backup directory ${candidate}: ${err.message}`,
        err
      );
    }
  }
  throw new BackupRestoreError(`Could not create a unique backup directory under ${out}`);
}

// Backwards-compatible name for the previous helper.
function uniqueBackupDir(out, now) {
  return path.join(out, "backup-" + stamp(now));
}

// Attach the source database's POSIX permission bits to its manifest entry. The
// field stays optional: a manifest without it (any release before this one)
// restores with the historical behaviour. Windows records nothing because it
// has no POSIX mode to reproduce. On POSIX the read is fail-closed: if the mode
// cannot be determined the backup aborts instead of emitting a manifest that
// says nothing about permissions.
function _withMode(meta, sourcePath) {
  const mode = _stores().sqliteSnapshot.sourcePermissionBits(sourcePath);
  if (mode !== null) meta.mode = mode;
  return meta;
}

function deleteDir(dir) {
  if (dir && fs.existsSync(dir)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

async function runBackup(options) {
  const opts = options || {};
  const dir = opts.dir;
  const out = opts.out;
  if (!dir || !out) throw new BackupRestoreError("runBackup requires dir and out");
  if (!fs.existsSync(dir)) throw new BackupRestoreError("Data directory not found: " + dir);

  const { tokenStore, challengeStore } = _stores();

  // P7: when an explicit inventory is supplied, only those JSON stores are
  // captured. Otherwise every *.json file is backed up (legacy behaviour).
  let jsonFiles;
  if (Array.isArray(opts.jsonInventory)) {
    jsonFiles = opts.jsonInventory
      .filter((f) => typeof f === "string" && f.endsWith(".json"))
      .filter((f) => fs.existsSync(path.join(dir, f)))
      .sort();
  } else {
    jsonFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  }

  fs.mkdirSync(out, { recursive: true });

  // P7: atomic publication. Write to a .partial-* directory, verify it, then
  // rename to backup-*. A crash mid-copy leaves only a .partial-* entry that
  // never matches the backup- discovery pattern.
  const baseName = "backup-" + stamp(opts.now);
  let partial;
  for (let i = 0; i < 1000; i++) {
    const candidate = path.join(out, PARTIAL_PREFIX + baseName + (i === 0 ? "" : "-" + i));
    try {
      fs.mkdirSync(candidate);
      partial = candidate;
      break;
    } catch (err) {
      if (err && err.code === "EEXIST") continue;
      throw new BackupRestoreError(
        `Could not create backup staging directory ${candidate}: ${err.message}`,
        err
      );
    }
  }
  if (!partial) {
    throw new BackupRestoreError(`Could not create a unique backup staging directory under ${out}`);
  }

  try {
    const result = await _writeBackup({ dir, dest: partial, jsonFiles, tokenStore, challengeStore, opts });
    // P7: mark the manifest complete only after every artifact is written.
    result.manifest.status = "complete";
    fs.writeFileSync(
      path.join(partial, "manifest.json"),
      JSON.stringify(result.manifest, null, 2)
    );
    // Independent verification before publication.
    const verification = verifyBackupDir(partial);
    if (!verification.ok) {
      throw new BackupRestoreError(
        "Staged backup failed verification: " +
          verification.failures.map((f) => `${f.name}: ${f.reason}`).join("; ")
      );
    }
    // Atomic publish: one rename within the destination filesystem. The
    // destination name must be unique too, because concurrent backups share the
    // same base timestamp. Retry on EEXIST/EPERM/ENOTEMPTY (Linux reports
    // ENOTEMPTY when renaming over an existing non-empty directory).
    let dest;
    for (let i = 0; i < 1000; i++) {
      const candidate = path.join(out, baseName + (i === 0 ? "" : "-" + i));
      try {
        fs.renameSync(partial, candidate);
        dest = candidate;
        break;
      } catch (err) {
        if (err && (err.code === "EEXIST" || err.code === "EPERM" || err.code === "ENOTEMPTY")) continue;
        throw err;
      }
    }
    if (!dest) {
      throw new BackupRestoreError(`Could not publish backup under ${out}`);
    }
    // P7: re-apply POSIX permission bits on the published paths so the final
    // artifacts carry the correct mode regardless of where chmod ran during
    // staging. SQLite modes come from the manifest; JSON stores are narrowed to
    // 0640 on POSIX.
    if (process.platform !== "win32") {
      for (const [name, meta] of Object.entries(result.manifest.files)) {
        const finalPath = path.join(dest, name);
        if (name.endsWith(".sqlite") && typeof meta.mode === "number") {
          try { fs.chmodSync(finalPath, meta.mode); } catch (_) {}
        } else if (name.endsWith(".json")) {
          try { fs.chmodSync(finalPath, 0o640); } catch (_) {}
        }
      }
    }
    return { dest, manifest: result.manifest };
  } catch (err) {
    // Remove the partial staging directory so a failed run never leaves a
    // discoverable backup behind.
    try { fs.rmSync(partial, { recursive: true, force: true }); } catch (_) {}
    throw err;
  }
}

async function _writeBackup(ctx) {
  const { dir, dest, jsonFiles, tokenStore, challengeStore, opts } = ctx;
  const { sqliteSnapshot } = _stores();
  const configured = resolveConfiguredPaths(dir, {
    tokenPath: opts.tokenPath,
    challengePath: opts.challengePath
  });

  const manifest = {
    version: MANIFEST_VERSION,
    created: new Date(opts.now || Date.now()).toISOString(),
    source: dir,
    consistency: "best-effort (JSON re-read; SQLite WAL-checkpointed)",
    files: {},
    databases: {},
    skipped: []
  };

  // JSON stores: snapshot then re-read to detect a concurrent modification.
  // Restore lock/temp files are never .json so they cannot be picked up here.
  for (const f of jsonFiles) {
    const src = path.join(dir, f);
    const before = fs.readFileSync(src);
    JSON.parse(before.toString("utf8"));
    const destFile = path.join(dest, f);
    fs.writeFileSync(destFile, before);
    const after = fs.readFileSync(src);
    if (!before.equals(after)) {
      throw new BackupRestoreError(
        `JSON store ${f} changed during backup; aborting to avoid an inconsistent snapshot. ` +
          "Run the backup while the service is stopped for a strict guarantee."
      );
    }
    manifest.files[f] = { bytes: before.length, sha256: sha256Buffer(before) };
  }

  // Token store (SQLite). A configured path that is missing fails closed.
  const tokenPath = configured.tokenPath;
  if (fs.existsSync(tokenPath)) {
    const storeDest = path.join(dest, "tokenStore.sqlite");
    await tokenStore.backupDatabase(tokenPath, storeDest);
    sqliteSnapshot.compactSidecars(storeDest);
    manifest.files["tokenStore.sqlite"] = _withMode(
      { bytes: fs.statSync(storeDest).size, sha256: sha256File(storeDest) },
      tokenPath
    );
    manifest.databases.tokenStore = { name: "tokenStore.sqlite", source: tokenPath, included: true };
  } else if (configured.tokenConfigured) {
    throw new BackupRestoreError(
      `Configured token database is missing: ${tokenPath}. Refusing an incomplete backup.`
    );
  } else {
    manifest.skipped.push({ name: "tokenStore.sqlite", reason: "not_present" });
  }

  // Challenge store (SQLite) — required in production-like envs.
  const challengePath = configured.challengePath;
  if (fs.existsSync(challengePath)) {
    const storeDest = path.join(dest, "challengeStore.sqlite");
    await challengeStore.backupDatabase(challengePath, storeDest);
    sqliteSnapshot.compactSidecars(storeDest);
    manifest.files["challengeStore.sqlite"] = _withMode(
      { bytes: fs.statSync(storeDest).size, sha256: sha256File(storeDest) },
      challengePath
    );
    manifest.databases.challengeStore = { name: "challengeStore.sqlite", source: challengePath, included: true };
  } else if (configured.challengeConfigured) {
    throw new BackupRestoreError(
      `Configured challenge database is missing: ${challengePath}. Refusing an incomplete backup.`
    );
  } else if (isProductionLike(opts.env)) {
    throw new BackupRestoreError(
      "Challenge database is required in this environment but CHALLENGE_DB_PATH is not configured; " +
        "refusing an incomplete backup."
    );
  } else {
    manifest.skipped.push({ name: "challengeStore.sqlite", reason: "not_configured" });
  }

  if (Object.keys(manifest.files).length === 0) {
    throw new BackupRestoreError("No backup artifacts found in " + dir);
  }

  fs.writeFileSync(path.join(dest, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { dest, manifest };
}

// ── Staged multi-file restore (F3) ──────────────────────────────────────────

function _formatFailures(failures) {
  return failures.map((f) => `${f.path} (${f.reason})`).join("; ");
}

// Move a file, tolerating a cross-device target: rename first (atomic, same
// volume), else a size-verified copy + unlink. Never deletes the source before
// the copy is confirmed.
//
// The cross-device branch is defensive: restore stages every incoming copy and
// every preserved original in the target's own directory, so a rename normally
// stays on one volume. If the copy or its size check fails, only the partial
// destination this call created is removed — a destination that already existed
// before the copy (pre-existing recovery material) is never touched, and the
// source is always preserved.
function _moveFile(from, to) {
  try {
    fs.renameSync(from, to);
    return "rename";
  } catch (err) {
    if (!err || err.code !== "EXDEV") throw err;
    const existedBefore = fs.existsSync(to);
    try {
      fs.copyFileSync(from, to);
      const srcSize = fs.statSync(from).size;
      const dstSize = fs.statSync(to).size;
      if (srcSize !== dstSize) {
        throw new BackupRestoreError(
          `Cross-device copy incomplete (${srcSize} != ${dstSize}): ${from} -> ${to}`,
          err
        );
      }
    } catch (copyErr) {
      if (!existedBefore) {
        try { if (fs.existsSync(to)) fs.unlinkSync(to); } catch (_) {}
      }
      throw copyErr;
    }
    fs.unlinkSync(from);
    return "copy";
  }
}

function _sidecarPaths(target) {
  return SIDECARS.map((suffix) => target + suffix);
}

// Remove a staged/incoming file together with any sidecars SQLite created while
// validating it (a read-only open of a WAL database still creates -wal/-shm in
// a writable directory).
function _removeFileWithSidecars(file) {
  for (const candidate of [file, ..._sidecarPaths(file)]) {
    try { if (fs.existsSync(candidate)) fs.unlinkSync(candidate); } catch (_) {}
  }
}

// Put every target back, newest first. Returns the list of failures (empty means
// the rollback was complete). Never throws: the caller is already handling a
// primary failure and must be able to report both.
function _rollbackTargets(applied) {
  const failures = [];
  for (let i = applied.length - 1; i >= 0; i--) {
    const record = applied[i];
    try {
      if (record.installed) {
        for (const candidate of [record.target, ..._sidecarPaths(record.target)]) {
          if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
        }
      }
      for (const moved of record.originals.slice().reverse()) {
        if (!fs.existsSync(moved.to)) {
          failures.push({ path: moved.from, reason: `preserved original missing at ${moved.to}` });
          continue;
        }
        if (fs.existsSync(moved.from)) fs.unlinkSync(moved.from);
        _moveFile(moved.to, moved.from);
      }
    } catch (err) {
      failures.push({ path: record.target, reason: err.message });
    }
  }
  return failures;
}

function _failWithRollback(applied, primary, stage) {
  const failures = _rollbackTargets(applied);
  if (failures.length > 0) {
    throw new RecoveryRequiredError(
      `Restore failed at stage "${stage}": ${primary.message}. ` +
        `ROLLBACK INCOMPLETE — ${failures.length} path(s) still need manual recovery: ` +
        `${_formatFailures(failures)}. Preserved originals remain beside their targets as ` +
        `*${ORIGIN_TAG}<nonce> files.`,
      primary,
      failures
    );
  }
  if (primary instanceof BackupRestoreError) throw primary;
  throw new BackupRestoreError(
    `Restore failed at stage "${stage}"; all previously applied targets were rolled back: ${primary.message}`,
    primary
  );
}

function _assertNotInUse(entry) {
  if (entry.kind !== "sqlite") return;
  if (!fs.existsSync(entry.target)) return;
  const { sqliteSnapshot } = _stores();
  if (!sqliteSnapshot.isDatabaseInUse(entry.target)) return;
  throw new BackupRestoreError(
    `Refusing to restore: the database is in use (a writer holds a lock) at ${entry.target}. ` +
      "Stop the service before restoring. " +
      "An open-but-idle connection or a read-only reader cannot be detected, so stopping the " +
      "service remains mandatory."
  );
}

// Existing managed artifacts in the data directory that the manifest does not
// describe. They would survive a restore and leave a mixed dataset.
function findUnlistedArtifacts(dir, plan) {
  const planned = new Set(
    plan.filter((entry) => path.dirname(entry.target) === path.resolve(dir)).map((entry) => entry.name)
  );
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (_) {
    return [];
  }
  return entries.filter((f) => DATA_ARTIFACT.test(f) && !planned.has(f)).sort();
}

// ── Isolated destination planning (P6 restore isolation) ───────────────────
// Without `isolated`, database destinations come from the environment first
// (resolveConfiguredPaths), which is correct for the operator-driven restore
// but dangerous for a rehearsal: a shell that still carries the production
// TOKEN_STORE_PATH / CHALLENGE_DB_PATH would silently target the live stores
// while the JSON artifacts went to the scratch directory. With `isolated`, the
// environment is never consulted and every artifact is named inside `dir`.
function _planTargets(manifest, dir, options) {
  const opts = options || {};
  const root = path.resolve(dir);
  if (opts.isolated) {
    return Object.keys(manifest.files).map((name) => ({
      name,
      kind: name.endsWith(".sqlite") ? "sqlite" : "json",
      target: path.join(root, name)
    }));
  }
  const configured = resolveConfiguredPaths(dir);
  return Object.keys(manifest.files).map((name) => {
    if (name === "tokenStore.sqlite") return { name, kind: "sqlite", target: configured.tokenPath };
    if (name === "challengeStore.sqlite") return { name, kind: "sqlite", target: configured.challengePath };
    return { name, kind: "json", target: path.join(dir, name) };
  });
}

function _realpathOrFail(p, label) {
  try {
    return fs.realpathSync.native(p);
  } catch (err) {
    throw new BackupRestoreError(
      `Isolated restore cannot prove containment for ${label}: ${err.message}. ` +
        "The directory must exist and be readable before an isolated restore.",
      err
    );
  }
}

// Prove, before a single byte is written, that every destination an isolated
// restore would touch resolves inside `dir`: JSON files, both SQLite databases,
// their -wal/-shm/-journal sidecars, the staging (.incoming.<tag>) and
// preservation (.origin.<tag>) names derived from those targets, and the lock
// files. Any symlink on a target or sidecar, any parent that resolves
// elsewhere, and any unreadable component fail closed.
function assertIsolatedPlan(dir, plan) {
  const declaredRoot = path.resolve(dir);
  const rootReal = _realpathOrFail(declaredRoot, "the restore destination");
  const failures = [];

  for (const entry of plan) {
    const target = path.resolve(entry.target);
    const expected = path.join(declaredRoot, entry.name);
    const expectedReal = path.join(rootReal, entry.name);

    if (target !== expected && target !== expectedReal) {
      failures.push(`${entry.name} is not named directly inside the destination (${target})`);
      continue;
    }
    if (!_isContained(declaredRoot, target) && !_isContained(rootReal, target)) {
      failures.push(`${entry.name} escapes the destination (${target})`);
      continue;
    }

    let parentReal;
    try {
      parentReal = fs.realpathSync.native(path.dirname(target));
    } catch (err) {
      failures.push(`${entry.name} has an unreadable parent (${path.dirname(target)}): ${err.message}`);
      continue;
    }
    if (parentReal !== rootReal) {
      failures.push(`${entry.name} would be written outside the destination (resolves to ${parentReal})`);
      continue;
    }

    for (const candidate of [target, ..._sidecarPaths(target)]) {
      let stats;
      try { stats = fs.lstatSync(candidate); } catch (_) { continue; }
      if (stats.isSymbolicLink()) failures.push(`${candidate} is a symbolic link, which an isolated restore refuses`);
    }
  }

  if (failures.length > 0) {
    throw new BackupRestoreError(`Isolated restore refused: ${failures.join("; ")}`);
  }
  return { root: rootReal };
}

// Resolve the physical path of a destination for lock naming. An existing file
// is resolved with realpath (symlinks, Windows short names and case); a file the
// restore is about to create is resolved through its parent directory, so two
// configurations that name the same directory differently still contend.
function canonicalPath(p) {
  const abs = path.resolve(String(p));
  try {
    return fs.realpathSync.native(abs);
  } catch (_) { /* target does not exist yet */ }
  try {
    return path.join(fs.realpathSync.native(path.dirname(abs)), path.basename(abs));
  } catch (_) {
    return abs;
  }
}

// Every lock a restore must hold, sorted so all processes acquire them in the
// same global order (a partial overlap can therefore never deadlock).
//   * the destination data directory (JSON stores + staging)
//   * one lock per SQLite destination, in the database's own directory
// A restore that relocates TOKEN_STORE_PATH/CHALLENGE_DB_PATH therefore contends
// with any other restore touching the same database, even from another --dir.
function restoreLockPaths(dir, plan) {
  // The data-directory lock is canonicalised exactly like the target locks. A
  // real path and an alias of the same --dir (junction/symlink) must therefore
  // produce identical lock identities and the same sorted position: otherwise
  // two restores with overlapping targets could each take their one shared lock
  // second and deadlock.
  const paths = [path.join(canonicalPath(dir), RESTORE_LOCK_NAME)];
  for (const entry of plan) {
    if (entry.kind !== "sqlite") continue;
    paths.push(canonicalPath(entry.target) + TARGET_LOCK_SUFFIX);
  }
  return [...new Set(paths)].sort();
}

// Acquire every lock in order, releasing the ones already held if any fails.
async function _acquireLocks(lockPaths, options) {
  const releases = [];
  try {
    const fileLock = require("../../utils/fileLock");
    for (const lockPath of lockPaths) {
      releases.push(await fileLock.acquire(lockPath, options));
    }
    return releases;
  } catch (err) {
    await _releaseLocks(releases);
    throw err;
  }
}

// Release in the reverse order of acquisition. Never throws: a release problem
// must not replace the outcome of the restore itself.
async function _releaseLocks(releases) {
  for (let i = releases.length - 1; i >= 0; i--) {
    try { await releases[i](); } catch (_) {}
  }
}

// Copy every artifact next to its own target and validate that copy. Runs
// before any target is touched; each copy lives on the target's filesystem, so
// the later swap never crosses a device boundary.
function _prepareIncoming({ plan, from, manifest, tag }) {
  const created = [];
  try {
    for (const entry of plan) {
      const incoming = entry.target + INCOMING_TAG + tag;
      fs.copyFileSync(path.join(from, entry.name), incoming);
      created.push(incoming);
      const meta = manifest.files[entry.name];
      const bytes = fs.statSync(incoming).size;
      if (bytes !== meta.bytes) {
        throw new BackupRestoreError(`Incoming ${entry.name} has the wrong size (${bytes} != ${meta.bytes})`);
      }
      if (sha256File(incoming) !== meta.sha256) {
        throw new BackupRestoreError(`Incoming ${entry.name} does not match its manifest checksum`);
      }
      if (entry.kind === "json") {
        try { JSON.parse(fs.readFileSync(incoming, "utf8")); } catch (err) {
          throw new BackupRestoreError(`Incoming ${entry.name} is not valid JSON: ${err.message}`);
        }
      } else {
        try { validateSqliteByName(entry.name, incoming); } catch (err) {
          throw new BackupRestoreError(`Incoming ${entry.name} is not a usable database: ${err.message}`, err);
        }
      }
      entry.incoming = incoming;
    }
    return created;
  } catch (err) {
    for (const file of created) _removeFileWithSidecars(file);
    throw err;
  }
}

async function runRestore(options) {
  const opts = options || {};
  const from = opts.from;
  const dir = opts.dir;
  if (!from) throw new BackupRestoreError("Backup directory required");
  if (!dir) throw new BackupRestoreError("Restore requires a destination data directory");

  // (1) Manifest + artifact validation. Nothing has been modified yet.
  const isolated = !!opts.isolated;
  const verification = verifyBackupDir(from);
  if (!verification.manifest) {
    throw new BackupRestoreError(`Backup directory (with a valid manifest.json) required: ${from}`);
  }
  if (!verification.ok) {
    const detail = verification.failures.map((f) => `${f.name}: ${f.reason}`).join("; ");
    throw new BackupRestoreError(`Backup verification failed (${verification.failures.length}): ${detail}`);
  }

  if (!fs.existsSync(dir)) {
    throw new BackupRestoreError(
      `Data directory does not exist: ${dir}. Create it (and grant write access) before restoring; ` +
        "the restore never invents paths."
    );
  }

  // (2) Resolve every actual destination and refuse to invent a configured
  // database's parent directory. This runs before any lock is created.
  const plan = _planTargets(verification.manifest, dir, { isolated });
  if (isolated) assertIsolatedPlan(dir, plan);
  for (const entry of plan) {
    const parent = path.dirname(entry.target);
    if (!fs.existsSync(parent)) {
      throw new BackupRestoreError(
        `Destination directory does not exist for ${entry.name}: ${parent}. ` +
          "Create it (and grant write access) before restoring; the restore never invents paths."
      );
    }
  }

  // (3) Serialise the whole transaction. The lock set covers the data directory
  // AND each SQLite destination, so two restores that share even one database
  // contend even when they use different --dir values. They are acquired in a
  // sorted global order, which makes a partial overlap deadlock-free, and every
  // acquired lock is released on every path.
  const lockPaths = restoreLockPaths(dir, plan);
  const lockOptions = { timeout: opts.lockTimeoutMs || 30000, stale: 30000 };
  let releases = [];
  try {
    releases = await _acquireLocks(lockPaths, lockOptions);
  } catch (err) {
    if (err && err.code === "ELOCKED") {
      const contended = (err && err.lockPath) || lockPaths[0];
      throw new BackupRestoreError(
        `Another restore is already running for ${contended}. ` +
          "A unified backup job holds the same data-directory lock; wait for it to finish, then retry."
      );
    }
    throw err;
  }

  try {
    return _runRestoreLocked({ ...opts, from, dir, manifest: verification.manifest, plan });
  } finally {
    await _releaseLocks(releases);
  }
}

// Re-apply the POSIX permission bits recorded for this entry. Skipped on Windows
// (chmod there only toggles the read-only attribute) and skipped for manifests
// that carry no mode, which is how legacy backups keep their old behaviour.
// Failures propagate untouched: applyFileMode throws a SqliteSnapshotError that
// carries no OS error `code`, so the caller cannot mistake it for a locked-file
// (EBUSY/EPERM) condition, and the outer handler wraps it with the rollback
// outcome and the exact path.
function _applyManifestMode(entry, manifest) {
  if (entry.kind !== "sqlite") return;
  if (process.platform === "win32") return;
  const meta = manifest.files[entry.name];
  if (!meta || typeof meta.mode !== "number") return;
  _stores().sqliteSnapshot.applyFileMode(entry.target, meta.mode);
}

function _runRestoreLocked(opts) {
  const { from, dir, manifest, plan } = opts;
  // Re-prove containment once the lock is held, so a target turned into a
  // symlink between planning and applying is still refused.
  if (opts.isolated) assertIsolatedPlan(dir, plan);
  const force = !!opts.force;
  const allowUnlisted = !!opts.allowUnlisted;
  const names = Object.keys(manifest.files);

  // (4) --force keeps its overwrite-only meaning.
  const existing = plan.filter((entry) => fs.existsSync(entry.target));
  if (existing.length > 0 && !force) {
    throw new BackupRestoreError(
      `Destination is not empty (${existing.map((e) => e.name).join(", ")}). ` +
        "Re-run with --force to overwrite."
    );
  }

  // (4b) Refuse to leave unmanaged stores behind, unless explicitly allowed.
  const unlisted = findUnlistedArtifacts(dir, plan);
  if (unlisted.length > 0 && !allowUnlisted) {
    throw new BackupRestoreError(
      `Destination contains ${unlisted.length} store(s) not in the backup manifest: ` +
        `${unlisted.join(", ")}. Restoring would leave a mixed dataset. ` +
        "Move them aside, or re-run with --allow-unlisted to keep them deliberately."
    );
  }

  // (5) Refuse to replace a database an active writer holds — checked for every
  // SQLite target before the first target is touched.
  for (const entry of plan) _assertNotInUse(entry);

  // (6) Prepare and validate every incoming copy before any target change. Each
  // copy sits beside its own target, so it is on the same filesystem.
  const tag = stamp(opts.now) + "-" + process.pid;
  const incoming = _prepareIncoming({ plan, from, manifest, tag });

  // (7) Apply. Originals move aside first; nothing is deleted until the whole
  // operation validates.
  const applied = [];
  try {
    for (const entry of plan) {
      const record = { target: entry.target, name: entry.name, originals: [], installed: false };
      applied.push(record);
      try {
        // Re-probe immediately before the swap to narrow the check-then-rename
        // window as far as this architecture allows.
        _assertNotInUse(entry);
        if (fs.existsSync(entry.target)) {
          const aside = entry.target + ORIGIN_TAG + tag;
          _moveFile(entry.target, aside);
          record.originals.push({ from: entry.target, to: aside });
        }
        for (const suffix of SIDECARS) {
          const sidecar = entry.target + suffix;
          if (!fs.existsSync(sidecar)) continue;
          const aside = entry.target + ORIGIN_TAG + tag + suffix;
          _moveFile(sidecar, aside);
          record.originals.push({ from: sidecar, to: aside });
        }
        _moveFile(entry.incoming, entry.target);
        record.installed = true;
        // Validation sidecars of the incoming copy are not part of the target (the
        // main file has been moved into place, only its -wal/-shm/-journal remain).
        _removeFileWithSidecars(entry.incoming);
        // (7b) Permissions last, and only once the entry is already registered in
        // `applied` as installed: if this throws, the outer catch rolls the whole
        // operation back, restoring both the original bytes and the original mode
        // (a rename back). No later step touches the mode, and this runs after
        // every copy, so nothing widens it again.
        _applyManifestMode(entry, manifest);
      } catch (err) {
        // Windows refuses to rename over a file another process holds open, with
        // EBUSY (or EPERM for a locked file). The writer probe cannot detect an
        // open-but-idle handle, so translate that specific case into the same
        // actionable service-stop message. Unrelated filesystem errors are
        // rethrown untouched so they are never mis-reported as "in use".
        if (entry.kind === "sqlite" && isLockedFileError(err) && !(err instanceof DatabaseInUseError)) {
          throw new DatabaseInUseError(
            `Refusing to restore: the database file at ${entry.target} is locked by another process ` +
              `(${err.code} while replacing it). Stop the service and close every connection to ` +
              "this database before restoring.",
            err
          );
        }
        throw err;
      }
    }
  } catch (err) {
    for (const file of incoming) _removeFileWithSidecars(file);
    _failWithRollback(applied, err, `apply ${applied[applied.length - 1].name}`);
  }

  // (8) Final validation of every target, exactly as it now sits on disk.
  for (const entry of plan) {
    try {
      if (entry.kind === "json") {
        JSON.parse(fs.readFileSync(entry.target, "utf8"));
      } else {
        validateSqliteByName(entry.name, entry.target);
      }
    } catch (err) {
      _failWithRollback(
        applied,
        new BackupRestoreError(`Final validation failed for ${entry.name}: ${err.message}`, err),
        `final validation of ${entry.name}`
      );
    }
  }

  // (9) Only now is the recovery material disposable.
  const cleanupFailures = [];
  for (const record of applied) {
    for (const moved of record.originals) {
      try { if (fs.existsSync(moved.to)) fs.unlinkSync(moved.to); } catch (err) {
        cleanupFailures.push({ path: moved.to, reason: err.message });
      }
    }
  }
  if (cleanupFailures.length > 0) {
    throw new BackupRestoreError(
      "Restore succeeded but preserved originals could not be removed: " + _formatFailures(cleanupFailures)
    );
  }

  return {
    restored: names.length,
    dir,
    targets: plan.map((entry) => entry.target),
    overwritten: existing.map((e) => e.name),
    unlistedKept: unlisted
  };
}

module.exports = {
  BackupRestoreError,
  DatabaseInUseError,
  RecoveryRequiredError,
  isLockedFileError,
  canonicalPath,
  restoreLockPaths,
  runBackup,
  runRestore,
  verifyBackupDir,
  validateManifest,
  resolveConfiguredPaths,
  resolveTokenStorePath,
  resolveChallengeDbPath,
  validateSqliteByName,
  validateSqliteArtifact,
  findUnlistedArtifacts,
  assertIsolatedPlan,
  isProductionLike,
  sha256Buffer,
  sha256File,
  stamp,
  createUniqueBackupDir,
  uniqueBackupDir,
  deleteDir,
  SIDECARS,
  RESTORE_LOCK_NAME,
  TARGET_LOCK_SUFFIX,
  INCOMING_TAG,
  ORIGIN_TAG,
  STAGING_PREFIX,
  MANIFEST_VERSION,
  PARTIAL_PREFIX,
  AUTHORITATIVE_JSON_STORES
};
