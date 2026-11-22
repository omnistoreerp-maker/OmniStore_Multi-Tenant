// P7 Independent Restore Drill — synthetic dataset only, never production data.
// Demonstrates: backup -> verify -> restore -> hash compare -> corrupt -> reject
// -> unsafe path -> reject -> failed restore preserves destination.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const lib = require('./lib/backupRestore');

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const results = [];
function step(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  // ── 1. Build a synthetic dataset with representative OmniStore JSON stores ──
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'p7-drill-'));
  const src = path.join(work, 'source');
  fs.mkdirSync(src, { recursive: true });

  const stores = {
    users: [{ id: 'u1', name: 'Alice' }, { id: 'u2', name: 'Bob' }],
    companies: [{ id: 'c1', name: 'Acme' }],
    products: [{ id: 'p1', sku: 'SKU-001', price: 999 }],
    sales: [{ id: 's1', companyId: 'c1', amount: 999 }],
    purchases: [{ id: 'b1', companyId: 'c1', amount: 499 }],
    tenantAddons: [{ id: 'a1', tenantId: 'c1', addon: 'premium' }],
    updateManifest: { version: 1, updatedAt: new Date().toISOString() },
    'revoked-tokens': []
  };

  const originalHashes = {};
  for (const [name, payload] of Object.entries(stores)) {
    const file = path.join(src, name + '.json');
    const raw = JSON.stringify(payload, null, 2);
    fs.writeFileSync(file, raw, 'utf8');
    originalHashes[name + '.json'] = sha256File(file);
  }
  console.log(`Synthetic dataset: ${Object.keys(stores).length} JSON stores in ${src}`);

  // ── 2. Back it up ──
  const backupRoot = path.join(work, 'backups');
  fs.mkdirSync(backupRoot, { recursive: true });
  let backupDir;
  try {
    const result = await lib.runBackup({ dir: src, out: backupRoot });
    backupDir = result.dest;
    step('Backup creation', true, `created ${path.basename(backupDir)}`);
  } catch (err) {
    step('Backup creation', false, err.message);
    cleanup(work);
    process.exit(1);
  }

  // ── 3. Verify the backup ──
  const verification = lib.verifyBackupDir(backupDir);
  step('Backup verification', verification.ok, verification.ok ? '' : verification.failures.map(f => f.reason).join(', '));

  // ── 4. Copy into a separate isolated restore-test location ──
  const drillRoot = path.join(work, 'drill');
  fs.mkdirSync(drillRoot, { recursive: true });
  const drillBackup = path.join(drillRoot, 'drill-backup');
  fs.cpSync(backupDir, drillBackup, { recursive: true });
  step('Backup copied to drill location', true, drillBackup);

  // ── 5. Restore into a fresh temporary destination ──
  const restoreDest = path.join(work, 'restored');
  fs.mkdirSync(restoreDest, { recursive: true });
  let restoreResult;
  try {
    restoreResult = await lib.runRestore({ from: drillBackup, dir: restoreDest, force: true, isolated: true });
    step('Restore to isolated destination', true, `restored ${restoreResult.restored} files`);
  } catch (err) {
    step('Restore to isolated destination', false, err.message);
    cleanup(work);
    process.exit(1);
  }

  // ── 6. Compare restored file hashes against the original synthetic dataset ──
  let hashMatch = true;
  for (const [name, expectedHash] of Object.entries(originalHashes)) {
    const restoredFile = path.join(restoreDest, name);
    if (!fs.existsSync(restoredFile)) {
      console.log(`FAIL  Restored file missing: ${name}`);
      hashMatch = false;
      continue;
    }
    const actualHash = sha256File(restoredFile);
    if (actualHash !== expectedHash) {
      console.log(`FAIL  Hash mismatch: ${name} (expected ${expectedHash.slice(0, 12)}..., got ${actualHash.slice(0, 12)}...)`);
      hashMatch = false;
    }
  }
  step('Restored hashes match originals', hashMatch, hashMatch ? '' : 'one or more hashes differ');

  // ── 7. Corrupt one backup file and confirm verification rejects it ──
  const corruptDir = path.join(work, 'corrupt-backup');
  fs.cpSync(backupDir, corruptDir, { recursive: true });
  const usersFile = path.join(corruptDir, 'users.json');
  fs.writeFileSync(usersFile, '{ not valid json', 'utf8');
  const corruptVerification = lib.verifyBackupDir(corruptDir);
  step('Corrupted backup rejected by verification', !corruptVerification.ok, corruptVerification.ok ? 'unexpectedly passed' : corruptVerification.failures.map(f => f.reason).join(', '));

  // Also confirm restore of corrupted backup is rejected.
  const corruptRestore = path.join(work, 'corrupt-restore');
  fs.mkdirSync(corruptRestore, { recursive: true });
  let corruptRestoreRejected = false;
  try {
    await lib.runRestore({ from: corruptDir, dir: corruptRestore, force: true, isolated: true });
  } catch (err) {
    corruptRestoreRejected = true;
  }
  step('Restore of corrupted backup rejected', corruptRestoreRejected, corruptRestoreRejected ? '' : 'unexpectedly succeeded');

  // ── 8. Attempt an unsafe path and confirm restore rejects it ──
  const unsafeBackup = path.join(work, 'unsafe-backup');
  fs.cpSync(backupDir, unsafeBackup, { recursive: true });
  const manifestPath = path.join(unsafeBackup, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.files['../escape.json'] = { bytes: 1, sha256: 'a'.repeat(64) };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const unsafeVerification = lib.verifyBackupDir(unsafeBackup);
  step('Unsafe path rejected by verification', !unsafeVerification.ok, unsafeVerification.ok ? 'unexpectedly passed' : unsafeVerification.failures.map(f => f.reason).join(', '));

  // ── 9. Simulate a failed restore and prove the original destination remains intact ──
  const preexistingDest = path.join(work, 'preexisting');
  fs.mkdirSync(preexistingDest, { recursive: true });
  fs.writeFileSync(path.join(preexistingDest, 'users.json'), JSON.stringify([{ id: 'pre-existing' }]), 'utf8');
  fs.writeFileSync(path.join(preexistingDest, 'sentinel.txt'), 'preexisting-data', 'utf8');
  const preexistingUsers = fs.readFileSync(path.join(preexistingDest, 'users.json'), 'utf8');
  const preexistingSentinel = fs.readFileSync(path.join(preexistingDest, 'sentinel.txt'), 'utf8');

  // Corrupt the backup so restore fails during validation.
  const failingBackup = path.join(work, 'failing-backup');
  fs.cpSync(backupDir, failingBackup, { recursive: true });
  fs.writeFileSync(path.join(failingBackup, 'users.json'), '{ corrupt', 'utf8');

  let failedRestore = false;
  try {
    await lib.runRestore({ from: failingBackup, dir: preexistingDest, force: true, isolated: true });
  } catch (err) {
    failedRestore = true;
  }
  step('Failed restore rejected', failedRestore, failedRestore ? '' : 'unexpectedly succeeded');

  const usersAfter = fs.readFileSync(path.join(preexistingDest, 'users.json'), 'utf8');
  const sentinelAfter = fs.readFileSync(path.join(preexistingDest, 'sentinel.txt'), 'utf8');
  step('Original destination preserved on failed restore', usersAfter === preexistingUsers && sentinelAfter === preexistingSentinel, usersAfter !== preexistingUsers ? 'users.json changed' : sentinelAfter !== preexistingSentinel ? 'sentinel.txt changed' : '');

  // ── 10. Record results ──
  let allPass = true;
  for (const r of results) {
    if (!r.ok) allPass = false;
  }
  console.log('\n' + (allPass ? 'DRILL PASSED — all steps succeeded' : 'DRILL FAILED — see above'));

  // Cleanup
  cleanup(work);

  process.exit(allPass ? 0 : 1);
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

main().catch((err) => {
  console.error('Drill failed with error:', err.message);
  process.exit(1);
});
