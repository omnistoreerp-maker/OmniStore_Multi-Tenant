// Backup backend/data into a timestamped directory with a SHA-256
// manifest for integrity verification.
// Usage:
//   node scripts/backup.js [--dir <dataDir>] [--out <backupsRoot>]
// Defaults: --dir ../data (backend/data), --out ../backups (backend/backups)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function stamp() {
  // UTC, filesystem-safe: 2026-08-03T12-34-56Z
  return new Date().toISOString().replace(/:/g, '-').replace(/\..*$/, 'Z');
}

function main() {
  const { dir, out } = parseArgs(process.argv);
  if (!fs.existsSync(dir)) {
    console.error('Data directory not found: ' + dir);
    process.exit(1);
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    console.error('No .json store files in ' + dir);
    process.exit(1);
  }

  const dest = path.join(out, 'backup-' + stamp());
  fs.mkdirSync(dest, { recursive: true });

  const manifest = { created: new Date().toISOString(), source: dir, files: {} };
  for (const f of files) {
    const src = path.join(dir, f);
    // Validate JSON before copying — never back up a corrupt store blindly.
    JSON.parse(fs.readFileSync(src, 'utf8'));
    fs.copyFileSync(src, path.join(dest, f));
    manifest.files[f] = { bytes: fs.statSync(src).size, sha256: sha256(src) };
  }
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log('Backup created: ' + dest);
  console.log('Files: ' + files.length + ' (' + files.join(', ') + ')');
}

main();
