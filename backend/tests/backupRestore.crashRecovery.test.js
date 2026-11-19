'use strict';

// D-1 documentation fixture: the DISASTER_RECOVERY.md §3 crash-recovery
// sequences must preserve a committed row that exists only in the -wal sidecar.
// Both documented crash states are reproduced against real files:
//   Case A — the main file was moved aside, the sidecars were not.
//   Case B — the main file and its sidecars were all moved to origin names.
// Every directory is a temp directory; backend/data is never touched.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { makeTempDataDir } = require('./helpers/testData');
const { ORIGIN_TAG } = require('../scripts/lib/backupRestore');

const ROW = 'committed-only-in-wal';
const TAG = '2026-01-01T00-00-00.000Z-4242';

const tempDirs = [];
function tmp(tag) {
  const dir = makeTempDataDir(tag);
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

// Build a database generation whose committed state lives in -wal only. The
// writer connection is kept open (autocheckpoint disabled) while the main file
// and its -wal are copied into a "crashed" directory, then it is closed.
function makeWalOnlyGeneration(tag) {
  const live = tmp(tag + '-live');
  const db = path.join(live, 'tokenStore.sqlite');
  const writer = new Database(db);
  try {
    writer.pragma('journal_mode = WAL');
    writer.pragma('wal_autocheckpoint = 0');
    writer.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    writer.prepare('INSERT INTO t (v) VALUES (?)').run(ROW);

    const crashed = tmp(tag + '-crashed');
    const target = path.join(crashed, 'tokenStore.sqlite');
    fs.copyFileSync(db, target);
    fs.copyFileSync(db + '-wal', target + '-wal');
    expect(fs.statSync(target + '-wal').size).toBeGreaterThan(0);
    return { target };
  } finally {
    writer.close();
  }
}

function rowsIn(file) {
  const db = new Database(file, { readonly: true });
  try { return db.prepare('SELECT v FROM t').all().map((row) => row.v); }
  finally { db.close(); }
}

test('D-1 fixture: the crashed main file alone holds none of the committed row', () => {
  const { target } = makeWalOnlyGeneration('d1-baseline');
  const isolated = path.join(tmp('d1-baseline-isolated'), 'tokenStore.sqlite');
  fs.copyFileSync(target, isolated);

  let rows = null;
  try { rows = rowsIn(isolated); } catch (_) { rows = null; } // the table itself may still be in the WAL
  // Either no table at all, or the committed row is genuinely absent.
  expect(rows === null || !rows.includes(ROW)).toBe(true);
});

test('D-1 Case A: renaming the origin main back and leaving sidecars at target names keeps the WAL row', () => {
  const { target } = makeWalOnlyGeneration('d1-casea');
  const origin = target + ORIGIN_TAG + TAG;

  // Crash state: main moved aside, -wal/-shm still beside the target.
  fs.renameSync(target, origin);
  expect(fs.existsSync(target)).toBe(false);
  expect(fs.existsSync(target + '-wal')).toBe(true);

  // Documented recovery: the main file comes back, the sidecars do not move.
  fs.renameSync(origin, target);
  expect(fs.existsSync(origin)).toBe(false);
  expect(fs.existsSync(origin + '-wal')).toBe(false);

  expect(rowsIn(target)).toEqual([ROW]);
});

test('D-1 Case B: restoring the whole origin group to target names keeps the WAL row', () => {
  const { target } = makeWalOnlyGeneration('d1-caseb');
  const origin = target + ORIGIN_TAG + TAG;

  // Crash state: main and sidecars already moved to origin names.
  fs.renameSync(target, origin);
  fs.renameSync(target + '-wal', origin + '-wal');
  expect(fs.existsSync(target)).toBe(false);
  expect(fs.existsSync(target + '-wal')).toBe(false);

  // Documented recovery: one generation moves back as a unit.
  fs.renameSync(origin, target);
  fs.renameSync(origin + '-wal', target + '-wal');
  expect(fs.existsSync(origin)).toBe(false);

  expect(rowsIn(target)).toEqual([ROW]);
});
