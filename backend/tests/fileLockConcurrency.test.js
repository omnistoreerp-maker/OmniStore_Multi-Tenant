'use strict';

// TRUE cross-process lock tests.
//
// Every scenario uses two independent Node processes (separate PIDs, separate
// module graphs) coordinated by explicit IPC messages — not by random sleeps
// and not by Promise.all alone. The parent only proceeds when a worker has
// reported the exact transition it needs (acquired / attempting / inside /
// done), so the ordering asserted here is deterministic.

const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const WORKER = path.join(__dirname, 'helpers', 'lockWorker.js');

let dir;
let lockPath;
let workers;

function readLock() {
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function start(mode, extra) {
  const child = fork(WORKER, [mode, lockPath, extra ? JSON.stringify(extra) : ''], {
    cwd: path.join(__dirname, '..'),
    silent: true
  });
  const events = [];
  const listeners = new Set();
  const exit = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));

  child.on('message', (message) => {
    const stamped = { ...message, at: Date.now() };
    events.push(stamped);
    for (const listener of [...listeners]) listener(stamped);
  });

  child.stderr.on('data', (chunk) => {
    events.push({ event: 'stderr', text: String(chunk) });
  });

  function waitFor(event, ms = 10000) {
    const existing = events.find((e) => e.event === event);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(listener);
        reject(new Error(
          `Timed out waiting for "${event}" from ${mode} (pid ${child.pid}). ` +
          `Events: ${JSON.stringify(events)}`
        ));
      }, ms);
      const listener = (message) => {
        if (message && message.event === event) {
          clearTimeout(timer);
          listeners.delete(listener);
          resolve(message);
        }
      };
      listeners.add(listener);
    });
  }

  const proc = { mode, child, pid: child.pid, events, waitFor, exit, send: (m) => child.send(m) };
  workers.push(proc);
  return proc;
}

beforeEach(() => {
  dir = makeTempDataDir('filelock-xproc');
  lockPath = path.join(dir, '.xproc.lock');
  workers = [];
});

afterEach(async () => {
  for (const proc of workers) {
    try { proc.child.kill('SIGKILL'); } catch (_) {}
  }
  await Promise.all(workers.map((p) => Promise.race([
    p.exit,
    new Promise((resolve) => setTimeout(resolve, 2000))
  ])));
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
});

registerCleanup(() => [], () => [dir]);

describe('cross-process lock — mutual exclusion', () => {
  test('a second OS process cannot acquire a lock held by a live first process', async () => {
    const holder = start('hold');
    const holderAcquired = await holder.waitFor('acquired');

    const contender = start('try', { timeout: 350 });
    await contender.waitFor('attempting');
    const timedOut = await contender.waitFor('timeout');
    await contender.exit;

    expect(timedOut.code).toBe('ELOCKED');
    expect(timedOut.pid).toBe(contender.pid);
    expect(holderAcquired.pid).toBe(holder.pid);
    expect(holder.pid).not.toBe(contender.pid);

    // Machine-readable evidence for the verification report.
    console.log('XPROC_LOCK_EVIDENCE ' + JSON.stringify({
      holderPid: holder.pid,
      contenderPid: contender.pid,
      holderToken: holderAcquired.token,
      contenderOutcome: timedOut.code
    }));
    expect(contender.events.some((e) => e.event === 'acquired')).toBe(false);
    expect(readLock().token).toBe(holderAcquired.token);

    holder.send({ event: 'release' });
    await holder.waitFor('released');
    await holder.exit;

    // The lock is genuinely free again only after the holder released it.
    const { acquire } = require('../utils/fileLock');
    const release = await acquire(lockPath, { timeout: 1000 });
    expect(readLock().token).toBe(release.token);
    await release();
  });

  test('a live holder is never evicted just because 10 seconds passed', async () => {
    const holder = start('hold');
    const acquired = await holder.waitFor('acquired');

    await new Promise((resolve) => setTimeout(resolve, 10500));

    // The worker is still alive and still holds the lock: staleness must not
    // be decided by age alone.
    const contender = start('try', { timeout: 400 });
    await contender.waitFor('attempting');
    const timedOut = await contender.waitFor('timeout');
    await contender.exit;

    expect(timedOut.code).toBe('ELOCKED');
    expect(readLock().token).toBe(acquired.token);

    holder.send({ event: 'release' });
    await holder.waitFor('released');
    await holder.exit;
  }, 25000);
});

describe('cross-process lock — crash recovery', () => {
  test('a process that dies while holding the lock does not block the store forever', async () => {
    const crashed = start('hold-crash');
    const acquired = await crashed.waitFor('acquired');
    const exit = await crashed.exit;

    expect(exit.code).toBe(7);
    expect(readLock().token).toBe(acquired.token); // lock file survives the crash

    const { acquire } = require('../utils/fileLock');
    const started = Date.now();
    const release = await acquire(lockPath, { timeout: 3000, stale: 10000, retry: 10 });

    expect(Date.now() - started).toBeLessThan(2500); // recovered immediately, no 10s wait
    expect(readLock().token).toBe(release.token);
    expect(readLock().token).not.toBe(acquired.token);
    await release();
  });
});

describe('cross-process lock — lost updates', () => {
  test('two concurrent read-modify-write processes both persist their change', async () => {
    const dataFile = path.join(dir, 'store.json');
    fs.writeFileSync(dataFile, JSON.stringify({ items: [] }), 'utf8');

    const first = start('mutate', { file: dataFile, value: 'A', holdMs: 600 });
    const second = start('mutate', { file: dataFile, value: 'B', holdMs: 0 });

    await first.waitFor('attempting');
    await second.waitFor('attempting');

    // Release first; wait until it is INSIDE the critical section, then start
    // the second process. This guarantees the second attempt overlaps a held
    // lock instead of relying on timing luck.
    first.send({ event: 'go' });
    const firstInside = await first.waitFor('inside');
    const heldWhileSecondStarts = readLock();
    expect(heldWhileSecondStarts).not.toBeNull();
    expect(heldWhileSecondStarts.token).toBe(firstInside.token);
    expect(heldWhileSecondStarts.pid).toBe(first.pid);

    second.send({ event: 'go' });
    await first.waitFor('mutated');
    await first.waitFor('done');
    await first.exit;
    const secondInside = await second.waitFor('inside');
    await second.waitFor('done');
    await second.exit;

    expect(first.pid).not.toBe(second.pid);

    const stored = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    expect(stored.items.sort()).toEqual(['A', 'B']); // no lost update

    // Ownership evidence: the second writer ran under a DIFFERENT lock token
    // than the one held when it started contending. If the first lock had been
    // stolen instead of awaited, both processes would report the same token.
    expect(secondInside.token).toBeTruthy();
    expect(secondInside.token).not.toBe(heldWhileSecondStarts.token);
  }, 25000);
});
