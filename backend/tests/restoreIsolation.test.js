"use strict";

// P6 — restore isolation hardening.
//
// Proves the fixed footgun: without `isolated`, database destinations follow
// TOKEN_STORE_PATH / CHALLENGE_DB_PATH (so a rehearsal launched from a shell
// that still carries production paths would overwrite the live stores), while
// `isolated` confines EVERY artifact to --dir and refuses to run when
// containment cannot be proven.
//
// All data here is synthetic and lives in os.tmpdir(); backend/data is never
// referenced.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { makeTempDataDir } = require("./helpers/testData");
const { makeTokenDb, makeChallengeDb } = require("./helpers/backupFixture");

const lib = require("../scripts/lib/backupRestore");

const isWindows = process.platform === "win32";

const tempDirs = [];
function tmp(tag) {
  const dir = makeTempDataDir(tag);
  tempDirs.push(dir);
  return dir;
}

const sha = (file) => lib.sha256File(file);

function seedSource(tag) {
  const dir = tmp(tag || "iso-src");
  fs.writeFileSync(path.join(dir, "users.json"), JSON.stringify([{ id: "u1" }]), "utf8");
  const token = makeTokenDb(path.join(dir, "tokenStore.sqlite"), "user-1");
  const challenge = makeChallengeDb(path.join(dir, "challengeStore.sqlite"));
  return { dir, token, challenge };
}

async function makeBackup(src) {
  const out = tmp("iso-backup-root");
  const created = await lib.runBackup({
    dir: src.dir,
    out,
    tokenPath: src.token,
    challengePath: src.challenge
  });
  return created.dest;
}

function withEnv(values, fn) {
  const saved = {};
  for (const key of Object.keys(values)) saved[key] = process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  try {
    return fn();
  } finally {
    for (const key of Object.keys(values)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

afterAll(() => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

describe("isolated restore", () => {
  test("production-looking env vars cannot escape the scratch directory", async () => {
    const src = seedSource();
    const backup = await makeBackup(src);
    const scratch = tmp("iso-scratch");

    // Stand-ins for the live production stores, outside the scratch directory.
    const outside = tmp("iso-outside");
    const outsideToken = path.join(outside, "tokenStore.sqlite");
    const outsideChallenge = path.join(outside, "challengeStore.sqlite");
    fs.copyFileSync(src.token, outsideToken);
    fs.copyFileSync(src.challenge, outsideChallenge);
    const beforeToken = sha(outsideToken);
    const beforeChallenge = sha(outsideChallenge);

    const result = await withEnv({
      TOKEN_STORE_PATH: outsideToken,
      CHALLENGE_DB_PATH: outsideChallenge
    }, () => lib.runRestore({ from: backup, dir: scratch, isolated: true }));

    // Both databases landed inside scratch…
    expect(fs.existsSync(path.join(scratch, "tokenStore.sqlite"))).toBe(true);
    expect(fs.existsSync(path.join(scratch, "challengeStore.sqlite"))).toBe(true);
    expect(fs.existsSync(path.join(scratch, "users.json"))).toBe(true);
    for (const target of result.targets) {
      expect(path.resolve(target).startsWith(path.resolve(scratch) + path.sep)).toBe(true);
    }

    // …and the outside databases were never touched.
    expect(sha(outsideToken)).toBe(beforeToken);
    expect(sha(outsideChallenge)).toBe(beforeChallenge);
  });

  test("no .origin/.incoming/lock artifact escapes scratch", async () => {
    const src = seedSource();
    const backup = await makeBackup(src);
    const scratch = tmp("iso-artifacts");
    const outside = tmp("iso-artifacts-outside");
    const outsideToken = path.join(outside, "tokenStore.sqlite");
    fs.copyFileSync(src.token, outsideToken);

    await withEnv({ TOKEN_STORE_PATH: outsideToken, CHALLENGE_DB_PATH: outsideToken }, () =>
      lib.runRestore({ from: backup, dir: scratch, isolated: true })
    );

    expect(fs.readdirSync(scratch).sort()).toEqual([
      "challengeStore.sqlite",
      "tokenStore.sqlite",
      "users.json"
    ].sort());
    // No staging or preservation leftovers anywhere.
    const leftovers = fs.readdirSync(scratch).filter((f) => f.includes(".origin.") || f.includes(".incoming."));
    expect(leftovers).toEqual([]);
    expect(fs.readdirSync(outside).sort()).toEqual(["tokenStore.sqlite"]);
  });

  test("a symlinked target is rejected", async () => {
    const src = seedSource();
    const backup = await makeBackup(src);
    const scratch = tmp("iso-symlink");
    const outside = tmp("iso-symlink-outside");
    const decoy = path.join(outside, "decoy.sqlite");
    fs.copyFileSync(src.token, decoy);

    try {
      fs.symlinkSync(decoy, path.join(scratch, "tokenStore.sqlite"));
    } catch (_) {
      return; // symlink creation requires privileges on this platform
    }

    await expect(lib.runRestore({ from: backup, dir: scratch, isolated: true }))
      .rejects.toThrow(/symbolic link/i);
  });

  test("fails closed when the destination does not exist", async () => {
    const src = seedSource();
    const backup = await makeBackup(src);
    const missing = path.join(tmp("iso-missing-parent"), "not-created");

    await expect(lib.runRestore({ from: backup, dir: missing, isolated: true }))
      .rejects.toThrow(/does not exist|Create it/i);
  });

  test("a malicious manifest path is refused before anything is written", async () => {
    const evil = tmp("iso-evil");
    fs.writeFileSync(path.join(evil, "manifest.json"), JSON.stringify({
      created: new Date().toISOString(),
      source: "/tmp",
      files: {
        "../escape.json": { bytes: 2, sha256: "0".repeat(64) },
        "tokenStore.sqlite": { bytes: 2, sha256: "0".repeat(64) }
      },
      databases: {},
      skipped: []
    }), "utf8");
    fs.writeFileSync(path.join(evil, "escape.json"), "{}", "utf8");

    const scratch = tmp("iso-evil-scratch");
    await expect(lib.runRestore({ from: evil, dir: scratch, isolated: true }))
      .rejects.toThrow(/Backup verification failed|escapes|separator/i);
    expect(fs.readdirSync(scratch)).toEqual([]);
  });
});

describe("non-isolated behaviour is unchanged", () => {
  test("without --isolated, database destinations still follow the environment", async () => {
    const src = seedSource();
    const backup = await makeBackup(src);
    const envDir = tmp("iso-env-target");
    const dataDir = tmp("iso-env-data");
    fs.writeFileSync(path.join(dataDir, "users.json"), JSON.stringify([{ id: "old" }]), "utf8");

    const envToken = path.join(envDir, "tokenStore.sqlite");
    const envChallenge = path.join(envDir, "challengeStore.sqlite");

    const result = await withEnv({ TOKEN_STORE_PATH: envToken, CHALLENGE_DB_PATH: envChallenge }, () =>
      lib.runRestore({ from: backup, dir: dataDir, force: true })
    );

    // Historical behaviour: the databases go to the configured paths…
    expect(result.targets).toContain(envToken);
    expect(result.targets).toContain(envChallenge);
    expect(fs.existsSync(envToken)).toBe(true);
    expect(fs.existsSync(envChallenge)).toBe(true);
    // …and the JSON store goes to --dir.
    expect(fs.existsSync(path.join(dataDir, "users.json"))).toBe(true);
  });
});

describe(".env cannot reintroduce production paths", () => {
  test("a .env in the working directory is ignored in isolated mode", async () => {
    const src = seedSource();
    const backup = await makeBackup(src);
    const scratch = tmp("iso-dotenv-scratch");

    const decoy = tmp("iso-dotenv-decoy");
    const decoyToken = path.join(decoy, "tokenStore.sqlite");
    const decoyChallenge = path.join(decoy, "challengeStore.sqlite");
    fs.copyFileSync(src.token, decoyToken);
    fs.copyFileSync(src.challenge, decoyChallenge);
    const beforeToken = sha(decoyToken);
    const beforeChallenge = sha(decoyChallenge);

    const outside = tmp("iso-dotenv-outside");
    const outsideToken = path.join(outside, "tokenStore.sqlite");
    const outsideChallenge = path.join(outside, "challengeStore.sqlite");
    fs.copyFileSync(src.token, outsideToken);
    fs.copyFileSync(src.challenge, outsideChallenge);
    const beforeOutsideToken = sha(outsideToken);

    // A runner directory whose .env names the decoy stores. The child process
    // loads it with the real dotenv (Jest replaces dotenv only in-process).
    const runner = tmp("iso-dotenv-runner");
    fs.writeFileSync(
      path.join(runner, ".env"),
      `TOKEN_STORE_PATH=${decoyToken}\nCHALLENGE_DB_PATH=${decoyChallenge}\n`,
      "utf8"
    );

    const cli = path.join(__dirname, "..", "scripts", "restore.js");
    const child = spawnSync(process.execPath, [cli, "--from", backup, "--dir", scratch, "--isolated"], {
      cwd: runner,
      env: Object.assign({}, process.env, {
        TOKEN_STORE_PATH: outsideToken,
        CHALLENGE_DB_PATH: outsideChallenge
      }),
      encoding: "utf8",
      timeout: 60000
    });

    if (isWindows && child.status !== 0 && /EBUSY|EPERM/.test(child.stderr || "")) {
      return; // platform file-locking noise, not an isolation failure
    }

    expect(child.status).toBe(0);
    expect(child.stdout).toContain(path.join(scratch, "tokenStore.sqlite"));
    expect(child.stdout).toContain(path.join(scratch, "challengeStore.sqlite"));

    // Neither the .env decoys nor the ambient env targets were modified.
    expect(sha(decoyToken)).toBe(beforeToken);
    expect(sha(decoyChallenge)).toBe(beforeChallenge);
    expect(sha(outsideToken)).toBe(beforeOutsideToken);
    expect(fs.existsSync(path.join(scratch, "tokenStore.sqlite"))).toBe(true);
  }, 60000);
});
