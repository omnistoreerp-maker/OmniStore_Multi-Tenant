'use strict';

// OmniStore Online Games — LICENSE / DEPENDENCY GATE.
//
// This is a gate, not a unit test: it answers one question before anything is
// ever shipped — "may this roster reach production?"
//
// The decision it enforces (2026-10-04, owner-ordered):
//
//   survivors      BLOCKED  sprite/atlas/manifest provenance and licence UNKNOWN
//   holdtheline    BLOCKED  same UNKNOWN art source (byte-identical shared sheets)
//   snakesurvivors BLOCKED  transitively requires survivors' blocked assets
//
// Why snakesurvivors is blocked even though its own files are MIT-clean:
//   src/games/snakesurvivors/cast.ts imports '../survivors/sprites'
//   src/games/snakesurvivors/SnakeSurvivorsScene.ts then runs
//     this.load.atlas(key, CAST[key].png, CAST[key].atlas)
//   so shipping the game necessarily ships the blocked sheets. A game's own
//   licence status does not make it safe when it depends on a blocked source.
//   Provenance is never invented and a missing licence is never assumed away.
//
// What it enforces, in the tree that would actually be committed:
//   1. roster arithmetic   49 authoritative = 46 SAFE + 3 BLOCKED
//   2. blocked ids can never enter safeIds
//   3. the production roster file, when it appears, is a subset of safeIds
//   4. no shipped JSON roster/catalog names a blocked id
//   5. no blocked game directory or blocked asset byte-hash is present
//   6. no unlicensed Ellaz UI font byte-hash or font basename is present
//   7. every font binary that ships carries a licence file beside it
//   8. lettercross ships its NOTICE.md
//   9. live transitive dependency scan against the foundation (when available)
//
// Run:  node online-games/roster-gate.test.cjs
// Optional live foundation scan:
//        ELLAZ_FOUNDATION_PATH=<path-to-ellaz-games> node online-games/roster-gate.test.cjs

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const GATE_PATH = path.join(__dirname, 'ROSTER_GATE.json');
const GATE = JSON.parse(fs.readFileSync(GATE_PATH, 'utf8'));

const BLOCKED_IDS = ['survivors', 'holdtheline', 'snakesurvivors'];

let passed = 0;
let failed = 0;
const results = {};
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('PASS  ' + name);
  } catch (err) {
    failed += 1;
    console.error('FAIL  ' + name + ' :: ' + err.message);
    process.exitCode = 1;
  }
}

const git = (args) =>
  spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .stdout.split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// The set that would actually be committed: tracked files plus untracked files
// that are not ignored. Nothing outside this set can reach a deployment.
const shippedPaths = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  .join('\0')
  .split('\0')
  .filter(Boolean);

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Roster arithmetic
// ---------------------------------------------------------------------------
check('authoritative roster is 49 games', () => {
  assert.strictEqual(GATE.authoritativeRosterCount, 49, 'declared authoritativeRosterCount changed');
  assert.strictEqual(GATE.rosterIds.length, 49, 'rosterIds length is ' + GATE.rosterIds.length);
  assert.strictEqual(new Set(GATE.rosterIds).size, 49, 'rosterIds contains duplicates');
});

check('SAFE = 46 and BLOCKED = 3', () => {
  assert.strictEqual(GATE.safeGameCount, 46, 'declared safeGameCount changed');
  assert.strictEqual(GATE.blockedGameCount, 3, 'declared blockedGameCount changed');
  assert.strictEqual(GATE.safeIds.length, 46, 'safeIds length is ' + GATE.safeIds.length);
  assert.strictEqual(GATE.blocked.length, 3, 'blocked length is ' + GATE.blocked.length);
  assert.strictEqual(new Set(GATE.safeIds).size, 46, 'safeIds contains duplicates');
  results.AUTHORITATIVE_ROSTER_COUNT = 46 + 3;
  results.SAFE_GAME_COUNT = 46;
  results.BLOCKED_GAME_COUNT = 3;
});

check('BLOCKED_GAME_IDS = survivors,holdtheline,snakesurvivors', () => {
  const ids = GATE.blocked.map((b) => b.id).sort();
  assert.deepStrictEqual(ids, BLOCKED_IDS.slice().sort());
  for (const b of GATE.blocked) {
    assert.strictEqual(b.status, 'BLOCKED', b.id + ' must be BLOCKED');
    assert.ok(b.reasonCode, b.id + ' needs a reasonCode');
    assert.ok(b.reason && b.reason.length > 40, b.id + ' needs a written reason');
  }
  results.BLOCKED_GAME_IDS = ids.join(',');
});

check('SAFE and BLOCKED partition the authoritative roster exactly', () => {
  const safe = new Set(GATE.safeIds);
  const blocked = new Set(BLOCKED_IDS);
  const union = new Set([...GATE.safeIds, ...BLOCKED_IDS]);
  assert.strictEqual(union.size, 49, 'safe + blocked does not cover the roster');
  for (const id of GATE.rosterIds) {
    assert.ok(union.has(id), 'roster id neither SAFE nor BLOCKED: ' + id);
  }
  for (const id of GATE.safeIds) {
    assert.ok(!blocked.has(id), 'blocked id leaked into safeIds: ' + id);
  }
  for (const id of BLOCKED_IDS) {
    assert.ok(!safe.has(id), 'blocked id present in safeIds: ' + id);
    assert.ok(GATE.rosterIds.includes(id), 'blocked id missing from authoritative roster: ' + id);
  }
});

// ---------------------------------------------------------------------------
// 2. The snakesurvivors dependency gate
// ---------------------------------------------------------------------------
check('SNAKESURVIVORS_DEPENDENCY_GATE = BLOCKED with recorded edges', () => {
  const entry = GATE.blocked.find((b) => b.id === 'snakesurvivors');
  assert.ok(entry, 'snakesurvivors missing from blocked[]');
  assert.strictEqual(entry.status, 'BLOCKED');
  assert.strictEqual(entry.reasonCode, 'TRANSITIVE_DEPENDENCY_ON_BLOCKED_ASSETS');
  assert.ok(Array.isArray(entry.dependencyEdges), 'dependencyEdges missing');
  assert.ok(entry.dependencyEdges.length >= 16, 'expected the full edge set, got ' + entry.dependencyEdges.length);
  for (const edge of entry.dependencyEdges) {
    assert.ok(
      /snakesurvivors\/[^ ]+ -> \.\.\/survivors\//.test(edge),
      'edge does not point at survivors: ' + edge
    );
  }
  assert.ok(entry.hardRule && entry.hardRule.includes('never'), 'hardRule missing');
  results.SNAKESURVIVORS_DEPENDENCY_GATE = 'BLOCKED';
});

check('no other roster game is recorded as depending on a blocked game', () => {
  for (const dep of GATE.safeCrossGameDependencies || []) {
    assert.ok(!BLOCKED_IDS.includes(dep.to), 'safe->blocked edge recorded: ' + JSON.stringify(dep));
    assert.ok(GATE.safeIds.includes(dep.from), 'edge from a non-safe game: ' + JSON.stringify(dep));
  }
  const forbidden = new Set(BLOCKED_IDS);
  for (const b of GATE.blocked) {
    for (const edge of b.dependencyEdges || []) {
      const from = edge.split('->')[0].trim().split('/')[0];
      assert.ok(forbidden.has(from), 'dependency edge recorded from a SAFE game: ' + edge);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. Production roster contract
// ---------------------------------------------------------------------------
function collectStrings(value, out) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collectStrings(v, out);
  return out;
}

check('production roster, when present, is a subset of the 46 SAFE games', () => {
  const rosterPath = path.join(ROOT, 'online-games', 'ROSTER.json');
  if (!fs.existsSync(rosterPath)) {
    console.log('      (online-games/ROSTER.json not created yet — implementation not started)');
    return;
  }
  const roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
  const ids = roster.ids || roster.rosterIds || [];
  assert.ok(Array.isArray(ids) && ids.length > 0, 'ROSTER.json carries no ids array');
  const safe = new Set(GATE.safeIds);
  for (const id of ids) {
    assert.ok(!BLOCKED_IDS.includes(id), 'BLOCKED id in production roster: ' + id);
    assert.ok(safe.has(id), 'roster id is not in the SAFE list: ' + id);
  }
  assert.strictEqual(ids.length, GATE.expectedSafeGames || ids.length, 'production roster size drifted');
});

check('no shipped roster/catalog JSON names a blocked game', () => {
  const candidates = shippedPaths.filter(
    (p) =>
      (p.startsWith('online-games/') || p.startsWith('games/')) &&
      p.endsWith('.json') &&
      !p.endsWith('ROSTER_GATE.json')
  );
  const safe = new Set(GATE.safeIds);
  for (const file of candidates) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    } catch (err) {
      throw new Error(file + ' is not valid JSON: ' + err.message);
    }
    const strings = collectStrings(parsed, []);
    for (const s of strings) {
      assert.ok(!BLOCKED_IDS.includes(s), 'blocked id ' + s + ' inside shipped catalog ' + file);
    }
    if (Array.isArray(parsed.ids) || Array.isArray(parsed.rosterIds)) {
      const ids = parsed.ids || parsed.rosterIds;
      for (const id of ids) assert.ok(safe.has(id), file + ' lists a non-SAFE id: ' + id);
    }
  }
  console.log('      (' + candidates.length + ' shipped catalog JSON file(s) scanned)');
});

// ---------------------------------------------------------------------------
// 4. Blocked directories and blocked asset bytes must not exist in the tree
// ---------------------------------------------------------------------------
check('no blocked game directory is shipped', () => {
  const offenders = shippedPaths.filter((p) => {
    const norm = p.replace(/\\/g, '/');
    return (
      norm.startsWith('games/survivors/') ||
      norm.startsWith('games/holdtheline/') ||
      norm.startsWith('games/snakesurvivors/') ||
      norm.includes('/survivors/') ||
      norm.includes('/holdtheline/')
    );
  });
  assert.deepStrictEqual(offenders, [], 'blocked directories present: ' + offenders.join(', '));
});

check('no blocked asset byte-hash is present anywhere in the shipped tree', () => {
  const wanted = new Set(GATE.blockedAssets.map((a) => a.sha256));
  const offenders = [];
  let hashed = 0;
  for (const rel of shippedPaths) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;
    const stat = fs.statSync(full);
    if (!stat.isFile() || stat.size > 40 * 1024 * 1024) continue;
    hashed += 1;
    const h = sha256(fs.readFileSync(full));
    if (wanted.has(h)) offenders.push(rel + '  (blocked asset ' + h.slice(0, 12) + ')');
  }
  assert.deepStrictEqual(offenders, [], 'blocked sprite/atlas/manifest bytes shipped: ' + offenders.join(', '));
  console.log('      (' + hashed + ' shipped files hashed, ' + wanted.size + ' blocked hashes checked)');
  results.BLOCKED_ASSET_HASH_SCAN = 'PASS';
});

// ---------------------------------------------------------------------------
// 5. Fonts
// ---------------------------------------------------------------------------
check('no unlicensed Ellaz UI font is shipped', () => {
  const wanted = new Set(GATE.uiFonts.forbiddenFiles.map((f) => f.sha256));
  const forbiddenNames = /^(fredoka-|baloo-2-|gochi-hand-|press-start-2p-)/i;
  const heeboSubset = /^heebo-(latin|latin-ext|hebrew)\.woff2$/i;
  const offenders = [];
  for (const rel of shippedPaths) {
    const base = path.basename(rel);
    if (forbiddenNames.test(base) || heeboSubset.test(base)) offenders.push(rel + ' (forbidden font name)');
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;
    const stat = fs.statSync(full);
    if (!stat.isFile() || stat.size > 40 * 1024 * 1024) continue;
    if (wanted.has(sha256(fs.readFileSync(full)))) offenders.push(rel + ' (forbidden font bytes)');
  }
  assert.deepStrictEqual(offenders, [], 'unlicensed Ellaz UI font shipped: ' + offenders.join(', '));
  results.UI_FONT_LICENSE_GATE = 'PASS';
});

check('every shipped font binary carries a licence file beside it', () => {
  const fonts = shippedPaths.filter((p) => /\.(woff2?|ttf|otf|eot)$/i.test(p));
  const offenders = [];
  for (const font of fonts) {
    let dir = path.dirname(font);
    let found = false;
    for (let i = 0; i < 4 && dir && dir !== path.dirname(dir); i += 1) {
      const entries = fs.readdirSync(path.join(ROOT, dir));
      if (entries.some((e) => /^(LICENSE|LICENCE|NOTICE|COPYING|OFL)/i.test(e))) {
        found = true;
        break;
      }
      dir = path.dirname(dir);
    }
    if (!found) offenders.push(font);
  }
  assert.deepStrictEqual(offenders, [], 'font binary without a licence file: ' + offenders.join(', '));
  console.log('      (' + fonts.length + ' font binaries checked)');
});

// ---------------------------------------------------------------------------
// 6. lettercross
// ---------------------------------------------------------------------------
check('lettercross is SAFE and its NOTICE requirement is recorded', () => {
  assert.ok(GATE.safeIds.includes('lettercross'), 'lettercross must stay SAFE');
  assert.ok(!BLOCKED_IDS.includes('lettercross'));
  assert.strictEqual(GATE.lettercross.id, 'lettercross');
  assert.strictEqual(GATE.lettercross.noticeRequired, true);
  assert.ok(/NOTICE\.md$/.test(GATE.lettercross.noticePath));
  assert.strictEqual(GATE.lettercross.noticeMustShipWithDistribution, true);
  results.LETTERCROSS_NOTICE_REQUIRED = 'YES';
});

check('any lettercross directory in this repo ships NOTICE.md', () => {
  const dirs = new Set();
  for (const p of shippedPaths) {
    const norm = p.replace(/\\/g, '/');
    const m = norm.match(/^(.*\/lettercross)\//);
    if (m) dirs.add(m[1]);
  }
  for (const dir of dirs) {
    assert.ok(
      fs.existsSync(path.join(ROOT, dir, 'NOTICE.md')),
      dir + ' is shipped without NOTICE.md'
    );
  }
  console.log('      (' + dirs.size + ' lettercross directory(ies) found)');
});

// ---------------------------------------------------------------------------
// 7. Live transitive dependency scan against the foundation
// ---------------------------------------------------------------------------
function resolveRelative(baseDir, rel) {
  const parts = (path.join(baseDir, rel).split(/[\\/]+/));
  const stack = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') stack.pop();
    else stack.push(p);
  }
  return stack.join('/');
}

check('TRANSITIVE_BLOCKED_ASSET_SCAN (shipped tree + recorded evidence)', () => {
  // (a) Nothing in the shipped tree may point at a blocked game directory.
  const offenders = [];
  for (const rel of shippedPaths) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|css|html|json)$/.test(rel)) continue;
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;
    const stat = fs.statSync(full);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
    const text = fs.readFileSync(full, 'utf8');
    for (const id of BLOCKED_IDS) {
      // Directory form (games/<id>/) AND bare-module form (games/<id> then a
      // closing quote) both count, so a slash-less module path is caught too.
      const re = new RegExp(
        '["\'](?:\\.\\./)+games/' + id + '(?:/|["\'])|["\']\\./' + id + '(?:/|["\'])'
      );
      if (re.test(text)) offenders.push(rel + ' -> ' + id);
    }
  }
  assert.deepStrictEqual(offenders, [], 'shipped source references a blocked game: ' + offenders.join(', '));

  // (b) Live scan of the foundation, when the owner exposes it.
  const foundation = process.env.ELLAZ_FOUNDATION_PATH;
  let scanned = 0;
  if (foundation && fs.existsSync(path.join(foundation, 'src', 'games'))) {
    const gamesRoot = path.join(foundation, 'src', 'games');
    const gameDirs = fs
      .readdirSync(gamesRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    for (const dir of gameDirs) {
      if (BLOCKED_IDS.includes(dir)) continue;
      const files = walk(path.join(gamesRoot, dir), []).filter(
        (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f)
      );
      for (const file of files) {
        scanned += 1;
        const text = fs.readFileSync(file, 'utf8');
        const re = /^\s*(?:import|export)\s[^'"]*['"](\.[^'"]+)['"]/gm;
        let m;
        while ((m = re.exec(text)) !== null) {
          const resolved = resolveRelative(path.dirname(file), m[1]);
          const norm = resolved.replace(/\\/g, '/');
          const marker = norm.lastIndexOf('/games/');
          if (marker === -1) continue;
          const rest = norm.slice(marker + '/games/'.length);
          const target = rest.split('/')[0];
          if (target !== dir && BLOCKED_IDS.includes(target)) {
            assert.fail(
              'SAFE game "' + dir + '" reaches BLOCKED game "' + target + '" via ' +
                path.relative(foundation, file) + ' -> ' + m[1]
            );
          }
        }
      }
    }
    console.log('      (foundation scan: ' + scanned + ' SAFE-game source files, ' + gameDirs.length + ' game dirs)');
    results.TRANSITIVE_BLOCKED_ASSET_SCAN = 'PASS (shipped-tree + foundation live scan)';
  } else {
    console.log('      (foundation not exposed — live scan skipped; shipped tree + recorded edges checked)');
    results.TRANSITIVE_BLOCKED_ASSET_SCAN = 'PASS (shipped-tree + recorded edges)';
  }
});

// ---------------------------------------------------------------------------
// 8. Foundation modules that must never be vendored (they reach blocked games)
// ---------------------------------------------------------------------------
check('foundation modules reaching a blocked game are identified, never vendored', () => {
  const foundation = process.env.ELLAZ_FOUNDATION_PATH;
  if (!foundation || !fs.existsSync(path.join(foundation, 'src'))) {
    console.log('      (foundation not exposed — vendoring-scope check skipped)');
    return;
  }
  const contaminated = [];
  for (const file of walk(path.join(foundation, 'src'), [])) {
    const rel = path.relative(foundation, file).replace(/\\/g, '/');
    if (/^src\/games\/(survivors|holdtheline|snakesurvivors)\//.test(rel)) continue;
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    // Trailing slash AND trailing quote, so a slash-less module path such as
    // content/index.ts importing games/survivors as a module is caught too.
    if (/games\/(survivors|holdtheline|snakesurvivors)(?:\/|["'`])/.test(text)) contaminated.push(rel);
  }
  // Not a failure: these modules are allowed to EXIST in the foundation. It is
  // a failure if one of them ever shows up in this repository's shipped tree.
  //
  // SUFFIX match, not equality. A vendored copy lives at
  // `online-games/runtime/src/portal/gamesRest.ts`, so an equality test against
  // the foundation-relative `src/portal/gamesRest.ts` would read that file as
  // clean and pass. Every vendored tree keeps the foundation's `src/` layout,
  // so the tail is both stable and the thing the rule is actually about.
  const leaked = contaminated.filter(
    (rel) => shippedPaths.some((p) => p === rel || p.endsWith('/' + rel))
  );
  assert.deepStrictEqual(leaked, [], 'contaminated foundation module vendored: ' + leaked.join(', '));
  for (const rel of contaminated) {
    assert.ok(!/^src\/games\/[^/]+\//.test(rel), 'a SAFE game dir reaches a blocked game: ' + rel);
  }
  console.log('      (' + contaminated.length + ' foundation module(s) must stay out of OmniStore):');
  for (const rel of contaminated.sort()) console.log('        - ' + rel);
  results.CONTAMINATED_FOUNDATION_MODULES = contaminated.length;
  results.VENDORING_SCOPE_SCAN = 'PASS';
  // Pinned against the gate file: the set may only change by an owner edit to
  // ROSTER_GATE.json, never by a foundation bump drifting it silently.
  if (Array.isArray(GATE.contaminatedFoundationModules)) {
    assert.deepStrictEqual(
      contaminated.sort(),
      GATE.contaminatedFoundationModules.slice().sort(),
      'contaminated foundation module set drifted from ROSTER_GATE.json'
    );
  }
});

// ---------------------------------------------------------------------------
// 9. Never re-approve a blocked game silently
// ---------------------------------------------------------------------------
check('blocked set cannot be narrowed without failing this gate', () => {
  assert.deepStrictEqual(
    BLOCKED_IDS.slice().sort(),
    ['holdtheline', 'snakesurvivors', 'survivors'],
    'BLOCKED_IDS constant changed — owner approval required'
  );
  assert.strictEqual(GATE.decision, 'LICENSE_DEPENDENCY_GATE');
  assert.ok(GATE.productionRosterContract.path.endsWith('ROSTER.json'));
  assert.strictEqual(GATE.productionRosterContract.expectedSafeGames, 46);
  assert.strictEqual(GATE.productionRosterContract.expectedBlockedGames, 3);
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
results.FINAL_LICENSE_GATE = failed === 0 ? 'PASS' : 'BLOCKED';
const lines = [
  '',
  '--- online-games/roster-gate.test.cjs ---',
  'AUTHORITATIVE_ROSTER_COUNT=' + (results.AUTHORITATIVE_ROSTER_COUNT || 49),
  'SAFE_GAME_COUNT=' + (results.SAFE_GAME_COUNT || 'n/a'),
  'BLOCKED_GAME_COUNT=' + (results.BLOCKED_GAME_COUNT || 'n/a'),
  'BLOCKED_GAME_IDS=' + (results.BLOCKED_GAME_IDS || BLOCKED_IDS.join(',')),
  'SNAKESURVIVORS_DEPENDENCY_GATE=' + (results.SNAKESURVIVORS_DEPENDENCY_GATE || 'n/a'),
  'TRANSITIVE_BLOCKED_ASSET_SCAN=' + (results.TRANSITIVE_BLOCKED_ASSET_SCAN || 'n/a'),
  'BLOCKED_ASSET_HASH_SCAN=' + (results.BLOCKED_ASSET_HASH_SCAN || 'n/a'),
  'LETTERCROSS_NOTICE_REQUIRED=' + (results.LETTERCROSS_NOTICE_REQUIRED || 'n/a'),
  'UI_FONT_LICENSE_GATE=' + (results.UI_FONT_LICENSE_GATE || 'n/a'),
  'VENDORING_SCOPE_SCAN=' + (results.VENDORING_SCOPE_SCAN || 'SKIPPED'),
  'CONTAMINATED_FOUNDATION_MODULES=' + (results.CONTAMINATED_FOUNDATION_MODULES === undefined ? 'n/a' : results.CONTAMINATED_FOUNDATION_MODULES),
  'FINAL_LICENSE_GATE=' + results.FINAL_LICENSE_GATE,
  'SHIPPED_FILE_COUNT=' + shippedPaths.length,
  'checks: ' + passed + ' passed, ' + failed + ' failed'
];
console.log(lines.join('\n'));
if (failed > 0) process.exit(1);
