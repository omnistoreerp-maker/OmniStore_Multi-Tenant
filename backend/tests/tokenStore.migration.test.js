'use strict';

// D5/D8 regression: legacy revocation migration follows the configured data
// directory, reports real counts, keeps malformed sources recoverable and never
// archives the source before successful migration + verification.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const BACKEND = path.join(__dirname, '..');
let dataDir;
const originalDataDir = process.env.DIGITRONICS_DATA_DIR;

function loadStore() {
  jest.resetModules();
  return require('../utils/tokenStore.sqlite');
}

function hashOf(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

beforeAll(() => {
  dataDir = makeTempDataDir('d5-migration');
  process.env.DIGITRONICS_DATA_DIR = dataDir;
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DIGITRONICS_DATA_DIR;
  else process.env.DIGITRONICS_DATA_DIR = originalDataDir;
});

registerCleanup(() => [], () => [dataDir]);

test('legacy revocation path derives from the configured data directory', () => {
  const script = "process.stdout.write(require('./config').legacyRevocationPath);";
  const res = spawnSync(process.execPath, ['-e', script], {
    cwd: BACKEND,
    env: { ...process.env, DIGITRONICS_DATA_DIR: dataDir },
    encoding: 'utf8'
  });
  expect(res.status).toBe(0);
  expect(res.stdout.trim()).toBe(path.join(dataDir, 'revoked-tokens.json'));
});

test('missing source is distinguished from a valid empty file', () => {
  const store = loadStore();
  store.initialise();

  const missing = store.migrateLegacyRevocations(path.join(dataDir, 'absent.json'));
  expect(missing).toMatchObject({ imported: 0, missing: true });

  const emptyPath = path.join(dataDir, 'empty.json');
  fs.writeFileSync(emptyPath, '[]');
  const empty = store.migrateLegacyRevocations(emptyPath);
  expect(empty).toMatchObject({ imported: 0, rejected: 0, duplicates: 0, verified: true });
  expect(empty.archivePath).toBeTruthy();
  expect(fs.existsSync(emptyPath)).toBe(false);

  store.closeDb();
});

test('corrupt JSON is reported and the source file is retained', () => {
  const store = loadStore();
  const corruptPath = path.join(dataDir, 'corrupt.json');
  fs.writeFileSync(corruptPath, '{ not valid json');
  const result = store.migrateLegacyRevocations(corruptPath);
  expect(result).toMatchObject({ imported: 0, error: 'parse_failed' });
  expect(fs.existsSync(corruptPath)).toBe(true);
  store.closeDb();
});

test('invalid entries are counted, valid ones imported, and the archived copy retains them', () => {
  const store = loadStore();
  const filePath = path.join(dataDir, 'mixed.json');
  const token = 'legacy-token-for-migration';
  fs.writeFileSync(filePath, JSON.stringify([
    { hash: hashOf(token), exp: Math.floor(Date.now() / 1000) + 3600 },
    { hash: 'not-a-sha256', exp: 1 },
    { nope: true }
  ]));

  const result = store.migrateLegacyRevocations(filePath);
  expect(result.imported).toBe(1);
  expect(result.rejected).toBe(2);
  expect(result.verified).toBe(true);
  expect(result.archivePath).toBeTruthy();
  const Database = require('better-sqlite3');
  const db = new Database(path.join(dataDir, 'tokenStore.sqlite'), { readonly: true });
  try {
    expect(db.prepare('SELECT 1 FROM legacy_revocations WHERE hash = ?').get(hashOf(token))).toBeTruthy();
  } finally {
    db.close();
  }

  // The archive still contains every original row, including the malformed ones.
  const archived = JSON.parse(fs.readFileSync(result.archivePath, 'utf8'));
  expect(archived).toHaveLength(3);
  store.closeDb();
});

test('repeating the migration is idempotent and still verifies', () => {
  const store = loadStore();
  const filePath = path.join(dataDir, 'repeat.json');
  const token = 'repeat-legacy-token';
  const payload = [{ hash: hashOf(token), exp: Math.floor(Date.now() / 1000) + 3600 }];
  fs.writeFileSync(filePath, JSON.stringify(payload));

  const first = store.migrateLegacyRevocations(filePath);
  expect(first.imported).toBe(1);

  fs.writeFileSync(filePath, JSON.stringify(payload));
  const second = store.migrateLegacyRevocations(filePath);
  expect(second).toMatchObject({ imported: 0, duplicates: 1, rejected: 0, verified: true });
  expect(second.archivePath).toBeTruthy();
  store.closeDb();
});
