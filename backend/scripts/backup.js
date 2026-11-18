// Backup backend/data into a timestamped directory with a SHA-256
// manifest for integrity verification.
// Also backs up the SQLite token revocation store.
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

async function main() {
  const { dir, out } = parseArgs(process.argv);
  if (!fs.existsSync(dir)) {
    console.error('Data directory not found: ' + dir);
    process.exit(1);
  }
  const jsonFiles = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  if (jsonFiles.length === 0) {
    console.error('No .json store files in ' + dir);
    process.exit(1);
  }

  const dest = path.join(out, 'backup-' + stamp());
  fs.mkdirSync(dest, { recursive: true });

  const manifest = { created: new Date().toISOString(), source: dir, files: {} };

  // Backup JSON stores
  for (const f of jsonFiles) {
    const src = path.join(dir, f);
    JSON.parse(fs.readFileSync(src, 'utf8'));
    fs.copyFileSync(src, path.join(dest, f));
    manifest.files[f] = { bytes: fs.statSync(src).size, sha256: sha256(src) };
  }

  // Backup SQLite token store if it exists. The backup API is WAL-aware: it
  // checkpoints and copies a consistent snapshot, unlike a raw file copy.
  const tokenStorePath = path.join(dir, 'tokenStore.sqlite');
  if (fs.existsSync(tokenStorePath)) {
    const tokenStore = require('../utils/tokenStore.sqlite');
    const storeDest = path.join(dest, 'tokenStore.sqlite');
    await tokenStore.backupDatabase(tokenStorePath, storeDest);
    manifest.files['tokenStore.sqlite'] = { bytes: fs.statSync(storeDest).size, sha256: sha256(storeDest) };
    console.log('Token revocation store backed up: tokenStore.sqlite');
  }

  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log('Backup created: ' + dest);
  console.log('Files: ' + (jsonFiles.length + (manifest.files['tokenStore.sqlite'] ? 1 : 0)) + ' (' + Object.keys(manifest.files).join(', ') + ')');
}

main().catch((err) => {
  console.error('Backup failed: ' + err.message);
  process.exit(1);
});
