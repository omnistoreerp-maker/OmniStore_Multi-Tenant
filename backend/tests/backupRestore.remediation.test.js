'use strict';

// P6 F4/F5 — regression coverage for the independent-review remediation
// (F-1 … F-7). Temp directories only; backend/data is never touched.

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { makeTempDataDir } = require('./helpers/testData');
const { makeTokenDb, makeChallengeDb } = require('./helpers/backupFixture');

const lib = require('../scripts/lib/backupRestore');
const sqliteSnapshot = require('../utils/sqliteSnapshot');

function tokenStore() { return require('../utils/tokenStore.sqlite'); }
function challengeStore() { return require('../utils/challengeStore.sqlite'); }

const savedEnv = {
  TOKEN_STORE_PATH: process.env.TOKEN_STORE_PATH,
  CHALLENGE_DB_PATH: process.env.CHALLENGE_DB_PATH
};
const tempDirs = [];

function tmp(tag) {
  const dir = makeTempDataDir(tag);
  tempDirs.push(dir);
  return dir;
}

function families(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try { return db.prepare('SELECT COUNT(*) c FROM session_families').get().c; }
  finally { db.close(); }
}

function seedDataDir() {
  const dir = tmp('rem-seed');
  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify([{ id: 'u1' }]), 'utf8');
  makeTokenDb(path.join(dir, 'tokenStore.sqlite'), 'user-1');
  makeChallengeDb(path.join(dir, 'challengeStore.sqlite'));
  return dir;
}

// names + hashes of every entry in a directory
function inventory(dir) {
  const out = {};
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    out[name] = stat.isFile() ? lib.sha256File(full) : 'DIR';
  }
  return out;
}

let outDir;

beforeAll(() => { outDir = tmp('rem-out'); });

afterEach(() => {
  if (savedEnv.TOKEN_STORE_PATH === undefined) delete process.env.TOKEN_STORE_PATH;
  else process.env.TOKEN_STORE_PATH = savedEnv.TOKEN_STORE_PATH;
  if (savedEnv.CHALLENGE_DB_PATH === undefined) delete process.env.CHALLENGE_DB_PATH;
  else process.env.CHALLENGE_DB_PATH = savedEnv.CHALLENGE_DB_PATH;
});

afterAll(() => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── F-1: active writer refusal on the CLI path ──────────────────────────────

test('F-1: CLI restore refuses an in-use database with an actionable error and no rename', async () => {
  const dir = seedDataDir();
  const { dest } = await lib.runBackup({ dir, out: outDir });
  const restoreDir = tmp('rem-inuse');
  const target = path.join(restoreDir, 'tokenStore.sqlite');
  makeTokenDb(target, 'held', 2);
  const before = fs.readFileSync(target);

  const blocker = new Database(target);
  blocker.exec('BEGIN IMMEDIATE');

  const renames = [];
  const realRename = fs.renameSync;
  const spy = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    renames.push(String(to));
    return realRename(from, to);
  });

  let caught = null;
  try {
    await lib.runRestore({ from: dest, dir: restoreDir, force: true });
  } catch (err) {
    caught = err;
  } finally {
    spy.mockRestore();
    try { blocker.exec('ROLLBACK'); } catch (_) {}
    blocker.close();
  }

  expect(caught).not.toBeNull();
  // Application-level refusal, not an incidental filesystem EBUSY.
  expect(caught.message).toMatch(/is in use/i);
  expect(caught.message).toMatch(/stop the service/i);
  expect(caught.message).not.toMatch(/EBUSY/i);
  // Proven independent of rename semantics: the target was never renamed.
  expect(renames).not.toContain(target);
  expect(fs.readFileSync(target).equals(before)).toBe(true);
});

test('F-1: every SQLite target is preflighted (challenge writer blocks the whole restore)', async () => {
  const dir = seedDataDir();
  const { dest } = await lib.runBackup({ dir, out: outDir });
  const restoreDir = tmp('rem-inuse2');
  const tokenTarget = path.join(restoreDir, 'tokenStore.sqlite');
  const challengeTarget = path.join(restoreDir, 'challengeStore.sqlite');
  makeTokenDb(tokenTarget, 'held', 2);
  makeChallengeDb(challengeTarget);
  const tokenBefore = fs.readFileSync(tokenTarget);

  const blocker = new Database(challengeTarget);
  blocker.exec('BEGIN IMMEDIATE');
  let caught = null;
  try {
    await lib.runRestore({ from: dest, dir: restoreDir, force: true });
  } catch (err) {
    caught = err;
  } finally {
    try { blocker.exec('ROLLBACK'); } catch (_) {}
    blocker.close();
  }

  expect(caught).not.toBeNull();
  expect(caught.message).toMatch(/challengeStore\.sqlite/);
  expect(caught.message).toMatch(/is in use/i);
  // Nothing was replaced: the token database is byte-identical.
  expect(fs.readFileSync(tokenTarget).equals(tokenBefore)).toBe(true);
  expect(families(tokenTarget)).toBe(2);
});

test('F-1: no destination file changes when the preflight refuses', async () => {
  const dir = seedDataDir();
  const { dest } = await lib.runBackup({ dir, out: outDir });
  const restoreDir = tmp('rem-inuse3');
  const target = path.join(restoreDir, 'tokenStore.sqlite');
  makeTokenDb(target, 'held');
  const beforeInventory = inventory(restoreDir);

  const blocker = new Database(target);
  blocker.exec('BEGIN IMMEDIATE');
  try {
    await expect(lib.runRestore({ from: dest, dir: restoreDir, force: true })).rejects.toThrow(/is in use/i);
  } finally {
    try { blocker.exec('ROLLBACK'); } catch (_) {}
    blocker.close();
  }
  expect(inventory(restoreDir)).toEqual(beforeInventory);
});

// ── F-2: configured stores on a different volume ────────────────────────────

const secondVolume = (() => {
  if (process.platform !== 'win32') return null;
  for (const letter of ['D:', 'E:', 'F:']) {
    const root = letter + '\\';
    try {
      if (path.parse(os.tmpdir()).root.toLowerCase() === root.toLowerCase()) continue;
      if (fs.existsSync(root)) {
        fs.accessSync(root, fs.constants.W_OK);
        return root;
      }
    } catch (_) { /* not usable */ }
  }
  return null;
})();

const multiVolumeTest = secondVolume ? test : test.skip;

multiVolumeTest('F-2: token and challenge stores on a second volume restore successfully', async () => {
  const ext = fs.mkdtempSync(path.join(secondVolume, 'p6rem-ext-'));
  const restoreExt = fs.mkdtempSync(path.join(secondVolume, 'p6rem-rest-'));
  try {
    const tokenExt = path.join(ext, 'tokenStore.sqlite');
    const challengeExt = path.join(ext, 'challengeStore.sqlite');
    makeTokenDb(tokenExt, 'ext', 2);
    makeChallengeDb(challengeExt);

    process.env.TOKEN_STORE_PATH = tokenExt;
    process.env.CHALLENGE_DB_PATH = challengeExt;

    const srcDir = tmp('rem-extdata');
    fs.writeFileSync(path.join(srcDir, 'users.json'), '[]', 'utf8');
    const { dest } = await lib.runBackup({ dir: srcDir, out: outDir });

    // Replace the live stores with different state.
    fs.rmSync(tokenExt);
    makeTokenDb(tokenExt, 'other', 1);
    expect(families(tokenExt)).toBe(1);

    const restoreDir = tmp('rem-extdir');
    await lib.runRestore({ from: dest, dir: restoreDir, force: true });

    // Written back to the same volume, same physical databases.
    expect(families(tokenExt)).toBe(2);
    expect(path.extname(tokenExt)).toBe('.sqlite');
    // Nothing was left beside the targets.
    expect(fs.readdirSync(ext).filter((f) => f.includes('.incoming.') || f.includes('.origin.'))).toEqual([]);
  } finally {
    fs.rmSync(ext, { recursive: true, force: true });
    fs.rmSync(restoreExt, { recursive: true, force: true });
  }
});

test('F-2: EXDEV on a rename uses the verified copy+unlink fallback', async () => {
  const dir = seedDataDir();
  const { dest } = await lib.runBackup({ dir, out: outDir });
  const restoreDir = tmp('rem-exdev');
  const target = path.join(restoreDir, 'tokenStore.sqlite');
  makeTokenDb(target, 'original', 3);

  const realRename = fs.renameSync;
  const spy = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(to).includes('.origin.')) {
      throw Object.assign(new Error('injected EXDEV'), { code: 'EXDEV' });
    }
    return realRename(from, to);
  });
  try {
    const result = await lib.runRestore({ from: dest, dir: restoreDir, force: true });
    expect(result.restored).toBe(3);
  } finally {
    spy.mockRestore();
  }

  // The fallback preserved the restore outcome.
  expect(families(target)).toBe(1);
  expect(
    fs.readdirSync(restoreDir).filter((f) => f.includes('.origin.') || f.includes('.incoming.'))
  ).toEqual([]);
});

test('F-2: a cross-device copy failure rolls back with exact recovery locations', async () => {
  const dir = seedDataDir();
  const { dest } = await lib.runBackup({ dir, out: outDir });
  const restoreDir = tmp('rem-exdev2');
  const target = path.join(restoreDir, 'tokenStore.sqlite');
  makeTokenDb(target, 'original', 3);
  const before = families(target);

  const realRename = fs.renameSync;
  const realCopy = fs.copyFileSync;
  const renameSpy = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(to).includes('.origin.')) {
      throw Object.assign(new Error('injected EXDEV'), { code: 'EXDEV' });
    }
    return realRename(from, to);
  });
  const copySpy = jest.spyOn(fs, 'copyFileSync').mockImplementation((from, to, ...rest) => {
    if (String(to).includes('.origin.')) {
      throw Object.assign(new Error('injected copy failure after EXDEV'), { code: 'EIO' });
    }
    return realCopy(from, to, ...rest);
  });
  let caught = null;
  try {
    await lib.runRestore({ from: dest, dir: restoreDir, force: true });
  } catch (err) {
    caught = err;
  } finally {
    renameSpy.mockRestore();
    copySpy.mockRestore();
  }

  expect(caught).not.toBeNull();
  expect(caught.message).toMatch(/injected copy failure after EXDEV|rolled back/i);
  expect(families(target)).toBe(before);
});

// ── F-3: unlisted destination stores ────────────────────────────────────────

test('F-3: stale JSON and SQLite stores in the destination are refused before any change', async () => {
  const dir = seedDataDir();
  const { dest } = await lib.runBackup({ dir, out: outDir });
  const restoreDir = tmp('rem-stale');
  fs.writeFileSync(path.join(restoreDir, 'users.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(restoreDir, 'stale.json'), JSON.stringify([{ id: 'STALE' }]), 'utf8');
  const staleDb = path.join(restoreDir, 'stale.sqlite');
  makeTokenDb(staleDb, 'stale', 1);

  const before = inventory(restoreDir);
  let caught = null;
  try {
    await lib.runRestore({ from: dest, dir: restoreDir, force: true });
  } catch (err) {
    caught = err;
  }
  expect(caught).not.toBeNull();
  expect(caught.message).toMatch(/not in the backup manifest/i);
  expect(caught.message).toMatch(/stale\.json/);
  expect(caught.message).toMatch(/stale\.sqlite/);
  expect(inventory(restoreDir)).toEqual(before);
});

test('F-3: --allow-unlisted is separate from --force and keeps the extra stores', async () => {
  const dir = seedDataDir();
  const { dest } = await lib.runBackup({ dir, out: outDir });
  const restoreDir = tmp('rem-allow');
  fs.writeFileSync(path.join(restoreDir, 'stale.json'), JSON.stringify([{ id: 'STALE' }]), 'utf8');

  // --force alone still refuses.
  await expect(lib.runRestore({ from: dest, dir: restoreDir, force: true })).rejects.toThrow(
    /not in the backup manifest/i
  );

  const result = await lib.runRestore({ from: dest, dir: restoreDir, force: true, allowUnlisted: true });
  expect(result.unlistedKept).toEqual(['stale.json']);
  expect(fs.readFileSync(path.join(restoreDir, 'stale.json'), 'utf8')).toBe(JSON.stringify([{ id: 'STALE' }]));
});

test('F-3: the restore lock file is never treated as a data artifact or backed up', async () => {
  const dir = tmp('rem-lock');
  fs.writeFileSync(path.join(dir, 'users.json'), '[]', 'utf8');
  const lockPath = path.join(dir, lib.RESTORE_LOCK_NAME);
  fs.writeFileSync(lockPath, '{}', 'utf8');

  const { manifest } = await lib.runBackup({ dir, out: outDir });
  expect(Object.keys(manifest.files)).toEqual(['users.json']);
  expect(lib.findUnlistedArtifacts(dir, [{ name: 'users.json', target: path.join(dir, 'users.json') }])).toEqual([]);
  fs.unlinkSync(lockPath);
});

// ── F-4: verification must not modify the backup ────────────────────────────

test('F-4: verifyBackupDir leaves the backup directory byte-identical', async () => {
  const dir = seedDataDir();
  const { dest } = await lib.runBackup({ dir, out: outDir });
  const before = inventory(dest);

  const result = lib.verifyBackupDir(dest);
  expect(result.ok).toBe(true);

  expect(inventory(dest)).toEqual(before);
  const sidecars = fs.readdirSync(dest).filter((f) => /-(wal|shm|journal)$/.test(f));
  expect(sidecars).toEqual([]);
});

// ── F-5: token validation is read-only ──────────────────────────────────────

test('F-5: tokenStore.validateDatabaseFile preserves bytes and creates no sidecars', () => {
  const work = tmp('rem-rovalidate');
  const db = path.join(work, 'tokenStore.sqlite');
  makeTokenDb(db, 'ro', 1);
  const before = inventory(work);

  expect(tokenStore().validateDatabaseFile(db)).toBe(db);

  expect(inventory(work)).toEqual(before);
});

test('F-5: validating a corrupt artifact does not modify it or its directory', () => {
  const work = tmp('rem-rocorrupt');
  const bad = path.join(work, 'tokenStore.sqlite');
  fs.writeFileSync(bad, 'not a sqlite database at all');
  const before = inventory(work);

  expect(() => tokenStore().validateDatabaseFile(bad)).toThrow();
  expect(inventory(work)).toEqual(before);
});

// ── F-6: journal sidecars ───────────────────────────────────────────────────

test('F-6: sidecar list covers -wal, -shm and -journal in both modules', () => {
  expect(sqliteSnapshot.SIDECARS).toEqual(['-wal', '-shm', '-journal']);
  expect(lib.SIDECARS).toEqual(['-wal', '-shm', '-journal']);
});

// ── F-7: restore serialisation ──────────────────────────────────────────────

test('F-7: concurrent restores with different timestamps serialise and both succeed', async () => {
  const dir = seedDataDir();
  const { dest } = await lib.runBackup({ dir, out: outDir });
  const restoreDir = tmp('rem-conc1');

  const results = await Promise.allSettled([
    lib.runRestore({ from: dest, dir: restoreDir, force: true }),
    lib.runRestore({ from: dest, dir: restoreDir, force: true, now: Date.now() + 1000 })
  ]);
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
  expect(
    fs.readdirSync(restoreDir).filter(
      (f) => f.includes('.incoming.') || f.includes('.origin.') || f === lib.RESTORE_LOCK_NAME
    )
  ).toEqual([]);
  expect(families(path.join(restoreDir, 'tokenStore.sqlite'))).toBe(1);
});

test('F-7: concurrent restores with identical timestamps serialise instead of colliding', async () => {
  const dir = seedDataDir();
  const { dest } = await lib.runBackup({ dir, out: outDir });
  const restoreDir = tmp('rem-conc2');
  const fixed = 1700000000000;

  const results = await Promise.allSettled([
    lib.runRestore({ from: dest, dir: restoreDir, force: true, now: fixed }),
    lib.runRestore({ from: dest, dir: restoreDir, force: true, now: fixed })
  ]);
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
  expect(
    fs.readdirSync(restoreDir).filter(
      (f) => f.includes('.incoming.') || f.includes('.origin.') || f === lib.RESTORE_LOCK_NAME
    )
  ).toEqual([]);
});

test('F-7: a held restore lock produces a clear contention error', async () => {
  const dir = seedDataDir();
  const { dest } = await lib.runBackup({ dir, out: outDir });
  const restoreDir = tmp('rem-lockheld');

  const fileLock = require('../utils/fileLock');
  const lockPath = path.join(restoreDir, lib.RESTORE_LOCK_NAME);
  const release = await fileLock.acquire(lockPath, { timeout: 5000, stale: 30000 });
  try {
    await expect(
      lib.runRestore({ from: dest, dir: restoreDir, lockTimeoutMs: 200 })
    ).rejects.toThrow(/Another restore is already running/i);
  } finally {
    await release();
  }
});
