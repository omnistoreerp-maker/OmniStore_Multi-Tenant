// Restore backend/data from a backup directory.
// The backup is verified against its manifest BEFORE anything is copied.
// Existing data files are only overwritten when --force is given; a
// pre-restore snapshot of the current data is always taken first.
// Usage:
//   node scripts/restore.js --from <backupDir> [--dir <dataDir>] [--force]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function parseArgs(argv) {
  const args = { from: '', dir: path.join(__dirname, '..', 'data'), force: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--from') args.from = path.resolve(argv[++i]);
    else if (argv[i] === '--dir') args.dir = path.resolve(argv[++i]);
    else if (argv[i] === '--force') args.force = true;
    else if (argv[i] === '--help') { console.log('Usage: node scripts/restore.js --from <backupDir> [--dir <dataDir>] [--force]'); process.exit(0); }
    else { console.error('Unknown argument: ' + argv[i]); process.exit(2); }
  }
  return args;
}

function main() {
  const { from, dir, force } = parseArgs(process.argv);
  if (!from || !fs.existsSync(path.join(from, 'manifest.json'))) {
    console.error('Backup directory (with manifest.json) required: --from <backupDir>');
    process.exit(2);
  }

  // 1. Verify backup integrity before touching live data.
  execFileSync(process.execPath, [path.join(__dirname, 'verify.js'), from], { stdio: 'inherit' });

  // 2. Refuse to overwrite existing non-empty data unless --force.
  fs.mkdirSync(dir, { recursive: true });
  const existing = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  if (existing.length > 0 && !force) {
    console.error('Data directory is not empty (' + existing.length + ' files). Re-run with --force to overwrite.');
    process.exit(1);
  }

  // 3. Pre-restore snapshot of the current data (safety net).
  if (existing.length > 0) {
    execFileSync(process.execPath, [path.join(__dirname, 'backup.js'), '--dir', dir], { stdio: 'inherit' });
  }

  // 4. Copy verified backup files into place.
  const manifest = JSON.parse(fs.readFileSync(path.join(from, 'manifest.json'), 'utf8'));
  for (const name of Object.keys(manifest.files)) {
    fs.copyFileSync(path.join(from, name), path.join(dir, name));
  }
  console.log('Restored ' + Object.keys(manifest.files).length + ' files into ' + dir);
}

main();
