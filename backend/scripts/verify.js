// Verify a backup directory against its SHA-256 manifest.
// Also verifies SQLite token store if present.
// Usage:
//   node scripts/verify.js <backupDir>
// Exit code 0 = integrity OK, 1 = mismatch/missing, 2 = bad usage.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: node scripts/verify.js <backupDir>');
    process.exit(2);
  }
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('manifest.json not found in ' + dir);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  let failures = 0;
  for (const [name, meta] of Object.entries(manifest.files)) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) {
      console.log('FAIL  ' + name + '  missing');
      failures++;
      continue;
    }
    const bytes = fs.statSync(file).size;
    const hash = sha256(file);
    const ok = bytes === meta.bytes && hash === meta.sha256;

    // Validate JSON only for .json files; the SQLite token store is validated
    // against the real schema/integrity rules instead of being parsed as JSON.
    if (name.endsWith('.json')) {
      try { JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
        console.log('FAIL  ' + name + '  invalid JSON: ' + e.message);
        failures++;
        continue;
      }
    }
    if (name.endsWith('.sqlite')) {
      try {
        require('../utils/tokenStore.sqlite').validateDatabaseFile(file);
      } catch (e) {
        console.log('FAIL  ' + name + '  invalid token store: ' + e.message);
        failures++;
        continue;
      }
    }
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '  checksum/size mismatch'));
    if (!ok) failures++;
  }

  console.log(failures === 0
    ? 'Backup integrity OK (' + Object.keys(manifest.files).length + ' files, created ' + manifest.created + ')'
    : failures + ' file(s) failed verification');
  process.exit(failures === 0 ? 0 : 1);
}

main();
