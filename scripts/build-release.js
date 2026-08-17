'use strict';

// ============================================================================
// PRODUCTION RELEASE BUILDER
// ============================================================================
// Creates a clean, versioned release archive (OmniStore-<version>.zip) that
// can be installed on a clean Windows machine and consumed by the in-app
// updater (which verifies its SHA-256 against the update manifest).
//
//   npm run build:release
//
// The archive contains APPLICATION FILES ONLY — never the data directory,
// .env, backups, tests, archives or git history. Company data lives in
// DIGITRONICS_DATA_DIR (outside the app) and is never packaged.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const VERSION = require(path.join(ROOT, 'backend', 'package.json')).version;
const OUT_DIR = path.join(ROOT, 'releases');
const OUT_ZIP = path.join(OUT_DIR, `OmniStore-${VERSION}.zip`);
const STAGE = path.join(OUT_DIR, `.stage-${VERSION}`);

// Relative paths (from ROOT) included in the release.
const INCLUDE = [
  'package.json',
  '.env.example',
  'index.html',
  'manifest.json',
  'sw.js',
  'icons',
  'services',
  'plugins',
  'templates',
  'backend',
  'scripts/install-windows.ps1',
  'scripts/build-release.js'
];

// Relative paths (from ROOT) excluded — even if inside an included dir.
const EXCLUDE = [
  'backend/data',
  'backend/tests',
  'backend/coverage',
  'backend/node_modules/.cache',
  'backend/logs',
  // Development-only tooling — never ship to a company server.
  'backend/scripts/benchmark.js',
  'backend/scripts/loadTest.js',
  'backend/scripts/stressTest.js',
  'backend/scripts/verify.js'
];

// File basenames never packaged (secrets / local config).
const EXCLUDE_NAMES = ['.env', '.env.local', '.env.production', '.env.development'];
function isExcludedName(name) {
  return EXCLUDE_NAMES.some(x => name === x || name.startsWith(x + '.'));
}

const INCLUDE_FILE = new Set(INCLUDE.filter(p => !fs.statSync(path.join(ROOT, p)).isDirectory()));

function copyTree(src, dest) {
  // `base` is the source ancestor whose subtree maps onto `dest` — files are
  // placed at dest/relative(base, file), so directory structure is preserved
  // (including nested node_modules packages).
  fs.mkdirSync(dest, { recursive: true });
  const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
  const walk = (dir, base) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const r = rel(full);
      if (EXCLUDE.some(x => r === x || r.startsWith(x + '/'))) continue;
      if (isExcludedName(entry.name)) continue;
      if (entry.isDirectory()) {
        walk(full, base);
      } else {
        const target = path.join(dest, path.relative(base, full));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(full, target);
      }
    }
  };
  walk(src, src);
}

function zipDir(srcDir, zipFile) {
  if (fs.existsSync(zipFile)) fs.rmSync(zipFile);
  const isWin = process.platform === 'win32';
  if (isWin) {
    // Prefer bsdtar (Windows' system tar): Compress-Archive is known to hang on
    // large node_modules trees with many small files. `-a` auto-selects zip
    // from the .zip extension; libarchive is far faster and more reliable.
    const sysTar = 'C:\\Windows\\System32\\tar.exe';
    if (fs.existsSync(sysTar)) {
      execSync(`"${sysTar}" -a -cf "${zipFile}" -C "${srcDir}" .`, { stdio: 'inherit', timeout: 600000 });
      return;
    }
    execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${srcDir}\\*' -DestinationPath '${zipFile}' -CompressionLevel Optimal -Force"`, { stdio: 'inherit', timeout: 600000 });
  } else {
    execSync(`cd "${srcDir}" && zip -qr "${zipFile}" .`, { stdio: 'inherit', timeout: 600000 });
  }
}

console.log('Building release ' + VERSION + ' -> ' + OUT_ZIP);
fs.mkdirSync(OUT_DIR, { recursive: true });
if (fs.existsSync(STAGE)) fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

for (const p of INCLUDE) {
  const src = path.join(ROOT, p);
  if (!fs.existsSync(src)) { console.warn('WARN missing include: ' + p); continue; }
  if (INCLUDE_FILE.has(p)) {
    const dest = path.join(STAGE, p);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  } else copyTree(src, path.join(STAGE, p));
}

zipDir(STAGE, OUT_ZIP);
fs.rmSync(STAGE, { recursive: true, force: true });

const sha = require('crypto').createHash('sha256').update(fs.readFileSync(OUT_ZIP)).digest('hex');
const sizeMb = (fs.statSync(OUT_ZIP).size / 1024 / 1024).toFixed(1);
console.log('');
console.log('Release ready: ' + OUT_ZIP + '  (' + sizeMb + ' MB)');
console.log('SHA-256: ' + sha);
console.log('');
console.log('Next: publish it, then generate the update manifest:');
console.log('  npm run update:manifest -- --release-zip "' + OUT_ZIP + '" --download-url "https://<host>/OmniStore-' + VERSION + '.zip" --release-notes "..."');
