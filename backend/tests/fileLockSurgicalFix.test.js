'use strict';

// Deterministic regression tests for fileLock quarantine and release races.
//
// Test A: _breakStale link-failure (EEXIST) — quarantine must be preserved.
// Test B: _removeIfOwner: when token does not match current lock, must return
//         false without touching any file (defensive check against deleting
//         another holder's lock).
//
// Uses jest.spyOn on fsp.link to force the EEXIST failure deterministically,
// without relying on sleep or timing.

const fs = require('fs');
const os = require('os');
const path = require('path');
const fsp = fs.promises;
const fileLock = require('../utils/fileLock');
const { makeTempDataDir } = require('./helpers/testData');

let dir;
let lockPath;

function writeLock(meta) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify(meta), 'utf8');
}

function readLock() {
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function listQuarantine() {
  return fs.readdirSync(dir).filter((f) => f.startsWith(path.basename(lockPath) + '.'));
}

beforeEach(() => {
  dir = makeTempDataDir('filelock-surgical-fix');
  lockPath = path.join(dir, '.test.lock');
});

afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
});

describe('fileLock — surgical fix regression (deterministic)', () => {
  test('Test A — _breakStale: EEXIST on link preserves quarantine and other holder lock', async () => {
    const { _breakStale } = fileLock.__test;

    // Lock Y is at lockPath (another holder took over).
    writeLock({ token: 'token-Y', pid: process.pid, host: os.hostname(), acquiredAt: Date.now(), heartbeatAt: Date.now() });

    // Force fsp.link to fail with EEXIST (simulating another process created lockPath).
    const linkSpy = jest.spyOn(fsp, 'link').mockRejectedValue(Object.assign(new Error('EEXIST'), { code: 'EEXIST' }));

    const result = await _breakStale(lockPath, { token: 'token-X' });

    expect(result).toBe(false);

    // Quarantine must still exist — we did not delete it.
    const quarantineFiles = listQuarantine().filter((f) => f.includes('stale-'));
    expect(quarantineFiles.length).toBe(1);

    // Quarantine content must still be token-Y.
    const qContent = JSON.parse(fs.readFileSync(path.join(dir, quarantineFiles[0]), 'utf8'));
    expect(qContent.token).toBe('token-Y');

    // lockPath must NOT exist (rename moved it, link failed to restore).
    expect(fs.existsSync(lockPath)).toBe(false);

    linkSpy.mockRestore();
  });

  test('Test B — _removeIfOwner: token mismatch returns false without deleting anything', async () => {
    const { _removeIfOwner } = fileLock.__test;

    // Lock Y owned by another process at lockPath.
    writeLock({ token: 'token-Y', pid: 99998, host: os.hostname(), acquiredAt: Date.now(), heartbeatAt: Date.now() });

    // We try to release as token-X owner, but the lock is Y.
    const result = await _removeIfOwner(lockPath, { token: 'token-X' });

    expect(result).toBe(false);

    // No files were created or deleted: lockPath still holds token-Y.
    const allFiles = fs.readdirSync(dir);
    expect(allFiles).toHaveLength(1);
    expect(allFiles[0]).toBe('.test.lock');

    const current = readLock();
    expect(current).not.toBeNull();
    expect(current.token).toBe('token-Y');
  });

  test('Test C — _breakStale: successful take-over of genuinely stale lock', async () => {
    const { _breakStale } = fileLock.__test;

    // Create an empty/corrupt lock file with an old mtime.
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, '', 'utf8');
    const old = new Date('2020-01-01T00:00:00Z');
    fs.utimesSync(lockPath, old, old);

    const result = await _breakStale(lockPath, null);

    expect(result).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
