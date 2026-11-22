"use strict";

// P6 — unified backup job.
//
// Every suite here runs against a synthetic data directory in os.tmpdir().
// backend/data is never read, written or required, and no production path is
// referenced anywhere in this file.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { makeTempDataDir } = require("./helpers/testData");
const { makeTokenDb, makeChallengeDb } = require("./helpers/backupFixture");

const job = require("../scripts/lib/backupJob");
const lib = require("../scripts/lib/backupRestore");
const fileLock = require("../utils/fileLock");

const isWindows = process.platform === "win32";
const posixTest = isWindows ? test.skip : test;
const isRoot = !isWindows && typeof process.getuid === "function" && process.getuid() === 0;
const permTest = posixTest === test && !isRoot ? test : test.skip;

const tempDirs = [];
function tmp(tag) {
  const dir = makeTempDataDir(tag);
  tempDirs.push(dir);
  return dir;
}

function bits(file) {
  return fs.statSync(file).mode & 0o777;
}

function sha(file) {
  return lib.sha256File(file);
}

// A complete, disposable source data directory: JSON stores + both databases.
function seedSource(tag) {
  const dir = tmp(tag || "job-src");
  fs.writeFileSync(path.join(dir, "users.json"), JSON.stringify([{ id: "u1" }]), "utf8");
  fs.writeFileSync(path.join(dir, "companies.json"), JSON.stringify([{ id: "c1" }]), "utf8");
  const token = makeTokenDb(path.join(dir, "tokenStore.sqlite"), "user-1", 2);
  const challenge = makeChallengeDb(path.join(dir, "challengeStore.sqlite"));
  return { dir, token, challenge };
}

function baseOptions(src, extra) {
  const out = tmp("job-out");
  return Object.assign({
    dataDir: src.dir,
    tokenPath: src.token,
    challengePath: src.challenge,
    outDir: out,
    retain: 7
  }, extra || {});
}

function familiesIn(dbPath) {
  const Database = require("better-sqlite3");
  const db = new Database(dbPath, { readonly: true });
  try { return db.prepare("SELECT COUNT(*) c FROM session_families").get().c; }
  finally { db.close(); }
}

function seedOldBackups(outDir, count) {
  fs.mkdirSync(outDir, { recursive: true });
  const names = [];
  for (let i = 0; i < count; i++) {
    const name = `backup-2020-01-0${i + 1}T00-00-00-000Z`;
    fs.mkdirSync(path.join(outDir, name), { recursive: true });
    fs.writeFileSync(path.join(outDir, name, "manifest.json"), "{}", "utf8");
    names.push(name);
  }
  return names;
}

// Operator-provisioned off-host root: a directory with the sentinel file.
function offhostRoot(tag) {
  const root = tmp(tag || "job-offhost");
  fs.writeFileSync(path.join(root, job.OFFHOST_SENTINEL), "", "utf8");
  return root;
}

// Synthetic mount table: [mountPoint, device]. Mirrors the shape of
// /proc/self/mountinfo (device id + longest matching mount point) so the
// separate-filesystem rule can be exercised without a second real disk.
function probeWith(table) {
  return (target) => {
    let real;
    try { real = fs.realpathSync(target); } catch (_) { return null; }
    let best = null;
    for (const [mountPoint, device] of table) {
      const resolved = path.resolve(mountPoint);
      const rootOfVolume = path.parse(resolved).root;
      const covers = real === resolved
        || real.startsWith(resolved.endsWith(path.sep) ? resolved : resolved + path.sep)
        || resolved === rootOfVolume;
      if (!covers) continue;
      if (!best || resolved.length > best.mountPoint.length) best = { mountPoint: resolved, device };
    }
    return best;
  };
}

function noLeftovers(dir) {
  return fs.readdirSync(dir).filter((name) => name.startsWith(job.PARTIAL_PREFIX));
}

function publishedIn(dir) {
  return fs.readdirSync(dir).filter((name) => /^backup-/.test(name));
}

afterAll(() => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

afterEach(() => { jest.restoreAllMocks(); });

describe("successful backup", () => {
  test("captures JSON stores and both SQLite databases, and verifies", async () => {
    const src = seedSource();
    const result = await job.runBackupJob(baseOptions(src));

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.status.verified).toBe(true);

    const files = fs.readdirSync(result.status.backupDir).sort();
    expect(files).toContain("users.json");
    expect(files).toContain("companies.json");
    expect(files).toContain("tokenStore.sqlite");
    expect(files).toContain("challengeStore.sqlite");
    expect(files).toContain("manifest.json");

    const manifest = JSON.parse(fs.readFileSync(path.join(result.status.backupDir, "manifest.json"), "utf8"));
    for (const name of ["users.json", "tokenStore.sqlite", "challengeStore.sqlite"]) {
      expect(manifest.files[name].sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(manifest.files[name].bytes).toBeGreaterThan(0);
    }
    expect(manifest.databases.tokenStore.included).toBe(true);
    expect(manifest.databases.challengeStore.included).toBe(true);
    // Non-artifact and secret files are never captured.
    expect(files).not.toContain(".env");
  });

  test("does not copy .env, sentinel files, or unlisted databases", async () => {
    const src = seedSource();
    fs.writeFileSync(path.join(src.dir, ".env"), "JWT_SECRET=do-not-copy\n", "utf8");
    fs.writeFileSync(path.join(src.dir, ".token_store_initialized"), "sentinel\n", "utf8");
    fs.writeFileSync(path.join(src.dir, "unrelated.sqlite"), "not-a-managed-store", "utf8");

    const result = await job.runBackupJob(baseOptions(src));
    expect(result.ok).toBe(true);
    const files = fs.readdirSync(result.status.backupDir);
    expect(files).not.toContain(".env");
    expect(files).not.toContain(".token_store_initialized");
    expect(files).not.toContain("unrelated.sqlite");
  });
});

describe("SQLite integrity and WAL awareness", () => {
  test("backup artifact passes SQLite integrity_check and keeps the rows", async () => {
    const src = seedSource();
    const sourceRows = familiesIn(src.token);
    const result = await job.runBackupJob(baseOptions(src));
    expect(result.ok).toBe(true);

    const artifact = path.join(result.status.backupDir, "tokenStore.sqlite");
    const Database = require("better-sqlite3");
    const db = new Database(artifact, { readonly: true });
    try {
      expect(db.pragma("integrity_check")[0].integrity_check).toBe("ok");
      expect(db.prepare("SELECT COUNT(*) c FROM session_families").get().c).toBe(sourceRows);
    } finally {
      db.close();
    }
  });

  test("captures a row written while the store is still open (WAL not checkpointed)", async () => {
    const src = seedSource();
    const store = require("../utils/tokenStore.sqlite");
    store.initialise(src.token);
    try {
      const fam = store.createSessionFamily("wal-open", "tenant-x");
      store.issueRefreshToken("jti-wal-open", {
        familyId: fam.familyId,
        sub: "wal-open",
        ver: 0,
        tenantId: "tenant-x",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 600000
      });
      const liveRows = familiesIn(src.token);

      const result = await job.runBackupJob(baseOptions(src));
      expect(result.ok).toBe(true);

      const artifact = path.join(result.status.backupDir, "tokenStore.sqlite");
      // The artifact must be self-contained: no live WAL travels with it.
      // Checked BEFORE opening the artifact, because a read-only SQLite open
      // recreates -wal/-shm in a writable directory.
      expect(fs.existsSync(artifact + "-wal")).toBe(false);
      expect(fs.existsSync(artifact + "-shm")).toBe(false);
      expect(familiesIn(artifact)).toBe(liveRows);
    } finally {
      store.closeDb();
    }
  });
});

describe("fail-closed sources", () => {
  test("missing configured database fails and leaves no backup directory", async () => {
    const src = seedSource();
    const opts = baseOptions(src);
    opts.challengePath = path.join(src.dir, "missing-challenge.sqlite");

    const result = await job.runBackupJob(opts);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.status.verified).toBe(false);
    expect(result.status.error).toMatch(/Challenge database does not exist/);
    expect(job.listBackups(opts.outDir)).toHaveLength(0);
  });

  test("corrupted source database fails without producing a partial backup", async () => {
    const src = seedSource();
    fs.writeFileSync(src.token, Buffer.from("this is not a sqlite database at all"));
    const opts = baseOptions(src);

    const result = await job.runBackupJob(opts);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(job.listBackups(opts.outDir)).toHaveLength(0);
  });

  test("a symlinked database is refused", () => {
    const src = seedSource();
    const link = path.join(src.dir, "linked-token.sqlite");
    try {
      fs.symlinkSync(src.token, link);
    } catch (_) {
      return; // symlink creation not permitted in this environment
    }
    const opts = baseOptions(src, { tokenPath: link });
    return job.runBackupJob(opts).then((result) => {
      expect(result.ok).toBe(false);
      expect(result.status.error).toMatch(/symbolic link/);
    });
  });

  permTest("insufficient destination permissions fail the job", async () => {
    const src = seedSource();
    const opts = baseOptions(src);
    fs.mkdirSync(opts.outDir, { recursive: true });
    fs.chmodSync(opts.outDir, 0o500);
    try {
      const result = await job.runBackupJob(opts);
      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(1);
    } finally {
      fs.chmodSync(opts.outDir, 0o700);
    }
  });
});

describe("interruption and verification", () => {
  test("an interrupted JSON copy aborts and removes the partial backup", async () => {
    const src = seedSource();
    const opts = baseOptions(src);
    const real = fs.writeFileSync;
    let calls = 0;
    jest.spyOn(fs, "writeFileSync").mockImplementation((file, data, ...rest) => {
      calls += 1;
      if (calls === 2) throw new Error("simulated interruption");
      return real(file, data, ...rest);
    });

    const result = await job.runBackupJob(opts);
    expect(result.ok).toBe(false);
    expect(result.status.verified).toBe(false);
    expect(job.listBackups(opts.outDir)).toHaveLength(0);
  });

  test("verification failure fails the job and prunes nothing", async () => {
    const src = seedSource();
    const opts = baseOptions(src);

    // Older, healthy-looking backups that must survive the failed run.
    const outDir = opts.outDir;
    fs.mkdirSync(outDir, { recursive: true });
    for (const name of ["backup-2020-01-01T00-00-00-000Z", "backup-2020-01-02T00-00-00-000Z"]) {
      fs.mkdirSync(path.join(outDir, name), { recursive: true });
      fs.writeFileSync(path.join(outDir, name, "manifest.json"), "{}", "utf8");
    }
    const before = fs.readdirSync(outDir).sort();

    opts.__hooks = {
      afterBackup: async ({ dest }) => {
        fs.appendFileSync(path.join(dest, "users.json"), "corrupted", "utf8");
      }
    };

    const result = await job.runBackupJob(opts);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.status.error).toMatch(/verification failed/i);
    expect(result.status.verified).toBe(false);
    expect(result.status.pruned).toEqual([]);
    expect(fs.readdirSync(outDir).sort()).toEqual(before);
  });
});

describe("retention", () => {
  test("retention runs only after a verified success", async () => {
    const src = seedSource();
    const opts = baseOptions(src, { retain: 2 });
    const old = seedOldBackups(opts.outDir, 3);

    const result = await job.runBackupJob(opts);
    expect(result.ok).toBe(true);
    expect(result.status.verified).toBe(true);
    expect(result.status.pruned.length).toBe(2);

    const remaining = job.listBackups(opts.outDir).map((d) => path.basename(d));
    expect(remaining).toHaveLength(2);
    expect(remaining).toContain(path.basename(result.status.backupDir));
    expect(remaining).toContain(old[2]); // newest old backup survives
  });

  test("retention never runs after a failure", async () => {
    const src = seedSource();
    const opts = baseOptions(src, { retain: 1 });
    const old = seedOldBackups(opts.outDir, 3);
    opts.tokenPath = path.join(src.dir, "does-not-exist.sqlite");

    const result = await job.runBackupJob(opts);
    expect(result.ok).toBe(false);
    expect(result.status.pruned).toEqual([]);
    const remaining = job.listBackups(opts.outDir).map((d) => path.basename(d));
    expect(remaining.sort()).toEqual(old.slice().sort());
  });

  test("the last known-good backup is preserved even with retain = 1", async () => {
    const src = seedSource();
    const opts = baseOptions(src, { retain: 1 });
    seedOldBackups(opts.outDir, 3);

    const result = await job.runBackupJob(opts);
    expect(result.ok).toBe(true);
    const remaining = job.listBackups(opts.outDir).map((d) => path.basename(d));
    expect(remaining).toEqual([path.basename(result.status.backupDir)]);
    expect(lib.verifyBackupDir(result.status.backupDir).ok).toBe(true);
  });

  test("pruneBackups never removes the protected directory", () => {
    const out = tmp("prune");
    fs.mkdirSync(path.join(out, "backup-2021-01-01T00-00-00-000Z"), { recursive: true });
    const removed = [];
    job.pruneBackups(out, 1, path.join(out, "backup-2021-01-01T00-00-00-000Z"), (dir) => removed.push(dir));
    expect(removed).toEqual([]);
  });
});

// ── Backup/Restore mutual exclusion ─────────────────────────────────────────
describe("coordination (backup <-> restore)", () => {
  function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
  }

  async function makeSourceBackup(src) {
    const out = tmp("coord-src-backup");
    const created = await lib.runBackup({
      dir: src.dir,
      out,
      tokenPath: src.token,
      challengePath: src.challenge
    });
    return created.dest;
  }

  test("two concurrent jobs are serialised and each produces a verified backup", async () => {
    const src = seedSource();
    const outDir = tmp("job-concurrent");
    const opts = { dataDir: src.dir, tokenPath: src.token, challengePath: src.challenge, outDir, retain: 5 };

    const [a, b] = await Promise.all([job.runBackupJob(opts), job.runBackupJob(opts)]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.status.backupDir).not.toBe(b.status.backupDir);
    expect(job.listBackups(outDir)).toHaveLength(2);
    expect(lib.verifyBackupDir(a.status.backupDir).ok).toBe(true);
    expect(lib.verifyBackupDir(b.status.backupDir).ok).toBe(true);
  });

  test("a restore cannot start while a backup is running", async () => {
    const src = seedSource();
    const from = await makeSourceBackup(src);

    const gate = deferred();
    const reached = deferred();
    const opts = baseOptions(src, {
      __hooks: {
        afterBackup: async () => { reached.resolve(); await gate.promise; }
      }
    });

    const running = job.runBackupJob(opts);
    await reached.promise;

    // The backup holds the data-directory lock Restore needs, so Restore must
    // fail rather than run concurrently (this is a real acquisition, not a
    // check-then-act).
    await expect(lib.runRestore({
      from,
      dir: src.dir,
      force: true,
      isolated: true,
      lockTimeoutMs: 250
    })).rejects.toThrow(/already running/);

    gate.resolve();
    const result = await running;
    expect(result.ok).toBe(true);
  });

  test("a backup cannot start while a restore is running", async () => {
    const src = seedSource();
    const from = await makeSourceBackup(src);

    const release = await fileLock.acquire(
      path.join(lib.canonicalPath(src.dir), lib.RESTORE_LOCK_NAME),
      { timeout: 5000 }
    );
    try {
      const opts = baseOptions(src, { retain: 1, lockTimeoutMs: 250 });
      const old = seedOldBackups(opts.outDir, 2);

      const result = await job.runBackupJob(opts);
      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.status.error).toMatch(/already running/);
      // No backup, no partial damage, and nothing pruned.
      expect(job.listBackups(opts.outDir).map((d) => path.basename(d)).sort()).toEqual(old.slice().sort());
      expect(result.status.pruned).toEqual([]);
    } finally {
      await release();
    }
    expect(fs.existsSync(from)).toBe(true);
  });

  test("a stale lock from a crashed process is recovered, not permanent", async () => {
    const src = seedSource();
    const lockPath = path.join(lib.canonicalPath(src.dir), lib.RESTORE_LOCK_NAME);
    fs.writeFileSync(lockPath, JSON.stringify({
      token: "crashed-run",
      pid: 999999,
      host: os.hostname(),
      acquiredAt: Date.now() - 3600000,
      heartbeatAt: Date.now() - 3600000
    }), "utf8");

    const result = await job.runBackupJob(baseOptions(src, { lockTimeoutMs: 5000 }));
    expect(result.ok).toBe(true);
    // The crashed owner's lock is gone, replaced by nothing (released).
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test("a lock owned by another process is never removed", async () => {
    const dir = tmp("coord-owner");
    const lockPath = path.join(dir, ".backup.lock");
    const release = await fileLock.acquire(lockPath, { timeout: 5000 });
    try {
      // Someone else takes over the path while we still hold a handle.
      fs.writeFileSync(lockPath, JSON.stringify({
        token: "someone-else",
        pid: process.pid,
        host: os.hostname(),
        acquiredAt: Date.now(),
        heartbeatAt: Date.now()
      }), "utf8");
    } finally {
      await release();
    }
    const surviving = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    expect(surviving.token).toBe("someone-else");
  });

  test("coordinationLockPaths shares the data-directory lock with restore", () => {
    const dir = tmp("coord-paths");
    const out = tmp("coord-paths-out");
    const paths = job.coordinationLockPaths(dir, out);
    const restorePath = path.join(lib.canonicalPath(dir), lib.RESTORE_LOCK_NAME);
    expect(paths).toContain(restorePath);
    expect(paths).toEqual(paths.slice().sort());
    expect(paths).toContain(path.join(lib.canonicalPath(out), job.BACKUP_LOCK_NAME));
  });
});

// ── Off-host hardening ──────────────────────────────────────────────────────
// ── mountinfo parsing ───────────────────────────────────────────────────────
// These exercise the real parser (no injected probe) against synthetic tables
// that use the same field layout as /proc/self/mountinfo, plus the live table on
// Linux. Nothing here reads or writes project data.
describe("mountinfo parsing", () => {
  const isLinux = process.platform === "linux";
  const linuxTest = isLinux ? test : test.skip;

  function mountFile(lines) {
    const file = path.join(tmp("mountinfo"), "mountinfo");
    fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
    return file;
  }

  // id parent major:minor root mountpoint options optional... - fstype source superopts
  function line(id, device, mountPoint) {
    return `${id} ${id - 1} ${device} / ${mountPoint} rw,relatime shared:${id} - ext4 /dev/sd${id} rw`;
  }

  test("_decodeMountPath decodes every mountinfo escape", () => {
    expect(job._decodeMountPath("/mnt/my\\040disk")).toBe("/mnt/my disk");
    expect(job._decodeMountPath("/mnt/tab\\011here")).toBe("/mnt/tab\there");
    expect(job._decodeMountPath("/mnt/line\\012break")).toBe("/mnt/line\nbreak");
    expect(job._decodeMountPath("/mnt/back\\134slash")).toBe("/mnt/back\\slash");
    expect(job._decodeMountPath("/mnt/\\040\\011\\012\\134")).toBe("/mnt/ \t\n\\");
    // Not a three-digit octal escape: left exactly as written.
    expect(job._decodeMountPath("/mnt/a\\b")).toBe("/mnt/a\\b");
    expect(job._decodeMountPath("/mnt/plain")).toBe("/mnt/plain");
  });

  test("_readMountInfo reads device id, mount id and decoded mount point", () => {
    const file = mountFile([
      line(40, "8:1", "/"),
      "",
      line(41, "8:17", "/mnt/off\\040host"),
      "garbage line",
      line(42, "0:21", "/mnt/tab\\011x")
    ]);
    const entries = job._readMountInfo(file);
    expect(entries).not.toBeNull();
    expect(entries.map((e) => e.device)).toEqual(["8:1", "8:17", "0:21"]);
    expect(entries.map((e) => e.id)).toEqual([40, 41, 42]);
    expect(entries[1].mountPoint).toBe("/mnt/off host");
    expect(entries[2].mountPoint).toBe("/mnt/tab\tx");
  });

  test("_readMountInfo returns null when the table cannot be read", () => {
    const missing = path.join(tmp("no-table"), "mountinfo");
    expect(job._readMountInfo(missing)).toBeNull();
  });

  test("_mountIdentity chooses the longest mount point and never a partial match", () => {
    const base = tmp("mount-real");
    const root = path.join(base, "offhost");
    const sibling = path.join(base, "offhost2");
    const nested = path.join(root, "inner");
    fs.mkdirSync(nested, { recursive: true });
    fs.mkdirSync(sibling, { recursive: true });

    const file = mountFile([
      line(30, "8:1", path.parse(root).root),
      line(31, "8:17", root),
      line(32, "8:18", sibling)
    ]);

    expect(job._mountIdentity(root, file)).toEqual({ device: "8:17", mountPoint: root });
    expect(job._mountIdentity(sibling, file)).toEqual({ device: "8:18", mountPoint: sibling });
    expect(job._mountIdentity(nested, file)).toEqual({ device: "8:17", mountPoint: root });

    // A sibling whose name merely starts with the mount point is not inside it.
    const prefixFile = mountFile([line(70, "8:1", path.join(base, "off"))]);
    expect(job._mountIdentity(root, prefixFile)).toBeNull();
  });

  test("a stacked mount resolves to the active (highest mount ID) layer, not to line order", () => {
    const base = tmp("mount-stacked");
    const root = path.join(base, "tie");
    fs.mkdirSync(root, { recursive: true });

    const lower = line(40, "8:1", root);
    const upper = line(91, "8:17", root);
    const expected = { device: "8:17", mountPoint: root };

    // Both line orders must produce the same answer: the top layer (id 91).
    expect(job._mountIdentity(root, mountFile([lower, upper]))).toEqual(expected);
    expect(job._mountIdentity(root, mountFile([upper, lower]))).toEqual(expected);
  });

  test("the longest mount point wins over a higher mount ID", () => {
    const base = tmp("mount-nested-id");
    const root = path.join(base, "root");
    const inner = path.join(root, "inner");
    fs.mkdirSync(inner, { recursive: true });

    const file = mountFile([line(50, "8:1", root), line(7, "8:17", inner)]);
    expect(job._mountIdentity(inner, file)).toEqual({ device: "8:17", mountPoint: inner });
  });

  test("an unprovable identity is null, never a guess", () => {
    const base = tmp("mount-unproven");
    const root = path.join(base, "unlisted");
    fs.mkdirSync(root, { recursive: true });

    // The table exists but no entry covers this path.
    expect(job._mountIdentity(root, mountFile([line(60, "8:1", path.join(base, "elsewhere"))]))).toBeNull();
    // The table is unavailable.
    expect(job._mountIdentity(root, path.join(base, "missing-table"))).toBeNull();
    // The target does not exist.
    expect(job._mountIdentity(path.join(base, "nope"), mountFile([line(61, "8:1", base)]))).toBeNull();
    // An entry without a device id is not usable identity.
    expect(job._mountIdentity(root, mountFile([line(62, "", root)]))).toBeNull();
  });

  linuxTest("_readMountInfo parses the live /proc/self/mountinfo", () => {
    const entries = job._readMountInfo();
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.device).toMatch(/^\d+:\d+$/);
      expect(entry.mountPoint.startsWith("/")).toBe(true);
    }

    expect(job._mountIdentity("/")).toEqual({
      device: expect.stringMatching(/^\d+:\d+$/),
      mountPoint: "/"
    });

    const identity = job._mountIdentity(os.tmpdir());
    expect(identity).not.toBeNull();
    expect(identity.device).toMatch(/^\d+:\d+$/);
    const prefix = identity.mountPoint.endsWith("/") ? identity.mountPoint : identity.mountPoint + "/";
    expect(fs.realpathSync(os.tmpdir()).startsWith(prefix)).toBe(true);
  });
});

describe("off-host destination (local, separately mounted)", () => {
  test("copies to a local path and verifies the copy", async () => {
    const src = seedSource();
    const outDir = tmp("job-offhost-out");
    const root = offhostRoot("job-offhost");
    const opts = {
      dataDir: src.dir,
      tokenPath: src.token,
      challengePath: src.challenge,
      outDir,
      retain: 7,
      offhostDir: root,
      offhostMountProbe: probeWith([[fs.realpathSync(outDir), "8:1"], [fs.realpathSync(root), "8:17"]])
    };

    const result = await job.runBackupJob(opts);
    expect(result.ok).toBe(true);
    expect(result.status.offhost.verified).toBe(true);
    expect(result.status.offhost.device).toBe("8:17");

    const copy = result.status.offhost.dir;
    expect(fs.existsSync(path.join(copy, "manifest.json"))).toBe(true);
    expect(lib.verifyBackupDir(copy).ok).toBe(true);
    // The manifest of the copy is byte-identical to the original.
    expect(sha(path.join(copy, "manifest.json")))
      .toBe(sha(path.join(result.status.backupDir, "manifest.json")));
    // Nothing half-written is left behind, and the copy is discoverable.
    expect(noLeftovers(root)).toEqual([]);
    expect(publishedIn(root)).toEqual([path.basename(result.status.backupDir)]);
  });

  test("a missing off-host root is rejected and never created", async () => {
    const src = seedSource();
    const parent = tmp("off-missing-parent");
    const missing = path.join(parent, "not-created");

    const result = await job.runBackupJob(baseOptions(src, { offhostDir: missing }));
    expect(result.ok).toBe(false);
    expect(result.status.offhost).toBeNull();
    expect(result.status.error).toMatch(/does not exist/);
    expect(fs.existsSync(missing)).toBe(false);
    // `path` (the parent) is untouched apart from the tmp dir itself.
    expect(fs.readdirSync(parent)).toEqual([]);
  });

  test("an off-host root that is a file is rejected", async () => {
    const src = seedSource();
    const file = path.join(tmp("off-file"), "root");
    fs.writeFileSync(file, "not a directory", "utf8");

    const result = await job.runBackupJob(baseOptions(src, { offhostDir: file }));
    expect(result.ok).toBe(false);
    expect(result.status.error).toMatch(/not a directory/);
  });

  test("a symlinked off-host root is rejected", async () => {
    const src = seedSource();
    const real = offhostRoot("off-symlink-real");
    const link = path.join(tmp("off-symlink"), "root");
    try {
      fs.symlinkSync(real, link, "dir");
    } catch (_) {
      return; // symlink creation requires privileges on this platform
    }

    const result = await job.runBackupJob(baseOptions(src, { offhostDir: link }));
    expect(result.ok).toBe(false);
    expect(result.status.error).toMatch(/symbolic link/);
  });

  test("a missing sentinel is rejected", async () => {
    const src = seedSource();
    const root = tmp("off-no-sentinel");

    const result = await job.runBackupJob(baseOptions(src, { offhostDir: root }));
    expect(result.ok).toBe(false);
    expect(result.status.error).toMatch(/sentinel missing/);
    expect(publishedIn(root)).toEqual([]);
  });

  test("a symlinked sentinel is rejected", async () => {
    const src = seedSource();
    const root = tmp("off-sentinel-link");
    const target = path.join(tmp("off-sentinel-target"), "real");
    fs.writeFileSync(target, "", "utf8");
    try {
      fs.symlinkSync(target, path.join(root, job.OFFHOST_SENTINEL));
    } catch (_) {
      return;
    }

    const result = await job.runBackupJob(baseOptions(src, { offhostDir: root }));
    expect(result.ok).toBe(false);
    expect(result.status.error).toMatch(/sentinel is not a regular file/);
  });

  test("a same-filesystem off-host destination is rejected", async () => {
    const src = seedSource();
    const outDir = tmp("off-same-fs-out");
    const root = offhostRoot("off-same-fs");
    const result = await job.runBackupJob({
      dataDir: src.dir,
      tokenPath: src.token,
      challengePath: src.challenge,
      outDir,
      offhostDir: root,
      offhostMountProbe: probeWith([[fs.realpathSync(outDir), "8:1"], [fs.realpathSync(root), "8:1"]])
    });

    expect(result.ok).toBe(false);
    expect(result.status.offhost).toBeNull();
    expect(result.status.error).toMatch(/same filesystem/);
    expect(publishedIn(root)).toEqual([]);
  });

  test("a destination that is not a mount point is rejected", async () => {
    const src = seedSource();
    const outDir = tmp("off-not-mount-out");
    const root = offhostRoot("off-not-mount");
    const result = await job.runBackupJob({
      dataDir: src.dir,
      tokenPath: src.token,
      challengePath: src.challenge,
      outDir,
      offhostDir: root,
      offhostMountProbe: probeWith([
        [fs.realpathSync(outDir), "8:1"],
        [fs.realpathSync(path.dirname(root)), "8:17"]
      ])
    });

    expect(result.ok).toBe(false);
    expect(result.status.error).toMatch(/not a mount point/);
  });

  test("unprovable mount identity fails closed", async () => {
    const src = seedSource();
    const root = offhostRoot("off-no-probe");
    const result = await job.runBackupJob(baseOptions(src, {
      offhostDir: root,
      offhostMountProbe: () => null
    }));

    expect(result.ok).toBe(false);
    expect(result.status.error).toMatch(/Cannot establish the mount identity/);
    expect(publishedIn(root)).toEqual([]);
  });

  test("the real mount probe never invents identity it cannot prove", async () => {
    // On a platform without /proc/self/mountinfo the production probe must
    // return nothing, which makes every off-host run fail closed. This is
    // asserted against the real default probe, not an injected stub.
    const root = offhostRoot("off-real-probe");
    if (isWindows) {
      expect(job._mountIdentity(root)).toBeNull();

      const src = seedSource();
      const result = await job.runBackupJob(baseOptions(src, { offhostDir: root }));
      expect(result.ok).toBe(false);
      expect(result.status.offhost).toBeNull();
      expect(result.status.error).toMatch(/mount identity/);
      expect(publishedIn(root)).toEqual([]);
    }
  });

  test("a copy that fails verification is never published", async () => {
    const src = seedSource();
    const outDir = tmp("off-verify-out");
    const root = offhostRoot("off-verify");
    const real = fs.cpSync;
    jest.spyOn(fs, "cpSync").mockImplementation((from, to, options) => {
      real(from, to, options);
      fs.appendFileSync(path.join(to, "users.json"), "tampered", "utf8");
    });

    const result = await job.runBackupJob({
      dataDir: src.dir,
      tokenPath: src.token,
      challengePath: src.challenge,
      outDir,
      offhostDir: root,
      offhostMountProbe: probeWith([[fs.realpathSync(outDir), "8:1"], [fs.realpathSync(root), "8:17"]])
    });

    expect(result.ok).toBe(false);
    expect(result.status.error).toMatch(/failed verification/);
    expect(publishedIn(root)).toEqual([]);
    expect(noLeftovers(root)).toEqual([]);
    // The verified local backup is preserved.
    expect(result.status.verified).toBe(true);
    expect(lib.verifyBackupDir(result.status.backupDir).ok).toBe(true);
  });

  test("an interrupted copy leaves no partial and does not block a retry", async () => {
    const src = seedSource();
    const outDir = tmp("off-interrupt-out");
    const root = offhostRoot("off-interrupt");
    const probe = probeWith([[fs.realpathSync(outDir), "8:1"], [fs.realpathSync(root), "8:17"]]);
    const opts = {
      dataDir: src.dir,
      tokenPath: src.token,
      challengePath: src.challenge,
      outDir,
      offhostDir: root,
      offhostMountProbe: probe
    };

    const real = fs.cpSync;
    const spy = jest.spyOn(fs, "cpSync").mockImplementation(() => {
      throw new Error("simulated mount loss");
    });
    const failed = await job.runBackupJob(opts);
    spy.mockRestore();

    expect(failed.ok).toBe(false);
    expect(failed.status.error).toMatch(/simulated mount loss/);
    expect(publishedIn(root)).toEqual([]);
    expect(noLeftovers(root)).toEqual([]);

    // A retry is not blocked by the failed attempt.
    const retried = await job.runBackupJob(opts);
    expect(retried.ok).toBe(true);
    expect(publishedIn(root)).toEqual([path.basename(retried.status.backupDir)]);
    expect(noLeftovers(root)).toEqual([]);
    expect(real).toBe(fs.cpSync);
  });

  test("a remote/UNC destination is refused, not attempted", async () => {
    const src = seedSource();
    for (const bad of ["ssh://host/path", "rsync://host/path", "s3://bucket/prefix", "\\\\server\\share"]) {
      expect(job._isRemoteDestination(bad)).toBe(true);
    }
    const result = await job.runBackupJob(baseOptions(src, { offhostDir: "ssh://host/path" }));
    expect(result.ok).toBe(false);
    expect(result.status.error).toMatch(/local filesystem path/);
  });
});

describe("retention ordering with off-host", () => {
  function offhostOptions(src, extra) {
    const outDir = tmp("order-out");
    const root = offhostRoot("order-offhost");
    return Object.assign({
      dataDir: src.dir,
      tokenPath: src.token,
      challengePath: src.challenge,
      outDir,
      offhostDir: root,
      offhostMountProbe: probeWith([[fs.realpathSync(outDir), "8:1"], [fs.realpathSync(root), "8:17"]])
    }, extra || {});
  }

  test("off-host succeeds, then retention runs", async () => {
    const src = seedSource();
    const opts = offhostOptions(src, { retain: 2 });
    const old = seedOldBackups(opts.outDir, 3);

    const result = await job.runBackupJob(opts);
    expect(result.ok).toBe(true);
    expect(result.status.offhost.verified).toBe(true);
    expect(result.status.pruned.length).toBe(2);

    const remaining = job.listBackups(opts.outDir).map((d) => path.basename(d));
    expect(remaining).toHaveLength(2);
    expect(remaining).toContain(path.basename(result.status.backupDir));
    expect(remaining).toContain(old[2]);
  });

  test("an unavailable mount does not prune any existing backup", async () => {
    const src = seedSource();
    const outDir = tmp("order-missing-out");
    const old = seedOldBackups(outDir, 3);
    const missing = path.join(tmp("order-missing-parent"), "unmounted");

    const result = await job.runBackupJob({
      dataDir: src.dir,
      tokenPath: src.token,
      challengePath: src.challenge,
      outDir,
      retain: 1,
      offhostDir: missing
    });

    expect(result.ok).toBe(false);
    expect(result.status.pruned).toEqual([]);
    const names = job.listBackups(outDir).map((d) => path.basename(d));
    // Every previous backup survives, plus the newly verified local one.
    for (const name of old) expect(names).toContain(name);
    expect(names).toHaveLength(old.length + 1);
    expect(result.status.verified).toBe(true);
  });

  test("retain=1 with a failed off-host copy keeps every previous backup", async () => {
    const src = seedSource();
    const outDir = tmp("order-retain1-out");
    const old = seedOldBackups(outDir, 2);
    const root = tmp("order-retain1-offhost"); // no sentinel: fails closed

    const result = await job.runBackupJob({
      dataDir: src.dir,
      tokenPath: src.token,
      challengePath: src.challenge,
      outDir,
      retain: 1,
      offhostDir: root
    });

    expect(result.ok).toBe(false);
    expect(result.status.pruned).toEqual([]);
    const names = job.listBackups(outDir).map((d) => path.basename(d));
    expect(names).toHaveLength(old.length + 1);
    for (const name of old) expect(names).toContain(name);
  });

  test("retain=1 with a successful off-host copy keeps only the new backup", async () => {
    const src = seedSource();
    const opts = offhostOptions(src, { retain: 1 });
    seedOldBackups(opts.outDir, 2);

    const result = await job.runBackupJob(opts);
    expect(result.ok).toBe(true);
    expect(job.listBackups(opts.outDir).map((d) => path.basename(d)))
      .toEqual([path.basename(result.status.backupDir)]);
    // The published off-host copy is untouched by retention.
    expect(publishedIn(opts.offhostDir)).toEqual([path.basename(result.status.backupDir)]);
  });
});

// ── Status files ────────────────────────────────────────────────────────────
describe("status files", () => {
  async function okResult(src) {
    return job.runBackupJob(baseOptions(src));
  }

  test("writes last-attempt and last-success atomically and privately", async () => {
    const src = seedSource();
    const result = await okResult(src);
    expect(result.ok).toBe(true);

    const dir = tmp("status-dir");
    const renameSpy = jest.spyOn(fs, "renameSync");
    const written = job.writeRunStatus(dir, result, { dataDir: src.dir, outDir: result.status.backupDir });
    expect(renameSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    renameSpy.mockRestore();

    expect(written.map((f) => path.basename(f)).sort())
      .toEqual(["last-attempt.json", "last-success.json"]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "last-success.json"), "utf8")).ok).toBe(true);
    // No temp files linger.
    expect(fs.readdirSync(dir).sort()).toEqual(["last-attempt.json", "last-success.json"]);
  });

  permTest("the status directory is 0700 and files are 0600", async () => {
    const src = seedSource();
    const result = await okResult(src);
    const dir = tmp("status-modes");
    job.writeRunStatus(dir, result, { dataDir: src.dir });

    expect(bits(dir)).toBe(0o700);
    expect(bits(path.join(dir, "last-attempt.json"))).toBe(0o600);
    expect(bits(path.join(dir, "last-success.json"))).toBe(0o600);
  });

  test("a failed attempt never overwrites the previous success", async () => {
    const src = seedSource();
    const good = await okResult(src);
    const dir = tmp("status-preserve");
    job.writeRunStatus(dir, good, { dataDir: src.dir });
    const successBefore = fs.readFileSync(path.join(dir, "last-success.json"), "utf8");

    const bad = await job.runBackupJob(baseOptions(src, {
      tokenPath: path.join(src.dir, "gone.sqlite")
    }));
    expect(bad.ok).toBe(false);
    job.writeRunStatus(dir, bad, { dataDir: src.dir });

    expect(fs.readFileSync(path.join(dir, "last-success.json"), "utf8")).toBe(successBefore);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "last-attempt.json"), "utf8")).ok).toBe(false);
  });

  test("an interrupted status write leaves the previous success intact and no temp file", async () => {
    const src = seedSource();
    const first = await okResult(src);
    const second = await okResult(src);
    expect(second.status.backupDir).not.toBe(first.status.backupDir);

    const dir = tmp("status-crash");
    job.writeRunStatus(dir, first, { dataDir: src.dir });
    const before = fs.readFileSync(path.join(dir, "last-success.json"), "utf8");

    const spy = jest.spyOn(fs, "writeFileSync").mockImplementationOnce(() => {
      throw new Error("simulated crash mid-write");
    });
    expect(() => job.writeRunStatus(dir, second, { dataDir: src.dir })).toThrow(/simulated crash/);
    spy.mockRestore();

    // The published status is still the previous, complete one…
    expect(fs.readFileSync(path.join(dir, "last-success.json"), "utf8")).toBe(before);
    // …and the abandoned temp file did not survive.
    expect(fs.readdirSync(dir).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  test("a status directory inside the data directory or backup root is refused", async () => {
    const src = seedSource();
    const result = await okResult(src);

    expect(() => job.writeRunStatus(path.join(src.dir, "status"), result, { dataDir: src.dir }))
      .toThrow(/may not live inside the data directory/);
    expect(() => job.writeRunStatus(path.join(result.status.backupDir, "status"), result, {
      outDir: path.dirname(result.status.backupDir)
    })).toThrow(/may not live inside the backup root/);
  });

  test("public status output carries no absolute paths, database paths or env values", async () => {
    const src = seedSource();
    const result = await okResult(src);
    const publicStatus = job.redactStatus(result.status);
    const serialized = JSON.stringify(publicStatus);

    expect(serialized).not.toContain(path.resolve(src.dir));
    expect(serialized).not.toContain(src.token);
    expect(publicStatus.dataDir).toBeUndefined();
    expect(publicStatus.databases).toBeUndefined();
    expect(Object.keys(publicStatus).sort()).toEqual([
      "backup", "discarded", "error", "files", "finishedAt", "offhost", "ok",
      "pruned", "startedAt", "statusWriteError", "verified", "version"
    ]);
  });
});

describe("explicit paths only", () => {
  test("ambient TOKEN_STORE_PATH / CHALLENGE_DB_PATH do not influence the job", async () => {
    const src = seedSource();
    const decoyDir = tmp("job-decoy");
    const decoyToken = path.join(decoyDir, "tokenStore.sqlite");
    const decoyChallenge = path.join(decoyDir, "challengeStore.sqlite");
    makeTokenDb(decoyToken, "decoy", 5);
    makeChallengeDb(decoyChallenge);

    const saved = {
      token: process.env.TOKEN_STORE_PATH,
      challenge: process.env.CHALLENGE_DB_PATH
    };
    process.env.TOKEN_STORE_PATH = decoyToken;
    process.env.CHALLENGE_DB_PATH = decoyChallenge;
    try {
      const result = await job.runBackupJob(baseOptions(src));
      expect(result.ok).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(path.join(result.status.backupDir, "manifest.json"), "utf8"));
      expect(manifest.databases.tokenStore.source).toBe(path.resolve(src.token));
      expect(manifest.databases.challengeStore.source).toBe(path.resolve(src.challenge));
      expect(manifest.databases.tokenStore.source).not.toBe(path.resolve(decoyToken));
    } finally {
      if (saved.token === undefined) delete process.env.TOKEN_STORE_PATH;
      else process.env.TOKEN_STORE_PATH = saved.token;
      if (saved.challenge === undefined) delete process.env.CHALLENGE_DB_PATH;
      else process.env.CHALLENGE_DB_PATH = saved.challenge;
    }
  });

  test("a missing explicit path is a usage error (exit 2), not an env fallback", async () => {
    const result = await job.runBackupJob({ dataDir: tmp("usage"), outDir: tmp("usage-out") });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.status.error).toMatch(/required/);
  });
});

describe("file and directory modes", () => {
  posixTest("backup directory is 0700, SQLite keeps its mode, JSON is 0640", async () => {
    const src = seedSource();
    fs.chmodSync(src.token, 0o600);
    fs.chmodSync(src.challenge, 0o640);

    const result = await job.runBackupJob(baseOptions(src));
    expect(result.ok).toBe(true);
    const dir = result.status.backupDir;

    expect(bits(dir)).toBe(0o700);
    expect(bits(path.join(dir, "tokenStore.sqlite"))).toBe(0o600);
    expect(bits(path.join(dir, "challengeStore.sqlite"))).toBe(0o640);
    expect(bits(path.join(dir, "users.json"))).toBe(0o640);
  });
});

describe("CLI exit codes", () => {
  const cli = path.join(__dirname, "..", "scripts", "backupJob.js");

  function run(args, env) {
    return spawnSync(process.execPath, [cli, ...args], {
      cwd: path.join(__dirname, ".."),
      env: Object.assign({}, process.env, env || {}),
      encoding: "utf8",
      timeout: 60000
    });
  }

  test("missing required arguments exits 2", () => {
    const result = run([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Usage/);
  });

  test("a failing backup exits 1 and prints a machine-readable status", () => {
    const src = seedSource();
    const outDir = tmp("cli-out");
    const result = run([
      "--data-dir", src.dir,
      "--token-store", path.join(src.dir, "nope.sqlite"),
      "--challenge-store", src.challenge,
      "--out", outDir,
      "--json"
    ]);
    expect(result.status).toBe(1);
    const status = JSON.parse(result.stdout.trim());
    expect(status.ok).toBe(false);
    expect(status.verified).toBe(false);
    expect(status.error).toMatch(/does not exist/);
    expect(status.backup).toBeNull();
  });

  test("a successful backup exits 0 and writes both status files", () => {
    const src = seedSource();
    const outDir = tmp("cli-out-ok");
    const statusDir = tmp("cli-status");
    const result = run([
      "--data-dir", src.dir,
      "--token-store", src.token,
      "--challenge-store", src.challenge,
      "--out", outDir,
      "--retain", "3",
      "--json",
      "--status-dir", statusDir
    ]);
    expect(result.status).toBe(0);
    const status = JSON.parse(result.stdout.trim());
    expect(status.ok).toBe(true);
    expect(status.verified).toBe(true);
    expect(fs.readdirSync(statusDir).sort()).toEqual(["last-attempt.json", "last-success.json"]);
    expect(JSON.parse(fs.readFileSync(path.join(statusDir, "last-success.json"), "utf8")).ok).toBe(true);
  });

  test("a failing backup writes last-attempt only", () => {
    const src = seedSource();
    const statusDir = tmp("cli-status-fail");
    const result = run([
      "--data-dir", src.dir,
      "--token-store", path.join(src.dir, "nope.sqlite"),
      "--challenge-store", src.challenge,
      "--out", tmp("cli-out-fail"),
      "--status-dir", statusDir
    ]);
    expect(result.status).toBe(1);
    expect(fs.readdirSync(statusDir)).toEqual(["last-attempt.json"]);
    expect(JSON.parse(fs.readFileSync(path.join(statusDir, "last-attempt.json"), "utf8")).ok).toBe(false);
  });

  test("a status-write failure does not turn a verified backup into a failure", () => {
    const src = seedSource();
    const result = run([
      "--data-dir", src.dir,
      "--token-store", src.token,
      "--challenge-store", src.challenge,
      "--out", tmp("cli-out-statusfail"),
      "--json",
      "--status-dir", path.join(src.dir, "status")
    ]);

    expect(result.status).toBe(0);
    const status = JSON.parse(result.stdout.trim());
    expect(status.ok).toBe(true);
    expect(status.verified).toBe(true);
    expect(status.statusWriteError).toMatch(/may not live inside the data directory/);
    expect(result.stderr).toMatch(/Status write failed/);
    expect(fs.existsSync(path.join(src.dir, "status"))).toBe(false);
  });
});
