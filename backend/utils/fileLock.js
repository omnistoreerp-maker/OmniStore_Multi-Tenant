'use strict';

// Cross-process advisory lock for the JSON file store.
//
// The store is plain files, so two Node processes (two app instances, or a test
// harness) can run read-modify-write sequences against the same document
// concurrently. This lock serialises those sequences across PIDs.
//
// Design (dependency-free):
//   * Acquisition is an atomic exclusive create (`open(..., 'wx')`).
//   * Every acquisition owns a random token; the token is written into the
//     lock file immediately after creation.
//   * Release NEVER deletes a lock it does not own: it re-reads the lock,
//     compares the token, moves the file aside with an atomic rename and
//     re-verifies the token on the moved copy before deleting it.
//   * Stale recovery is based on the owner's liveness, not on age alone:
//     on the same host a lock whose PID is still alive is NEVER stolen. A
//     lock owned by a dead PID is recovered immediately (crash recovery).
//   * Take-over is race-safe: the lock is renamed to a private quarantine
//     name, the moved content is verified to be the exact lock that was
//     judged stale, and it is restored if it changed hands in between.
//   * Waiters sleep asynchronously (no event-loop blocking) and retry.
//   * `withLock` supports synchronous AND asynchronous callbacks and only
//     releases after the callback (including its promise) has settled.
//
// The lock is advisory: a writer that bypasses this helper is not blocked.
//
// Scope note: the lock protects only the code paths that opt into it. It is
// intended for short critical sections (read + write of a JSON document).

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DEFAULTS = {
  timeout: 10000,   // give up acquiring after this many ms
  stale: 10000,     // cross-host heartbeat age before a lock is considered dead
  retry: 25,        // delay between acquisition attempts
  heartbeat: 2500   // refresh interval used by cross-host liveness checks
};

function _token() {
  return crypto.randomBytes(16).toString('hex');
}

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A PID is alive when the OS accepts signal 0. EPERM means it exists but is
// owned by another user, which still counts as alive.
function _pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

async function _readMeta(lockPath) {
  try {
    const raw = await fsp.readFile(lockPath, 'utf8');
    const meta = JSON.parse(raw);
    if (!meta || typeof meta !== 'object' || !meta.token) {
      return { meta: null, raw };
    }
    return { meta, raw };
  } catch (err) {
    return { meta: null, raw: null, code: err && err.code };
  }
}

function _sameHost(meta) {
  return String(meta.host || '') === os.hostname();
}

// A lock is stale when its owner can no longer be writing.
// Same host: a live PID always wins, no matter how old the file is.
// Different host: fall back to the heartbeat timestamp.
function _isStale(meta, stat, options) {
  if (!meta) {
    // Unparseable/empty lock file: only recover once it is old enough that a
    // creator could not still be between create and write.
    return !!stat && Date.now() - stat.mtimeMs > options.stale;
  }

  if (_sameHost(meta) && meta.pid) {
    const pid = Number(meta.pid);
    if (pid === process.pid) return false; // re-entrant/own lock: never steal
    return !_pidAlive(pid);               // dead owner -> recover
  }

  const last = Number(meta.heartbeatAt || meta.acquiredAt || (stat && stat.mtimeMs) || 0);
  if (!last) return false;
  return Date.now() - last > options.stale;
}

async function _tryCreate(lockPath, meta) {
  let fd;
  try {
    fd = fs.openSync(lockPath, 'wx');
  } catch (err) {
    if (err && err.code === 'EEXIST') return false;
    throw err;
  }
  try {
    fs.writeFileSync(fd, JSON.stringify(meta));
  } catch (err) {
    try { fs.closeSync(fd); } catch (_) {}
    try { fs.unlinkSync(lockPath); } catch (_) {}
    throw err;
  }
  try { fs.closeSync(fd); } catch (_) {}
  return true;
}

// Atomically remove a stale lock, but only if it is still the exact lock that
// was judged stale. Renaming first removes it from the shared path in one
// step; verifying the moved content prevents deleting a fresher lock that was
// created in the race window.
async function _breakStale(lockPath, expectedMeta) {
  const quarantine = `${lockPath}.stale-${_token()}`;
  try {
    await fsp.rename(lockPath, quarantine);
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }

  let moved = null;
  try {
    moved = JSON.parse(await fsp.readFile(quarantine, 'utf8'));
  } catch (_) {
    moved = null;
  }

  const expectedToken = expectedMeta ? expectedMeta.token : null;
  const movedToken = moved && moved.token ? moved.token : null;

  if (expectedToken !== movedToken) {
    // The lock changed hands between inspection and rename: put it back and
    // let the caller retry instead of silently stealing a live lock.
    const linkOk = await fsp.link(quarantine, lockPath)
      .then(() => true)
      .catch(() => false);
    if (!linkOk) {
      // Another process created lockPath between rename and link. Quarantine
      // still holds the old lock data; do not delete it. Return false so the
      // caller retries instead of stealing a live lock.
      return false;
    }
    await fsp.unlink(quarantine).catch(() => {});
    return false;
  }

  await fsp.unlink(quarantine).catch(() => {});
  return true;
}

// Refresh the lock's heartbeat. `state` is the owning handle's lifecycle
// object: once `state.released` is set, no heartbeat may publish anything.
//
// Two guards are required, not one:
//   1. `state.released` is checked on entry AND again after the async write,
//      because a heartbeat that started before release() must abort instead of
//      renaming its temp copy over the (now removed) lock path.
//   2. Ownership is re-read from disk immediately before the final rename, so
//      even a heartbeat that was never told about the release (or that raced a
//      take-over) cannot resurrect a lock file it no longer owns.
// The check is deliberately placed AFTER the write: an entry-only check leaves
// the whole write duration open to a release.
async function _heartbeat(lockPath, meta, state) {
  if (state && state.released) return;
  const { meta: current } = await _readMeta(lockPath);
  if (!current || current.token !== meta.token) return; // lost ownership
  if (state && state.released) return; // released while we were reading

  meta.heartbeatAt = Date.now();
  const tmp = `${lockPath}.hb-${meta.token}`;
  await fsp.writeFile(tmp, JSON.stringify(meta));

  // Final guard, placed after the async write and immediately before rename.
  const { meta: latest } = await _readMeta(lockPath);
  if ((state && state.released) || !latest || latest.token !== meta.token) {
    await fsp.unlink(tmp).catch(() => {});
    return;
  }

  try {
    await fsp.rename(tmp, lockPath);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
}

async function _removeIfOwner(lockPath, meta) {
  const { meta: current } = await _readMeta(lockPath);
  if (!current || current.token !== meta.token) return false;

  const quarantine = `${lockPath}.rel-${meta.token}`;
  try {
    await fsp.rename(lockPath, quarantine);
  } catch (_) {
    return false;
  }

  let moved = null;
  try {
    moved = JSON.parse(await fsp.readFile(quarantine, 'utf8'));
  } catch (_) {
    moved = null;
  }

  if (moved && moved.token && moved.token !== meta.token) {
    // A different holder appeared inside the window: restore it.
    const linkOk = await fsp.link(quarantine, lockPath)
      .then(() => true)
      .catch(() => false);
    if (!linkOk) {
      // lockPath was recreated by another process; do not delete quarantine.
      return false;
    }
  }

  await fsp.unlink(quarantine).catch(() => {});
  return true;
}

function _makeHandle(lockPath, meta, options) {
  // Shared lifecycle state: `released` is read by every heartbeat before it
  // touches the lock path.
  const state = { released: false };
  // Heartbeats are serialised into one chain so release() can wait for the
  // refresh that is already running. This is what makes the ordering provable:
  // an in-flight heartbeat finishes (and renames) BEFORE removal starts, so no
  // heartbeat can rename afterwards and recreate the lock file.
  let heartbeatChain = Promise.resolve();

  const interval = Math.max(50, Math.min(options.heartbeat, Math.floor(options.stale / 2)));
  const timer = setInterval(() => {
    heartbeatChain = heartbeatChain
      .then(() => _heartbeat(lockPath, meta, state))
      .catch(() => {});
  }, interval);
  if (timer.unref) timer.unref();

  async function release() {
    if (state.released) return;
    // Publish the state FIRST: a heartbeat that has not started yet aborts at
    // its entry check, and one already running is awaited below.
    state.released = true;
    clearInterval(timer);
    await heartbeatChain;
    await _removeIfOwner(lockPath, meta);
  }

  release.token = meta.token;
  release.pid = meta.pid;
  release.isHeld = async function isHeld() {
    const { meta: current } = await _readMeta(lockPath);
    return !!current && current.token === meta.token;
  };
  return release;
}

// Acquire `lockPath` and resolve with a release function.
// Rejects with code ELOCKED when the lock cannot be obtained before `timeout`.
async function acquire(lockPath, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const timeout = Number(opts.timeout) > 0 ? Number(opts.timeout) : DEFAULTS.timeout;
  const stale = Number(opts.stale) > 0 ? Number(opts.stale) : DEFAULTS.stale;
  const retry = Number(opts.retry) > 0 ? Number(opts.retry) : DEFAULTS.retry;
  const heartbeat = Number(opts.heartbeat) > 0 ? Number(opts.heartbeat) : DEFAULTS.heartbeat;
  const settings = { timeout, stale, retry, heartbeat };
  const deadline = Date.now() + timeout;

  await fsp.mkdir(path.dirname(lockPath), { recursive: true });

  const meta = {
    token: _token(),
    pid: process.pid,
    host: os.hostname(),
    acquiredAt: Date.now(),
    heartbeatAt: Date.now()
  };

  for (;;) {
    if (await _tryCreate(lockPath, meta)) {
      return _makeHandle(lockPath, meta, settings);
    }

    const { meta: current } = await _readMeta(lockPath);
    const stat = await fsp.stat(lockPath).catch(() => null);
    if (!stat) continue; // released between create and read

    if (_isStale(current, stat, settings)) {
      if (await _breakStale(lockPath, current)) continue;
    }

    if (Date.now() >= deadline) {
      const err = new Error('Timed out acquiring file lock');
      err.code = 'ELOCKED';
      err.lockPath = lockPath;
      throw err;
    }

    await _sleep(Math.min(retry, Math.max(1, deadline - Date.now())));
  }
}

// Run `fn` while holding the lock. Supports sync and async callbacks; the
// lock is released only after `fn` (and its returned promise) settles.
async function withLock(lockPath, fn, options) {
  const release = await acquire(lockPath, options);
  try {
    return await fn();
  } finally {
    await release();
  }
}

async function isLocked(lockPath) {
  const { meta } = await _readMeta(lockPath);
  return !!meta;
}

module.exports = {
  acquire,
  withLock,
  isLocked,
  _pidAlive,
  // Internal seams for the deterministic heartbeat/release race tests.
  __test: { _heartbeat, _removeIfOwner, _breakStale, _makeHandle }
};
