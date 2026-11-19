'use strict';

// P6 F4/F5 backup & restore hardening.
//
// These tests drive the shared scripts/lib/backupRestore.js logic directly (no
// child processes, no real server, no ports). Every database lives in a temp
// directory; nothing touches backend/data.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const lib = require('../scripts/lib/backupRestore');
const sqliteSnapshot = require('../utils/sqliteSnapshot');

let dataDir;
let outDir;
const originalDataDir = process.env.DIGITRONICS_DATA_DIR;
const originalChallengePath = process.env.CHALLENGE_DB_PATH;

function tokenStore() {
  return require('../utils/tokenStore.sqlite');
}
function challengeStore() {
  return require('../utils/challengeStore.sqlite');
}

// Create a token-store DB with a couple of rows at the given path.
function makeTokenDb(file, marker) {
  const store = tokenStore();
  store.initialise(file);
  try {
    const fam = store.createSessionFamily(marker, 'tenant-x');
    store.issueRefreshToken('jti-' + marker, {
      familyId: fam.familyId,
      sub: marker,
      ver: 0,
      tenantId: 'tenant-x',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 600000
    });
  } finally {
    store.closeDb();
  }
  return file;
}

// Create a challenge-store DB with one row at the given path.
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
function integrityOk(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try { return db.pragma('integrity_check'); }
  finally { db.close(); }
}

// Build a fresh data dir populated with JSON + both SQLite stores.
function seedDataDir() {
  const dir = makeTempDataDir('p6f45');
  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify([{ id: 'u1' }], null, 2), 'utf8');
  makeTokenDb(path.join(dir, 'tokenStore.sqlite'), 'user-1');
  makeChallengeDb(path.join(dir, 'challengeStore.sqlite'));
  return dir;
}

beforeAll(() => {
  dataDir = makeTempDataDir('p6f45-root');
  outDir = makeTempDataDir('p6f45-out');
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  delete process.env.CHALLENGE_DB_PATH;
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DIGITRONICS_DATA_DIR;
  else process.env.DIGITRONICS_DATA_DIR = originalDataDir;
  if (originalChallengePath === undefined) delete process.env.CHALLENGE_DB_PATH;
  else process.env.CHALLENGE_DB_PATH = originalChallengePath;
});

registerCleanup(() => [], () => [dataDir, outDir]);

test('backup includes and verifies both SQLite stores plus JSON', async () => {
  const dir = seedDataDir();
  const { dest, manifest } = await lib.runBackup({ dir, out: outDir });

  expect(Object.keys(manifest.files)).toEqual(
    expect.arrayContaining(['users.json', 'tokenStore.sqlite', 'challengeStore.sqlite'])
  );
  expect(manifest.databases.tokenStore.included).toBe(true);
  expect(manifest.databases.challengeStore.included).toBe(true);
  expect(fs.existsSync(path.join(dest, 'manifest.json'))).toBe(true);

  // The backup directory must be self-contained: restore copies only the main
  // file, so un-checkpointed -wal/-shm sidecars would lose committed rows.
  const sidecars = fs.readdirSync(dest).filter((f) => f.endsWith('-wal') || f.endsWith('-shm'));
  expect(sidecars).toEqual([]);

  const verification = lib.verifyBackupDir(dest);
  expect(verification.ok).toBe(true);
  expect(verification.failures).toEqual([]);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('restore of a valid SQLite (incl. WAL) succeeds and stays consistent', async () => {
  const dir = seedDataDir();
  const { dest } = await lib.runBackup({ dir, out: outDir });
  const restoreDir = makeTempDataDir('p6f45-restore');

  await lib.runRestore({ from: dest, dir: restoreDir });

  const tokenTarget = path.join(restoreDir, 'tokenStore.sqlite');
  const challengeTarget = path.join(restoreDir, 'challengeStore.sqlite');
  expect(integrityOk(tokenTarget)).toEqual([{ integrity_check: 'ok' }]);
  expect(integrityOk(challengeTarget)).toEqual([{ integrity_check: 'ok' }]);
  expect(tokenStore().validateDatabaseFile(tokenTarget)).toBe(tokenTarget);
  expect(challengeStore().validateDatabaseFile(challengeTarget)).toBe(challengeTarget);
  expect(families(tokenTarget)).toBe(families(path.join(dir, 'tokenStore.sqlite')));
  expect(challenges(challengeTarget)).toBe(1);

  // No restore/rollback scratch files left behind.
  const leftovers = fs.readdirSync(restoreDir).filter((f) => f.includes('.restore.') || f.includes('.rollback.'));
  expect(leftovers).toEqual([]);

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(restoreDir, { recursive: true, force: true });
});

test('a corrupt SQLite in the backup is refused before any copy', async () => {
  const dir = seedDataDir();
  const { dest, manifest } = await lib.runBackup({ dir, out: outDir });

  // Corrupt the challenge DB but recompute its manifest entry so checksum passes
  // and only the schema/integrity validator rejects it.
  const bad = path.join(dest, 'challengeStore.sqlite');
  fs.writeFileSync(bad, 'not a sqlite database at all');
  manifest.files['challengeStore.sqlite'] = {
    bytes: fs.statSync(bad).size,
    sha256: lib.sha256File(bad)
  };
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const restoreDir = makeTempDataDir('p6f45-corrupt');
  await expect(lib.runRestore({ from: dest, dir: restoreDir })).rejects.toThrow(/verification failed|invalid SQLite/i);

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(restoreDir, { recursive: true, force: true });
});

test('a failed replacement rolls back and keeps the original database', async () => {
  const source = makeTokenDb(path.join(dataDir, 'rb-source.sqlite'), 'original');
  const backup = path.join(dataDir, 'rb-backup.sqlite');
  const target = path.join(dataDir, 'rb-target.sqlite');
  fs.copyFileSync(source, target);
  const before = families(target);
  await tokenStore().backupDatabase(source, backup);

  const originalRename = fs.renameSync;
  const spy = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(to) === target && String(from).includes('.restore.')) {
      const err = new Error('injected rename failure');
      err.code = 'EIO';
      throw err;
    }
    return originalRename(from, to);
  });
  try {
    await expect(sqliteSnapshot.restoreSqlite(backup, target)).rejects.toThrow(/rolled back|injected/i);
  } finally {
    spy.mockRestore();
  }

  expect(tokenStore().validateDatabaseFile(target)).toBe(target);
  expect(families(target)).toBe(before);
  const leftovers = fs.readdirSync(dataDir).filter((f) => f.startsWith('rb-target.sqlite.rollback.'));
  expect(leftovers).toEqual([]);
});

test('restore refuses to replace a database that is in use', async () => {
  const dir = seedDataDir();
  const { dest } = await lib.runBackup({ dir, out: outDir });
  const restoreDir = makeTempDataDir('p6f45-inuse');
  // Seed a target we then hold open with a write transaction.
  makeTokenDb(path.join(restoreDir, 'tokenStore.sqlite'), 'held');
  const target = path.join(restoreDir, 'tokenStore.sqlite');
  const before = families(target);

  const blocker = new Database(target);
  blocker.exec('BEGIN IMMEDIATE');
  try {
    await expect(lib.runRestore({ from: dest, dir: restoreDir, force: true })).rejects.toThrow(/in use|busy/i);
  } finally {
    try { blocker.exec('ROLLBACK'); } catch (_) {}
    blocker.close();
  }

  expect(families(target)).toBe(before);

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(restoreDir, { recursive: true, force: true });
});

test('restore refuses to overwrite a non-empty destination without --force', async () => {
  const dir = seedDataDir();
  const { dest } = await lib.runBackup({ dir, out: outDir });
  const restoreDir = makeTempDataDir('p6f45-nonempty');
  fs.writeFileSync(path.join(restoreDir, 'users.json'), '[]', 'utf8');

  await expect(lib.runRestore({ from: dest, dir: restoreDir })).rejects.toThrow(/not empty|--force/i);

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(restoreDir, { recursive: true, force: true });
});

test('a configured-but-missing challenge database fails the backup', async () => {
  const dir = seedDataDir();
  const missing = path.join(dataDir, 'does-not-exist.sqlite');
  const prev = process.env.CHALLENGE_DB_PATH;
  process.env.CHALLENGE_DB_PATH = missing;
  try {
    await expect(lib.runBackup({ dir, out: outDir })).rejects.toThrow(/challenge database is missing/i);
  } finally {
    if (prev === undefined) delete process.env.CHALLENGE_DB_PATH;
    else process.env.CHALLENGE_DB_PATH = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a JSON store modified during backup aborts the snapshot', async () => {
  const dir = makeTempDataDir('p6f45-jsonrace');
  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify([{ id: 'a' }], null, 2), 'utf8');

  const realRead = fs.readFileSync;
  let reads = 0;
  const spy = jest.spyOn(fs, 'readFileSync').mockImplementation((p, ...rest) => {
    if (typeof p === 'string' && p.endsWith('users.json')) {
      reads++;
      if (reads === 2) return Buffer.from(JSON.stringify([{ id: 'changed' }]), 'utf8');
    }
    return realRead.call(fs, p, ...rest);
  });
  try {
    await expect(lib.runBackup({ dir, out: outDir })).rejects.toThrow(/changed during backup/i);
  } finally {
    spy.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrupt JSON store aborts the backup (regression)', async () => {
  const dir = makeTempDataDir('p6f45-badjson');
  fs.writeFileSync(path.join(dir, 'users.json'), '{ this is not json', 'utf8');
  await expect(lib.runBackup({ dir, out: outDir })).rejects.toThrow();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
