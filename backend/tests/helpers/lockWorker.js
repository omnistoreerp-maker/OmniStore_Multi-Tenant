'use strict';

// Standalone worker for the cross-process lock tests.
//
// Usage: node lockWorker.js <mode> <lockPath> <json-extra>
//
// Modes:
//   hold        acquire, report, wait for {event:'release'}, release, exit 0
//   hold-crash  acquire, report, exit(7) WITHOUT releasing (simulated crash)
//   try         report, attempt with the given timeout, report timeout/success
//   mutate      report, wait for {event:'go'}, then read-modify-write a JSON
//               file while holding the lock (optional in-lock hold)

const fs = require('fs');
const fileLock = require('../../utils/fileLock');

const [, , mode, lockPath, extraRaw] = process.argv;
const extra = extraRaw ? JSON.parse(extraRaw) : {};

function send(message) {
  try { if (process.send) process.send(message); } catch (_) {}
}

function waitFor(event) {
  return new Promise((resolve) => {
    const handler = (message) => {
      if (message && message.event === event) {
        process.off('message', handler);
        resolve(message);
      }
    };
    process.on('message', handler);
  });
}

(async () => {
  try {
    if (mode === 'hold') {
      const release = await fileLock.acquire(lockPath, { timeout: 8000, retry: 10 });
      send({ event: 'acquired', pid: process.pid, token: release.token });
      await waitFor('release');
      await release();
      send({ event: 'released', pid: process.pid });
      process.exit(0);
    }

    if (mode === 'hold-crash') {
      const release = await fileLock.acquire(lockPath, { timeout: 8000, retry: 10 });
      send({ event: 'acquired', pid: process.pid, token: release.token });
      process.exit(7); // deliberately no release()
    }

    if (mode === 'try') {
      send({ event: 'attempting', pid: process.pid });
      try {
        const release = await fileLock.acquire(lockPath, {
          timeout: Number(extra.timeout) > 0 ? Number(extra.timeout) : 300,
          retry: 10
        });
        send({ event: 'acquired', pid: process.pid, token: release.token });
        await waitFor('release');
        await release();
        send({ event: 'released', pid: process.pid });
        process.exit(0);
      } catch (err) {
        send({ event: 'timeout', pid: process.pid, code: err.code, message: err.message });
        process.exit(0);
      }
    }

    if (mode === 'mutate') {
      send({ event: 'attempting', pid: process.pid });
      await waitFor('go');
      await fileLock.withLock(lockPath, async () => {
        let heldToken = null;
        try { heldToken = JSON.parse(fs.readFileSync(lockPath, 'utf8')).token; } catch (_) {}
        send({ event: 'inside', pid: process.pid, token: heldToken });
        if (extra.holdMs) await new Promise((r) => setTimeout(r, extra.holdMs));
        const db = JSON.parse(fs.readFileSync(extra.file, 'utf8'));
        db.items.push(extra.value);
        fs.writeFileSync(extra.file, JSON.stringify(db));
        send({ event: 'mutated', pid: process.pid, value: extra.value });
      }, { timeout: 8000, retry: 10 });
      send({ event: 'done', pid: process.pid });
      process.exit(0);
    }

    send({ event: 'error', pid: process.pid, message: 'unknown mode ' + mode });
    process.exit(2);
  } catch (err) {
    send({ event: 'error', pid: process.pid, message: err && err.message, code: err && err.code });
    process.exit(1);
  }
})();
