'use strict';

// tenant-git-prompt-removal.test.cjs — Phase: server-side-gist-sync.
//
// Pins the removal of the tenant-facing GitHub PAT prompt from BOTH frontend
// shells without a browser:
//   - no #firstRunModal markup / ids / PAT input fields remain
//   - no checkFirstRun boot trigger (setTimeout(checkFirstRun, ...))
//   - frConnect/frSkip are no-ops (no api.github.com token probe, no
//     GH_TOKEN_KEY writes) — the ordinary tenant journey never touches GitHub
//   - sync page has no PAT/Gist form; server-first helpers exist
//   - login / session / visitor-browsing chains are untouched
//
// This suite deliberately does NOT test the backend vault or GitHub upstream:
// those are covered by backend/tests/gistSync.test.js with mocked fetch.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
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

// ---- forbidden token/element markers (must be gone from both shells) ----
const FORBIDDEN = [
  'id="firstRunModal"',
  'id="frTokenInput"',
  'id="frGistInput"',
  'id="frConnectBtn"',
  'id="frStatus"',
  'id="syncTokenInput"',
  'id="syncGistInput"',
  'id="syncSetupMsg"',
  'id="syncGistDisplay"',
  "setTimeout(checkFirstRun",
  'getElementById(\'firstRunModal\')',
  'getElementById(\'frTokenInput\')',
  'getElementById(\'frGistInput\')',
  'getElementById(\'syncTokenInput\')',
  'getElementById(\'syncGistInput\')',
  'localStorage.setItem(GH_TOKEN_KEY'
];

// frConnect body must not contain a live GitHub token probe or credential write.
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

for (const [label, html] of [['index.html', INDEX_HTML], ['DigiTronics_v5.html', V5_HTML]]) {
  check(label + ': no first-run modal / PAT input / gist input elements', () => {
    for (const marker of FORBIDDEN) {
      assert(html.indexOf(marker) === -1, 'still contains: ' + marker);
    }
  });

  check(label + ': no boot trigger for the first-run prompt', () => {
    assert(!/setTimeout\(\s*checkFirstRun/.test(html), 'setTimeout(checkFirstRun) still present');
  });

  check(label + ': frConnect is a no-op (no api.github.com probe, no token write)', () => {
    const body = extractFunction(html, 'frConnect');
    assert(body !== null, 'frConnect not found');
    assert(body.indexOf('api.github.com') === -1, 'frConnect still probes api.github.com');
    assert(body.indexOf('GH_TOKEN_KEY') === -1, 'frConnect still writes GH_TOKEN_KEY');
    assert(body.length < 300, 'frConnect body is not a stub (too large)');
  });

  check(label + ': frSkip is a no-op (no modal to hide)', () => {
    const body = extractFunction(html, 'frSkip');
    assert(body !== null, 'frSkip not found');
    assert(body.indexOf('firstRunModal') === -1, 'frSkip still references firstRunModal');
  });

  check(label + ': checkFirstRun is a no-op (no modal to show)', () => {
    const body = extractFunction(html, 'checkFirstRun');
    assert(body !== null, 'checkFirstRun not found');
    assert(body.indexOf('firstRunModal') === -1, 'checkFirstRun still references firstRunModal');
    assert(body.indexOf('ghToken') === -1, 'checkFirstRun still branches on ghToken');
  });

  check(label + ': sync page has no PAT connect form / connect button', () => {
    assert(!/syncPageConnect/.test(html), 'syncPageConnect still referenced');
    assert(!/onclick="syncPageConnect\(\)"/.test(html), 'connect button still present');
    // the owner-managed notice must exist
    assert(html.indexOf('إدارة المنصة') !== -1, 'owner-managed notice missing');
  });

  check(label + ': server-first sync client helpers exist (status/pull/push)', () => {
    // index.html has the full server client; v5 is local-only twin (no backend
    // sync surface) so it only needs the status-only page contract.
    if (label === 'index.html') {
      assert(/async function serverSyncStatus\s*\(/.test(html), 'serverSyncStatus missing');
      assert(/async function serverSyncPull\s*\(/.test(html), 'serverSyncPull missing');
      assert(/async function serverSyncPush\s*\(/.test(html), 'serverSyncPush missing');
      assert(/function applyGhContent\s*\(/.test(html), 'applyGhContent missing');
      assert(html.indexOf("'/sync/status'") !== -1 || html.indexOf('"/sync/status"') !== -1 || /\/sync\/status/.test(html), 'sync status route not referenced');
      assert(/\/sync\/pull/.test(html), 'sync pull route not referenced');
      assert(/\/sync\/push/.test(html), 'sync push route not referenced');
    }
  });

  check(label + ': login/session chain intact (login form + auth probe survive)', () => {
    assert(/id="loginPage"|id="loginForm"|type="password"/.test(html), 'login surface missing');
    // frontend calls the backend through backendApi._fetch('POST','/auth/login',...)
    assert(/'\/auth\/login'|"[^"]*\/auth\/login"|\/api\/v1\/auth/.test(html), 'auth endpoint reference missing');
  });

  check(label + ': visitor browsing is not auto-redirected by sync removal', () => {
    // no forced showPage('sync') at boot
    assert(!/setTimeout\(\s*\(\s*\)\s*=>\s*showPage\(['"]sync['"]/.test(html), 'boot redirects to sync page');
  });
}

// index.html-only: legacy silent path preserved for existing token holders
check('index.html: legacy ghPull/ghPush engine preserved (existing devices keep working)', () => {
  assert(/async function ghPull\s*\(/.test(INDEX_HTML), 'ghPull missing');
  assert(/async function ghPush\s*\(/.test(INDEX_HTML), 'ghPush missing');
  assert(/async function autoPrepareGithubSync\s*\(/.test(INDEX_HTML), 'autoPrepareGithubSync missing');
});

check('index.html: applyGhContent keeps company-binding + no-downgrade guards', () => {
  const body = extractFunction(INDEX_HTML, 'applyGhContent');
  assert(body !== null, 'applyGhContent not found');
  assert(body.indexOf('_companyId') !== -1, 'company-binding guard removed');
  assert(body.indexOf('remoteVersion < localVersion') !== -1, 'no-downgrade guard removed');
});

check('index.html: syncPagePull/Push route server-first, legacy fallback', () => {
  const pull = extractFunction(INDEX_HTML, 'syncPagePull');
  const push = extractFunction(INDEX_HTML, 'syncPagePush');
  assert(pull && pull.indexOf('serverSyncPull') !== -1, 'syncPagePull does not use serverSyncPull');
  assert(push && push.indexOf('serverSyncPush') !== -1, 'syncPagePush does not use serverSyncPush');
  assert(pull.indexOf('ghPull') !== -1, 'syncPagePull lost its legacy fallback');
  assert(push.indexOf('ghPush') !== -1, 'syncPagePush lost its legacy fallback');
});

check('index.html: no raw GitHub token placeholder in ordinary tenant journey', () => {
  // The only remaining ghp_ placeholders may be inside comments explaining the
  // removal — no live input may ask for one.
  assert(!/placeholder="ghp_/.test(INDEX_HTML), 'live ghp_ placeholder input still present');
});

check('DigiTronics_v5.html: no raw GitHub token placeholder in tenant journey', () => {
  assert(!/placeholder="ghp_/.test(V5_HTML), 'live ghp_ placeholder input still present');
});

check('DigiTronics_v5.html: legacy engine preserved for existing token devices', () => {
  assert(/async function ghPull\s*\(/.test(V5_HTML), 'ghPull missing');
  assert(/async function ghPush\s*\(/.test(V5_HTML), 'ghPush missing');
  assert(/async function autoPrepareGithubSync\s*\(/.test(V5_HTML), 'autoPrepareGithubSync missing');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
