// Backup backend/data (JSON stores + SQLite token/challenge stores) into a
// timestamped directory with a SHA-256 manifest for integrity verification.
//
// Guarantees live in scripts/lib/backupRestore.js. This wrapper only parses
// arguments and maps a thrown error to a non-zero exit code.
//
// Usage:
//   node scripts/backup.js [--dir <dataDir>] [--out <backupsRoot>]
// Defaults: --dir ../data (backend/data), --out ../backups (backend/backups)
const path = require('path');
const { runBackup } = require('./lib/backupRestore');

function parseArgs(argv) {
  const args = { dir: path.join(__dirname, '..', 'data'), out: path.join(__dirname, '..', 'backups') };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dir') args.dir = path.resolve(argv[++i]);
    else if (argv[i] === '--out') args.out = path.resolve(argv[++i]);
    else if (argv[i] === '--help') { console.log('Usage: node scripts/backup.js [--dir <dataDir>] [--out <backupsRoot>]'); process.exit(0); }
    else { console.error('Unknown argument: ' + argv[i]); process.exit(2); }
  }
  return args;
}

async function main() {
  const { dir, out } = parseArgs(process.argv);
  const result = await runBackup({ dir, out });
  const names = Object.keys(result.manifest.files);
  console.log('Backup created: ' + result.dest);
  console.log('Files: ' + names.length + ' (' + names.join(', ') + ')');
  if (result.manifest.skipped.length) {
    console.log('Skipped: ' + result.manifest.skipped.map((s) => s.name + ' (' + s.reason + ')').join(', '));
  }
}

main().catch((err) => {
  console.error('Backup failed: ' + err.message);
  process.exit(1);
});
