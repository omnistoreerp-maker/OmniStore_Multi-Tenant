'use strict';

// P7 — JSON backup & restore hardening.
//
// Atomic publication, manifest versioning, completion status, authoritative JSON
// inventory, and JSON permission hardening. Every database lives in a temp
// directory; nothing touches backend/data.

const fs = require('fs');
const path = require('path');
const { makeTempDataDir } = require('./helpers/testData');

const lib = require('../scripts/lib/backupRestore');

const isWindows = process.platform === 'win32';
const posixTest = isWindows ? test.skip : test;

const tempDirs = [];
function tmp(tag) {
  const dir = makeTempDataDir(tag);
  tempDirs.push(dir);
  return dir;
}

function bits(file) {
  return fs.statSync(file).mode & 0o777;
}

function seedSource(tag) {
  const dir = tmp(tag || 'p7-src');
  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify([{ id: 'u1' }]), 'utf8');
  fs.writeFileSync(path.join(dir, 'companies.json'), JSON.stringify([{ id: 'c1' }]), 'utf8');
  fs.writeFileSync(path.join(dir, 'cache.json'), JSON.stringify([{ id: 'x1' }]), 'utf8');
  fs.writeFileSync(path.join(dir, '.env'), 'JWT_SECRET=do-not-backup', 'utf8');
  fs.writeFileSync(path.join(dir, 'stale.bak'), 'legacy', 'utf8');
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

afterEach(() => { jest.restoreAllMocks(); });

describe('P7 atomic publication', () => {
  test('no .partial directory is discoverable after a successful backup', async () => {
    const src = seedSource();
    const out = tmp('p7-atomic-out');
    const result = await lib.runBackup({ dir: src, out });

    const entries = fs.readdirSync(out);
    const partials = entries.filter((e) => e.startsWith(lib.PARTIAL_PREFIX));
    expect(partials).toEqual([]);
    const backups = entries.filter((e) => /^backup-/.test(e));
    expect(backups).toHaveLength(1);
    expect(result.dest.endsWith(backups[0])).toBe(true);
    expect(lib.verifyBackupDir(result.dest).ok).toBe(true);
  });

  test('an interrupted JSON copy removes the partial staging directory (try/catch)', async () => {
    const src = seedSource();
    const out = tmp('p7-interrupt-out2');
    const realWrite = fs.writeFileSync;
    let calls = 0;
    jest.spyOn(fs, 'writeFileSync').mockImplementation((file, data, ...rest) => {
      calls += 1;
      if (calls === 3) throw new Error('simulated interruption');
      return realWrite(file, data, ...rest);
    });

    let error = null;
    try {
      await lib.runBackup({ dir: src, out });
    } catch (err) {
      error = err;
    }
    expect(error).not.toBeNull();
    expect(error.message).toMatch(/simulated interruption/);
    const entries = fs.readdirSync(out);
    const partials = entries.filter((e) => e.startsWith(lib.PARTIAL_PREFIX));
    expect(partials).toEqual([]);
    const backups = entries.filter((e) => /^backup-/.test(e));
    expect(backups).toEqual([]);
  });
});

describe('P7 manifest versioning', () => {
  test('manifest carries version 2 and status complete', async () => {
    const src = seedSource();
    const out = tmp('p7-version-out');
    const result = await lib.runBackup({ dir: src, out });

    expect(result.manifest.version).toBe(2);
    expect(result.manifest.status).toBe('complete');

    const onDisk = JSON.parse(fs.readFileSync(path.join(result.dest, 'manifest.json'), 'utf8'));
    expect(onDisk.version).toBe(2);
    expect(onDisk.status).toBe('complete');
  });

  test('verifyBackupDir rejects an unsupported manifest version', async () => {
    const src = seedSource();
    const out = tmp('p7-badver-out');
    const { dest } = await lib.runBackup({ dir: src, out });

    const manifestPath = path.join(dest, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.version = 99;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const verification = lib.verifyBackupDir(dest);
    expect(verification.ok).toBe(false);
    expect(verification.failures.some((f) => f.reason.match(/version/i))).toBe(true);
  });

  test('a legacy manifest without version still verifies', async () => {
    const src = seedSource();
    const out = tmp('p7-legacy-out');
    const { dest } = await lib.runBackup({ dir: src, out });

    const manifestPath = path.join(dest, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    delete manifest.version;
    delete manifest.status;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const verification = lib.verifyBackupDir(dest);
    expect(verification.ok).toBe(true);
  });
});

describe('P7 authoritative JSON inventory', () => {
  test('jsonInventory backs up only listed stores, skipping unlisted JSON', async () => {
    const src = seedSource();
    const out = tmp('p7-inventory-out');
    const result = await lib.runBackup({
      dir: src,
      out,
      jsonInventory: ['users.json', 'companies.json']
    });

    const files = Object.keys(result.manifest.files);
    expect(files).toContain('users.json');
    expect(files).toContain('companies.json');
    expect(files).not.toContain('cache.json');
    expect(files).not.toContain('.env');
    expect(files).not.toContain('stale.bak');
  });

  test('jsonInventory ignores files that do not exist in the source', async () => {
    const src = seedSource();
    const out = tmp('p7-inventory-missing-out');
    const result = await lib.runBackup({
      dir: src,
      out,
      jsonInventory: ['users.json', 'nonexistent.json', 'companies.json']
    });

    const files = Object.keys(result.manifest.files);
    expect(files).toContain('users.json');
    expect(files).toContain('companies.json');
    expect(files).not.toContain('nonexistent.json');
  });

  test('without jsonInventory all *.json files are captured (legacy behaviour)', async () => {
    const src = seedSource();
    const out = tmp('p7-legacy-all-out');
    const result = await lib.runBackup({ dir: src, out });

    const files = Object.keys(result.manifest.files);
    expect(files).toContain('users.json');
    expect(files).toContain('companies.json');
    expect(files).toContain('cache.json');
  });

  test('AUTHORITATIVE_JSON_STORES is a non-empty array of .json names', () => {
    expect(Array.isArray(lib.AUTHORITATIVE_JSON_STORES)).toBe(true);
    expect(lib.AUTHORITATIVE_JSON_STORES.length).toBeGreaterThan(0);
    for (const name of lib.AUTHORITATIVE_JSON_STORES) {
      expect(name.endsWith('.json')).toBe(true);
      expect(name).not.toMatch(/[\/\\]/);
    }
  });
});

describe('P7 JSON permission hardening', () => {
  posixTest('JSON stores are narrowed to 0640 on POSIX', async () => {
    const src = seedSource();
    const out = tmp('p7-perm-out');
    const result = await lib.runBackup({ dir: src, out });

    for (const name of Object.keys(result.manifest.files)) {
      if (name.endsWith('.json')) {
        expect(bits(path.join(result.dest, name))).toBe(0o640);
      }
    }
  });
});

describe('P7 restore to isolated destination', () => {
  test('restore into an isolated temp directory succeeds and preserves hashes', async () => {
    const src = seedSource();
    const out = tmp('p7-restore-out');
    const { dest } = await lib.runBackup({ dir: src, out });

    const restoreDir = tmp('p7-restore-dest');
    const result = await lib.runRestore({ from: dest, dir: restoreDir, force: true, isolated: true });

    expect(result.restored).toBeGreaterThan(0);
    for (const name of Object.keys(JSON.parse(fs.readFileSync(path.join(dest, 'manifest.json'), 'utf8')).files)) {
      const original = fs.readFileSync(path.join(dest, name));
      const restored = fs.readFileSync(path.join(restoreDir, name));
      expect(restored.equals(original)).toBe(true);
    }
  });

  test('restore refuses a tampered backup before touching the destination', async () => {
    const src = seedSource();
    const out = tmp('p7-tamper-out');
    const { dest } = await lib.runBackup({ dir: src, out });

    // Tamper with a JSON artifact without updating the manifest.
    fs.writeFileSync(path.join(dest, 'users.json'), JSON.stringify([{ id: 'tampered' }]), 'utf8');

    const restoreDir = tmp('p7-tamper-dest');
    fs.writeFileSync(path.join(restoreDir, 'sentinel.txt'), 'untouched', 'utf8');

    let error = null;
    try {
      await lib.runRestore({ from: dest, dir: restoreDir, force: true, isolated: true });
    } catch (err) {
      error = err;
    }
    expect(error).not.toBeNull();
    expect(error.message).toMatch(/checksum\/size mismatch|verification failed/i);
    // Destination untouched.
    expect(fs.readFileSync(path.join(restoreDir, 'sentinel.txt'), 'utf8')).toBe('untouched');
  });
});

describe('P7 legacy backup compatibility', () => {
  test('a P6-style manifest (no version/status) restores correctly', async () => {
    const src = seedSource();
    const out = tmp('p7-p6compat-out');
    const { dest } = await lib.runBackup({ dir: src, out });

    // Strip P7 fields to simulate a P6 manifest.
    const manifestPath = path.join(dest, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    delete manifest.version;
    delete manifest.status;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const verification = lib.verifyBackupDir(dest);
    expect(verification.ok).toBe(true);

    const restoreDir = tmp('p7-p6compat-dest');
    const result = await lib.runRestore({ from: dest, dir: restoreDir, force: true, isolated: true });
    expect(result.restored).toBeGreaterThan(0);
  });
});
