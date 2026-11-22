#!/usr/bin/env node
// Unified, verified, retention-aware backup job (the cron-ready entry point).
//
// Every path is explicit. Nothing is inferred from TOKEN_STORE_PATH,
// CHALLENGE_DB_PATH or DIGITRONICS_DATA_DIR, so a scheduled run cannot silently
// back up the wrong store.
//
// Usage:
//   node scripts/backupJob.js \
//     --data-dir     <dataDir> \
//     --token-store  <tokenStore.sqlite> \
//     --challenge-store <challengeStore.sqlite> \
//     --out          <backupRoot> \
//     [--retain N] [--offhost-dir <mountPoint>] [--status-dir <dir>] [--json]
//
// --offhost-dir must be an existing mount point of a DIFFERENT filesystem that
// contains an operator-created `.omnistore-offhost` sentinel file. It is never
// created for you.
//
// --status-dir receives last-attempt.json on every run and last-success.json
// only on success (0700 directory, 0600 files, written atomically).
//
// Exit codes: 0 = verified success (or success with a status-write warning),
//             1 = failure (no pruning performed), 2 = bad usage.
"use strict";

const path = require("path");
const { runBackupJob, writeRunStatus, redactStatus } = require("./lib/backupJob");

const USAGE = [
  "Usage: node scripts/backupJob.js --data-dir <dir> --token-store <file> --challenge-store <file> --out <dir>",
  "                                  [--retain N] [--offhost-dir <mountPoint>] [--status-dir <dir>] [--json]"
].join("\n");

function parseArgs(argv) {
  const args = {
    dataDir: "",
    tokenPath: "",
    challengePath: "",
    outDir: "",
    retain: undefined,
    offhostDir: "",
    statusDir: "",
    json: false
  };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--data-dir") args.dataDir = argv[++i];
    else if (flag === "--token-store") args.tokenPath = argv[++i];
    else if (flag === "--challenge-store") args.challengePath = argv[++i];
    else if (flag === "--out") args.outDir = argv[++i];
    else if (flag === "--offhost-dir") args.offhostDir = argv[++i];
    else if (flag === "--status-dir") args.statusDir = argv[++i];
    else if (flag === "--retain") {
      const raw = argv[++i];
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1) {
        console.error("--retain requires an integer >= 1");
        process.exit(2);
      }
      args.retain = value;
    } else if (flag === "--json") args.json = true;
    else if (flag === "--help" || flag === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else {
      console.error("Unknown argument: " + flag);
      console.error(USAGE);
      process.exit(2);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.dataDir || !args.tokenPath || !args.challengePath || !args.outDir) {
    console.error(USAGE);
    process.exit(2);
  }

  const result = await runBackupJob(args);

  // A status problem is reported on its own channel and recorded in the result.
  // It must never turn an already verified backup into a reported failure.
  if (args.statusDir) {
    try {
      writeRunStatus(args.statusDir, result, {
        dataDir: path.resolve(args.dataDir),
        outDir: path.resolve(args.outDir)
      });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      result.status.statusWriteError = message;
      console.error("Status write failed (backup result is unaffected): " + message);
    }
  }

  if (args.json) {
    console.log(JSON.stringify(redactStatus(result.status)));
  } else if (result.ok) {
    console.log("Backup created: " + result.status.backupDir);
    console.log("Verified: yes (" + result.status.files + " artifacts)");
    if (result.status.offhost) {
      console.log("Off-host copy published and verified: " + result.status.offhost.dir);
    }
    if (result.status.pruned.length) {
      console.log("Pruned: " + result.status.pruned.join(", "));
    }
  } else {
    console.error("Backup FAILED: " + result.status.error);
    if (result.status.verified && result.status.backupDir) {
      console.error("Local backup kept (verified): " + result.status.backupDir);
    } else if (result.status.backupDir) {
      console.error("Partial artifact: " + result.status.backupDir);
    }
    console.error("Retention was NOT applied.");
  }

  process.exit(result.exitCode);
}

main().catch((err) => {
  console.error("Backup FAILED: " + (err && err.message ? err.message : String(err)));
  process.exit(1);
});
