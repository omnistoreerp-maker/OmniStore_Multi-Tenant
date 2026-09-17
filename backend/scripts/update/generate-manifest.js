'use strict';

// ============================================================================
// UPDATE MANIFEST GENERATOR
// ============================================================================
// Creates the update manifest consumed by the in-app update rail from a
// release archive:
//
//   npm run update:manifest -- \
//     --release-zip ./releases/OmniStore-1.0.1.zip \
//     --download-url "https://updates.example.com/OmniStore-1.0.1.zip" \
//     --version 1.0.1 \
//     --release-notes "Fixes X, adds Y" \
//     [--mandatory] [--minimum-supported 1.0.0]
//
// Writes backend/data/updateManifest.json (override with UPDATE_MANIFEST_PATH).
// The manifest contains ONLY version metadata + HTTPS download URL + sha256 +
// release notes — never secrets.
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val !== undefined && !val.startsWith('--')) { args[key] = val; i++; } else { args[key] = 'true'; }
    }
  }
  return args;
}

const argv = parseArgs(process.argv.slice(2));
const val = (flag, envKey, fallback) => argv[flag] !== undefined ? argv[flag] : (process.env[envKey] || fallback);

function fail(msg) {
  console.error('ERROR: ' + msg);
  console.error('Usage: npm run update:manifest -- --release-zip <file.zip> --download-url <https-url> [--version 1.0.1] [--release-notes "..."] [--mandatory] [--minimum-supported 1.0.0]');
  process.exit(1);
}

const zipPath = (val('release-zip', 'RELEASE_ZIP', '') || '').trim();
const downloadUrl = (val('download-url', 'UPDATE_DOWNLOAD_URL', '') || '').trim();
const version = (val('version', 'RELEASE_VERSION', '') || '').trim() || require('../../package.json').version;
const releaseNotes = (val('release-notes', 'RELEASE_NOTES', '') || '').trim();
const mandatory = argv['mandatory'] === 'true' || val('mandatory', 'UPDATE_MANDATORY', '') === 'true';
const minimumSupportedVersion = (val('minimum-supported', 'MINIMUM_SUPPORTED_VERSION', '') || '').trim();

if (!zipPath) fail('--release-zip is required');
if (!fs.existsSync(zipPath)) fail('release zip not found: ' + zipPath);
if (!downloadUrl) fail('--download-url is required (HTTPS recommended)');
if (!/^https?:\/\//i.test(downloadUrl)) fail('download URL must start with http(s)://');

const sha256 = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');

const manifest = {
  version,
  releaseDate: new Date().toISOString().slice(0, 10),
  downloadUrl,
  sha256,
  mandatory,
  releaseNotes,
  minimumSupportedVersion
};

const outPath = path.resolve(process.env.UPDATE_MANIFEST_PATH || path.join(__dirname, '..', '..', 'data', 'updateManifest.json'));
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');

console.log('Manifest written: ' + outPath);
console.log(JSON.stringify(manifest, null, 2));
