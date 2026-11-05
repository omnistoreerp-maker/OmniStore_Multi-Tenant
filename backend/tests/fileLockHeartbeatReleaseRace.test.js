'use strict';

// Deterministic race test for heartbeat vs release in fileLock.
//
// Tests that a heartbeat in flight cannot resurrect a lock file after
// release() has removed it. Uses the exported __test seams (_heartbeat,
// _removeIfOwner, _makeHandle) for direct control.

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
  dir = makeTempDataDir('filelock-hb-release-race');
  lockPath = path.join(dir, '.test.lock');
});

afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
});

describe('fileLock — heartbeat vs release race (deterministic)', () => {
  test('heartbeat does not recreate lock after release removed it', async () => {
    const { _heartbeat, _removeIfOwner, _makeHandle } = fileLock.__test;

    // Create a handle for token-X.
    writeLock({ token: 'token-X', pid: process.pid, host: os.hostname(), acquiredAt: Date.now(), heartbeatAt: Date.now() });

    const release = _makeHandle(lockPath, { token: 'token-X', pid: process.pid, host: os.hostname() }, {
      timeout: 10000,
      stale: 10000,
      retry: 25,
      heartbeat: 2500
    });

    // Manually trigger a heartbeat. It should succeed (we own the lock).
    await _heartbeat(lockPath, { token: 'token-X', pid: process.pid, host: os.hostname(), acquiredAt: Date.now(), heartbeatAt: Date.now() }, { released: false });
    expect(readLock().token).toBe('token-X');

    // Now release: sets released=true, awaits heartbeatChain, then removes.
    await release();

    // Lock must be removed.
    expect(readLock()).toBeNull();

    // Now simulate a heartbeat that was in flight BEFORE release but completes
    // AFTER release removed the lock. It must NOT recreate the lock.
    await _heartbeat(lockPath, { token: 'token-X', pid: process.pid, host: os.hostname(), acquiredAt: Date.now(), heartbeatAt: Date.now() }, { released: true });

    // Lock must STILL be null — heartbeat must not resurrect it.
    expect(readLock()).toBeNull();
  });

  test('heartbeat that lost ownership does not rename over a new lock', async () => {
    const { _heartbeat } = fileLock.__test;

    // Lock X at lockPath.
    writeLock({ token: 'token-X', pid: 99999, host: os.hostname(), acquiredAt: 0, heartbeatAt: 0 });

    // A new holder Y replaces X at lockPath.
    writeLock({ token: 'token-Y', pid: process.pid, host: os.hostname(), acquiredAt: Date.now(), heartbeatAt: Date.now() });

    // Heartbeat for old token X: reads meta, sees Y (not X), returns early.
    await _heartbeat(lockPath, { token: 'token-X', pid: 99999, host: os.hostname(), acquiredAt: 0, heartbeatAt: 0 }, { released: false });

    // Lock Y must still be at lockPath — heartbeat did not rename over it.
    expect(readLock().token).toBe('token-Y');
  });
});
