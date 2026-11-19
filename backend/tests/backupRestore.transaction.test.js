'use strict';

// P6 F4/F5 — F1 / F2 / F3 / F4 regression coverage.
//
// Drives scripts/lib/backupRestore.js and utils/sqliteSnapshot.js directly:
// no child processes, no server, no ports. Every database lives in a temp
// directory; backend/data is never touched.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { makeTempDataDir } = require('./helpers/testData');

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

function makeTokenDb(file, marker, familyCount) {
  const count = familyCount === undefined ? 1 : familyCount;
  const store = tokenStore();
  store.initialise(file);
  try {
    for (let i = 0; i < count; i++) {
      const fam = store.createSessionFamily(marker + '-' + i, 'tenant-x');
      store.issueRefreshToken('jti-' + marker + '-' + i, {
        familyId: fam.familyId,
        sub: marker + '-' + i,
        ver: 0,
        tenantId: 'tenant-x',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 600000
      });
    }
  } finally {
    store.closeDb();
  }
  return file;
}

function makeChallengeDb(file) {
  const cs = challengeStore();
  const { db } = cs.initialise(file);
  try {
    cs.persistChallenge(db, { token: 'challenge-token-1', sub: 'user-1', purpose: 'mfa', ttlMs: 60000 });
  } finally {
    cs.closeDb(db);
  }
  return file;
}

function families(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try { return db.prepare('SELECT COUNT(*) c FROM session_families').get().c; }
  finally { db.close(); }
}

function challenges(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try { return db.prepare('SELECT COUNT(*) c FROM challenges').get().c; }
  finally { db.close(); }
}

function seedDataDir() {
  const dir = tmp('tx-seed');
  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify([{ id: 'u1' }]), 'utf8');
  makeTokenDb(path.join(dir, 'tokenStore.sqlite'), 'user-1');
  makeChallengeDb(path.join(dir, 'challengeStore.sqlite'));
  return dir;
}

function seedTwoJsonDir() {
  const dir = tmp('tx-seed2');
  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify([{ id: 'u1' }]), 'utf8');
  fs.writeFileSync(path.join(dir, 'products.json'), JSON.stringify([{ id: 'p1' }]), 'utf8');
  makeTokenDb(path.join(dir, 'tokenStore.sqlite'), 'tx');
  makeChallengeDb(path.join(dir, 'challengeStore.sqlite'));
  return dir;
}

let outDir;

beforeAll(() => {
  outDir = tmp('tx-out');
});

afterEach(() => {
  // No configured path may leak between tests.
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

// ── F2: authoritative configured paths ──────────────────────────────────────

test('F2: backup and restore address the physical databases named by TOKEN_STORE_PATH and CHALLENGE_DB_PATH', async () => {
  const ext = tmp('tx-ext');
  const tokenExt = path.join(ext, 'tokenStore.sqlite');
  const challengeExt = path.join(ext, 'challengeStore.sqlite');
  makeTokenDb(tokenExt, 'ext', 2);
  makeChallengeDb(challengeExt);

  process.env.TOKEN_STORE_PATH = tokenExt;
  process.env.CHALLENGE_DB_PATH = challengeExt;

  const srcDir = tmp('tx-extdata');
  fs.writeFileSync(path.join(srcDir, 'users.json'), JSON.stringify([{ id: 'u1' }]), 'utf8');

  const { dest, manifest } = await lib.runBackup({ dir: srcDir, out: outDir });
  expect(Object.keys(manifest.files)).toEqual(
    expect.arrayContaining(['users.json', 'tokenStore.sqlite', 'challengeStore.sqlite'])
  );
  expect(manifest.databases.tokenStore.source).toBe(tokenExt);
  expect(manifest.databases.challengeStore.source).toBe(challengeExt);
  expect(lib.verifyBackupDir(dest).ok).toBe(true);

  // Replace the live databases with different state.
  fs.rmSync(tokenExt);
  makeTokenDb(tokenExt, 'other', 1);
  fs.rmSync(challengeExt);
  const emptied = challengeStore().initialise(challengeExt);
  challengeStore().closeDb(emptied.db);
  expect(families(tokenExt)).toBe(1);
  expect(challenges(challengeExt)).toBe(0);

  const restoreDir = tmp('tx-extrestore');
  await lib.runRestore({ from: dest, dir: restoreDir, force: true });

  // Restore wrote back to the same physical files the backup read.
  expect(families(tokenExt)).toBe(2);
  expect(challenges(challengeExt)).toBe(1);
  expect(fs.existsSync(path.join(restoreDir, 'tokenStore.sqlite'))).toBe(false);
  expect(fs.existsSync(path.join(restoreDir, 'challengeStore.sqlite'))).toBe(false);
});

test('F2: a configured-but-missing token database fails the backup closed (not "not_present")', async () => {
  const dir = seedDataDir();
  process.env.TOKEN_STORE_PATH = path.join(tmp('tx-missing'), 'absent-token-store.sqlite');
  await expect(lib.runBackup({ dir, out: outDir })).rejects.toThrow(
    /configured token database is missing/i
  );
});

test('F2: a configured-but-missing challenge database fails the backup', async () => {
  const dir = seedDataDir();
  process.env.CHALLENGE_DB_PATH = path.join(tmp('tx-missing2'), 'absent-challenge.sqlite');
  await expect(lib.runBackup({ dir, out: outDir })).rejects.toThrow(
    /configured challenge database is missing/i
  );
});

// ── F4: atomic unique backup directories ────────────────────────────────────

test('F4: concurrent backups never share or overwrite a destination directory', async () => {
  const dir = seedDataDir();
  const fixed = Date.now();
  const results = await Promise.all(
    Array.from({ length: 5 }, () => lib.runBackup({ dir, out: outDir, now: fixed }))
  );

  const dests = results.map((r) => r.dest);
  expect(new Set(dests).size).toBe(5);
  for (const dest of dests) {
    expect(fs.existsSync(path.join(dest, 'manifest.json'))).toBe(true);
    expect(lib.verifyBackupDir(dest).ok).toBe(true);
  }
});

// ── F1: rollback / sidecar failure reporting ────────────────────────────────

test('F1/F6: a sidecar move failure is surfaced and the original database survives', async () => {
  const work = tmp('tx-sidecar');
  const source = makeTokenDb(path.join(work, 'source.sqlite'), 'original');
  const backup = path.join(work, 'backup.sqlite');
  const target = path.join(work, 'target.sqlite');
  fs.copyFileSync(source, target);
  await tokenStore().backupDatabase(source, backup);

  // A stale rollback journal must move with its database. The primitive is
  // invoked with requireStopped:false so the read-write in-use probe does not
  // perform journal recovery and consume the journal before the move.
  fs.writeFileSync(target + '-journal', 'stale-journal');
  const originalBytes = fs.readFileSync(target);
  const originalJournal = fs.readFileSync(target + '-journal');

  const realRename = fs.renameSync;
  const spy = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(from) === target + '-journal') {
      throw Object.assign(new Error('injected sidecar move failure'), { code: 'EACCES' });
    }
    return realRename(from, to);
  });
  try {
    await expect(
      sqliteSnapshot.restoreSqlite(backup, target, { requireStopped: false })
    ).rejects.toThrow(/injected sidecar/i);
  } finally {
    spy.mockRestore();
  }

  expect(fs.readFileSync(target).equals(originalBytes)).toBe(true);
  expect(fs.existsSync(target + '-journal')).toBe(true);
  expect(fs.readFileSync(target + '-journal').equals(originalJournal)).toBe(true);
  const leftovers = fs.readdirSync(work).filter((f) => f.includes('.rollback.') || f.includes('.restore.'));
  expect(leftovers).toEqual([]);
});

test('F6: a stale -journal in the destination never survives a CLI restore as a stray', async () => {
  const dir = seedDataDir();
  const { dest } = await lib.runBackup({ dir, out: outDir });
  const restoreDir = tmp('tx-journal');
  const target = path.join(restoreDir, 'tokenStore.sqlite');
  makeTokenDb(target, 'original');
  fs.writeFileSync(target + '-journal', 'stale-journal');

  await lib.runRestore({ from: dest, dir: restoreDir, force: true });

  // Either the journal was reclaimed by the writer probe or moved aside with
  // its original; the stale content must never sit beside the restored file.
  const stray = target + '-journal';
  if (fs.existsSync(stray)) {
    expect(fs.readFileSync(stray, 'utf8')).not.toBe('stale-journal');
  }
  const residue = fs.readdirSync(restoreDir).filter((f) => f.includes('.origin.') || f.includes('.incoming.'));
  expect(residue).toEqual([]);
});


test('F1: a failed rollback surfaces the original error AND every recovery error', async () => {
  const work = tmp('tx-rollback');
  const source = makeTokenDb(path.join(work, 'source.sqlite'), 'original');
  const backup = path.join(work, 'backup.sqlite');
  const target = path.join(work, 'target.sqlite');
  fs.copyFileSync(source, target);
  await tokenStore().backupDatabase(source, backup);

  const realRename = fs.renameSync;
  const spy = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(to) === target && String(from).includes('.restore.')) {
      throw Object.assign(new Error('injected swap failure'), { code: 'EIO' });
    }
    if (String(from).includes('.rollback.')) {
      throw Object.assign(new Error('injected rollback failure'), { code: 'EIO' });
    }
    return realRename(from, to);
  });

  let caught = null;
  try {
    await sqliteSnapshot.restoreSqlite(backup, target);
  } catch (err) {
    caught = err;
  } finally {
    spy.mockRestore();
  }

  expect(caught).not.toBeNull();
  expect(caught.name).toBe('RecoveryRequiredError');
  expect(caught.recoveryRequired).toBe(true);
  expect(caught.message).toMatch(/ROLLBACK INCOMPLETE/);
  expect(caught.message).toMatch(/injected swap failure/);
  expect(caught.message).toMatch(/injected rollback failure/);
  expect(caught.rollbackFailures.length).toBeGreaterThan(0);
  expect(String(caught.originalError && caught.originalError.message)).toMatch(/injected swap/);

  // The original was preserved on disk under a rollback name, exactly as the
  // error claims, and it was not silently deleted.
  const preserved = fs.readdirSync(work).filter((f) => f.includes('target.sqlite.rollback.'));
  expect(preserved.length).toBeGreaterThan(0);
});

test('F1: restore refuses to replace a database an active writer holds', async () => {
  const dir = seedDataDir();
  const { dest } = await lib.runBackup({ dir, out: outDir });
  const restoreDir = tmp('tx-inuse');
  const target = path.join(restoreDir, 'tokenStore.sqlite');
  makeTokenDb(target, 'held');
  const before = families(target);

  const blocker = new Database(target);
  blocker.exec('BEGIN IMMEDIATE');
  try {
    await expect(lib.runRestore({ from: dest, dir: restoreDir, force: true })).rejects.toThrow(
      /in use|busy/i
    );
  } finally {
    try { blocker.exec('ROLLBACK'); } catch (_) {}
    blocker.close();
  }
  expect(families(target)).toBe(before);
});

// ── F3: staged multi-file restore recovery ──────────────────────────────────

test('F3: failure on the second JSON replacement rolls the first JSON back', async () => {
  const dir = seedTwoJsonDir();
  const { dest } = await lib.runBackup({ dir, out: outDir });

  const restoreDir = tmp('tx-json');
  const originalUsers = JSON.stringify([{ id: 'pre-existing' }]);
  fs.writeFileSync(path.join(restoreDir, 'users.json'), originalUsers, 'utf8');
  fs.writeFileSync(path.join(restoreDir, 'products.json'), '[]', 'utf8');

  const realRename = fs.renameSync;
  const spy = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(from).includes('.incoming.') && String(from).includes('products.json')) {
      throw Object.assign(new Error('injected second-JSON failure'), { code: 'EIO' });
    }
    return realRename(from, to);
  });
  try {
    await expect(lib.runRestore({ from: dest, dir: restoreDir, force: true })).rejects.toThrow(
      /second-JSON|rolled back/i
    );
  } finally {
    spy.mockRestore();
  }

  expect(fs.readFileSync(path.join(restoreDir, 'users.json'), 'utf8')).toBe(originalUsers);
  expect(fs.readFileSync(path.join(restoreDir, 'products.json'), 'utf8')).toBe('[]');
  expect(
    fs.readdirSync(restoreDir).filter((f) => f.includes('.incoming.') || f.includes('.origin.'))
  ).toEqual([]);
});

test('F3: token database replaced, then challenge failure, rolls BOTH databases back', async () => {
  const dir = seedTwoJsonDir();
  const { dest } = await lib.runBackup({ dir, out: outDir });

  const restoreDir = tmp('tx-sqlite');
  const tokenTarget = path.join(restoreDir, 'tokenStore.sqlite');
  makeTokenDb(tokenTarget, 'pre', 3);
  const before = families(tokenTarget);

  const realRename = fs.renameSync;
  const spy = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(from).includes('.incoming.') && String(from).includes('challengeStore.sqlite')) {
      throw Object.assign(new Error('injected challenge replacement failure'), { code: 'EIO' });
    }
    return realRename(from, to);
  });
  try {
    await expect(lib.runRestore({ from: dest, dir: restoreDir, force: true })).rejects.toThrow(
      /challenge replacement|rolled back/i
    );
  } finally {
    spy.mockRestore();
  }

  expect(tokenStore().validateDatabaseFile(tokenTarget)).toBe(tokenTarget);
  expect(families(tokenTarget)).toBe(before);
  expect(fs.existsSync(path.join(restoreDir, 'challengeStore.sqlite'))).toBe(false);
});

test('F3: final validation failure after all replacements rolls everything back', async () => {
  const dir = seedTwoJsonDir();
  const { dest } = await lib.runBackup({ dir, out: outDir });

  const restoreDir = tmp('tx-final');
  const originalUsers = JSON.stringify([{ id: 'keep-me' }]);
  fs.writeFileSync(path.join(restoreDir, 'users.json'), originalUsers, 'utf8');
  const tokenTarget = path.join(restoreDir, 'tokenStore.sqlite');
  makeTokenDb(tokenTarget, 'keep', 2);
  const before = families(tokenTarget);

  const store = tokenStore();
  const realValidate = store.validateDatabaseFile;
  store.validateDatabaseFile = (file) => {
    const p = String(file);
    // Fail only for the installed target, not for the incoming copy.
    if (p.startsWith(restoreDir) && !p.includes('.incoming.')) {
      throw new Error('injected final validation failure');
    }
    return realValidate(p);
  };
  try {
    await expect(lib.runRestore({ from: dest, dir: restoreDir, force: true })).rejects.toThrow(
      /Final validation failed/i
    );
  } finally {
    store.validateDatabaseFile = realValidate;
  }

  expect(fs.readFileSync(path.join(restoreDir, 'users.json'), 'utf8')).toBe(originalUsers);
  expect(families(tokenTarget)).toBe(before);
  expect(fs.existsSync(path.join(restoreDir, 'challengeStore.sqlite'))).toBe(false);
});

test('F3: a target that did not exist before is deleted when the operation fails', async () => {
  const dir = seedTwoJsonDir();
  const { dest } = await lib.runBackup({ dir, out: outDir });
  const restoreDir = tmp('tx-new');
  fs.writeFileSync(path.join(restoreDir, 'users.json'), '[]', 'utf8');

  const realRename = fs.renameSync;
  const spy = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(from).includes('.incoming.') && String(from).includes('products.json')) {
      throw Object.assign(new Error('injected failure before products'), { code: 'EIO' });
    }
    return realRename(from, to);
  });
  try {
    await expect(lib.runRestore({ from: dest, dir: restoreDir, force: true })).rejects.toThrow();
  } finally {
    spy.mockRestore();
  }

  expect(fs.existsSync(path.join(restoreDir, 'tokenStore.sqlite'))).toBe(false);
  expect(fs.existsSync(path.join(restoreDir, 'challengeStore.sqlite'))).toBe(false);
});

// ── F3: crash recovery is NOT claimed ───────────────────────────────────────

test('F3: a successful restore leaves no staging, incoming, origin or lock files behind', async () => {
  const dir = seedDataDir();
  const { dest } = await lib.runBackup({ dir, out: outDir });
  const restoreDir = tmp('tx-clean');
  const result = await lib.runRestore({ from: dest, dir: restoreDir });
  expect(result.restored).toBe(3);
  const residue = fs.readdirSync(restoreDir).filter(
    (f) => f.startsWith(lib.STAGING_PREFIX) || f.includes('.incoming.') || f.includes('.origin.') || f === lib.RESTORE_LOCK_NAME
  );
  expect(residue).toEqual([]);
  expect(fs.existsSync(path.join(restoreDir, 'tokenStore.sqlite'))).toBe(true);
  expect(fs.existsSync(path.join(restoreDir, 'challengeStore.sqlite'))).toBe(true);
});
