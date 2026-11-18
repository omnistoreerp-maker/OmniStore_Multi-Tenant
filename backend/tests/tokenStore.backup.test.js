'use strict';

// D2/D3/D6/D7 regression: backup and restore use the installed better-sqlite3
// API correctly, verify integrity with the real pragma result shape, and stay
// WAL-consistent while the store is in use.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

let dataDir;
const originalDataDir = process.env.DIGITRONICS_DATA_DIR;

function loadStore() {
  jest.resetModules();
  return require('../utils/tokenStore.sqlite');
}

function counts(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return {
      families: db.prepare('SELECT COUNT(*) c FROM session_families').get().c,
      refresh: db.prepare('SELECT COUNT(*) c FROM refresh_tokens').get().c,
      denylist: db.prepare('SELECT COUNT(*) c FROM access_token_denylist').get().c
    };
  } finally {
    db.close();
  }
}

function integrity(dbPath, readonly) {
  const db = new Database(dbPath, readonly ? { readonly: true } : undefined);
  try {
    return db.pragma('integrity_check');
  } finally {
    db.close();
  }
}

beforeAll(() => {
  dataDir = makeTempDataDir('d2-backup');
  process.env.DIGITRONICS_DATA_DIR = dataDir;
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DIGITRONICS_DATA_DIR;
  else process.env.DIGITRONICS_DATA_DIR = originalDataDir;
});

registerCleanup(() => [], () => [dataDir]);

test('backup and restore preserve rows with WAL-enabled source still open', async () => {
  const store = loadStore();
  const storePath = path.join(dataDir, 'source.sqlite');
  store.initialise(storePath);

  const fam1 = store.createSessionFamily('user-1', 'tenant-1');
  store.issueRefreshToken('refresh-1', {
    jti: 'refresh-1', familyId: fam1.familyId, sub: 'user-1', ver: 0,
    tenantId: 'tenant-1', issuedAt: Date.now(), expiresAt: Date.now() + 600000
  });
  store.createSessionFamily('user-2', null);
  expect(store.revokeAccessToken('access-jti-1', 'user-1', Math.floor(Date.now() / 1000) + 600).revoked).toBe(true);

  const expected = counts(storePath);

  // The store's own connection stays open here: backup must be WAL-consistent.
  const backupPath = path.join(dataDir, 'backup.sqlite');
  await expect(store.backupDatabase(storePath, backupPath)).resolves.toBe(backupPath);
  expect(fs.existsSync(backupPath)).toBe(true);
  expect(integrity(backupPath, true)).toEqual([{ integrity_check: 'ok' }]);
  expect(counts(backupPath)).toEqual(expected);

  const targetPath = path.join(dataDir, 'restored.sqlite');
  await expect(store.restoreDatabase(backupPath, targetPath)).resolves.toBeUndefined();
  expect(integrity(targetPath, false)).toEqual([{ integrity_check: 'ok' }]);
  expect(counts(targetPath)).toEqual(expected);
  expect(store.validateDatabaseFile(targetPath)).toBe(targetPath);

  store.closeDb();
});

test('backup refuses to overwrite an existing destination', async () => {
  const store = loadStore();
  const storePath = path.join(dataDir, 'source.sqlite');
  const taken = path.join(dataDir, 'taken.sqlite');
  fs.writeFileSync(taken, 'existing');
  await expect(store.backupDatabase(storePath, taken)).rejects.toThrow(/already exists/i);
  expect(fs.readFileSync(taken, 'utf8')).toBe('existing');
});

test('a corrupt source fails the backup instead of producing a bad file', async () => {
  const store = loadStore();
  const corruptSource = path.join(dataDir, 'corrupt-source.sqlite');
  fs.writeFileSync(corruptSource, 'garbage');
  const corruptBytes = fs.readFileSync(corruptSource);
  const dest = path.join(dataDir, 'should-not-exist.sqlite');
  await expect(store.backupDatabase(corruptSource, dest)).rejects.toThrow(/not usable|not a database|disk I\/O|corrupt|header/i);
  expect(fs.existsSync(dest)).toBe(false);
  expect(Buffer.compare(fs.readFileSync(corruptSource), corruptBytes)).toBe(0);
});

test('a corrupt backup is refused and the target is left untouched', () => {
  const store = loadStore();
  const badBackup = path.join(dataDir, 'bad-backup.sqlite');
  fs.writeFileSync(badBackup, 'corrupt backup payload');
  const target = path.join(dataDir, 'protected-target.sqlite');
  fs.writeFileSync(target, 'original target bytes');

  expect(() => store.restoreDatabase(badBackup, target)).toThrow(/corrupt|not usable|not a database/i);
  expect(fs.readFileSync(target, 'utf8')).toBe('original target bytes');
});

test('a failed replacement rolls back to the original database', async () => {
  const store = loadStore();
  const sourcePath = path.join(dataDir, 'source.sqlite');
  const target = path.join(dataDir, 'rollback-target.sqlite');
  const backup = path.join(dataDir, 'rollback-backup.sqlite');
  fs.copyFileSync(sourcePath, target);
  const before = counts(target);
  await store.backupDatabase(sourcePath, backup);

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
    await expect(store.restoreDatabase(backup, target)).rejects.toThrow(/rolled back|injected/i);
  } finally {
    spy.mockRestore();
  }

  // The original database (and its WAL association) is still in place.
  expect(store.validateDatabaseFile(target)).toBe(target);
  expect(counts(target)).toEqual(before);
  const leftovers = fs.readdirSync(dataDir).filter((f) => f.startsWith('rollback-target.sqlite.rollback.'));
  expect(leftovers).toEqual([]);
});

test('a busy WAL checkpoint fails safely when another writer blocks it', async () => {
  const store = loadStore();
  const storePath = path.join(dataDir, 'source.sqlite');

  const blocker = new Database(storePath);
  blocker.exec('BEGIN IMMEDIATE');
  blocker.prepare("INSERT INTO session_families (familyId, sub, tenantId, createdAt, revokedAt, revocationReason) VALUES ('blocker-fam','blocker','t',?,NULL,NULL)").run(Date.now());

  try {
    const dest = path.join(dataDir, 'busy-backup.sqlite');
    await expect(store.backupDatabase(storePath, dest)).rejects.toThrow(/busy/i);
    expect(fs.existsSync(dest)).toBe(false);
  } finally {
    try { blocker.exec('ROLLBACK'); } catch (_) {}
    blocker.close();
  }
});
