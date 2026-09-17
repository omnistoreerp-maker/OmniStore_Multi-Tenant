'use strict';

// ============================================================================
// SAFE APPLICATION UPDATER (runs as a SEPARATE process)
// ============================================================================
// Performs the in-app update flow started by the update rail:
//
//   1. read the update manifest
//   2. skip if the installed version is already current
//   3. download the release archive (HTTPS preferred)
//   4. verify SHA-256 against the manifest
//   5. stop the application (configurable command / service)
//   6. BACKUP the current installation (rename to <installDir>.previous-<ver>)
//   7. extract the new release into place (atomic swap)
//   8. start the application
//   9. health-check the new version
//  10. on failure: ROLL BACK to the previous installation and restart
//
// SAFETY INVARIANTS:
//   - COMPANY DATA (DIGITRONICS_DATA_DIR) is NEVER touched; the updater
//     refuses to run when the data dir resolves inside the install dir
//   - the previous installation is kept for rollback (last 2 retained)
//   - an unverified archive is never extracted (SHA-256 mismatch aborts)
//   - if anything fails BEFORE the new version is running, the ORIGINAL
//     installation is restarted — the application is never left down
//
// ENV (all optional):
//   UPDATE_MANIFEST_PATH   default backend/data/updateManifest.json
//   UPDATE_DOWNLOAD_URL    override the manifest downloadUrl
//   INSTALL_DIR            default: repo root (where backend/ + index.html live)
//   DATA_DIR               default: DIGITRONICS_DATA_DIR or backend/data
//   BACKUP_DIR             default: <installDir>/backups
//   HEALTH_URL             default: http://127.0.0.1:<PORT>/api/v1/health
//   UPDATE_STOP_COMMAND    e.g. "net stop OmniStoreBackend" (empty = no stop)
//   UPDATE_START_COMMAND   e.g. "net start OmniStoreBackend" (empty = spawn `node backend/server.js` detached)
//   UPDATE_START_CWD       working dir the app must start from (dotenv/.env location)
//   UPDATE_HEALTH_TIMEOUT_MS  default 60000
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { spawn, execSync } = require('child_process');

const log = (msg) => console.log('[' + new Date().toISOString() + '] ' + msg);

// ----------------------------- helpers -------------------------------------

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'OmniStore-Updater/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('download failed: HTTP ' + res.statusCode + ' for ' + url));
      }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve(dest)));
      out.on('error', reject);
    });
    req.setTimeout(120000, () => req.destroy(new Error('download timeout')));
    req.on('error', reject);
  });
}

function runCommand(cmd) {
  return new Promise((resolve) => {
    if (!cmd || !String(cmd).trim()) return resolve({ ok: true, skipped: true });
    try {
      const sh = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
      const out = execSync(sh === 'cmd.exe' ? `${cmd}` : cmd, { shell: sh, stdio: 'pipe', timeout: 60000 });
      log('command ok: ' + cmd);
      resolve({ ok: true, output: String(out) });
    } catch (err) {
      log('command failed (ignored): ' + cmd + ' — ' + (err.message || err));
      resolve({ ok: false, error: String(err.message || err) });
    }
  });
}

// Extract a zip archive. On Windows, prefer bsdtar (C:\Windows\System32\tar.exe,
// present on every supported Windows) — PowerShell Expand-Archive is far too
// slow for large node_modules trees (minutes vs seconds). Falls back to
// Expand-Archive if bsdtar is unavailable.
function extractZip(zip, dest) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    if (isWin) {
      const sysTar = 'C:\\Windows\\System32\\tar.exe';
      if (fs.existsSync(sysTar)) {
        try {
          execSync(`"${sysTar}" -xf "${zip}" -C "${dest}"`, { stdio: 'pipe', timeout: 300000 });
          return resolve();
        } catch (err) {
          return reject(new Error('bsdtar extraction failed: ' + (err.message || err)));
        }
      }
      const ps = `powershell -NoProfile -Command "Expand-Archive -Path '${zip}' -DestinationPath '${dest}' -Force"`;
      try {
        execSync(ps, { stdio: 'pipe', timeout: 300000 });
        resolve();
      } catch (err) {
        reject(new Error('Expand-Archive extraction failed: ' + (err.message || err)));
      }
    } else {
      try {
        execSync(`unzip -q -o "${zip}" -d "${dest}"`, { stdio: 'pipe', timeout: 300000 });
        resolve();
      } catch (err) {
        try {
          execSync(`tar -xzf "${zip}" -C "${dest}"`, { stdio: 'pipe', timeout: 300000 });
          resolve();
        } catch (err2) {
          reject(new Error('extraction failed: ' + (err2.message || err2)));
        }
      }
    }
  });
}

function waitHealthy(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      http.get(url, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve(true);
        retry();
      }).on('error', retry);
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(tick, 1500);
    };
    tick();
  });
}

// ----------------------------- main flow -----------------------------------

function main() {
  const installDir = path.resolve(process.env.INSTALL_DIR || path.join(__dirname, '..', '..', '..'));
  const manifestPath = path.resolve(process.env.UPDATE_MANIFEST_PATH || path.join(installDir, 'backend', 'data', 'updateManifest.json'));
  const dataDir = path.resolve(process.env.DATA_DIR || process.env.DIGITRONICS_DATA_DIR || path.join(installDir, 'backend', 'data'));
  const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(installDir, 'backups'));
  // PORT semantics must mirror config/index.js (parseInt + default): a
  // literal "0" in the environment (some shells set PORT=0) would otherwise
  // produce a health URL of 127.0.0.1:0.
  const port = (parseInt(process.env.PORT, 10) > 0) ? process.env.PORT : '3001';
  const healthUrl = process.env.HEALTH_URL || `http://127.0.0.1:${port}/api/v1/health`;
  const healthTimeoutMs = parseInt(process.env.UPDATE_HEALTH_TIMEOUT_MS, 10) || 60000;
  const stopCmd = process.env.UPDATE_STOP_COMMAND || '';
  const startCmd = process.env.UPDATE_START_COMMAND || '';
  // Working directory the application must be started from (where dotenv finds
  // .env). In the installed layout the .env lives at <InstallDir> while the
  // app files are at <InstallDir>\app — the installer sets UPDATE_START_CWD.
  const startCwd = path.resolve(process.env.UPDATE_START_CWD || installDir);

  // Start (or restart) the backend. Reusable for the new version, a rollback
  // restore, and the pre-swap failure recovery.
  const startApp = () => {
    if (startCmd.trim()) return runCommand(startCmd);
    return new Promise((resolve) => {
      const serverJs = path.join(installDir, 'backend', 'server.js');
      log('spawning backend: node ' + serverJs + ' (cwd=' + startCwd + ')');
      fs.mkdirSync(backupDir, { recursive: true });
      const out = fs.openSync(path.join(backupDir, 'update-app.log'), 'a');
      const child = spawn(process.execPath, [serverJs], { cwd: startCwd, detached: true, stdio: ['ignore', out, out] });
      child.unref();
      try { fs.closeSync(out); } catch (_) {}
      resolve({ ok: true });
    });
  };

  // Hard safety: never run an update whose data dir lives inside the install dir.
  const rel = path.relative(installDir, dataDir);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    log('ABORT: DATA_DIR resolves inside INSTALL_DIR. The company data directory must live OUTSIDE the application directory.');
    process.exit(2);
  }

  if (!fs.existsSync(manifestPath)) {
    log('No update manifest at ' + manifestPath + ' — nothing to do.');
    process.exit(0);
  }
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); } catch (err) {
    log('ABORT: manifest unreadable: ' + err.message);
    process.exit(1);
  }
  if (!manifest || !manifest.version || !manifest.sha256 || !manifest.downloadUrl) {
    log('ABORT: manifest missing version/sha256/downloadUrl.');
    process.exit(1);
  }

  const currentVersion = (function () {
    try { return require(path.join(installDir, 'backend', 'package.json')).version; } catch (_) { return '0.0.0'; }
  })();

  log('current version : ' + currentVersion);
  log('latest version  : ' + manifest.version);
  if (compareVersions(manifest.version, currentVersion) <= 0) {
    log('Already up to date — nothing to do.');
    process.exit(0);
  }
  if (manifest.minimumSupportedVersion && compareVersions(currentVersion, manifest.minimumSupportedVersion) < 0) {
    log('ABORT: current version ' + currentVersion + ' is below the minimum supported version ' + manifest.minimumSupportedVersion + '. Manual reinstall required.');
    process.exit(1);
  }

  // 1-4. download + verify
  fs.mkdirSync(path.join(backupDir, 'downloads'), { recursive: true });
  const zipFile = path.join(backupDir, 'downloads', 'omnistore-' + manifest.version + '.zip');
  const downloadUrl = process.env.UPDATE_DOWNLOAD_URL || manifest.downloadUrl;
  log('downloading ' + downloadUrl);
  download(downloadUrl, zipFile).then(() => {
    const actual = sha256File(zipFile);
    if (actual.toLowerCase() !== String(manifest.sha256).toLowerCase()) {
      log('ABORT: SHA-256 mismatch. expected=' + manifest.sha256 + ' actual=' + actual + ' — refusing to apply.');
      process.exit(1);
    }
    log('SHA-256 verified: ' + actual);

    // 5. stop
    return runCommand(stopCmd).then(() => {
      // Safety guard: if the application is STILL answering on the health port
      // shortly after the stop command, swapping the install dir underneath a
      // live process would corrupt the update (old process holds the port, new
      // version fails health, rollback spins). Abort BEFORE touching anything.
      return waitHealthy(healthUrl, 15000).then((stillUp) => {
        if (stillUp) {
          log('ABORT: the application is still running after the stop command (health URL still answers). Configure UPDATE_STOP_COMMAND to actually stop the backend.');
          process.exit(1);
        }
      });
    });
  }).then(async () => {
    // 6-7. stage + backup + swap (any failure here restores the ORIGINAL app)
    const staging = installDir + '.update-staging';
    const prev = installDir + '.previous-' + currentVersion;

    try {
      if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
      fs.mkdirSync(staging, { recursive: true });
      log('extracting to staging: ' + staging);
      await extractZip(zipFile, staging);

      if (fs.existsSync(prev)) fs.rmSync(prev, { recursive: true, force: true });
      log('backing up current installation -> ' + prev);
      fs.renameSync(installDir, prev);
      log('swapping new version into place');
      fs.renameSync(staging, installDir);
    } catch (err) {
      log('UPDATE FAILED before the new version could be started: ' + (err && err.message ? err.message : err));
      try {
        if (fs.existsSync(path.join(installDir, 'backend', 'server.js'))) {
          // Swap never happened — the original app is still in place.
          log('restarting the original installation');
          await startApp();
        } else if (fs.existsSync(prev)) {
          // Backup rename succeeded but the swap rename failed — restore it.
          log('restoring the previous installation after a failed swap');
          if (fs.existsSync(staging)) { try { fs.rmSync(staging, { recursive: true, force: true }); } catch (_) {} }
          fs.renameSync(prev, installDir);
          await startApp();
        } else {
          log('unable to locate an installation to restore — manual intervention required');
        }
        log('UPDATE FAILED — the original application was restarted. No company data was touched.');
      } catch (e2) {
        log('UPDATE FAILED and the application could not be restarted automatically: ' + (e2 && e2.message ? e2.message : e2));
      }
      process.exit(1);
    }

    // 8-9. start + health-check the new version
    await startApp();
    log('health check: ' + healthUrl);
    const healthy = await waitHealthy(healthUrl, healthTimeoutMs);
    if (healthy) {
      log('UPDATE SUCCESSFUL — new version ' + manifest.version + ' is running.');
      // keep the last 2 previous versions
      const prevs = fs.readdirSync(path.dirname(prev)).filter(n => n.startsWith(path.basename(installDir) + '.previous-')).sort();
      while (prevs.length > 2) {
        const oldest = path.join(path.dirname(prev), prevs.shift());
        try { fs.rmSync(oldest, { recursive: true, force: true }); log('removed old backup: ' + oldest); } catch (_) {}
      }
      process.exit(0);
    }

    // 10. rollback
    log('HEALTH CHECK FAILED — rolling back.');
    await runCommand(stopCmd);
    const failed = installDir + '.failed-' + manifest.version;
    if (fs.existsSync(failed)) fs.rmSync(failed, { recursive: true, force: true });
    fs.renameSync(installDir, failed);
    log('restoring previous installation');
    fs.renameSync(prev, installDir);
    await startApp();
    const rolledBackHealthy = await waitHealthy(healthUrl, healthTimeoutMs);
    log(rolledBackHealthy ? 'ROLLBACK OK — previous version restored.' : 'ROLLBACK FAILED — manual intervention required.');
    process.exit(rolledBackHealthy ? 3 : 4);
  }).catch((err) => {
    log('UPDATE FAILED: ' + (err && err.message ? err.message : err));
    process.exit(1);
  });
}

main();
