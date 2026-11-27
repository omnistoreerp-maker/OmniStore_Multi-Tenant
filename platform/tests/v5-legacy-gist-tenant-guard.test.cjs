'use strict';

// v5-legacy-gist-tenant-guard.test.cjs — FIX B (migration safety).
//
// DigiTronics_v5.html keeps a FIXED global database namespace
// (DB_KEY = 'cairo_db_v7') and reads the generic localStorage Gist key
// digi_gh_gist_id with no tenant scoping, no tenant identity helpers and no
// server-authoritative sync path. A tenant session must therefore NEVER reach
// the legacy Gist engine from this shell. The guard policy pinned here:
//
//   - any authenticated session (access_token / refresh_token present) or an
//     unreadable localStorage => legacy Gist sync FAILS CLOSED with a clear,
//     non-secret explanation;
//   - a token-less standalone device (true no-tenant legacy) stays reachable;
//   - ghPull / ghPush / syncPagePull / syncPagePush / the 3-second auto-sync
//     timer / autoPrepareGithubSync (gist bootstrap + create) all consult the
//     guard BEFORE touching the PAT, the Gist id or api.github.com;
//   - the guard never inspects the PAT and never mutates localStorage;
//   - first-run PAT prompts stay retired (no reintroduction).
//
// No browser, no network and no provider calls: static extraction + a stubbed
// localStorage executing the guard function only.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const V5_HTML = fs.readFileSync(path.join(ROOT, 'DigiTronics_v5.html'), 'utf8');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('PASS  ' + name);
  } catch (err) {
    failed += 1;
    console.error('FAIL  ' + name + ' :: ' + (err && err.message));
    process.exitCode = 1;
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message || 'assertion failed');
}
function extractFunction(src, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'g');
  const m = re.exec(src);
  if (!m) return null;
  const start = m.index;
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

// ---- 1. guard helpers exist ------------------------------------------------
check('v5: legacy sync guard helpers exist', () => {
  assert(extractFunction(V5_HTML, 'v5LegacySyncBlockedReason') !== null, 'v5LegacySyncBlockedReason missing');
  assert(extractFunction(V5_HTML, 'v5LegacySyncAllowed') !== null, 'v5LegacySyncAllowed missing');
});

// ---- 2. guard behaviour: fail closed, no PAT, no mutations -----------------
check('v5: guard blocks authenticated sessions, allows token-less legacy, fails closed on storage errors', () => {
  const src = extractFunction(V5_HTML, 'v5LegacySyncBlockedReason');
  assert(src !== null, 'guard not found');
  const factory = new Function('localStorage', src + '\nreturn v5LegacySyncBlockedReason;');
  const tokenless = factory({ getItem: () => null });
  const reason = tokenless();
  assert(reason === '', 'token-less standalone device must stay allowed, got: ' + reason);
  const withAccess = factory({ getItem: (k) => (k === 'access_token' ? 'jwt.value' : null) });
  assert(withAccess() !== '', 'access_token session must be blocked');
  const withRefresh = factory({ getItem: (k) => (k === 'refresh_token' ? 'refresh.value' : null) });
  assert(withRefresh() !== '', 'refresh_token session must be blocked');
  const broken = factory({ getItem: () => { throw new Error('storage error'); } });
  assert(broken() !== '', 'unreadable localStorage must FAIL CLOSED');
  const both = factory({ getItem: (k) => (k === 'access_token' || k === 'refresh_token' ? 'x' : null) });
  assert(both() !== '', 'any auth token must be blocked');
  // explanation is non-secret and the guard itself is inert
  assert(!/ghp_|digi_gh_token|GH_TOKEN_KEY|ghToken\(/.test(src), 'guard must never inspect or expose the PAT');
  assert(!/removeItem|\.clear\s*\(|setItem/.test(src), 'guard must never mutate localStorage');
  assert(!/api\.github\.com/.test(src), 'guard must not call the provider');
});

// ---- 3. every legacy engine entry point consults the guard -----------------
check('v5: ghPull consults the guard before PAT/gist access', () => {
  const body = extractFunction(V5_HTML, 'ghPull');
  assert(body !== null, 'ghPull missing');
  const g = body.indexOf('v5LegacySyncBlockedReason()');
  assert(g !== -1, 'ghPull is not guarded');
  assert(g < body.indexOf('ghToken()'), 'guard must run before ghToken()/gist access in ghPull');
});
check('v5: ghPush consults the guard before PAT/gist access', () => {
  const body = extractFunction(V5_HTML, 'ghPush');
  assert(body !== null, 'ghPush missing');
  const g = body.indexOf('v5LegacySyncBlockedReason()');
  assert(g !== -1, 'ghPush is not guarded');
  assert(g < body.indexOf('ghToken()'), 'guard must run before ghToken()/gist access in ghPush');
});
check('v5: syncPagePull/syncPagePush fail closed with the guard (clear non-secret reason)', () => {
  for (const fn of ['syncPagePull', 'syncPagePush']) {
    const body = extractFunction(V5_HTML, fn);
    assert(body !== null, fn + ' missing');
    assert(body.indexOf('v5LegacySyncBlockedReason()') !== -1, fn + ' is not guarded');
    assert(body.indexOf('showToast(blockedReason') !== -1, fn + ' must surface the non-secret explanation');
  }
});
check('v5: 3-second auto-sync timer is guarded (background bypass prevented)', () => {
  const idx = V5_HTML.indexOf('AUTO SYNC ENGINE');
  assert(idx !== -1, 'auto sync marker missing');
  const seg = V5_HTML.slice(idx, idx + 4500);
  assert(seg.indexOf('v5LegacySyncAllowed()') !== -1, 'setInterval callback is not guarded');
});
check('v5: autoPrepareGithubSync (gist list/create bootstrap) is guarded first', () => {
  const body = extractFunction(V5_HTML, 'autoPrepareGithubSync');
  assert(body !== null, 'autoPrepareGithubSync missing');
  const g = body.search(/v5LegacySync(?:Allowed|BlockedReason)\s*\(/);
  assert(g !== -1, 'autoPrepareGithubSync is not guarded');
  assert(g < body.indexOf('ghToken()'), 'guard must run before gist bootstrap');
});
check('v5: every api.github.com call site lives in a guarded function', () => {
  // The four provider calls are: ghFindExistingGistByToken (list),
  // ghEnsureGistForToken (create), ghPull (get), ghPush (patch).
  // ghFindExistingGistByToken is only reachable through ghEnsureGistForToken,
  // which is only reachable through the guarded autoPrepareGithubSync.
  const guardedFns = ['ghPull', 'ghPush', 'autoPrepareGithubSync'];
  for (const fn of guardedFns) {
    const body = extractFunction(V5_HTML, fn);
    assert(body !== null, fn + ' missing');
    assert(/api\.github\.com/.test(body) || fn === 'autoPrepareGithubSync', fn + ' should own/reach provider calls');
  }
  const find = extractFunction(V5_HTML, 'ghFindExistingGistByToken');
  const ensure = extractFunction(V5_HTML, 'ghEnsureGistForToken');
  assert(find !== null && ensure !== null, 'gist discovery helpers missing');
  assert(find.indexOf('ghEnsureGistForToken') === -1, 'unexpected recursion');
  const ensureCalls = (V5_HTML.match(/ghEnsureGistForToken\s*\(/g) || []).length;
  assert(ensureCalls === 2, 'ghEnsureGistForToken must be defined once and called only from autoPrepareGithubSync, found ' + ensureCalls + ' occurrences');
  const findCalls = (V5_HTML.match(/ghFindExistingGistByToken\s*\(/g) || []).length;
  assert(findCalls === 2, 'ghFindExistingGistByToken must be defined once and called only from ghEnsureGistForToken, found ' + findCalls + ' occurrences');
});

// ---- 4. legacy no-tenant path preserved ------------------------------------
check('v5: token-less legacy engine remains intact (ghPull/ghPush/stubs survive)', () => {
  assert(/async function ghPull\s*\(/.test(V5_HTML), 'ghPull missing');
  assert(/async function ghPush\s*\(/.test(V5_HTML), 'ghPush missing');
  assert(/async function autoPrepareGithubSync\s*\(/.test(V5_HTML), 'autoPrepareGithubSync missing');
  // the generic legacy key is still read for token-less devices (no data
  // migration, no key removal) — but only reachable when the guard allows.
  assert(/digi_gh_gist_id/.test(V5_HTML), 'legacy generic gist key removed (must be preserved, not migrated)');
  assert(/const\s+GH_TOKEN_KEY\s*=\s*'digi_gh_token'/.test(V5_HTML), 'legacy PAT key const removed (must be preserved)');
});

// ---- 5. first-run PAT prompts stay retired ---------------------------------
check('v5: first-run PAT prompts remain retired (no reintroduction)', () => {
  const FORBIDDEN = [
    'id="firstRunModal"',
    'id="frTokenInput"',
    'id="frGistInput"',
    'id="frConnectBtn"',
    'id="syncTokenInput"',
    'id="syncGistInput"',
    'id="syncSetupMsg"',
    'id="syncGistDisplay"',
    'setTimeout(checkFirstRun',
    "getElementById('firstRunModal')",
    'getElementById(\'frTokenInput\')',
    'getElementById(\'frGistInput\')',
    'localStorage.setItem(GH_TOKEN_KEY'
  ];
  for (const marker of FORBIDDEN) {
    assert(V5_HTML.indexOf(marker) === -1, 'reintroduced: ' + marker);
  }
  const frConnect = extractFunction(V5_HTML, 'frConnect');
  assert(frConnect !== null, 'frConnect missing');
  assert(frConnect.length < 300, 'frConnect is no longer a stub');
  assert(frConnect.indexOf('api.github.com') === -1, 'frConnect probes api.github.com');
  assert(frConnect.indexOf('GH_TOKEN_KEY') === -1, 'frConnect writes GH_TOKEN_KEY');
  const frSkip = extractFunction(V5_HTML, 'frSkip');
  assert(frSkip !== null && frSkip.indexOf('firstRunModal') === -1, 'frSkip references firstRunModal');
  const checkFirstRun = extractFunction(V5_HTML, 'checkFirstRun');
  assert(checkFirstRun !== null && checkFirstRun.indexOf('ghToken') === -1, 'checkFirstRun branches on ghToken');
  assert(!/placeholder="ghp_/.test(V5_HTML), 'live ghp_ placeholder input present');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
