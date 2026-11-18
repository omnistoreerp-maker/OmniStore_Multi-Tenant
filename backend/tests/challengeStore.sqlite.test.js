"use strict";

// Runtime tests for the durable single-use challenge store.
// These are real executions against a real SQLite database (better-sqlite3):
// no mocks, no in-memory substitutes for the file-backed guarantees.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const {
  initialise,
  persistChallenge,
  consumeChallenge,
  purgeExpired,
  closeDb,
  openDbInMemory,
  hashChallenge,
  resolveDefaultPath
} = require("../utils/challengeStore.sqlite");

function waitMs(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { /* spin */ }
}

function removeDbFiles(dbPath) {
  [dbPath, dbPath + "-wal", dbPath + "-shm"].forEach(function (p) {
    try { fs.unlinkSync(p); } catch (_) {}
  });
}

// ---------------------------------------------------------------------------
// In-memory suite: single-process semantics
// ---------------------------------------------------------------------------

describe("challengeStore.sqlite - persistence and single-use semantics", () => {
  let db;

  beforeAll(() => {
    db = openDbInMemory();
  });

  beforeEach(() => {
    db.exec("DELETE FROM challenges");
  });

  afterAll(() => {
    closeDb(db);
  });

  function rowCount() {
    return db.prepare("SELECT count(*) AS n FROM challenges").get().n;
  }

  test("schema is created and only hashes are persisted", () => {
    const token = "raw.jwt.token.value";
    const record = persistChallenge(db, {
      token: token,
      sub: "user-1",
      purpose: "google_mfa",
      ttlMs: 60000
    });

    expect(record.hash).toBe(hashChallenge(token));
    expect(record.hash).not.toBe(token);

    const row = db.prepare("SELECT * FROM challenges WHERE hash = ?").get(record.hash);
    expect(row.sub).toBe("user-1");
    expect(row.purpose).toBe("google_mfa");

    // The raw token must not appear anywhere in the stored row.
    expect(JSON.stringify(row).indexOf(token)).toBe(-1);
  });

  test("duplicate challenge hash is rejected by the database", () => {
    const token = "duplicate-token";
    persistChallenge(db, { token: token, sub: "user-1", purpose: "google_mfa", ttlMs: 60000 });

    expect(function () {
      persistChallenge(db, { token: token, sub: "user-2", purpose: "google_mfa", ttlMs: 60000 });
    }).toThrow(/UNIQUE constraint failed/);

    expect(rowCount()).toBe(1);
  });

  test("first consumption succeeds and the row is removed", () => {
    const token = "single-use-token";
    persistChallenge(db, { token: token, sub: "user-1", purpose: "google_mfa", ttlMs: 60000 });

    const result = consumeChallenge(db, { token: token, purpose: "google_mfa", sub: "user-1" });
    expect(result.consumed).toBe(true);
    expect(result.reason).toBe("success");
    expect(rowCount()).toBe(0);
  });

  test("sequential replay of the same challenge fails", () => {
    const token = "replay-token";
    persistChallenge(db, { token: token, sub: "user-1", purpose: "google_mfa", ttlMs: 60000 });

    const first = consumeChallenge(db, { token: token, purpose: "google_mfa", sub: "user-1" });
    const second = consumeChallenge(db, { token: token, purpose: "google_mfa", sub: "user-1" });

    expect(first.consumed).toBe(true);
    expect(second.consumed).toBe(false);
    expect(second.reason).toBe("not_found");
  });

  test("unknown challenge hash fails", () => {
    const result = consumeChallenge(db, { token: "never-issued", purpose: "google_mfa" });
    expect(result.consumed).toBe(false);
    expect(result.reason).toBe("not_found");
  });

  test("wrong purpose fails and leaves the row intact", () => {
    const token = "purpose-bound-token";
    persistChallenge(db, { token: token, sub: "user-1", purpose: "google_mfa", ttlMs: 60000 });

    const result = consumeChallenge(db, {
      token: token,
      purpose: "google_tenant_selection",
      sub: "user-1"
    });
    expect(result.consumed).toBe(false);
    expect(result.reason).toBe("purpose_mismatch");
    expect(rowCount()).toBe(1);

    // The correct purpose still works afterwards.
    expect(consumeChallenge(db, { token: token, purpose: "google_mfa", sub: "user-1" }).consumed).toBe(true);
  });

  test("wrong subject fails and leaves the row intact", () => {
    const token = "subject-bound-token";
    persistChallenge(db, { token: token, sub: "user-1", purpose: "google_mfa", ttlMs: 60000 });

    const result = consumeChallenge(db, { token: token, purpose: "google_mfa", sub: "user-2" });
    expect(result.consumed).toBe(false);
    expect(result.reason).toBe("subject_mismatch");
    expect(rowCount()).toBe(1);

    expect(consumeChallenge(db, { token: token, purpose: "google_mfa", sub: "user-1" }).consumed).toBe(true);
  });

  test("expired challenge fails closed and is purged", () => {
    const token = "expired-token";
    persistChallenge(db, { token: token, sub: "user-1", purpose: "google_mfa", ttlMs: 1 });

    waitMs(60);

    const result = consumeChallenge(db, { token: token, purpose: "google_mfa", sub: "user-1" });
    expect(result.consumed).toBe(false);
    expect(result.reason).toBe("expired");
    expect(rowCount()).toBe(0);
  });

  test("purgeExpired removes only expired rows", () => {
    persistChallenge(db, { token: "fresh", sub: "user-1", purpose: "google_mfa", ttlMs: 60000 });
    persistChallenge(db, { token: "stale", sub: "user-1", purpose: "google_mfa", ttlMs: 1 });

    waitMs(60);

    expect(purgeExpired(db)).toBe(1);
    expect(rowCount()).toBe(1);
  });

  test("distinct challenges are consumed independently", () => {
    persistChallenge(db, { token: "a", sub: "user-1", purpose: "google_mfa", ttlMs: 60000 });
    persistChallenge(db, { token: "b", sub: "user-2", purpose: "google_mfa", ttlMs: 60000 });

    expect(consumeChallenge(db, { token: "a", purpose: "google_mfa", sub: "user-1" }).consumed).toBe(true);
    expect(consumeChallenge(db, { token: "b", purpose: "google_mfa", sub: "user-2" }).consumed).toBe(true);
    expect(rowCount()).toBe(0);
  });

  test("invalid input is rejected rather than silently stored", () => {
    expect(function () { persistChallenge(db, { token: "", sub: "u", purpose: "p" }); }).toThrow(/token/);
    expect(function () { persistChallenge(db, { token: "t", sub: "", purpose: "p" }); }).toThrow(/subject/);
    expect(function () { persistChallenge(db, { token: "t", sub: "u", purpose: "" }); }).toThrow(/purpose/);
    expect(function () { consumeChallenge(db, { token: "", purpose: "p" }); }).toThrow(/token/);
    expect(function () { consumeChallenge(db, { token: "t", purpose: "" }); }).toThrow(/purpose/);
  });

  test("a closed database raises an error instead of reporting success", () => {
    const tmpPath = path.join(os.tmpdir(), "challenge-closed-" + process.pid + "-" + Date.now() + ".sqlite");
    const fresh = initialise(tmpPath);
    persistChallenge(fresh.db, { token: "closing", sub: "u1", purpose: "google_mfa" });
    closeDb(fresh.db);

    expect(function () {
      consumeChallenge(fresh.db, { token: "closing", purpose: "google_mfa" });
    }).toThrow();

    removeDbFiles(tmpPath);
  });
});

// ---------------------------------------------------------------------------
// File-backed suite: durability and cross-process atomicity
// ---------------------------------------------------------------------------

describe("challengeStore.sqlite - file persistence and cross-process atomicity", () => {
  let dbPath;

  beforeAll(() => {
    dbPath = path.join(os.tmpdir(), "challenge-file-" + process.pid + "-" + Date.now() + ".sqlite");
  });

  afterEach(() => {
    removeDbFiles(dbPath);
  });

  test("consumption survives closing and reopening the database", () => {
    const first = initialise(dbPath);
    persistChallenge(first.db, { token: "durable", sub: "user-1", purpose: "google_mfa", ttlMs: 60000 });
    closeDb(first.db);

    const second = initialise(dbPath);
    // The challenge is still there after reopen.
    expect(second.db.prepare("SELECT count(*) AS n FROM challenges").get().n).toBe(1);

    const result = consumeChallenge(second.db, { token: "durable", purpose: "google_mfa", sub: "user-1" });
    expect(result.consumed).toBe(true);
    closeDb(second.db);

    // A third open proves the consumption was committed, not cached.
    const third = initialise(dbPath);
    expect(third.db.prepare("SELECT count(*) AS n FROM challenges").get().n).toBe(0);
    expect(consumeChallenge(third.db, { token: "durable", purpose: "google_mfa" }).consumed).toBe(false);
    closeDb(third.db);
  });

  test("two OS processes racing for one challenge produce exactly one success", async () => {
    const seeded = initialise(dbPath);
    persistChallenge(seeded.db, { token: "cross-process-token", sub: "user-1", purpose: "google_mfa", ttlMs: 60000 });
    closeDb(seeded.db);

    const storeModule = path.join(__dirname, "..", "utils", "challengeStore.sqlite.js");
    const attemptScript = [
      "const store = require(" + JSON.stringify(storeModule) + ");",
      "const opened = store.initialise(" + JSON.stringify(dbPath) + ");",
      "const result = store.consumeChallenge(opened.db, {",
      "  token: \"cross-process-token\",",
      "  purpose: \"google_mfa\",",
      "  sub: \"user-1\"",
      "});",
      "process.stdout.write(result.consumed ? \"CONSUMED\" : \"REJECTED:\" + result.reason);",
      "store.closeDb(opened.db);"
    ].join("\n");

    function attempt() {
      return new Promise(function (resolve) {
        const child = spawn(process.execPath, ["-e", attemptScript], {
          stdio: ["ignore", "pipe", "pipe"]
        });
        let out = "";
        child.stdout.on("data", function (d) { out += String(d); });
        child.stderr.on("data", function () {});
        child.on("close", function () { resolve(out.trim()); });
      });
    }

    // Launch several children simultaneously against the same file.
    const results = await Promise.all([attempt(), attempt(), attempt(), attempt()]);
    const successes = results.filter(function (r) { return r === "CONSUMED"; });
    const rejected = results.filter(function (r) { return r.indexOf("REJECTED:") === 0; });

    expect(successes.length).toBe(1);
    expect(rejected.length).toBe(3);

    const check = initialise(dbPath);
    expect(check.db.prepare("SELECT count(*) AS n FROM challenges").get().n).toBe(0);
    closeDb(check.db);
  }, 60000);
});

// ---------------------------------------------------------------------------
// Path configuration
// ---------------------------------------------------------------------------

describe("challengeStore.sqlite - path configuration", () => {
  const original = process.env.CHALLENGE_DB_PATH;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (original === undefined) delete process.env.CHALLENGE_DB_PATH;
    else process.env.CHALLENGE_DB_PATH = original;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  test("an explicit configured path is honoured", () => {
    const explicit = path.join(os.tmpdir(), "explicit-challenge.sqlite");
    process.env.CHALLENGE_DB_PATH = explicit;
    expect(resolveDefaultPath()).toBe(explicit);
  });

  test("production without a configured path refuses to start", () => {
    delete process.env.CHALLENGE_DB_PATH;
    process.env.NODE_ENV = "production";
    expect(function () { resolveDefaultPath(); }).toThrow(/CHALLENGE_DB_PATH must be configured/);
  });
});
