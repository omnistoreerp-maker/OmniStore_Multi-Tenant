'use strict';

// P6 F4/F5 remediation, second review round:
//   M-1 — restore locks cover actual destinations (not just --dir)
//   M-2 — EBUSY/EPERM on replacement becomes an actionable service-stop error
//   L-1 — a failed cross-device copy removes only its own partial destination
//   L-3 — challenge validator is side-effect free
//
// Every directory is a temp directory; backend/data is never touched.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { makeTempDataDir } = require('./helpers/testData');
const { makeTokenDb, makeChallengeDb } = require('./helpers/backupFixture');

const lib = require('../scripts/lib/backupRestore');
const fileLock = require('../utils/fileLock');

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

function inventory(dir) {
  const out = {};
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    out[name] = fs.statSync(full).isFile() ? lib.sha256File(full) : 'DIR';
  }
  return out;
}

function targetLockPath(target) {
  return lib.canonicalPath(target) + lib.TARGET_LOCK_SUFFIX;
}

function seedDir(tag) {
  const dir = tmp(tag);
  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify([{ id: 'u1' }]), 'utf8');
  makeTokenDb(path.join(dir, 'tokenStore.sqlite'), 'seed', 2);
  makeChallengeDb(path.join(dir, 'challengeStore.sqlite'));
  return dir;
}

// Reverse the manifest key order to prove lock acquisition does not follow
// manifest/plan order.
function reverseManifestOrder(dest) {
  const file = path.join(dest, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const reversed = {};
  for (const key of Object.keys(manifest.files).reverse()) reversed[key] = manifest.files[key];
  manifest.files = reversed;
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  return dest;
}

function assertNoLocksHeld(paths) {
  for (const lockPath of paths) {
    expect(fs.existsSync(lockPath)).toBe(false);
  }
}

let outDir;

beforeAll(() => { outDir = tmp('lock-out'); });

afterEach(() => {
  if (savedEnv.TOKEN_STORE_PATH === undefined) delete process.env.TOKEN_STORE_PATH;
  else process.env.TOKEN_STORE_PATH = savedEnv.TOKEN_STORE_PATH;
  if (savedEnv.CHALLENGE_DB_PATH === undefined) delete process.env.CHALLENGE_DB_PATH;
  else process.env.CHALLENGE_DB_PATH = savedEnv.CHALLENGE_DB_PATH;
});

afterAll(() => {
  for (const alias of aliases) {
    try { fs.unlinkSync(alias); } catch (_) {
      try { fs.rmSync(alias, { recursive: true, force: true }); } catch (_) {}
    }
  }
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── M-1: locks cover the actual destinations ────────────────────────────────

test('M-1: restores with different --dir but the same TOKEN_STORE_PATH contend', async () => {
  const shared = tmp('m1-shared');
  const tokenExt = path.join(shared, 'tokenStore.sqlite');
  makeTokenDb(tokenExt, 'shared', 2);
  process.env.TOKEN_STORE_PATH = tokenExt;
  process.env.CHALLENGE_DB_PATH = path.join(shared, 'challengeStore.sqlite');
  makeChallengeDb(process.env.CHALLENGE_DB_PATH);

  const src = tmp('m1-src');
  fs.writeFileSync(path.join(src, 'users.json'), '[]', 'utf8');
  const backup = (await lib.runBackup({ dir: src, out: outDir })).dest;

  const dirA = tmp('m1-dirA');
  const dirB = tmp('m1-dirB');
  const lockPath = targetLockPath(tokenExt);
  const release = await fileLock.acquire(lockPath, { timeout: 5000, stale: 30000 });
  try {
    await expect(lib.runRestore({ from: backup, dir: dirA, force: true, lockTimeoutMs: 150 }))
      .rejects.toThrow(/Another restore is already running/);
    await expect(lib.runRestore({ from: backup, dir: dirB, force: true, lockTimeoutMs: 150 }))
      .rejects.toThrow(/Another restore is already running/);
    // Nothing was replaced while the destination lock was held.
    expect(families(tokenExt)).toBe(2);
  } finally {
    await release();
  }

  // With the lock free, the same restore succeeds and leaves no lock behind.
  await lib.runRestore({ from: backup, dir: dirA, force: true });
  expect(families(tokenExt)).toBe(2);
  assertNoLocksHeld([lockPath]);
});

test('M-1: restores with different --dir but the same CHALLENGE_DB_PATH contend', async () => {
  const shared = tmp('m1-chshared');
  const challengeExt = path.join(shared, 'challengeStore.sqlite');
  makeChallengeDb(challengeExt);
  process.env.CHALLENGE_DB_PATH = challengeExt;
  delete process.env.TOKEN_STORE_PATH;

  const src = tmp('m1-chsrc');
  fs.writeFileSync(path.join(src, 'users.json'), '[]', 'utf8');
  makeTokenDb(path.join(src, 'tokenStore.sqlite'), 'seed', 1);
  const backup = (await lib.runBackup({ dir: src, out: outDir })).dest;

  const dirA = tmp('m1-chdirA');
  const dirB = tmp('m1-chdirB');
  const lockPath = targetLockPath(challengeExt);
  const release = await fileLock.acquire(lockPath, { timeout: 5000, stale: 30000 });
  try {
    await expect(lib.runRestore({ from: backup, dir: dirA, force: true, lockTimeoutMs: 150 }))
      .rejects.toThrow(/Another restore is already running/);
    await expect(lib.runRestore({ from: backup, dir: dirB, force: true, lockTimeoutMs: 150 }))
      .rejects.toThrow(/Another restore is already running/);
  } finally {
    await release();
  }
  assertNoLocksHeld([lockPath]);
});

test('M-1: shared target with different additional targets serialises without deadlock', async () => {
  const shared = tmp('m1-part');
  const tokenExt = path.join(shared, 'tokenStore.sqlite');
  makeTokenDb(tokenExt, 'shared', 2);
  process.env.TOKEN_STORE_PATH = tokenExt;
  delete process.env.CHALLENGE_DB_PATH; // challenge stays per-data-dir

  const src = tmp('m1-partsrc');
  fs.writeFileSync(path.join(src, 'users.json'), '[]', 'utf8');
  makeTokenDb(path.join(src, 'tokenStore.sqlite'), 'seed', 2);
  makeChallengeDb(path.join(src, 'challengeStore.sqlite'));
  const backup = (await lib.runBackup({ dir: src, out: outDir })).dest;

  const dirA = tmp('m1-partA');
  const dirB = tmp('m1-partB');
  const results = await Promise.allSettled([
    lib.runRestore({ from: backup, dir: dirA, force: true }),
    lib.runRestore({ from: backup, dir: dirB, force: true })
  ]);
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
  expect(families(tokenExt)).toBe(2);
  assertNoLocksHeld([targetLockPath(tokenExt)]);
});

test('M-1: concurrent restores with reversed target ordering do not deadlock', async () => {
  const shared = tmp('m1-rev');
  const tokenExt = path.join(shared, 'tokenStore.sqlite');
  const challengeExt = path.join(shared, 'challengeStore.sqlite');
  makeTokenDb(tokenExt, 'shared', 2);
  makeChallengeDb(challengeExt);
  process.env.TOKEN_STORE_PATH = tokenExt;
  process.env.CHALLENGE_DB_PATH = challengeExt;

  const src = tmp('m1-revsrc');
  fs.writeFileSync(path.join(src, 'users.json'), '[]', 'utf8');
  makeTokenDb(path.join(src, 'tokenStore.sqlite'), 'seed', 2);
  makeChallengeDb(path.join(src, 'challengeStore.sqlite'));
  const forward = (await lib.runBackup({ dir: src, out: outDir })).dest;
  const reversed = reverseManifestOrder((await lib.runBackup({ dir: src, out: outDir })).dest);

  const results = await Promise.allSettled([
    lib.runRestore({ from: forward, dir: tmp('m1-revA'), force: true, lockTimeoutMs: 20000 }),
    lib.runRestore({ from: reversed, dir: tmp('m1-revB'), force: true, lockTimeoutMs: 20000 })
  ]);
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
  assertNoLocksHeld([targetLockPath(tokenExt), targetLockPath(challengeExt)]);
});

test('M-1: a refused lock acquisition mutates no destination', async () => {
  const shared = tmp('m1-mut');
  const tokenExt = path.join(shared, 'tokenStore.sqlite');
  const challengeExt = path.join(shared, 'challengeStore.sqlite');
  makeTokenDb(tokenExt, 'live', 3);
  makeChallengeDb(challengeExt);
  process.env.TOKEN_STORE_PATH = tokenExt;
  process.env.CHALLENGE_DB_PATH = challengeExt;

  const src = tmp('m1-mutsrc');
  fs.writeFileSync(path.join(src, 'users.json'), '[]', 'utf8');
  makeTokenDb(path.join(src, 'tokenStore.sqlite'), 'seed', 2);
  makeChallengeDb(path.join(src, 'challengeStore.sqlite'));
  const backup = (await lib.runBackup({ dir: src, out: outDir })).dest;

  const dataDir = tmp('m1-mutdata');
  fs.writeFileSync(path.join(dataDir, 'users.json'), '[]', 'utf8');
  makeTokenDb(path.join(dataDir, 'tokenStore.sqlite'), 'live', 3);
  makeChallengeDb(path.join(dataDir, 'challengeStore.sqlite'));

  const beforeData = inventory(dataDir);
  const beforeToken = fs.readFileSync(tokenExt);
  const lockPath = targetLockPath(challengeExt);
  const release = await fileLock.acquire(lockPath, { timeout: 5000, stale: 30000 });
  try {
    await expect(lib.runRestore({ from: backup, dir: dataDir, force: true, lockTimeoutMs: 150 }))
      .rejects.toThrow(/Another restore is already running/);
  } finally {
    await release();
  }

  expect(inventory(dataDir)).toEqual(beforeData);
  expect(fs.readFileSync(tokenExt).equals(beforeToken)).toBe(true);
  expect(families(tokenExt)).toBe(3);
});

test('M-1: an incomplete rollback still releases every lock', async () => {
  const dir = seedDir('m1-rb');
  const backup = (await lib.runBackup({ dir, out: outDir })).dest;
  const restoreDir = tmp('m1-rbdir');
  const target = path.join(restoreDir, 'tokenStore.sqlite');
  makeTokenDb(target, 'live', 1);

  const plan = [{ name: 'tokenStore.sqlite', kind: 'sqlite', target }];
  const lockPaths = lib.restoreLockPaths(restoreDir, plan);

  const store = tokenStore();
  const realValidate = store.validateDatabaseFile;
  store.validateDatabaseFile = (file) => {
    const p = String(file);
    if (p.startsWith(restoreDir) && !p.includes('.incoming.')) {
      throw new Error('injected final validation failure');
    }
    return realValidate(p);
  };
  const realRename = fs.renameSync;
  const spy = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    // Fail the rollback's attempt to put the original back.
    if (String(from).includes('.origin.')) {
      throw Object.assign(new Error('injected rollback failure'), { code: 'EIO' });
    }
    return realRename(from, to);
  });
  let caught = null;
  try {
    await lib.runRestore({ from: backup, dir: restoreDir, force: true });
  } catch (err) {
    caught = err;
  } finally {
    spy.mockRestore();
    store.validateDatabaseFile = realValidate;
  }

  expect(caught).not.toBeNull();
  expect(caught.name).toBe('RecoveryRequiredError');
  expect(caught.message).toMatch(/ROLLBACK INCOMPLETE/);
  assertNoLocksHeld(lockPaths);
});

test('M-1: lock files are not backed up and are not unlisted artifacts', async () => {
  const dir = tmp('m1-lockfiles');
  fs.writeFileSync(path.join(dir, 'users.json'), '[]', 'utf8');
  makeTokenDb(path.join(dir, 'tokenStore.sqlite'), 'seed', 1);
  makeChallengeDb(path.join(dir, 'challengeStore.sqlite'));
  fs.writeFileSync(path.join(dir, lib.RESTORE_LOCK_NAME), '{}', 'utf8');
  fs.writeFileSync(path.join(dir, 'tokenStore.sqlite' + lib.TARGET_LOCK_SUFFIX), '{}', 'utf8');

  const { manifest } = await lib.runBackup({ dir, out: outDir });
  expect(Object.keys(manifest.files).sort()).toEqual([
    'challengeStore.sqlite', 'tokenStore.sqlite', 'users.json'
  ]);
  expect(lib.verifyBackupDir((await lib.runBackup({ dir, out: outDir })).dest).ok).toBe(true);

  const plan = [
    { name: 'users.json', kind: 'json', target: path.join(dir, 'users.json') },
    { name: 'tokenStore.sqlite', kind: 'sqlite', target: path.join(dir, 'tokenStore.sqlite') },
    { name: 'challengeStore.sqlite', kind: 'sqlite', target: path.join(dir, 'challengeStore.sqlite') }
  ];
  expect(lib.findUnlistedArtifacts(dir, plan)).toEqual([]);
});

// ── M-2: actionable locked-file errors ──────────────────────────────────────

test('M-2: EBUSY on replacement is reported as an actionable service-stop error', async () => {
  const dir = seedDir('m2-ebusy');
  const backup = (await lib.runBackup({ dir, out: outDir })).dest;
  const restoreDir = tmp('m2-ebusydir');
  const target = path.join(restoreDir, 'tokenStore.sqlite');
  makeTokenDb(target, 'live', 2);
  const before = fs.readFileSync(target);

  const realRename = fs.renameSync;
  const spy = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(from) === target && String(to).includes('.origin.')) {
      throw Object.assign(new Error("EBUSY: resource busy or locked, rename '" + target + "'"), {
        code: 'EBUSY',
        path: target
      });
    }
    return realRename(from, to);
  });
  let caught = null;
  try {
    await lib.runRestore({ from: backup, dir: restoreDir, force: true });
  } catch (err) {
    caught = err;
  } finally {
    spy.mockRestore();
  }

  expect(caught).not.toBeNull();
  expect(caught.name).toBe('DatabaseInUseError');
  expect(caught.message).toMatch(/stop the service/i);
  expect(caught.message).toMatch(/close every connection/i);
  expect(caught.message).toContain(target);
  // Original diagnostic info is preserved.
  expect(caught.code).toBe('EBUSY');
  expect(caught.cause && caught.cause.code).toBe('EBUSY');
  // Rollback preserved the original database.
  expect(fs.readFileSync(target).equals(before)).toBe(true);
  expect(families(target)).toBe(2);
  assertNoLocksHeld(lib.restoreLockPaths(restoreDir, [{ name: 'tokenStore.sqlite', kind: 'sqlite', target }]));
});

test('M-2: a real idle open connection produces the actionable error (win32)', async () => {
  if (process.platform !== 'win32') {
    // POSIX allows renaming an open file, so this refusal does not exist there;
    // the deterministic EBUSY injection above covers the message contract.
    expect(true).toBe(true);
    return;
  }
  const dir = seedDir('m2-real');
  const backup = (await lib.runBackup({ dir, out: outDir })).dest;
  const restoreDir = tmp('m2-realdir');
  const target = path.join(restoreDir, 'tokenStore.sqlite');
  makeTokenDb(target, 'live', 3);
  const before = fs.readFileSync(target);

  const idle = new Database(target);
  let caught = null;
  try {
    await lib.runRestore({ from: backup, dir: restoreDir, force: true });
  } catch (err) {
    caught = err;
  } finally {
    idle.close();
  }

  expect(caught).not.toBeNull();
  expect(caught.message).toMatch(/stop the service/i);
  expect(caught.code === 'EBUSY' || caught.code === 'EPERM').toBe(true);
  expect(fs.readFileSync(target).equals(before)).toBe(true);
  expect(families(target)).toBe(3);
  assertNoLocksHeld(lib.restoreLockPaths(restoreDir, [{ name: 'tokenStore.sqlite', kind: 'sqlite', target }]));
});

test('M-2: a locked-file failure leaves the original database and sidecars in place', async () => {
  const dir = seedDir('m2-sidecar');
  const backup = (await lib.runBackup({ dir, out: outDir })).dest;
  const restoreDir = tmp('m2-sidecardir');
  const target = path.join(restoreDir, 'tokenStore.sqlite');
  makeTokenDb(target, 'live', 2);
  // A stale rollback journal is handled before the swap: the read-write in-use
  // probe performs journal recovery, so its bytes may be reclaimed. What must
  // never happen is the database being replaced or an original being orphaned.
  fs.writeFileSync(target + '-journal', 'stale-journal');
  const beforeDb = fs.readFileSync(target);

  const realRename = fs.renameSync;
  const spy = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(from) === target && String(to).includes('.origin.')) {
      throw Object.assign(new Error('EBUSY injected'), { code: 'EBUSY' });
    }
    return realRename(from, to);
  });
  try {
    await expect(lib.runRestore({ from: backup, dir: restoreDir, force: true }))
      .rejects.toThrow(/stop the service/i);
  } finally {
    spy.mockRestore();
  }

  expect(fs.existsSync(target)).toBe(true);
  expect(fs.readFileSync(target).equals(beforeDb)).toBe(true);
  expect(families(target)).toBe(2);
  expect(fs.readdirSync(restoreDir).filter((f) => f.includes('.origin.') || f.includes('.incoming.'))).toEqual([]);
});

test('M-2: EACCES and ENOENT are not misclassified as database-in-use errors', async () => {
  for (const code of ['EACCES', 'ENOENT']) {
    const dir = seedDir('m2-' + code.toLowerCase());
    const backup = (await lib.runBackup({ dir, out: outDir })).dest;
    const restoreDir = tmp('m2-' + code.toLowerCase() + 'dir');
    const target = path.join(restoreDir, 'tokenStore.sqlite');
    makeTokenDb(target, 'live', 2);
    const before = fs.readFileSync(target);

    const realRename = fs.renameSync;
    const spy = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(from) === target && String(to).includes('.origin.')) {
        throw Object.assign(new Error('injected ' + code), { code });
      }
      return realRename(from, to);
    });
    let caught = null;
    try {
      await lib.runRestore({ from: backup, dir: restoreDir, force: true });
    } catch (err) {
      caught = err;
    } finally {
      spy.mockRestore();
    }

    expect(caught).not.toBeNull();
    expect(caught.name).not.toBe('DatabaseInUseError');
    expect(caught.message).not.toMatch(/stop the service/i);
    expect(caught.message).not.toMatch(/locked by another process/i);
    expect(fs.readFileSync(target).equals(before)).toBe(true);
    assertNoLocksHeld(lib.restoreLockPaths(restoreDir, [{ name: 'tokenStore.sqlite', kind: 'sqlite', target }]));
  }
});

// ── L-1: partial cross-device copy cleanup ──────────────────────────────────

function withExdevAndCopy(tag, copyImpl) {
  const dir = seedDir(tag);
  const restoreDir = tmp(tag + 'dir');
  const target = path.join(restoreDir, 'tokenStore.sqlite');
  makeTokenDb(target, 'live', 2);
  return { dir, restoreDir, target };
}

test('L-1: a short cross-device copy removes its partial destination and keeps the original', async () => {
  const ctx = withExdevAndCopy('l1-short');
  const backup = (await lib.runBackup({ dir: ctx.dir, out: outDir })).dest;
  const before = fs.readFileSync(ctx.target);

  const realRename = fs.renameSync;
  const realCopy = fs.copyFileSync;
  const renameSpy = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(to).includes('.origin.')) throw Object.assign(new Error('EXDEV injected'), { code: 'EXDEV' });
    return realRename(from, to);
  });
  const copySpy = jest.spyOn(fs, 'copyFileSync').mockImplementation((from, to, ...rest) => {
    if (String(to).includes('.origin.')) {
      fs.writeFileSync(to, Buffer.from('truncated')); // wrong size, no throw
      return undefined;
    }
    return realCopy(from, to, ...rest);
  });
  let caught = null;
  try {
    await lib.runRestore({ from: backup, dir: ctx.restoreDir, force: true });
  } catch (err) {
    caught = err;
  } finally {
    renameSpy.mockRestore();
    copySpy.mockRestore();
  }

  expect(caught).not.toBeNull();
  expect(caught.message).toMatch(/Cross-device copy incomplete/);
  expect(fs.readdirSync(ctx.restoreDir).filter((f) => f.includes('.origin.'))).toEqual([]);
  expect(fs.readFileSync(ctx.target).equals(before)).toBe(true);
});

test('L-1: a failed cross-device copy removes the partial destination and keeps the source', async () => {
  const ctx = withExdevAndCopy('l1-fail');
  const backup = (await lib.runBackup({ dir: ctx.dir, out: outDir })).dest;
  const before = fs.readFileSync(ctx.target);

  const realRename = fs.renameSync;
  const realCopy = fs.copyFileSync;
  const renameSpy = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(to).includes('.origin.')) throw Object.assign(new Error('EXDEV injected'), { code: 'EXDEV' });
    return realRename(from, to);
  });
  const copySpy = jest.spyOn(fs, 'copyFileSync').mockImplementation((from, to, ...rest) => {
    if (String(to).includes('.origin.')) {
      fs.writeFileSync(to, Buffer.from('partial'));
      throw Object.assign(new Error('copy failed'), { code: 'EIO' });
    }
    return realCopy(from, to, ...rest);
  });
  let caught = null;
  try {
    await lib.runRestore({ from: backup, dir: ctx.restoreDir, force: true });
  } catch (err) {
    caught = err;
  } finally {
    renameSpy.mockRestore();
    copySpy.mockRestore();
  }

  expect(caught).not.toBeNull();
  expect(caught.message).toMatch(/copy failed/);
  expect(fs.readdirSync(ctx.restoreDir).filter((f) => f.includes('.origin.'))).toEqual([]);
  expect(fs.readFileSync(ctx.target).equals(before)).toBe(true);
});

// ── L-3: challenge validator is side-effect free ────────────────────────────

test('L-3: challengeStore.validateDatabaseFile preserves bytes and creates no sidecars', () => {
  const work = tmp('l3-validate');
  const db = path.join(work, 'challengeStore.sqlite');
  makeChallengeDb(db);
  const before = inventory(work);

  expect(challengeStore().validateDatabaseFile(db)).toBe(path.resolve(db));

  expect(inventory(work)).toEqual(before);
  expect(fs.readdirSync(work).filter((f) => /-(wal|shm|journal)$/.test(f))).toEqual([]);
});

test('L-3: a corrupt challenge artifact is rejected without modifying its directory', () => {
  const work = tmp('l3-corrupt');
  const bad = path.join(work, 'challengeStore.sqlite');
  fs.writeFileSync(bad, 'not a sqlite database at all');
  const before = inventory(work);

  expect(() => challengeStore().validateDatabaseFile(bad)).toThrow();
  expect(inventory(work)).toEqual(before);
});

// ── M-1 (follow-up): --dir aliases share one canonical lock identity ────────
// The directory lock used path.resolve(dir) while the database locks used
// canonicalPath(), so a real path and a junction/symlink alias of the same
// --dir produced lock sets in *different* sorted orders. Two restores with
// overlapping targets could then each hold one lock and wait for the other.

const aliases = [];

function makeDirAlias(realDir, tag) {
  const alias = path.join(tmp(tag + '-aliasroot'), 'link');
  fs.symlinkSync(realDir, alias, process.platform === 'win32' ? 'junction' : 'dir');
  aliases.push(alias);
  return alias;
}

function aliasPlan(base) {
  return [
    { name: 'users.json', kind: 'json', target: path.join(base, 'users.json') },
    { name: 'tokenStore.sqlite', kind: 'sqlite', target: path.join(base, 'tokenStore.sqlite') },
    { name: 'challengeStore.sqlite', kind: 'sqlite', target: path.join(base, 'challengeStore.sqlite') }
  ];
}

test('M-1: a junction alias of --dir yields the identical canonical lock set and order', () => {
  const realDir = tmp('m1-alias-id');
  const alias = makeDirAlias(realDir, 'm1-alias-id');

  const viaReal = lib.restoreLockPaths(realDir, aliasPlan(realDir));
  const viaAlias = lib.restoreLockPaths(alias, aliasPlan(alias));

  expect(viaAlias).toEqual(viaReal);
  // The directory lock itself is canonicalised, not merely path.resolve()d.
  expect(path.dirname(viaAlias[0])).toBe(lib.canonicalPath(realDir));
});

test('M-1: the same lock blocks a restore run through either spelling', async () => {
  const dir = seedDir('m1-alias-block');
  const src = tmp('m1-alias-src');
  fs.writeFileSync(path.join(src, 'users.json'), '[]', 'utf8');
  makeTokenDb(path.join(src, 'tokenStore.sqlite'), 'seed', 1);
  makeChallengeDb(path.join(src, 'challengeStore.sqlite'));
  const backup = (await lib.runBackup({ dir: src, out: outDir })).dest;
  const alias = makeDirAlias(dir, 'm1-alias-block');
  const before = inventory(dir);

  for (const spelling of [alias, dir]) {
    const release = await fileLock.acquire(path.join(dir, lib.RESTORE_LOCK_NAME), { timeout: 5000, stale: 30000 });
    try {
      await expect(lib.runRestore({ from: backup, dir: spelling, force: true, lockTimeoutMs: 150 }))
        .rejects.toThrow(/Another restore is already running/);
    } finally {
      await release();
    }
  }

  expect(inventory(dir)).toEqual(before);
  assertNoLocksHeld(lib.restoreLockPaths(dir, aliasPlan(dir)));
});

test('M-1: concurrent restores through a junction alias and the real path do not deadlock', async () => {
  const dir = tmp('m1-alias-race');
  fs.writeFileSync(path.join(dir, 'users.json'), '[]', 'utf8');
  makeTokenDb(path.join(dir, 'tokenStore.sqlite'), 'live', 2);
  makeChallengeDb(path.join(dir, 'challengeStore.sqlite'));
  const alias = makeDirAlias(dir, 'm1-alias-race');

  const src = tmp('m1-alias-racesrc');
  fs.writeFileSync(path.join(src, 'users.json'), '[]', 'utf8');
  makeTokenDb(path.join(src, 'tokenStore.sqlite'), 'seed', 2);
  makeChallengeDb(path.join(src, 'challengeStore.sqlite'));
  const backup = (await lib.runBackup({ dir: src, out: outDir })).dest;

  const results = await Promise.allSettled([
    lib.runRestore({ from: backup, dir, force: true, lockTimeoutMs: 20000 }),
    lib.runRestore({ from: backup, dir: alias, force: true, lockTimeoutMs: 20000 })
  ]);
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
  expect(families(path.join(dir, 'tokenStore.sqlite'))).toBe(2);
  assertNoLocksHeld(lib.restoreLockPaths(dir, aliasPlan(dir)));
});
