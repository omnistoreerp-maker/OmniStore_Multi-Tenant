'use strict';

// Standalone child-process worker for the cross-process linking test.
//
// Usage:
//   node googleLinkWorker.js <dataDir> <userId> <googleSub> <startAtMs> <resultPath>
//
// The worker boots its own module graph (its own fileStore cache and PID),
// waits for the shared start timestamp, then performs the REAL link operation
// against the shared temporary data directory.

const fs = require('fs');

const [, , dataDir, userId, googleSub, startAtRaw, resultPath] = process.argv;

process.env.DIGITRONICS_DATA_DIR = dataDir;
process.env.NODE_ENV = 'test';
process.env.AUTH_REQUIRED = 'false';

function writeResult(result) {
  fs.writeFileSync(resultPath, JSON.stringify(result), 'utf-8');
}

(async () => {
  const oauthService = require('../../services/oauth.service');

  const startAt = Number(startAtRaw);
  const wait = startAt - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

  try {
    const result = await oauthService.linkProvider(userId, 'google', {
      id: googleSub,
      emails: []
    });

    writeResult({
      pid: process.pid,
      ok: !result.error,
      conflict: !!result.conflict,
      alreadyLinked: !!result.alreadyLinked,
      error: result.error || null,
      linkedUser: result.user ? result.user.id : null
    });
    process.exit(0);
  } catch (err) {
    writeResult({
      pid: process.pid,
      ok: false,
      crash: true,
      error: err && err.message ? err.message : String(err)
    });
    process.exit(1);
  }
})();
