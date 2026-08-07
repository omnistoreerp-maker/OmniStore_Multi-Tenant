// Cleanup helpers: remove temp data dirs and stop child processes.
const fs = require('fs');
const { stopServer } = require('./testServer');

function removeDir(dir) {
  try {
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {
    // best-effort cleanup only
  }
}

// Convenience: register standard afterAll teardown for a suite.
// Usage: registerCleanup(() => [server], () => [dir1, dir2]);
function registerCleanup(getServers, getDirs) {
  afterAll(async () => {
    const servers = (getServers ? getServers() : []) || [];
    for (const s of servers) await stopServer(s);
    const dirs = (getDirs ? getDirs() : []) || [];
    for (const d of dirs) removeDir(d);
  });
}

module.exports = { removeDir, registerCleanup };
