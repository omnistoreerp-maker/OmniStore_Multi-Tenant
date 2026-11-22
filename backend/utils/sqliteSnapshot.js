"use strict";

// Generic, schema-agnostic safe SQLite snapshot helpers shared by the token
// store, the login-challenge store, and the backup/restore scripts.
//
// Guarantees:
//   * backup uses better-sqlite3's online backup API after a WAL checkpoint, so
//     the snapshot is internally consistent even while the source database is
//     open in WAL mode. A raw file copy of a live WAL database is NOT used.
//   * restore moves the authoritative file AND its -wal/-shm sidecars aside
//     together, swaps in the verified replacement, and rolls back on any
//     failure. The original database is never deleted before final validation.
//   * rollback is never silent. If restoring the originals fails, the thrown
//     error is a RecoveryRequiredError that carries the original failure and
//     every rollback failure, so an operator always learns that recovery is
//     incomplete and which paths need attention.
//   * a caller-supplied `validate(db, resolvedPath)` hook adds schema checks on
//     top of the mandatory integrity_check. Failures always propagate.
//
// This module never starts a server and never invents a path.
//
// LIMITATION (do not overstate): the in-use probe can only observe a live write
// lock. It cannot see an open-but-idle connection and it cannot detect that the
// service process is still running. Stopping the service is a mandatory
// operational precondition of any restore, not something this module proves.

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

class SqliteSnapshotError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "SqliteSnapshotError";
    this.cause = cause;
  }
}

// Thrown when an operation failed AND the attempted rollback did not fully
// succeed. `failures` lists every path that could not be put back.
class RecoveryRequiredError extends SqliteSnapshotError {
  constructor(message, originalError, failures) {
    super(message, originalError);
    this.name = "RecoveryRequiredError";
    this.originalError = originalError;
    this.rollbackFailures = failures || [];
    this.recoveryRequired = true;
  }
}

// ── POSIX permission preservation ───────────────────────────────────────────
// A new SQLite database file is created with SQLITE_DEFAULT_FILE_PERMISSIONS
// (0644) masked by the process umask, no matter what the database it was copied
// FROM looked like. A backup artifact is a new database, so a hardened 0600
// source would otherwise come back as a world-readable 0644 artifact — and a
// restore would faithfully install that 0644 file. These helpers carry the
// permission bits across explicitly. Only permission bits are ever handled;
// file-type bits are masked out.
//
// Windows is deliberately out of scope: chmod there only toggles the read-only
// attribute, so the historical behaviour must be preserved untouched.

// Permission bits (never file-type bits) of the database a backup must
// reproduce. Windows has no POSIX mode to carry, so this returns null there and
// no chmod is ever attempted. On POSIX an unreadable source is FATAL: an unknown
// mode must never fall through to SQLite's default 0644, so the caller aborts the
// backup rather than writing a wider artifact. The error keeps the path and the
// original cause.
function sourcePermissionBits(file) {
  if (process.platform === "win32") return null;
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (err) {
    throw new SqliteSnapshotError(
      `Could not read the permissions of ${file}, so the backup cannot preserve them: ${err.message}`,
      err
    );
  }
  return stat.mode & 0o777;
}

// Apply `mode` to `file`. Windows is a no-op. Any failure throws, so a caller
// can never continue as if permissions had been set when they were not.
function applyFileMode(file, mode) {
  if (process.platform === "win32") return;
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o777) {
    throw new SqliteSnapshotError(`Refusing to apply invalid permission bits ${mode} to ${file}`);
  }
  try {
    fs.chmodSync(file, mode);
  } catch (err) {
    throw new SqliteSnapshotError(
      `Could not apply permissions ${mode.toString(8)} to ${file}: ${err.message}`,
      err
    );
  }
}

const SQLITE_MAGIC = "SQLite format 3\u0000";

function _headerOk(file) {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(16);
      fs.readSync(fd, buf, 0, 16, 0);
      return buf.toString("utf8") === SQLITE_MAGIC;
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    return false;
  }
}

function _integrityOk(db) {
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

// Validate an arbitrary SQLite file without mutating it. `validate` may add
// schema assertions and must throw on mismatch.
function validateSqliteFile(dbPath, validate) {
  if (!dbPath) throw new SqliteSnapshotError("A database path is required");
  const resolved = path.resolve(String(dbPath));
  if (!fs.existsSync(resolved)) {
    throw new SqliteSnapshotError(`Database missing: ${resolved}`);
  }
  if (!_headerOk(resolved)) {
    throw new SqliteSnapshotError(`Database corrupt (invalid header): ${resolved}`);
  }
  let db = null;
  try {
    db = new Database(resolved, { readonly: true });
    if (!_integrityOk(db)) {
      throw new SqliteSnapshotError(`Database corrupt (integrity_check failed): ${resolved}`);
    }
    if (typeof validate === "function") validate(db, resolved);
  } catch (err) {
    if (err instanceof SqliteSnapshotError) throw err;
    throw new SqliteSnapshotError(`Database not usable at ${resolved}: ${err.message}`, err);
  } finally {
    if (db) { try { db.close(); } catch (_) {} }
  }
  return resolved;
}

// Validate a database WITHOUT touching it or its directory: the file (and any
// sidecars) are copied to an isolated temporary directory and the copy is
// validated there. This is what backup verification uses, so verifying a backup
// never creates -wal/-shm/-journal entries next to the artifact and works on
// read-only media.
function validateSqliteIsolated(dbPath, validate) {
  const os = require("os");
  if (!dbPath) throw new SqliteSnapshotError("A database path is required");
  const resolved = path.resolve(String(dbPath));
  if (!fs.existsSync(resolved)) {
    throw new SqliteSnapshotError(`Database missing: ${resolved}`);
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-verify-"));
  try {
    const copy = path.join(tmpDir, path.basename(resolved));
    fs.copyFileSync(resolved, copy);
    for (const suffix of SIDECARS) {
      const sidecar = resolved + suffix;
      if (!fs.existsSync(sidecar)) continue;
      try { fs.copyFileSync(sidecar, copy + suffix); } catch (_) {}
    }
    validateSqliteFile(copy, validate);
    return resolved;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

// Best-effort "is a writer currently holding this database?" probe.
// Fails closed: any inability to prove the database is idle reports in-use.
// This does NOT prove an application process is stopped — an open-but-idle
// connection holds no POSIX lock — so callers must still document the
// requirement that the service be stopped before a restore.
function isDatabaseInUse(dbPath) {
  if (!fs.existsSync(dbPath)) return false;
  let db = null;
  try {
    db = new Database(dbPath, { timeout: 0 });
    try {
      db.exec("BEGIN EXCLUSIVE");
    } catch (_) {
      return true; // busy / locked => someone is writing
    }
    try { db.exec("ROLLBACK"); } catch (_) {}
    return false;
  } catch (_) {
    return true; // cannot open => treat as in use (fail closed)
  } finally {
    if (db) { try { db.close(); } catch (_) {} }
  }
}

// Async: WAL-consistent online backup with post-backup verification.
async function backupSqlite(sourcePath, destPath, options) {
  const opts = options || {};
  if (!sourcePath || !destPath) {
    throw new SqliteSnapshotError("backupSqlite requires a source path and a destination path");
  }
  if (!fs.existsSync(sourcePath)) {
    throw new SqliteSnapshotError(`Backup source missing: ${sourcePath}`);
  }
  if (fs.existsSync(destPath)) {
    throw new SqliteSnapshotError(`Backup destination already exists: ${destPath}`);
  }

  validateSqliteFile(sourcePath, opts.validate);
  // Captured before the copy, and fatal on POSIX when it cannot be read: this is
  // the mode the live database is meant to keep, not SQLite's default for a new
  // artifact. Throws before any artifact exists, so nothing is left behind.
  const sourceMode = sourcePermissionBits(sourcePath);

  const sourceDb = new Database(sourcePath);
  try {
    const cp = sourceDb.pragma("wal_checkpoint(FULL)");
    const row = Array.isArray(cp) ? cp[0] : cp;
    if (row && Number(row.busy) > 0) {
      throw new SqliteSnapshotError("WAL checkpoint failed: database busy");
    }
    // better-sqlite3: the SOURCE connection creates the dest file. Never pass
    // a Database instance.
    await sourceDb.backup(destPath);
  } finally {
    try { sourceDb.close(); } catch (_) {}
  }

  try {
    validateSqliteFile(destPath, opts.validate);
  } catch (err) {
    try { fs.unlinkSync(destPath); } catch (_) {}
    throw err instanceof SqliteSnapshotError
      ? err
      : new SqliteSnapshotError(`Backup verification failed: ${err.message}`, err);
  }
  compactSidecars(destPath);
  // The artifact is complete and compacted, so its final mode is set now and
  // nothing later in the backup rewrites the file. Fail closed: an artifact
  // whose permissions could not be restricted is removed, not kept.
  if (sourceMode !== null) {
    try {
      applyFileMode(destPath, sourceMode);
    } catch (err) {
      try { fs.unlinkSync(destPath); } catch (_) {}
      throw err;
    }
  }
  return destPath;
}

// Fold a backup's -wal/-shm sidecars into the main file and delete them.
// A backup directory must be self-contained: restore only copies the main
// file, so any un-checkpointed WAL content would be silently lost.
function compactSidecars(dbPath) {
  const wal = dbPath + "-wal";
  const shm = dbPath + "-shm";
  if (!fs.existsSync(wal) && !fs.existsSync(shm)) return dbPath;
  let db = null;
  try {
    db = new Database(dbPath);
    db.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    if (db) { try { db.close(); } catch (_) {} }
  }
  for (const sidecar of [wal, shm]) {
    try { if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar); } catch (_) {}
  }
  return dbPath;
}

// Every companion file that belongs to the database. -journal is the rollback
// journal used when a database is not in WAL mode; it must move with its
// database, otherwise a stale journal would sit beside a replaced file.
const SIDECARS = ["-wal", "-shm", "-journal"];

// Put every moved-aside path back, newest first. Returns the list of failures
// (empty array means the rollback was complete). Never throws: the caller is
// already handling a primary failure and must be able to report both.
function _restoreMoved(moved) {
  const failures = [];
  for (let i = moved.length - 1; i >= 0; i--) {
    const item = moved[i];
    try {
      if (!fs.existsSync(item.to)) {
        failures.push({ path: item.from, reason: `rollback copy missing at ${item.to}` });
        continue;
      }
      // A replacement may already sit at the original path; it must go before
      // the original can be renamed back into place.
      if (fs.existsSync(item.from)) fs.unlinkSync(item.from);
      fs.renameSync(item.to, item.from);
    } catch (err) {
      failures.push({ path: item.from, reason: err.message });
    }
  }
  return failures;
}

function _formatFailures(failures) {
  return failures.map((f) => `${f.path} (${f.reason})`).join("; ");
}

// Synchronous verification failure throws before the lock is taken; the swap
// itself runs under the cross-process file lock and returns a promise.
function restoreSqlite(backupPath, targetPath, options) {
  const opts = options || {};
  if (!backupPath || !targetPath) {
    throw new SqliteSnapshotError("restoreSqlite requires a backup path and a target path");
  }
  if (!fs.existsSync(backupPath)) {
    throw new SqliteSnapshotError(`Backup file missing: ${backupPath}`);
  }

  // Validate the incoming database BEFORE touching the target.
  validateSqliteFile(backupPath, opts.validate);

  const fileLock = require("../utils/fileLock");
  const lockPath = targetPath + ".lock";

  return fileLock.withLock(lockPath, () => {
    // Refuse to replace a database an active writer holds (fail closed).
    if (opts.requireStopped !== false && isDatabaseInUse(targetPath)) {
      throw new SqliteSnapshotError(
        `Target database is in use: ${targetPath}. Stop the service before restoring.`
      );
    }

    const nonce = Date.now() + "-" + process.pid;
    const tmpPath = targetPath + ".restore." + nonce;
    const rollbackPath = targetPath + ".rollback." + nonce;

    const moved = [];
    const cleanupTmp = () => {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    };

    // Stage the replacement next to the target (same volume, so rename works).
    fs.copyFileSync(backupPath, tmpPath);

    const moveAside = (from, to) => {
      if (!fs.existsSync(from)) return;
      fs.renameSync(from, to);
      moved.push({ from, to });
    };

    // Any failure from here on must restore every moved-aside path. A rollback
    // that fails is reported as RecoveryRequiredError, never swallowed.
    const failAndRollback = (primary, stage) => {
      cleanupTmp();
      const failures = _restoreMoved(moved);
      if (failures.length > 0) {
        throw new RecoveryRequiredError(
          `Restore of ${targetPath} failed at stage "${stage}": ${primary.message}. ` +
            `ROLLBACK INCOMPLETE — ${failures.length} path(s) need manual recovery: ${_formatFailures(failures)}`,
          primary,
          failures
        );
      }
      if (primary instanceof SqliteSnapshotError) throw primary;
      throw new SqliteSnapshotError(
        `Restore failed at stage "${stage}" and the original database was restored: ${primary.message}`,
        primary
      );
    };

    try {
      moveAside(targetPath, rollbackPath);
      for (const suffix of SIDECARS) {
        moveAside(targetPath + suffix, rollbackPath + suffix);
      }
      fs.renameSync(tmpPath, targetPath);
    } catch (err) {
      failAndRollback(err, "swap");
    }

    try {
      validateSqliteFile(targetPath, opts.validate);
    } catch (err) {
      failAndRollback(err, "post-restore validation");
    }

    // Success: the rollback copies are no longer authoritative. A failure to
    // remove them is surfaced (with the location) instead of being swallowed.
    const cleanupFailures = [];
    for (const item of moved) {
      try { if (fs.existsSync(item.to)) fs.unlinkSync(item.to); } catch (err) {
        cleanupFailures.push({ path: item.to, reason: err.message });
      }
    }
    if (cleanupFailures.length > 0) {
      throw new SqliteSnapshotError(
        `Restore of ${targetPath} succeeded but rollback material could not be removed: ` +
          _formatFailures(cleanupFailures)
      );
    }
    // Deliberately resolves to undefined: restoreDatabase() in both stores is
    // documented as Promise<void>.
    return undefined;
  }, { timeout: 10000, stale: 10000 });
}

module.exports = {
  backupSqlite,
  restoreSqlite,
  sourcePermissionBits,
  applyFileMode,
  validateSqliteFile,
  validateSqliteIsolated,
  isDatabaseInUse,
  compactSidecars,
  _headerOk,
  _integrityOk,
  SIDECARS,
  SqliteSnapshotError,
  RecoveryRequiredError
};
