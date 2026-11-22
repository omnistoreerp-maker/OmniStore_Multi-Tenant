// Restore backend/data from a verified backup directory.
//
// The backup is verified against its manifest BEFORE anything is copied. SQLite
// token/challenge stores are restored through the rollback-safe path
// (WAL/SHM sidecars moved aside, original kept until final validation).
// Existing destinations are only overwritten with --force; --force does NOT
// bypass integrity/schema validation.
//
// OPERATIONAL REQUIREMENT: stop the service before restoring. The scripts
// refuse to replace a database that an active writer currently holds, but an
// open-but-idle connection cannot be detected reliably, so this is a documented
// precondition — not a guarantee.
//
// Usage:
//   node scripts/restore.js --from <backupDir> [--dir <dataDir>] [--force] [--allow-unlisted]
//
// --force allows overwriting existing targets. --allow-unlisted is a separate,
// explicit opt-in that keeps destination stores the backup does not contain.
//
// --isolated confines EVERY artifact (both SQLite databases included) to --dir
// and ignores TOKEN_STORE_PATH / CHALLENGE_DB_PATH entirely. Use it for a
// rehearsal against a scratch directory: it refuses to run if containment
// cannot be proven, and never falls back to an environment path.
const path = require('path');
const { runRestore } = require('./lib/backupRestore');

function parseArgs(argv) {
  const args = { from: '', dir: path.join(__dirname, '..', 'data'), force: false, allowUnlisted: false, isolated: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--from') args.from = path.resolve(argv[++i]);
    else if (argv[i] === '--dir') args.dir = path.resolve(argv[++i]);
    else if (argv[i] === '--force') args.force = true;
    else if (argv[i] === '--allow-unlisted') args.allowUnlisted = true;
    else if (argv[i] === '--isolated') args.isolated = true;
    else if (argv[i] === '--help') { console.log('Usage: node scripts/restore.js --from <backupDir> [--dir <dataDir>] [--force] [--allow-unlisted] [--isolated]'); process.exit(0); }
    else { console.error('Unknown argument: ' + argv[i]); process.exit(2); }
  }
  return args;
}

async function main() {
  const { from, dir, force, allowUnlisted, isolated } = parseArgs(process.argv);
  const result = await runRestore({ from, dir, force, allowUnlisted, isolated });
  if (result.unlistedKept.length) {
    console.log('Kept unlisted stores (--allow-unlisted): ' + result.unlistedKept.join(', '));
  }
  if (isolated) {
    console.log('Isolated restore: every artifact confined to ' + result.dir);
    for (const target of result.targets) console.log('  target: ' + target);
  }
  console.log('Restored ' + result.restored + ' files into ' + result.dir);
  console.log('Restore integrity OK');
}

main().catch((err) => {
  console.error('Restore failed: ' + err.message);
  process.exit(1);
});
