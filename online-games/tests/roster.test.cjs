/**
 * The roster contract, asserted against the file the pages actually load.
 *
 * Three sources have to agree and this is where the disagreement is caught:
 * `ROSTER_GATE.json` (the licence/dependency decision), `ROSTER.json` (what the
 * pages render) and `runtime/src/games/` (what the bundler will build). The
 * generator, `scripts/build-roster.mjs`, is the only thing allowed to reconcile
 * them — so the last check runs it in `--check` mode and insists it changes
 * nothing.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const OG = path.join(ROOT, "online-games");
const GAMES_SRC = path.join(OG, "runtime", "src", "games");

const roster = JSON.parse(fs.readFileSync(path.join(OG, "ROSTER.json"), "utf8"));
const gate = JSON.parse(fs.readFileSync(path.join(OG, "ROSTER_GATE.json"), "utf8"));

const BLOCKED_IDS = gate.blocked.map((b) => b.id).sort();
const CATEGORY_IDS = ["learn", "think", "kids", "speed", "create", "classics"];
const CATEGORY_COUNTS = { learn: 6, think: 14, kids: 10, speed: 4, create: 1, classics: 11 };

test("roster ships 46 games in exactly the six documented categories", () => {
  assert.strictEqual(roster.games.length, 46);
  assert.strictEqual(roster.totals.games, 46);
  assert.strictEqual(roster.totals.blocked, 3);
  assert.strictEqual(roster.totals.authoritative, 49);

  assert.deepStrictEqual(
    roster.categories.map((c) => c.id),
    CATEGORY_IDS,
  );
  for (const c of roster.categories) {
    assert.match(c.labelAr, /[ء-ي]/, "category label must be Arabic: " + c.id);
    assert.strictEqual(c.count, CATEGORY_COUNTS[c.id], "count drifted: " + c.id);
  }
  assert.deepStrictEqual(
    roster.categories.map((c) => c.count).reduce((a, b) => a + b, 0),
    46,
    "category counts must add up to the roster",
  );

  const actual = {};
  for (const g of roster.games) actual[g.category] = (actual[g.category] || 0) + 1;
  assert.deepStrictEqual(actual, CATEGORY_COUNTS, "per-category tally drifted");
});

test("no blocked game can reach the shipped roster", () => {
  assert.deepStrictEqual(BLOCKED_IDS, ["holdtheline", "snakesurvivors", "survivors"]);
  const ids = roster.games.map((g) => g.id);
  for (const blocked of BLOCKED_IDS) {
    assert.ok(!ids.includes(blocked), "blocked id leaked into ROSTER.json: " + blocked);
    assert.ok(
      !ids.some((id) => id.includes(blocked)),
      "blocked id leaked as a substring: " + blocked,
    );
  }
  assert.strictEqual(new Set(ids).size, ids.length, "duplicate roster id");
});

test("roster ids and the gate's safeIds are the same set", () => {
  assert.strictEqual(gate.authoritativeRosterCount, 49);
  assert.strictEqual(gate.safeGameCount, 46);
  assert.strictEqual(gate.blockedGameCount, 3);
  assert.strictEqual(gate.rosterIds.length, 49);
  assert.strictEqual(gate.safeIds.length, 46);
  assert.strictEqual(gate.blocked.length, 3);

  const safe = new Set(gate.safeIds);
  const shipped = new Set(roster.games.map((g) => g.id));
  assert.deepStrictEqual([...shipped].sort(), [...safe].sort());
  for (const id of gate.rosterIds) {
    assert.ok(
      safe.has(id) || BLOCKED_IDS.includes(id),
      "gate lists a roster id that is neither SAFE nor BLOCKED: " + id,
    );
  }
  assert.strictEqual(gate.productionRosterContract.expectedSafeGames, 46);
});

test("every game carries the fields the pages render", () => {
  const REQUIRED = ["id", "dir", "titleAr", "titleEn", "summaryAr", "category", "emoji", "color"];
  const en = new Set();
  for (const g of roster.games) {
    for (const field of REQUIRED) {
      assert.equal(typeof g[field], "string", g.id + "." + field + " must be a string");
      assert.notStrictEqual(g[field].trim(), "", g.id + "." + field + " must not be empty");
    }
    // Arabic script, or the Arabic-Indic digits ٢٠٤٨ uses as its Arabic name.
    assert.match(g.titleAr, /[ء-ي٠-٩]/, g.id + " needs an Arabic title");
    assert.match(g.summaryAr, /[ء-ي]/, g.id + " needs an Arabic summary");
    assert.match(g.color, /^#[0-9a-f]{6}$/i, g.id + " colour must be a 6-digit hex");
    assert.ok(g.aliases.length > 0, g.id + " needs at least one alias");
    for (const a of g.aliases) assert.notStrictEqual(a.trim(), "", g.id + " has a blank alias");
    assert.ok(!en.has(g.titleEn.toLowerCase()), "duplicate English title: " + g.titleEn);
    en.add(g.titleEn.toLowerCase());
  }
});

test("every roster entry resolves to a real game directory with an entry file", () => {
  const missing = [];
  for (const g of roster.games) {
    const dir = gate.idToDirectoryExceptions[g.id] || g.dir;
    const full = path.join(GAMES_SRC, dir);
    if (!fs.existsSync(full)) {
      missing.push(g.id + " -> " + dir + " (no directory)");
      continue;
    }
    const entry = fs.readdirSync(full).find((f) => /^index\.(ts|tsx)$/.test(f));
    if (!entry) missing.push(g.id + " -> " + dir + " (no index.ts/tsx)");
  }
  assert.deepStrictEqual(missing, []);

  // The three files that are not games must not be mistaken for one.
  for (const file of ["GameBoundary.tsx", "reactHost.tsx"]) {
    assert.ok(fs.existsSync(path.join(GAMES_SRC, file)), file + " must stay in src/games/");
  }
  assert.strictEqual(fs.readdirSync(GAMES_SRC).filter((n) => n.endsWith(".tsx")).sort().join(","), "GameBoundary.tsx,reactHost.tsx");
});

test("enums stay inside the values the pages know how to render", () => {
  const CATEGORY = new Set(CATEGORY_IDS);
  const AGE = new Set(roster.ageBands.map((a) => a.id));
  for (const g of roster.games) {
    assert.ok(CATEGORY.has(g.category), g.id + " unknown category");
    assert.ok(AGE.has(g.ageBand), g.id + " unknown ageBand");
    assert.ok(["any", "portrait"].includes(g.orientation), g.id + " unknown orientation");
    assert.ok(["dom", "phaser"].includes(g.renderer), g.id + " unknown renderer");
    assert.ok(
      g.scoreUnit == null || ["points", "moves", "ms"].includes(g.scoreUnit),
      g.id + " unknown scoreUnit: " + g.scoreUnit,
    );
  }
  assert.deepStrictEqual(roster.ageBands.map((a) => a.id), ["kids", "all"]);
  assert.strictEqual(roster.language, "ar");
  assert.strictEqual(roster.direction, "rtl");
});

test("ROSTER.json is exactly what build-roster.mjs generates", () => {
  const res = spawnSync(
    process.execPath,
    [path.join(OG, "scripts", "build-roster.mjs"), "--check"],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.strictEqual(res.status, 0, (res.stdout || "") + (res.stderr || ""));
  assert.match(res.stdout, /ROSTER\.json is current/);
});
