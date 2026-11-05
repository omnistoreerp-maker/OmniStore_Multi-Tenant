'use strict';

// Unit-level tests for backend/utils/fileLock.js.
//
// These exercise the real lock module in-process: ownership tokens, release
// safety, live-owner protection, dead-owner recovery, idempotent release and
// sync/async callback handling. Cross-process ordering lives in
// fileLockConcurrency.test.js.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const fileLock = require('../utils/fileLock');
const { makeTempDataDir } = require('./helpers/testData');

let dir;
let lockPath;

function readLock() {
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeLock(meta) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify(meta), 'utf8');
}

function deadPid() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', () => resolve(child.pid));
  });
}

beforeEach(() => {
  dir = makeTempDataDir('filelock-unit');
  lockPath = path.join(dir, '.test.lock');
});

afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
});

describe('fileLock — ownership and release', () => {
  test('acquires, exposes an ownership token, and releases its own lock', async () => {
    const release = await fileLock.acquire(lockPath, { timeout: 1000 });
    const held = readLock();

    expect(held.token).toBe(release.token);
    expect(held.pid).toBe(process.pid);
    expect(await release.isHeld()).toBe(true);

    await release();

    expect(fs.existsSync(lockPath)).toBe(false);
    expect(await release.isHeld()).toBe(false);
  });

  test('a second acquisition cannot take a lock held by a live owner', async () => {
    const release = await fileLock.acquire(lockPath, { timeout: 1000 });

    await expect(fileLock.acquire(lockPath, { timeout: 250, retry: 10 }))
      .rejects.toMatchObject({ code: 'ELOCKED' });

    expect(readLock().token).toBe(release.token);
    await release();
  });

  test('release is idempotent and safe to call twice', async () => {
    const release = await fileLock.acquire(lockPath, { timeout: 1000 });

    await release();
    await expect(release()).resolves.toBeUndefined();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test('a stale handle cannot delete a lock created after a takeover', async () => {
    const first = await fileLock.acquire(lockPath, { timeout: 1000 });
    const firstToken = first.token;

    // Simulate an administrative/OS recovery: the old file is removed and a
    // new holder acquires. The old handle must not delete the new lock.
    fs.unlinkSync(lockPath);
    const second = await fileLock.acquire(lockPath, { timeout: 1000 });

    expect(second.token).not.toBe(firstToken);
    await first();

    const current = readLock();
    expect(current).not.toBeNull();
    expect(current.token).toBe(second.token);
    expect(await second.isHeld()).toBe(true);

    await second();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test('release only removes the exact lock it acquired', async () => {
    const release = await fileLock.acquire(lockPath, { timeout: 1000 });

    // Replace the payload behind the handle's back with a different owner.
    writeLock({ token: 'someone-else', pid: process.pid, host: os.hostname(), acquiredAt: Date.now() });
    await release();

    expect(readLock()).toEqual(expect.objectContaining({ token: 'someone-else' }));
  });
});

describe('fileLock — staleness is owner liveness, not age', () => {
  test('never steals a lock whose owning PID is still alive, even after the stale window', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });

    writeLock({
      token: 'live-owner',
      pid: child.pid,
      host: os.hostname(),
      acquiredAt: Date.now() - 60000,
      heartbeatAt: Date.now() - 60000
    });

    try {
      await expect(fileLock.acquire(lockPath, { timeout: 400, stale: 50, retry: 10 }))
        .rejects.toMatchObject({ code: 'ELOCKED' });
      expect(readLock().token).toBe('live-owner');
    } finally {
      child.kill();
    }
  });

  test('recovers a lock left by a dead process on the same host without waiting for the stale window', async () => {
    const pid = await deadPid();
    writeLock({
      token: 'dead-owner',
      pid,
      host: os.hostname(),
      acquiredAt: Date.now() - 60000,
      heartbeatAt: Date.now() - 60000
    });

    const started = Date.now();
    const release = await fileLock.acquire(lockPath, { timeout: 2000, stale: 10000, retry: 10 });
    const elapsed = Date.now() - started;

    expect(readLock().token).toBe(release.token);
    expect(readLock().token).not.toBe('dead-owner');
    expect(elapsed).toBeLessThan(1500); // recovered immediately, not after 10s
    await release();
  });

  test('recovers an empty/corrupt lock file once it is older than the stale window', async () => {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, '', 'utf8');
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(lockPath, old, old);

    const release = await fileLock.acquire(lockPath, { timeout: 2000, stale: 1000, retry: 10 });
    expect(readLock().token).toBe(release.token);
    await release();
  });

  test('does not recover an unreadable lock that is still being created', async () => {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, '', 'utf8'); // fresh empty file

    await expect(fileLock.acquire(lockPath, { timeout: 300, stale: 10000, retry: 10 }))
      .rejects.toMatchObject({ code: 'ELOCKED' });
  });
});

describe('fileLock — callback handling', () => {
  test('holds the lock for the whole async callback and releases afterwards', async () => {
    let signalInside;
    let openGate;
    const inside = new Promise((resolve) => { signalInside = resolve; });
    const gate = new Promise((resolve) => { openGate = resolve; });
    let heldDuringCallback = null;

    const pending = fileLock.withLock(lockPath, async () => {
      signalInside();
      await gate;
      heldDuringCallback = fs.existsSync(lockPath);
      return 'done';
    }, { timeout: 1000 });

    await inside; // callback is now running and the lock must be held

    await expect(fileLock.acquire(lockPath, { timeout: 150, retry: 10 }))
      .rejects.toMatchObject({ code: 'ELOCKED' });

    openGate();
    await expect(pending).resolves.toBe('done');
    expect(heldDuringCallback).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test('supports synchronous callbacks and releases on throw', async () => {
    const value = await fileLock.withLock(lockPath, () => 42, { timeout: 1000 });
    expect(value).toBe(42);
    expect(fs.existsSync(lockPath)).toBe(false);

    await expect(fileLock.withLock(lockPath, () => { throw new Error('boom'); }, { timeout: 1000 }))
      .rejects.toThrow('boom');
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test('releases the lock when the async callback rejects', async () => {
    await expect(fileLock.withLock(lockPath, async () => {
      await new Promise((r) => setTimeout(r, 20));
      throw new Error('async boom');
    }, { timeout: 1000 })).rejects.toThrow('async boom');

    expect(fs.existsSync(lockPath)).toBe(false);
  });
});

// W2 — heartbeat/release race.
//
// A heartbeat that read the lock before release() must never rename its temp
// copy back onto the lock path afterwards. These tests are deterministic: the
// heartbeat is stopped at an explicit barrier (no random sleeps), and the
// release ordering is asserted directly (release may not complete while a
// heartbeat is still running).
describe('fileLock — heartbeat cannot resurrect a released lock', () => {
  test('release waits for an in-flight heartbeat and the lock stays released', async () => {
    const fsp = fs.promises;
    const originalWrite = fsp.writeFile;
    let heartbeatBlocked;
    const blocked = new Promise((resolve) => { heartbeatBlocked = resolve; });
    let openGate;
    const gate = new Promise((resolve) => { openGate = resolve; });
    let intercepted = false;

    const spy = jest.spyOn(fsp, 'writeFile').mockImplementation(async (target, data, ...rest) => {
      if (!intercepted && String(target).includes('.hb-')) {
        intercepted = true;
        heartbeatBlocked();
        await gate;
      }
      return originalWrite(target, data, ...rest);
    });

    const release = await fileLock.acquire(lockPath, { timeout: 1000, heartbeat: 50 });
    try {
      await blocked; // heartbeat has read the lock and is mid-refresh

      let releaseSettled = false;
      const releasing = release().then(() => { releaseSettled = true; });

      // The gate is still closed, so the heartbeat cannot finish: release must
      // therefore still be pending. Before the fix release() resolved here and
      // the heartbeat renamed the lock back into existence afterwards.
      await new Promise((r) => setTimeout(r, 50));
      expect(releaseSettled).toBe(false);

      openGate();
      await releasing;

      expect(fs.existsSync(lockPath)).toBe(false);
      expect(await release.isHeld()).toBe(false);
      expect(fs.readdirSync(dir).filter((f) => f.includes('.hb-'))).toEqual([]);

      // A later acquisition in the same process must succeed.
      const fresh = await fileLock.acquire(lockPath, { timeout: 1000 });
      expect(await fresh.isHeld()).toBe(true);
      await fresh();
      expect(fs.existsSync(lockPath)).toBe(false);
    } finally {
      openGate();
      spy.mockRestore();
    }
  });

  test('a heartbeat that learns about release before writing does nothing', async () => {
    const release = await fileLock.acquire(lockPath, { timeout: 1000 });
    const meta = readLock();
    await release();

    await fileLock.__test._heartbeat(lockPath, meta, { released: true });

    expect(fs.existsSync(lockPath)).toBe(false);
    expect(fs.readdirSync(dir).filter((f) => f.includes('.hb-'))).toEqual([]);
  });

  test('a heartbeat that loses the lock during its write aborts before renaming', async () => {
    const fsp = fs.promises;
    const originalWrite = fsp.writeFile;
    const release = await fileLock.acquire(lockPath, { timeout: 1000 });
    const meta = readLock();

    // Simulate release()/take-over completing while the heartbeat is writing:
    // the lock disappears between the initial read and the final rename.
    const spy = jest.spyOn(fsp, 'writeFile').mockImplementation(async (target, data, ...rest) => {
      if (String(target).includes('.hb-') && fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
      }
      return originalWrite(target, data, ...rest);
    });

    try {
      await fileLock.__test._heartbeat(lockPath, meta, { released: false });
      expect(fs.existsSync(lockPath)).toBe(false); // not resurrected
      expect(fs.readdirSync(dir).filter((f) => f.includes('.hb-'))).toEqual([]);
    } finally {
      spy.mockRestore();
      await release();
    }
  });
});
