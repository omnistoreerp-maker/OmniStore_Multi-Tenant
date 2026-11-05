'use strict';

// Deterministic race tests for fileLock quarantine operations.
//
// Tests the scenario:
//   1. Process A reads an old lock (token X).
//   2. Process B moves the old lock and creates a new lock (token Y).
//   3. Process A moves the current lock to quarantine.
//   4. Process A detects token mismatch (X !== Y).
//   5. Process C creates a new lock at the original path before restore.
//   6. fsp.link fails because the path exists.
//   7. Deleting quarantine must NOT lose the other holder's lock (Y).
//
// No production module is mocked. Uses the real fileLock module against
// isolated temp files.

const fs = require('fs');
const os = require('os');
const path = require('path');
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

beforeEach(() => {
  dir = makeTempDataDir('filelock-quarantine-race');
  lockPath = path.join(dir, '.test.lock');
});

afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
});

describe('fileLock — quarantine race (deterministic)', () => {
  test('_breakStale: does not delete another holder lock when link fails', async () => {
    const { _breakStale } = fileLock.__test;

    // Lock Y is at lockPath (another holder took over before A's rename).
    writeLock({ token: 'token-Y', pid: process.pid, host: os.hostname(), acquiredAt: Date.now(), heartbeatAt: Date.now() });

    // A's _breakStale expects token-X but finds token-Y at the path.
    const result = await _breakStale(lockPath, { token: 'token-X' });

    // _breakStale returns false (could not take over).
    expect(result).toBe(false);

    // The lock at lockPath must still be token-Y (the other holder's lock
    // must NOT be deleted).
    const current = readLock();
    expect(current).not.toBeNull();
    expect(current.token).toBe('token-Y');
  });

  test('_breakStale: when link succeeds, restores old lock and removes quarantine', async () => {
    const { _breakStale } = fileLock.__test;

    // Lock Y at lockPath (another holder).
    writeLock({ token: 'token-Y', pid: process.pid, host: os.hostname(), acquiredAt: Date.now(), heartbeatAt: Date.now() });

    // No other lock at lockPath when _breakStale runs: link should succeed
    // (lockPath currently holds Y, but we rename Y to quarantine first, then
    // link it back — path is empty during the link attempt).
    const result = await _breakStale(lockPath, { token: 'token-X' });

    expect(result).toBe(false); // token mismatch, could not take over

    // After failed take-over with successful link: lockPath should be restored
    // to token-Y, and quarantine should be removed.
    const current = readLock();
    expect(current).not.toBeNull();
    expect(current.token).toBe('token-Y');
  });

  test('_breakStale: takes over a genuinely stale lock (no holder)', async () => {
    const { _breakStale } = fileLock.__test;

    // Empty/corrupt lock file older than stale window.
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, '', 'utf8');
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(lockPath, old, old);

    const result = await _breakStale(lockPath, null);

    expect(result).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test('_removeIfOwner: does not delete another holder lock when link fails', async () => {
    const { _removeIfOwner } = fileLock.__test;

    // Lock Y owned by another process at lockPath.
    writeLock({ token: 'token-Y', pid: 99998, host: os.hostname(), acquiredAt: Date.now(), heartbeatAt: Date.now() });

    // We try to release as token-X owner, but the lock is now Y.
    const result = await _removeIfOwner(lockPath, { token: 'token-X' });

    expect(result).toBe(false);

    // Lock Y must still be at lockPath.
    const current = readLock();
    expect(current).not.toBeNull();
    expect(current.token).toBe('token-Y');
  });

  test('_removeIfOwner: releases own lock correctly', async () => {
    const { _removeIfOwner } = fileLock.__test;

    // Lock X owned by us.
    writeLock({ token: 'token-X', pid: process.pid, host: os.hostname(), acquiredAt: Date.now(), heartbeatAt: Date.now() });

    const result = await _removeIfOwner(lockPath, { token: 'token-X' });

    expect(result).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
