'use strict';

// P6 F4/F5 — F6 / F7 manifest validation coverage.
//
// Every malformed manifest must be rejected before a single destination file is
// created, replaced or removed. All data lives in temp directories.

const fs = require('fs');
const path = require('path');
const { makeTempDataDir } = require('./helpers/testData');

const lib = require('../scripts/lib/backupRestore');
const { makeTokenDb, makeChallengeDb } = require('./helpers/backupFixture');

const tempDirs = [];
function tmp(tag) {
  const dir = makeTempDataDir(tag);
  tempDirs.push(dir);
  return dir;
}

let outDir;
let backupDir;
let goodManifest;

beforeAll(async () => {
  outDir = tmp('mf-out');
  const dataDir = tmp('mf-data');
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify([{ id: 'u1' }]), 'utf8');
  makeTokenDb(path.join(dataDir, 'tokenStore.sqlite'), 'mf');
  makeChallengeDb(path.join(dataDir, 'challengeStore.sqlite'));

  const result = await lib.runBackup({ dir: dataDir, out: outDir });
  backupDir = result.dest;
  goodManifest = JSON.parse(fs.readFileSync(path.join(backupDir, 'manifest.json'), 'utf8'));
});

afterAll(() => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

function clone() {
  return JSON.parse(JSON.stringify(goodManifest));
}

function addEntry(manifest, name) {
  manifest.files[name] = { bytes: 1, sha256: 'a'.repeat(64) };
  return manifest;
}

// Build a backup-shaped directory containing the valid artifacts plus a
// crafted manifest, then assert the restore refuses it and modifies nothing.
async function expectRejected(manifest, pattern, rawOverride) {
  const caseDir = tmp('mf-case');
  for (const name of Object.keys(goodManifest.files)) {
    const src = path.join(backupDir, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(caseDir, name));
  }
  const raw = rawOverride === undefined ? JSON.stringify(manifest, null, 2) : rawOverride;
  fs.writeFileSync(path.join(caseDir, 'manifest.json'), raw, 'utf8');

  const restoreDir = tmp('mf-restore');
  const sentinel = path.join(restoreDir, 'sentinel.txt');
  fs.writeFileSync(sentinel, 'untouched', 'utf8');

  const verification = lib.verifyBackupDir(caseDir);
  expect(verification.ok).toBe(false);

  let error = null;
  try {
    await lib.runRestore({ from: caseDir, dir: restoreDir, force: true });
  } catch (err) {
    error = err;
  }
  expect(error).not.toBeNull();
  expect(error.message).toMatch(pattern);
  // Nothing in the destination changed: only our sentinel remains.
  expect(fs.readdirSync(restoreDir)).toEqual(['sentinel.txt']);
  expect(fs.readFileSync(sentinel, 'utf8')).toBe('untouched');
}

test('F6: the reference manifest is valid', () => {
  expect(lib.verifyBackupDir(backupDir).ok).toBe(true);
  expect(lib.validateManifest(goodManifest, backupDir)).toEqual([]);
});

test('F6: an empty manifest is rejected', async () => {
  await expectRejected({ files: {} }, /empty/i);
});

test('F6: a declared artifact that is missing from the backup is rejected', async () => {
  const manifest = addEntry(clone(), 'ghost.json');
  await expectRejected(manifest, /missing|checksum/i);
});

test('F7: an unknown artifact name is rejected', async () => {
  await expectRejected(addEntry(clone(), 'notes.txt'), /unknown artifact/i);
});

test('F7: an absolute path is rejected', async () => {
  await expectRejected(addEntry(clone(), '/etc/passwd'), /separator|absolute/i);
});

test('F7: a drive-prefixed path is rejected', async () => {
  await expectRejected(addEntry(clone(), 'C:evil.json'), /drive|absolute/i);
});

test('F7: a path separator in an artifact name is rejected', async () => {
  await expectRejected(addEntry(clone(), 'sub/users.json'), /separator/i);
});

test('F7: a traversal component is rejected', async () => {
  await expectRejected(addEntry(clone(), '..'), /traversal|separator/i);
});

test('F6: invalid checksum metadata is rejected', async () => {
  const manifest = clone();
  manifest.files['users.json'] = { bytes: 2, sha256: 'not-a-hash' };
  await expectRejected(manifest, /sha256/i);
});

test('F6: invalid byte metadata is rejected', async () => {
  const manifest = clone();
  manifest.files['users.json'] = { bytes: -1, sha256: 'a'.repeat(64) };
  await expectRejected(manifest, /byte count/i);
});

test('F6: duplicate manifest entries are rejected', async () => {
  const raw = fs.readFileSync(path.join(backupDir, 'manifest.json'), 'utf8');
  // Insert a second, competing "users.json" key at the top level of `files`.
  // JSON.parse would silently keep only the last one, so this must be caught by
  // scanning the raw text.
  const duplicated = raw.replace(
    /"users\.json": \{/,
    '"users.json": {"bytes": 1, "sha256": "' + 'a'.repeat(64) + '"},\n    "users.json": {'
  );
  expect(duplicated).not.toBe(raw);
  expect(duplicated.match(/"users\.json": \{/g).length).toBe(2);
  await expectRejected(goodManifest, /duplicate/i, duplicated);
});

test('F6: a manifest whose checksum no longer matches its file is rejected', async () => {
  const caseDir = tmp('mf-tamper');
  for (const name of Object.keys(goodManifest.files)) {
    fs.copyFileSync(path.join(backupDir, name), path.join(caseDir, name));
  }
  fs.writeFileSync(path.join(caseDir, 'manifest.json'), JSON.stringify(goodManifest, null, 2), 'utf8');
  // Tamper with a JSON artifact without updating the manifest.
  fs.writeFileSync(path.join(caseDir, 'users.json'), JSON.stringify([{ id: 'tampered' }]), 'utf8');

  const restoreDir = tmp('mf-tamper-restore');
  await expect(lib.runRestore({ from: caseDir, dir: restoreDir, force: true })).rejects.toThrow(
    /checksum\/size mismatch/i
  );
  expect(fs.readdirSync(restoreDir)).toEqual([]);
});
