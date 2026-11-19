// Verify a backup directory against its SHA-256 manifest, including the SQLite
// token store and login-challenge store (schema-appropriate validation).
// Exit code 0 = integrity OK, 1 = mismatch/missing/corrupt, 2 = bad usage.
//
// Usage:
//   node scripts/verify.js <backupDir>
const path = require('path');
const { verifyBackupDir } = require('./lib/backupRestore');

function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: node scripts/verify.js <backupDir>');
    process.exit(2);
  }

  const result = verifyBackupDir(path.resolve(dir));
  if (!result.manifest) {
    console.error(result.failures.map((f) => 'FAIL  ' + f.name + '  ' + f.reason).join('\n'));
    process.exit(1);
  }

  const failed = new Set(result.failures.map((f) => f.name));
  for (const name of Object.keys(result.manifest.files)) {
    console.log((failed.has(name) ? 'FAIL  ' : 'PASS  ') + name);
  }
  for (const f of result.failures) {
    if (!(f.name in result.manifest.files)) console.log('FAIL  ' + f.name + '  ' + f.reason);
  }

  if (result.ok) {
    console.log('Backup integrity OK (' + Object.keys(result.manifest.files).length + ' files, created ' + result.manifest.created + ')');
    process.exit(0);
  }
  console.error(result.failures.length + ' file(s) failed verification');
  process.exit(1);
}

main();
