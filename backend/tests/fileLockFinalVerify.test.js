'use strict';

// Deterministic real-filesystem race tests for fileLock quarantine and release.
//
// Uses jest.spyOn(fsp, 'link') as synchronization barrier—not to fake
// results, but to pause execution at the exact point where link() is about
// to be called, so the test can create a conflicting lock at lockPath first.
//
// All filesystem operations are real; no mocks force EEXIST.

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

function waitFor(condition, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (condition()) resolve();
      else if (Date.now() - start > timeoutMs) reject(new Error('timeout waiting for condition'));
      else setImmediate(check);
    };
    check();
  });
}

beforeEach(() => {
  dir = makeTempDataDir('filelock-final-verify');
  lockPath = path.join(dir, '.test.lock');
});

afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
});

describe('fileLock — final verification: real filesystem races', () => {
  test('Test A — _breakStale: real EEXIST on link preserves quarantine and other holder lock', async () => {
    const { _breakStale } = fileLock.__test;

    // Lock Y is at lockPath (another holder).
    writeLock({ token: 'token-Y', pid: 99999, host: os.hostname(), acquiredAt: Date.now(), heartbeatAt: Date.now() });

    let releaseLink = null;
    let linkCalled = false;
    const originalLink = fsp.link.bind(fsp);
    const spy = jest.spyOn(fsp, 'link').mockImplementation((oldPath, newPath) => {
      if (!linkCalled && oldPath.startsWith(lockPath + '.stale-') && newPath === lockPath) {
        linkCalled = true;
        // Return a promise that we control—pause before calling originalLink.
        return new Promise((resolve) => {
          releaseLink = () => resolve(originalLink(oldPath, newPath));
        });
      }
      return originalLink(oldPath, newPath);
    });

    // Run _breakStale: it will pause at fsp.link(quarantine -> lockPath).
    const breakStalePromise = _breakStale(lockPath, { token: 'token-X' });

    // Wait until _breakStale has called fsp.link (linkCalled = true).
    await waitFor(() => linkCalled);

    // Another process creates a conflicting lock at lockPath.
    writeLock({ token: 'token-Z', pid: 12345, host: os.hostname(), acquiredAt: Date.now(), heartbeatAt: Date.now() });

    // Resume fsp.link: originalLink(quarantine, lockPath) will fail with EEXIST
    // because lockPath now holds token-Z.
    releaseLink();

    const result = await breakStalePromise;

    expect(result).toBe(false);

    // Quarantine must still exist with token-Y (not deleted).
    const quarantineFiles = listQuarantine().filter((f) => f.includes('stale-'));
    expect(quarantineFiles.length).toBe(1);
    const qContent = JSON.parse(fs.readFileSync(path.join(dir, quarantineFiles[0]), 'utf8'));
    expect(qContent.token).toBe('token-Y');

    // lockPath must still hold token-Z (the conflicting lock).
    const current = readLock();
    expect(current).not.toBeNull();
    expect(current.token).toBe('token-Z');

    spy.mockRestore();
  });

  test('Test B — _removeIfOwner: token mismatch returns false without deleting anything', async () => {
    const { _removeIfOwner } = fileLock.__test;

    // Lock Y owned by another process at lockPath.
    writeLock({ token: 'token-Y', pid: 54321, host: os.hostname(), acquiredAt: Date.now(), heartbeatAt: Date.now() });

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

  test('Test C — heartbeat does not resurrect lock after release removed it', async () => {
    const { _heartbeat, _makeHandle } = fileLock.__test;

    // Create lock X at lockPath.
    writeLock({ token: 'token-X', pid: process.pid, host: os.hostname(), acquiredAt: Date.now(), heartbeatAt: Date.now() });

    const release = _makeHandle(lockPath, { token: 'token-X', pid: process.pid, host: os.hostname() }, {
      timeout: 10000,
      stale: 10000,
      retry: 25,
      heartbeat: 2500,
    });

    // Heartbeat succeeds while we own the lock.
    await _heartbeat(lockPath, { token: 'token-X', pid: process.pid, host: os.hostname(), acquiredAt: Date.now(), heartbeatAt: Date.now() }, { released: false });
    expect(readLock().token).toBe('token-X');

    // Release: sets released=true, clears interval, awaits heartbeatChain,
    // then calls _removeIfOwner which removes lockPath.
    await release();
    expect(readLock()).toBeNull();

    // Heartbeat that was "in flight" before release but completes after:
    // state.released is true, so it must NOT rename temp → lockPath.
    await _heartbeat(lockPath, { token: 'token-X', pid: process.pid, host: os.hostname(), acquiredAt: Date.now(), heartbeatAt: Date.now() }, { released: true });
    expect(readLock()).toBeNull();

    // No quarantine or temp files left behind.
    const remaining = fs.readdirSync(dir);
    expect(remaining.length).toBe(0);
  });
});
