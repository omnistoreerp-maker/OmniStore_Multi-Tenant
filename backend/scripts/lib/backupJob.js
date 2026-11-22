"use strict";

// Unified, cron-ready backup job for OmniStore P6.
//
// This module is a thin, explicit pipeline around the existing implementation
// in ./backupRestore (which already uses SQLite's online backup API and a
// SHA-256 manifest). It adds the operational guarantees the two legacy cron
// scripts lack:
//
//   * every path is stated by the caller — no ambient TOKEN_STORE_PATH /
//     CHALLENGE_DB_PATH / DIGITRONICS_DATA_DIR is consulted, so a scheduled run
//     can never silently back up the wrong store;
//   * the run is serialised through the SAME `utils/fileLock` lock Restore
//     holds (the data directory's .restore.lock) plus its own output lock, so a
//     backup can never run during a restore, a restore can never start during a
//     backup, and two backups can never overlap. The lock is an atomic
//     O_EXCL create with PID/heartbeat staleness recovery, not a check-then-act;
//   * the backup is VERIFIED against its manifest before it is reported as a
//     success;
//   * an optional off-host destination is a LOCAL, SEPARATELY MOUNTED
//     filesystem, proven by /proc/self/mountinfo: the root must already exist,
//     carry an operator-provisioned sentinel, be a mount point, and have a
//     different device identity than the local backup root. Mount identity that
//     cannot be established fails closed. The copy is written to a
//     .partial-<name>-<random> directory, verified independently, then
//     published with one atomic rename — a partial copy is never discoverable
//     as a backup and never blocks a retry;
//   * retention runs ONLY after the local backup verified AND, when configured,
//     the off-host copy verified and published. A failed night therefore cannot
//     delete the last known-good copy, including with retain=1;
//   * no .env (or any secret) is ever copied — only `*.json` stores and the two
//     SQLite databases are captured;
//   * status is written atomically (temp file + rename) into a 0700 directory as
//     0600 files, split into last-attempt.json and last-success.json, and a
//     status failure can never turn a verified backup into a false failure.
//
// Guarantees are inherited from backupRestore.js and are not re-implemented:
// per-database WAL-consistent snapshots, per-file JSON re-read detection,
// fail-closed handling of configured-but-missing databases, and manifest
// validation. Cross-artifact consistency stays BEST-EFFORT unless the service
// is stopped; run this job against a stopped service for a cutover snapshot.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const lib = require("./backupRestore");

const STATUS_VERSION = 1;
// Backup directories are named `backup-<ISO timestamp with ':' replaced by '-'>`
// by createUniqueBackupDir, so the name sorts chronologically. PARTIAL_PREFIX
// deliberately does not match, so an in-flight copy is invisible to discovery.
const BACKUP_DIR_NAME = /^backup-\d{4}-\d{2}-\d{2}T[\d.\-]+Z(?:-\d+)?$/;
const PARTIAL_PREFIX = ".partial-";
const DEFAULT_RETAIN = 7;

// Coordination: Restore holds <dataDir>/.restore.lock (see restoreLockPaths in
// ./backupRestore). Taking the same lock here is what makes "backup cannot run
// during restore" and "restore cannot start during backup" true for both
// directions with one proven primitive.
const BACKUP_LOCK_NAME = ".backup.lock";
const DEFAULT_LOCK_TIMEOUT = 10000;

// Operator-provisioned marker that must exist in the off-host root. Its
// presence is the human assertion "yes, this really is my off-host mount"; it
// cannot be inferred from a successful copy, because a failed mount silently
// turns the copy into a second local copy.
const OFFHOST_SENTINEL = ".omnistore-offhost";
const MOUNTINFO = "/proc/self/mountinfo";

const STATUS_FILES = { attempt: "last-attempt.json", success: "last-success.json" };

class BackupJobUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "BackupJobUsageError";
  }
}

function _requireAbsPath(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BackupJobUsageError(`${label} is required (explicit path, not inferred from the environment)`);
  }
  return path.resolve(value.trim());
}

function _posix() {
  return process.platform !== "win32";
}

function _chmod(target, mode) {
  if (!_posix()) return;
  fs.chmodSync(target, mode);
}

// The unified job records artifact modes, so the backup tree itself must not be
// world/group readable. Applied only to directories this job created, so a
// pre-existing shared parent is never re-moded under another job's feet.
function _createdDir(dir) {
  const existed = fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!existed) _chmod(dir, 0o700);
  return !existed;
}

// True when `candidate` is `root` or lives beneath it. Used both to keep the
// status directory out of the data/backup trees and to refuse an off-host root
// that is really the local backup root.
function _containedIn(root, candidate) {
  const normalize = (value) => (process.platform === "win32" ? value.toLowerCase() : value);
  const rel = path.relative(normalize(path.resolve(root)), normalize(path.resolve(candidate)));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function listBackups(outDir) {
  let entries;
  try {
    entries = fs.readdirSync(outDir);
  } catch (_) {
    return [];
  }
  return entries
    .filter((name) => BACKUP_DIR_NAME.test(name))
    .map((name) => path.join(outDir, name))
    .filter((dir) => {
      try { return fs.statSync(dir).isDirectory(); } catch (_) { return false; }
    })
    .sort();
}

// Keep the newest `retain` backups overall, and never delete `protectedDir`.
// Called only after the protected backup has verified AND (when configured) its
// off-host copy has been published, so this can only remove strictly older
// copies.
function pruneBackups(outDir, retainOption, protectedDir, removeDir) {
  const retain = Number.isInteger(retainOption) && retainOption > 0 ? retainOption : DEFAULT_RETAIN;
  const remove = removeDir || ((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  const all = listBackups(outDir).filter((dir) => path.resolve(dir) !== path.resolve(protectedDir));
  const pruned = [];

  // One slot is occupied by the protected backup, so at most retain-1 of the
  // older directories survive.
  const survivors = Math.max(retain - 1, 0);
  const keep = new Set(all.slice(Math.max(all.length - survivors, 0)));

  for (const dir of all) {
    if (keep.has(dir)) continue;
    remove(dir);
    pruned.push(path.basename(dir));
  }
  return pruned;
}

function _isRemoteDestination(value) {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) return true;
  if (/^(ssh|rsync|sftp|scp|ftp|ftps|s3|gs|az|rclone)(?:$|[:/])/i.test(value)) return true;
  // A UNC path is a network share on Windows.
  if (/^\\\\/.test(value)) return true;
  return false;
}

// ── Filesystem identity ─────────────────────────────────────────────────────
// /proc/self/mountinfo field 3 is the device id ("major:minor") and field 5 is
// the mount point, so "is this a separate filesystem, mounted where the
// operator said it would be" is answerable without spawning mount(8).
function _decodeMountPath(value) {
  return value.replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function _readMountInfo(file) {
  let raw;
  try {
    raw = fs.readFileSync(file || MOUNTINFO, "utf8");
  } catch (_) {
    return null;
  }
  const entries = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const fields = line.split(" ");
    if (fields.length < 5) continue;
    const id = Number(fields[0]);
    entries.push({
      id: Number.isInteger(id) && id >= 0 ? id : null,
      device: fields[2],
      mountPoint: _decodeMountPath(fields[4])
    });
  }
  return entries;
}

// The mount an existing path belongs to, or null when identity is unavailable
// (no /proc/self/mountinfo, an unreadable table, or a path missing). Null is
// treated as failure by every caller: off-host protection is never assumed.
function _mountIdentity(target, mountInfoFile) {
  let real;
  try {
    real = fs.realpathSync(target);
  } catch (_) {
    return null;
  }
  const entries = _readMountInfo(mountInfoFile);
  if (!entries) return null;
  let best = null;
  for (const entry of entries) {
    const prefix = entry.mountPoint.endsWith(path.sep) ? entry.mountPoint : entry.mountPoint + path.sep;
    if (real !== entry.mountPoint && !real.startsWith(prefix)) continue;
    if (!best) {
      best = entry;
      continue;
    }
    // Longest valid mount-point wins; ties broken by the highest mount ID (null
    // IDs sort below as -1). Never chosen by line order.
    if (entry.mountPoint.length > best.mountPoint.length) {
      best = entry;
      continue;
    }
    if (entry.mountPoint.length === best.mountPoint.length) {
      const entryId = entry.id === null ? -1 : entry.id;
      const bestId = best.id === null ? -1 : best.id;
      if (entryId > bestId) best = entry;
    }
  }
  if (!best || !best.device) return null;
  return { device: best.device, mountPoint: best.mountPoint };
}

function _assertOffhostRoot(offhostRoot, outDir) {
  const root = path.resolve(String(offhostRoot));
  if (_isRemoteDestination(String(offhostRoot))) {
    throw new lib.BackupRestoreError(
      `Off-host destination must be a local filesystem path: ${offhostRoot}. ` +
        "Network transfer is not implemented by this job (it needs a separately reviewed design)."
    );
  }

  // NEVER create this directory. A missing mount point must fail loudly; a
  // silently created directory would put the "second copy" on the same disk.
  let stat;
  try {
    stat = fs.lstatSync(root);
  } catch (_) {
    throw new lib.BackupRestoreError(
      `Off-host root does not exist: ${root}. Off-host protection requires an operator-provisioned, ` +
        "separately mounted directory; this job never creates it (creating it would put the copy back " +
        "on the local filesystem)."
    );
  }
  if (stat.isSymbolicLink()) {
    throw new lib.BackupRestoreError(`Off-host root is a symbolic link, refusing to use it: ${root}`);
  }
  if (!stat.isDirectory()) {
    throw new lib.BackupRestoreError(`Off-host root is not a directory: ${root}`);
  }

  const real = fs.realpathSync(root);
  if (_containedIn(outDir, real)) {
    throw new lib.BackupRestoreError(
      `Off-host root ${real} is inside the local backup root ${path.resolve(outDir)}; that is a second ` +
        "copy on the same filesystem, not off-host protection."
    );
  }

  const sentinel = path.join(real, OFFHOST_SENTINEL);
  let sentinelStat;
  try {
    sentinelStat = fs.lstatSync(sentinel);
  } catch (_) {
    throw new lib.BackupRestoreError(
      `Off-host sentinel missing: ${sentinel}. Create an empty regular file named ${OFFHOST_SENTINEL} in ` +
        "the off-host root to confirm that this directory is the intended off-host destination."
    );
  }
  if (sentinelStat.isSymbolicLink() || !sentinelStat.isFile()) {
    throw new lib.BackupRestoreError(`Off-host sentinel is not a regular file: ${sentinel}`);
  }

  return real;
}

// Copy a verified backup to a second, LOCAL filesystem and verify the copy
// independently. The copy is written to a unique .partial-* directory, verified
// there, and published with one atomic rename inside the same filesystem. Every
// failure path removes the partial, so a retry is never blocked by leftovers and
// a half-written copy is never discoverable as a backup.
//
// `options.mountProbe` exists only as a test seam; production always uses
// _mountIdentity.
function copyOffhost(backupDir, offhostRoot, options) {
  const opts = options || {};
  const outDir = path.dirname(path.resolve(backupDir));
  const root = _assertOffhostRoot(offhostRoot, outDir);

  const probe = typeof opts.mountProbe === "function" ? opts.mountProbe : _mountIdentity;

  // (1) The destination must be its own mounted filesystem, at the expected
  // mount point. Unprovable identity is a failure, never a success.
  let destIdentity;
  try {
    destIdentity = probe(root);
  } catch (_) {
    destIdentity = null;
  }
  if (!destIdentity || !destIdentity.device || !destIdentity.mountPoint) {
    throw new lib.BackupRestoreError(
      `Cannot establish the mount identity of the off-host root ${root}, so off-host protection cannot ` +
        "be proven. Refusing to report success."
    );
  }
  if (path.resolve(destIdentity.mountPoint) !== root) {
    throw new lib.BackupRestoreError(
      `Off-host root ${root} is not a mount point (its filesystem is mounted at ` +
        `${destIdentity.mountPoint}). Mount the off-host filesystem directly at the configured path.`
    );
  }

  // (2) Same-filesystem check against the local backup root.
  let sourceIdentity;
  try {
    sourceIdentity = probe(outDir);
  } catch (_) {
    sourceIdentity = null;
  }
  if (!sourceIdentity || !sourceIdentity.device) {
    throw new lib.BackupRestoreError(
      `Cannot establish the mount identity of the local backup root ${outDir}; refusing to claim ` +
        "off-host protection for the copy."
    );
  }
  if (sourceIdentity.device === destIdentity.device) {
    throw new lib.BackupRestoreError(
      `Off-host root ${root} is on the same filesystem (device ${destIdentity.device}) as the local ` +
        `backup root ${outDir}; losing that filesystem would lose both copies.`
    );
  }

  const name = path.basename(path.resolve(backupDir));
  if (!BACKUP_DIR_NAME.test(name)) {
    throw new lib.BackupRestoreError(`Refusing to publish an off-host copy of an unexpected directory name: ${name}`);
  }
  const target = path.join(root, name);
  if (fs.existsSync(target)) {
    throw new lib.BackupRestoreError(`Off-host destination already exists: ${target}`);
  }
  if (BACKUP_DIR_NAME.test(PARTIAL_PREFIX + name)) {
    throw new lib.BackupRestoreError("Internal: partial prefix would match backup discovery");
  }

  const partial = path.join(root, `${PARTIAL_PREFIX}${name}-${crypto.randomBytes(6).toString("hex")}`);
  let published = false;
  try {
    fs.cpSync(backupDir, partial, { recursive: true });
    _chmod(partial, 0o700);

    const verification = lib.verifyBackupDir(partial);
    if (!verification.ok) {
      throw new lib.BackupRestoreError(
        `Off-host copy failed verification (${verification.failures.length}): ` +
          verification.failures.map((f) => `${f.name}: ${f.reason}`).join("; ")
      );
    }

    // Publish: one atomic rename within the destination filesystem.
    fs.renameSync(partial, target);
    published = true;

    return {
      dir: target,
      verified: true,
      files: Object.keys(verification.manifest.files).length,
      device: destIdentity.device,
      mountPoint: root
    };
  } finally {
    if (!published) {
      // Copy failure, verification failure, or a rename that did not happen:
      // the partial must not survive as a fake backup and must not block a retry.
      try { fs.rmSync(partial, { recursive: true, force: true }); } catch (_) {}
    }
  }
}

// ── Coordination ────────────────────────────────────────────────────────────
// Sorted so every participant acquires shared locks in one global order; the
// only lock shared with Restore is <dataDir>/.restore.lock, and the output lock
// is unique to backup jobs, so no cycle can form.
function coordinationLockPaths(dataDir, outDir) {
  return [
    ...new Set([
      path.join(lib.canonicalPath(dataDir), lib.RESTORE_LOCK_NAME),
      path.join(lib.canonicalPath(outDir), BACKUP_LOCK_NAME)
    ])
  ].sort();
}

async function _acquireCoordination(lockPaths, options) {
  const fileLock = require("../../utils/fileLock");
  const releases = [];
  try {
    for (const lockPath of lockPaths) {
      releases.push(await fileLock.acquire(lockPath, options));
    }
    return releases;
  } catch (err) {
    await _releaseCoordination(releases);
    throw err;
  }
}

async function _releaseCoordination(releases) {
  for (let i = releases.length - 1; i >= 0; i--) {
    try { await releases[i](); } catch (_) {}
  }
}

// JSON stores are user data; the manifest deliberately records no mode for
// them (mode is a SQLite-only field), so the job narrows them here instead.
function _narrowJsonModes(backupDir, manifest) {
  if (!_posix()) return;
  for (const name of Object.keys(manifest.files)) {
    if (!name.endsWith(".json")) continue;
    try { fs.chmodSync(path.join(backupDir, name), 0o640); } catch (_) {}
  }
}

function _assertExplicitDatabase(file, label) {
  if (!fs.existsSync(file)) {
    throw new lib.BackupRestoreError(`${label} database does not exist: ${file}`);
  }
  const stats = fs.lstatSync(file);
  if (stats.isSymbolicLink()) {
    throw new lib.BackupRestoreError(`${label} database is a symbolic link, refusing to back it up: ${file}`);
  }
  if (!stats.isFile()) {
    throw new lib.BackupRestoreError(`${label} database is not a regular file: ${file}`);
  }
  const parent = path.dirname(file);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new lib.BackupRestoreError(`${label} database directory does not exist: ${parent}`);
  }
}

/**
 * Run one unified backup.
 *
 * @param {object} options
 * @param {string} options.dataDir        explicit JSON store directory (required)
 * @param {string} options.tokenPath      explicit token database (required)
 * @param {string} options.challengePath  explicit challenge database (required)
 * @param {string} options.outDir         explicit backup root (required)
 * @param {number} [options.retain]       backups to keep, newest first (>=1)
 * @param {string} [options.offhostDir]   optional LOCAL, separately mounted destination
 * @param {number} [options.lockTimeoutMs] how long to wait for the coordination lock
 * @returns {Promise<{ok: boolean, exitCode: number, status: object}>}
 */
async function runBackupJob(options) {
  const opts = options || {};
  const status = {
    version: STATUS_VERSION,
    ok: false,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    dataDir: null,
    databases: {},
    backupDir: null,
    verified: false,
    files: 0,
    pruned: [],
    offhost: null,
    locks: [],
    discarded: false,
    error: null
  };

  let releases = [];
  try {
    const dataDir = _requireAbsPath(opts.dataDir, "dataDir (--data-dir)");
    const tokenPath = _requireAbsPath(opts.tokenPath, "tokenPath (--token-store)");
    const challengePath = _requireAbsPath(opts.challengePath, "challengePath (--challenge-store)");
    const outDir = _requireAbsPath(opts.outDir, "outDir (--out)");
    status.dataDir = dataDir;
    status.databases = { token: tokenPath, challenge: challengePath };

    if (!fs.existsSync(dataDir) || !fs.statSync(dataDir).isDirectory()) {
      throw new lib.BackupRestoreError(`Data directory does not exist or is not a directory: ${dataDir}`);
    }
    _assertExplicitDatabase(tokenPath, "Token");
    _assertExplicitDatabase(challengePath, "Challenge");

    // (1) Coordination before any backup work. The lock set is the one Restore
    // uses for the data directory, so the two operations are mutually exclusive
    // in both directions, and two backups cannot overlap.
    const lockPaths = coordinationLockPaths(dataDir, outDir);
    status.locks = lockPaths.map((lockPath) => path.basename(lockPath));
    const lockTimeout = Number(opts.lockTimeoutMs) > 0 ? Number(opts.lockTimeoutMs) : DEFAULT_LOCK_TIMEOUT;
    try {
      releases = await _acquireCoordination(lockPaths, { timeout: lockTimeout, stale: 30000 });
    } catch (err) {
      if (err && err.code === "ELOCKED") {
        throw new lib.BackupRestoreError(
          `Another backup or restore is already running (lock: ${err.lockPath || lockPaths.join(", ")}). ` +
            "No backup was created and retention was not applied; retry once it has finished."
        );
      }
      throw err;
    }

    const outExisted = fs.existsSync(outDir);
    _createdDir(outDir);
    // fileLock created `outDir` on our behalf (it mkdirs the lock's parent), so
    // narrow it here; we hold the output lock, so nothing else is writing in it.
    if (!outExisted) _chmod(outDir, 0o700);

    // (2) Create. The existing implementation performs the WAL-consistent online
    // backup and writes the manifest; explicit paths are passed through so
    // ambient environment values cannot redirect them. The authoritative JSON
    // inventory limits the backup to known application stores.
    const created = await lib.runBackup({
      dir: dataDir,
      out: outDir,
      tokenPath,
      challengePath,
      jsonInventory: lib.AUTHORITATIVE_JSON_STORES
    });
    const backupDir = created.dest;
    status.backupDir = backupDir;
    _chmod(backupDir, 0o700);
    _narrowJsonModes(backupDir, created.manifest);

    status.files = Object.keys(created.manifest.files).length;
    if (status.files === 0) {
      throw new lib.BackupRestoreError("Backup contains no artifacts");
    }

    if (typeof (opts.__hooks && opts.__hooks.afterBackup) === "function") {
      await opts.__hooks.afterBackup({ dest: backupDir, manifest: created.manifest });
    }

    // (3) Mandatory verification BEFORE the run is marked successful.
    const verification = lib.verifyBackupDir(backupDir);
    if (!verification.ok) {
      throw new lib.BackupRestoreError(
        `Backup verification failed (${verification.failures.length}): ` +
          verification.failures.map((f) => `${f.name}: ${f.reason}`).join("; ")
      );
    }
    status.verified = true;

    // (4) Off-host copy and its independent verification, published atomically.
    // A failure here throws before retention, so every previous backup survives.
    if (opts.offhostDir) {
      status.offhost = copyOffhost(backupDir, opts.offhostDir, { mountProbe: opts.offhostMountProbe });
      if (!status.offhost || status.offhost.verified !== true) {
        throw new lib.BackupRestoreError("Off-host copy was not verified; refusing to report success");
      }
    }

    // (5) Retention only after every configured copy verified. The new backup is
    // protected, and retain=1 can therefore never delete the known-good copy.
    status.pruned = pruneBackups(outDir, opts.retain, backupDir);

    status.ok = true;
    status.finishedAt = new Date().toISOString();
    return { ok: true, exitCode: 0, status };
  } catch (err) {
    status.ok = false;
    status.error = err && err.message ? err.message : String(err);
    status.finishedAt = new Date().toISOString();

    // A backup that did not verify is not restorable and must not be left where
    // retention or a human could mistake it for a good copy. Only the directory
    // this run created is removed; a verified local backup is kept even when the
    // off-host step failed, and nothing older is touched.
    if (status.backupDir && !status.verified) {
      try {
        fs.rmSync(status.backupDir, { recursive: true, force: true });
        status.discarded = true;
      } catch (_) {
        status.discarded = false;
      }
    }

    const exitCode = err instanceof BackupJobUsageError ? 2 : 1;
    return { ok: false, exitCode, status };
  } finally {
    await _releaseCoordination(releases);
  }
}

// ── Status files ────────────────────────────────────────────────────────────
// Atomic, private, and outside the trees they describe. A status problem is
// reported, never allowed to redefine whether the backup itself succeeded.
function _atomicWriteJson(file, value) {
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  let fd;
  try {
    fd = fs.openSync(tmp, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
    fs.fsyncSync(fd);
  } catch (err) {
    try { if (fd !== undefined) fs.closeSync(fd); } catch (_) {}
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw err;
  }
  try { fs.closeSync(fd); } catch (_) {}
  try {
    _chmod(tmp, 0o600);
    // Rename is atomic on the same filesystem: a reader sees the old file or the
    // new one, never a truncated status.
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw err;
  }
}

/**
 * Write last-attempt.json always, and last-success.json only for a successful
 * run, so a failed attempt can never erase the last known-good status.
 *
 * @param {string} statusDir
 * @param {{ok: boolean, status: object}} result
 * @param {{dataDir?: string, outDir?: string}} [context] paths the status must not live inside
 * @returns {string[]} files written
 */
function writeRunStatus(statusDir, result, context) {
  const ctx = context || {};
  const dir = path.resolve(String(statusDir || ""));
  if (!statusDir) throw new BackupJobUsageError("statusDir is required");

  for (const [label, root] of [["data directory", ctx.dataDir], ["backup root", ctx.outDir]]) {
    if (!root) continue;
    if (_containedIn(root, dir)) {
      throw new BackupJobUsageError(`Status directory may not live inside the ${label}: ${dir}`);
    }
  }

  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  _chmod(dir, 0o700);

  const written = [];
  const attempt = path.join(dir, STATUS_FILES.attempt);
  _atomicWriteJson(attempt, result.status);
  written.push(attempt);

  if (result.ok) {
    const success = path.join(dir, STATUS_FILES.success);
    _atomicWriteJson(success, result.status);
    written.push(success);
  }
  return written;
}

// Public (machine-readable) projection: no ambient paths, no database paths and
// no environment values. The full detail stays in the private status files.
function redactStatus(status) {
  const src = status || {};
  return {
    version: src.version,
    ok: !!src.ok,
    startedAt: src.startedAt,
    finishedAt: src.finishedAt,
    backup: src.backupDir ? path.basename(src.backupDir) : null,
    verified: !!src.verified,
    files: src.files || 0,
    pruned: src.pruned || [],
    offhost: src.offhost
      ? { dir: path.basename(src.offhost.dir), verified: !!src.offhost.verified, files: src.offhost.files || 0 }
      : null,
    discarded: !!src.discarded,
    statusWriteError: src.statusWriteError || null,
    error: src.error || null
  };
}

module.exports = {
  BackupJobUsageError,
  DEFAULT_RETAIN,
  DEFAULT_LOCK_TIMEOUT,
  BACKUP_LOCK_NAME,
  OFFHOST_SENTINEL,
  PARTIAL_PREFIX,
  STATUS_FILES,
  runBackupJob,
  pruneBackups,
  listBackups,
  copyOffhost,
  coordinationLockPaths,
  writeRunStatus,
  redactStatus,
  _isRemoteDestination,
  _mountIdentity,
  _readMountInfo,
  _decodeMountPath,
  _containedIn
};
