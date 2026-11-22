'use strict';

// P6 F4/F5 follow-up — POSIX permission preservation across backup and restore.
//
// A new SQLite database is always created with its default 0644 & ~umask, no
// matter what the database it was copied from looked like, so a hardened 0600
// token/challenge store used to come back world-readable. These suites prove the
// mode is carried through the manifest and re-applied on restore, and that a
// failure to apply it rolls the whole restore back.
//
// Every database here is synthetic and lives in an OS temp directory; nothing
// under backend/data is read or written.

const fs = require('fs');
const path = require('path');
const { makeTempDataDir } = require('./helpers/testData');
const { makeTokenDb, makeChallengeDb } = require('./helpers/backupFixture');

const lib = require('../scripts/lib/backupRestore');
const sqliteSnapshot = require('../utils/sqliteSnapshot');

const isWindows = process.platform === 'win32';
// Real permission bits only mean something on POSIX, so those assertions are
// skipped on Windows; the call-sequence and failure behaviour below run on both.
const posixTest = isWindows ? test.skip : test;
const windowsTest = isWindows ? test : test.skip;

const bits = (file) => fs.statSync(file).mode & 0o777;

const tempDirs = [];
function tmp(tag) {
  const dir = makeTempDataDir(tag);
  tempDirs.push(dir);
  return dir;
}

function families(dbPath) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  try { return db.prepare('SELECT COUNT(*) c FROM session_families').get().c; }
  finally { db.close(); }
}

let outDir;
beforeAll(() => { outDir = tmp('perm-out'); });

afterAll(() => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

afterEach(() => { jest.restoreAllMocks(); });

function seedDataDir(tag, tokenMode) {
  const dir = tmp(tag);
  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify([{ id: 'u1' }]), 'utf8');
  const token = path.join(dir, 'tokenStore.sqlite');
  const challenge = path.join(dir, 'challengeStore.sqlite');
  makeTokenDb(token, 'user-1', 2);
  makeChallengeDb(challenge);
  if (!isWindows && tokenMode) {
    fs.chmodSync(token, tokenMode);
    fs.chmodSync(challenge, tokenMode);
  }
  return { dir, token, challenge };
}

// Rewrite a synthetic manifest so a restore has to apply a chosen mode. Used to
// prove the manifest drives the result even when the artifact's own mode differs.
function injectMode(dest, modes) {
  const file = path.join(dest, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [name, mode] of Object.entries(modes)) manifest.files[name].mode = mode;
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  return manifest;
}

function removeMode(dest) {
  const file = path.join(dest, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const meta of Object.values(manifest.files)) delete meta.mode;
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  return manifest;
}

// Run one call as if the host were POSIX, so the chmod path (and its failure
// handling) is exercised on a Windows developer machine too. Only
// process.platform is overridden, for the duration of the call.
async function asPosix(fn) {
  const saved = process.platform;
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'platform', { value: saved, configurable: true });
  }
}

// ── A: the backup artifact keeps the source mode ────────────────────────────

posixTest('backup preserves a 0600 source on both SQLite artifacts', async () => {
  const { dir, token, challenge } = seedDataDir('perm-bk600', 0o600);
  expect(bits(token)).toBe(0o600);

  const { dest } = await lib.runBackup({ dir, out: outDir });

  // SQLite would have created both artifacts 0644; the source bits win.
  expect(bits(path.join(dest, 'tokenStore.sqlite'))).toBe(0o600);
  expect(bits(path.join(dest, 'challengeStore.sqlite'))).toBe(0o600);
  expect(lib.verifyBackupDir(dest).ok).toBe(true);
});

posixTest('backup records the source mode in the manifest for each database', async () => {
  const { dir, challenge } = seedDataDir('perm-bkrec', 0o640);
  fs.chmodSync(challenge, 0o600);

  const { dest, manifest } = await lib.runBackup({ dir, out: outDir });

  expect(manifest.files['tokenStore.sqlite'].mode).toBe(0o640);
  expect(manifest.files['challengeStore.sqlite'].mode).toBe(0o600);
  // JSON stores never carry a mode.
  expect(manifest.files['users.json'].mode).toBeUndefined();
  const onDisk = JSON.parse(fs.readFileSync(path.join(dest, 'manifest.json'), 'utf8'));
  expect(onDisk.files['tokenStore.sqlite'].mode).toBe(0o640);
});

test('backup applies the source mode to each artifact, after it exists', async () => {
  const { dir, token, challenge } = seedDataDir('perm-bk-calls');
  const realChmod = fs.chmodSync;
  const calls = [];
  jest.spyOn(fs, 'chmodSync').mockImplementation((file, mode) => {
    calls.push([String(file), mode]);
    return realChmod(file, mode);
  });

  const { dest } = await asPosix(() => lib.runBackup({ dir, out: outDir }));

  const tokenArtifact = path.join(dest, 'tokenStore.sqlite');
  const challengeArtifact = path.join(dest, 'challengeStore.sqlite');
  // Applied to the artifact (never the live source) with the source's bits.
  expect(calls).toContainEqual([tokenArtifact, bits(token)]);
  expect(calls).toContainEqual([challengeArtifact, bits(challenge)]);
  expect(calls.some(([file]) => file === token || file === challenge)).toBe(false);
  expect(fs.existsSync(tokenArtifact)).toBe(true);
});

test('backup fails closed when the source permissions cannot be read', async () => {
  const { dir, token } = seedDataDir('perm-stat-fail');
  const backupsBefore = fs.readdirSync(outDir).filter((f) => f.startsWith('backup-')).length;
  const realStat = fs.statSync;
  jest.spyOn(fs, 'statSync').mockImplementation((target, ...rest) => {
    if (String(target) === token) {
      throw Object.assign(new Error('injected stat failure'), { code: 'EACCES', path: token });
    }
    return realStat(target, ...rest);
  });

  let caught = null;
  try {
    await asPosix(() => lib.runBackup({ dir, out: outDir }));
  } catch (err) {
    caught = err;
  }

  expect(caught).not.toBeNull();
  // The mode is never guessed: the path and the underlying cause survive.
  expect(caught.message).toContain(token);
  expect(caught.message).toMatch(/permissions/i);
  expect(caught.cause && caught.cause.code).toBe('EACCES');
  // Nothing was left behind, and no artifact with default permissions exists.
  expect(fs.readdirSync(outDir).filter((f) => f.startsWith('backup-')).length).toBe(backupsBefore);
});

test('a chmod failure during backup fails closed and keeps no artifact', async () => {
  const { dir } = seedDataDir('perm-bk-fail');
  const backupsBefore = fs.readdirSync(outDir).filter((f) => f.startsWith('backup-')).length;
  const realChmod = fs.chmodSync;
  jest.spyOn(fs, 'chmodSync').mockImplementation((file, mode) => {
    if (String(file).endsWith('tokenStore.sqlite')) {
      throw Object.assign(new Error('injected backup chmod failure'), { code: 'EPERM' });
    }
    return realChmod(file, mode);
  });

  let caught = null;
  try {
    await asPosix(() => lib.runBackup({ dir, out: outDir }));
  } catch (err) {
    caught = err;
  }

  expect(caught).not.toBeNull();
  expect(caught.message).toMatch(/permissions/i);
  // runBackup removes the directory it created, so no widened artifact survives.
  expect(fs.readdirSync(outDir).filter((f) => f.startsWith('backup-')).length).toBe(backupsBefore);
});

// ── B/C: restore re-applies the recorded mode ───────────────────────────────

posixTest('restore re-applies 0o600 from the manifest over a widened artifact', async () => {
  const { dir } = seedDataDir('perm-rs600', 0o600);
  const { dest } = await lib.runBackup({ dir, out: outDir });

  // Widen the artifact: only the manifest can bring the mode back.
  fs.chmodSync(path.join(dest, 'tokenStore.sqlite'), 0o644);
  fs.chmodSync(path.join(dest, 'challengeStore.sqlite'), 0o644);

  const restoreDir = tmp('perm-rs600-target');
  await lib.runRestore({ from: dest, dir: restoreDir, force: true });

  expect(bits(path.join(restoreDir, 'tokenStore.sqlite'))).toBe(0o600);
  expect(bits(path.join(restoreDir, 'challengeStore.sqlite'))).toBe(0o600);
});

posixTest('restore applies each entry its own mode (token 0640, challenge 0600)', async () => {
  const { dir } = seedDataDir('perm-rsmix', 0o640);
  const { dest } = await lib.runBackup({ dir, out: outDir });
  const manifest = injectMode(dest, {
    'tokenStore.sqlite': 0o640,
    'challengeStore.sqlite': 0o600
  });
  expect(manifest.files['tokenStore.sqlite'].mode).toBe(0o640);
  // Artifacts stay at the default mode, so only the manifest can explain the result.
  fs.chmodSync(path.join(dest, 'tokenStore.sqlite'), 0o644);
  fs.chmodSync(path.join(dest, 'challengeStore.sqlite'), 0o644);

  const restoreDir = tmp('perm-rsmix-target');
  await lib.runRestore({ from: dest, dir: restoreDir, force: true });

  expect(bits(path.join(restoreDir, 'tokenStore.sqlite'))).toBe(0o640);
  expect(bits(path.join(restoreDir, 'challengeStore.sqlite'))).toBe(0o600);
});

test('the recorded mode is applied exactly once per SQLite target', async () => {
  const { dir } = seedDataDir('perm-calls');
  const { dest } = await lib.runBackup({ dir, out: outDir });
  injectMode(dest, { 'tokenStore.sqlite': 0o640, 'challengeStore.sqlite': 0o600 });

  const restoreDir = tmp('perm-calls-target');
  const realChmod = fs.chmodSync;
  const calls = [];
  jest.spyOn(fs, 'chmodSync').mockImplementation((file, mode) => {
    calls.push([String(file), mode]);
    return realChmod(file, mode);
  });

  await asPosix(() => lib.runRestore({ from: dest, dir: restoreDir, force: true }));

  const tokenTarget = path.join(restoreDir, 'tokenStore.sqlite');
  const challengeTarget = path.join(restoreDir, 'challengeStore.sqlite');
  expect(calls).toContainEqual([tokenTarget, 0o640]);
  expect(calls).toContainEqual([challengeTarget, 0o600]);
  // Never applied to the JSON store, and never twice to the same database.
  expect(calls.filter(([file]) => file === tokenTarget)).toHaveLength(1);
  expect(calls.some(([file]) => file.endsWith('users.json'))).toBe(false);
});

// ── D: legacy manifests ─────────────────────────────────────────────────────

test('a legacy manifest without mode restores and applies no chmod', async () => {
  const { dir } = seedDataDir('perm-legacy');
  const { dest } = await lib.runBackup({ dir, out: outDir });
  const manifest = removeMode(dest);
  expect(manifest.files['tokenStore.sqlite'].mode).toBeUndefined();
  expect(lib.verifyBackupDir(dest).ok).toBe(true);

  const restoreDir = tmp('perm-legacy-target');
  const realChmod = fs.chmodSync;
  const chmod = jest.spyOn(fs, 'chmodSync').mockImplementation((file, mode) => {
    return realChmod(file, mode);
  });

  const result = await asPosix(() => lib.runRestore({ from: dest, dir: restoreDir, force: true }));

  expect(result.restored).toBe(3);
  expect(chmod).not.toHaveBeenCalled();
  expect(families(path.join(restoreDir, 'tokenStore.sqlite'))).toBe(2);
});

// ── Manifest validation ─────────────────────────────────────────────────────

function manifestWithMode(mode, name) {
  const artifact = name || 'tokenStore.sqlite';
  return { files: { [artifact]: { bytes: 1, sha256: 'a'.repeat(64), mode } } };
}

test('invalid mode values are rejected rather than coerced', () => {
  for (const bad of [999, '600', -1, 1.5, null, {}, 0o1000]) {
    const failures = lib.validateManifest(manifestWithMode(bad), null);
    expect(failures).toHaveLength(1);
    expect(failures[0].name).toBe('tokenStore.sqlite');
    expect(failures[0].reason).toMatch(/mode/i);
  }
});

test('valid mode values are accepted, including 0 and 0o777', () => {
  for (const good of [0, 0o600, 0o640, 0o777]) {
    expect(lib.validateManifest(manifestWithMode(good), null)).toEqual([]);
  }
  // A manifest without mode is still valid (legacy compatibility).
  const legacy = { files: { 'tokenStore.sqlite': { bytes: 1, sha256: 'a'.repeat(64) } } };
  expect(lib.validateManifest(legacy, null)).toEqual([]);
});

test('mode is rejected on artifacts that are not SQLite databases', () => {
  const failures = lib.validateManifest(manifestWithMode(0o600, 'users.json'), null);
  expect(failures).toHaveLength(1);
  expect(failures[0].reason).toMatch(/mode is only valid for SQLite/i);
});

test('a manifest with a tampered mode fails verification before anything is restored', async () => {
  const { dir } = seedDataDir('perm-bad');
  const { dest } = await lib.runBackup({ dir, out: outDir });
  injectMode(dest, { 'tokenStore.sqlite': 999 });

  const verification = lib.verifyBackupDir(dest);
  expect(verification.ok).toBe(false);
  expect(verification.failures[0].reason).toMatch(/mode/i);

  const restoreDir = tmp('perm-bad-target');
  await expect(
    lib.runRestore({ from: dest, dir: restoreDir, force: true })
  ).rejects.toThrow(/invalid mode/i);
  expect(fs.readdirSync(restoreDir)).toEqual([]);
});

// ── Failure and rollback ────────────────────────────────────────────────────

test('a chmod failure after installation rolls the restore back', async () => {
  const { dir } = seedDataDir('perm-fail');
  const { dest } = await lib.runBackup({ dir, out: outDir });
  injectMode(dest, { 'tokenStore.sqlite': 0o600, 'challengeStore.sqlite': 0o600 });

  const restoreDir = tmp('perm-fail-target');
  const tokenTarget = path.join(restoreDir, 'tokenStore.sqlite');
  makeTokenDb(tokenTarget, 'original', 3);
  if (!isWindows) fs.chmodSync(tokenTarget, 0o600);
  const beforeBytes = fs.readFileSync(tokenTarget);
  const beforeMode = bits(tokenTarget);

  const realChmod = fs.chmodSync;
  let originalsPreservedDuringChmod = false;
  jest.spyOn(fs, 'chmodSync').mockImplementation((file, mode) => {
    if (String(file) === tokenTarget) {
      // The pre-existing database is still beside its target as *.origin.*, so
      // it was preserved before the replacement and before this chmod.
      originalsPreservedDuringChmod = fs
        .readdirSync(restoreDir)
        .some((f) => f.includes('.origin.'));
      throw Object.assign(new Error('injected chmod failure'), { code: 'EPERM' });
    }
    return realChmod(file, mode);
  });

  let caught = null;
  try {
    await asPosix(() => lib.runRestore({ from: dest, dir: restoreDir, force: true }));
  } catch (err) {
    caught = err;
  }

  expect(caught).not.toBeNull();
  expect(originalsPreservedDuringChmod).toBe(true);
  // The error names the database whose permissions could not be applied.
  expect(caught.message).toContain(tokenTarget);
  expect(caught.message).toMatch(/permissions/i);
  // Not misreported as a locked/in-use database even though the OS code was EPERM.
  expect(caught.name).not.toBe('DatabaseInUseError');

  // Original bytes AND original mode are back; nothing insecure is left behind.
  expect(fs.readFileSync(tokenTarget).equals(beforeBytes)).toBe(true);
  expect(families(tokenTarget)).toBe(3);
  if (!isWindows) expect(bits(tokenTarget)).toBe(beforeMode);
  expect(
    fs.readdirSync(restoreDir).filter(
      (f) => f.includes('.origin.') || f.includes('.incoming.') || f === lib.RESTORE_LOCK_NAME
    )
  ).toEqual([]);
  // Rollback is complete, so the operation failed cleanly rather than partially.
  expect(caught.message).toMatch(/rolled back/i);
});

// ── Windows: unchanged behaviour ────────────────────────────────────────────

windowsTest('Windows backup records no mode and restore invokes no chmod', async () => {
  const { dir } = seedDataDir('perm-win');
  const { dest, manifest } = await lib.runBackup({ dir, out: outDir });

  expect(manifest.files['tokenStore.sqlite'].mode).toBeUndefined();
  expect(manifest.files['challengeStore.sqlite'].mode).toBeUndefined();

  // Even a manifest written on POSIX (with a mode) must not chmod on Windows.
  injectMode(dest, { 'tokenStore.sqlite': 0o600, 'challengeStore.sqlite': 0o600 });
  const realChmod = fs.chmodSync;
  const chmod = jest.spyOn(fs, 'chmodSync').mockImplementation((file, mode) => {
    return realChmod(file, mode);
  });

  const restoreDir = tmp('perm-win-target');
  const result = await lib.runRestore({ from: dest, dir: restoreDir, force: true });

  expect(result.restored).toBe(3);
  expect(chmod).not.toHaveBeenCalled();
});

// Keep the exported helper honest on this platform.
test('applyFileMode is a no-op on Windows and rejects invalid bits elsewhere', () => {
  if (isWindows) {
    expect(() => sqliteSnapshot.applyFileMode(path.join(tmp('perm-win-helper'), 'x'), 0o600)).not.toThrow();
    return;
  }
  const file = path.join(tmp('perm-helper'), 'x.sqlite');
  fs.writeFileSync(file, 'x');
  sqliteSnapshot.applyFileMode(file, 0o600);
  expect(bits(file)).toBe(0o600);
  expect(() => sqliteSnapshot.applyFileMode(file, 0o1000)).toThrow(/invalid permission bits/i);
});
