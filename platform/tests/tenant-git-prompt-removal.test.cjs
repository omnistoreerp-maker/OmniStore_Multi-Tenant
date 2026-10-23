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

check('index.html: push baseRevision is proof-of-read — only pull/push responses set it', () => {
  // The push base must never be seeded from a status poll: a revision this
  // device never observed (or a wrong field name) would let it acknowledge
  // freshness it never read. Only serverSyncPull/serverSyncPush responses
  // may assign to syncServerRevision.
  const assignments = [];
  const re = /syncServerRevision\s*=\s*([^;]+);/g;
  let m;
  while ((m = re.exec(INDEX_HTML)) !== null) assignments.push(m[1]);
  assert(assignments.length >= 3, 'syncServerRevision assignments missing (expected let + pull + push)');
  const seeded = assignments.filter((rhs) => !/r\.data\./.test(rhs) && !/^\s*null\s*$/.test(rhs));
  assert(seeded.length === 0, 'syncServerRevision seeded from an unproven source: ' + seeded.join(' | '));
  assert(!/syncServerRevision\s*=\s*status\./.test(INDEX_HTML), 'syncServerRevision seeded from status poll');
  const pushBody = extractFunction(INDEX_HTML, 'serverSyncPush');
  assert(pushBody && pushBody.indexOf('baseRevision') !== -1, 'serverSyncPush does not send baseRevision');
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

// ---------------------------------------------------------------------------
// GATE 4 — six-state legacy migration model (advisory, boolean-only report)
// ---------------------------------------------------------------------------
const MIGRATION_STATES = [
  'LEGACY_NOT_SEEN',
  'LEGACY_PRESENT_NOT_MIGRATED',
  'SERVER_SYNC_AVAILABLE',
  'MIGRATION_VERIFIED',
  'LEGACY_REVOCATION_PENDING',
  'LEGACY_REVOKED'
];

check('index.html: all six migration states are represented in the UI map', () => {
  for (const s of MIGRATION_STATES) {
    assert(INDEX_HTML.indexOf(s) !== -1, 'missing migration state: ' + s);
  }
});

check('index.html: legacy report sends a boolean presence flag + non-secret device id only (no token value)', () => {
  const body = extractFunction(INDEX_HTML, 'serverSyncLegacyReport');
  assert(body !== null, 'serverSyncLegacyReport not found');
  // holds must be a strict boolean coercion — the token VALUE must never
  // travel in the payload, only its presence.
  assert(/holds\s*=\s*!!ghToken\(\)/.test(body), 'holds is not a !!ghToken() boolean coercion');
  assert(/holdsLegacyToken:\s*holds/.test(body), 'payload does not carry holdsLegacyToken: holds');
  // FIX A v2 payload: holdsLegacyToken + reportVersion + non-secret deviceId.
  // Exactly these three fields, holdsLegacyToken first.
  const payloadMatch = body.match(/_fetch\(\s*['"]POST['"]\s*,\s*['"]\/sync\/legacy-report['"]\s*,\s*\{([^}]*)\}/);
  assert(payloadMatch, 'legacy report POST body not found');
  const fields = payloadMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
  assert(fields.length === 3, 'legacy report body must contain exactly three fields, got: ' + payloadMatch[1]);
  assert(/^holdsLegacyToken:\s*holds$/.test(fields[0]), 'unexpected first field in legacy report body');
  assert(/^reportVersion:\s*2$/.test(fields[1]), 'missing/changed reportVersion field');
  assert(/^deviceId:\s*deviceId\s*\|\|\s*undefined$/.test(fields[2]), 'missing/changed deviceId field');
  // The device id must come from the non-secret syncDeviceId() helper —
  // never from the PAT, never from any gh* credential storage.
  const devId = extractFunction(INDEX_HTML, 'syncDeviceId');
  assert(devId !== null, 'syncDeviceId helper missing');
  assert(/digi_sync_device_id/.test(devId), 'syncDeviceId must persist a stable non-secret id');
  assert(!/digi_gh_token|GH_TOKEN_KEY|ghToken\(/.test(devId), 'syncDeviceId must never read the PAT');
  // No localStorage token value may be interpolated into the payload.
  assert(!/holdsLegacyToken:\s*localStorage/.test(body), 'raw localStorage value sent as report');
  assert(!/holdsLegacyToken:\s*ghToken\(\)/.test(body), 'token value (not boolean) sent as report');
});

check('index.html: legacy report fired from renderSyncPage (backend path only)', () => {
  const render = extractFunction(INDEX_HTML, 'renderSyncPage');
  assert(render !== null, 'renderSyncPage not found');
  assert(render.indexOf('serverSyncLegacyReport()') !== -1, 'report not fired from renderSyncPage');
  const body = extractFunction(INDEX_HTML, 'serverSyncLegacyReport');
  assert(body.indexOf('if (!USE_BACKEND) return;') !== -1, 'report not gated to backend mode');
});

check('index.html: legacy localStorage keys RETAINED (migration keeps old devices working)', () => {
  // Migration contract: legacy keys must NOT be removed by this PR — devices
  // still holding them must keep their silent local path until step 9.
  assert(/const\s+GH_TOKEN_KEY\s*=\s*['"]digi_gh_token['"]/.test(INDEX_HTML), 'digi_gh_token key removed/renamed');
  assert(/digi_gh_gist_id/.test(INDEX_HTML), 'digi_gh_gist_id key reference removed');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
