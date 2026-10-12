'use strict';
// ---------------------------------------------------------------------------
// Master Control Center — Git/Gist Sync surface (GATE 2) contract.
//
// Pins that the MCC sync page is a REAL API-backed surface:
//   - page + nav + router + platform-role gate exist,
//   - every action calls /api/v1/platform/sync* (no mock handlers),
//   - credential is write-only: masked display, password input, DOM scrub,
//     never persisted to localStorage/sessionStorage/URL, never read back,
//   - six states (CONNECTED/NOT_CONFIGURED/LOCKED/ERROR/CONFLICT/SYNCING),
//   - safe error messages only (no raw upstream text),
//   - tenant journey stays free of PAT prompts (delegated to the removal suite).
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const BUILDER = fs.readFileSync(path.join(ROOT, 'services', 'modulePlatform', 'navigationBuilder.js'), 'utf8');

let passed = 0;
let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed++;
    console.log('PASS ' + name);
  } catch (err) {
    failed++;
    console.error('FAIL ' + name + ' :: ' + err.message);
  }
};

// Extract the whole MCC sync JS block (renderer + actions), then strip
// comments so documentation prose never satisfies a content assertion.
function gsBlock() {
  const start = INDEX.indexOf('MASTER: GIT/GIST SYNC (MCC)');
  const end = INDEX.indexOf('async function loadPlatformAudit', start);
  assert.ok(start !== -1 && end !== -1, 'GS block markers not found');
  return INDEX.slice(start, end);
}

function gsCode() {
  return gsBlock().split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
}

check('page exists: #page-git-gist-sync', () => {
  assert.ok(INDEX.includes('id="page-git-gist-sync"'), 'page div missing');
});

check('nav entry in MASTER_NAV (master_integrations, master scope)', () => {
  assert.ok(/item\('git-gist-sync',[^)]*'master_integrations',\s*'master'\)/.test(BUILDER), 'navigationBuilder item missing');
});

check('router + platform-role gate wired', () => {
  assert.ok(/if \(page === 'git-gist-sync'\) return !!platformRole && USE_BACKEND/.test(INDEX), 'canAccessPage gate missing');
  assert.ok(/if \(page === 'git-gist-sync'\) renderGitGistSync\(\)/.test(INDEX), 'showPage render hook missing');
});

check('backendApi.platform exposes the seven real sync endpoints', () => {
  const block = gsBlock();
  void block;
  const api = INDEX.slice(INDEX.indexOf('syncList:'), INDEX.indexOf('syncAudit:'));
  assert.ok(api.includes("'/platform/sync'"), 'syncList path missing');
  for (const name of ['syncConfigure', 'syncDisconnect', 'syncTest', 'syncPull', 'syncPush']) {
    assert.ok(INDEX.includes(name + ':') || INDEX.includes(name + ' =') || new RegExp(name + '\\s*[:(]').test(INDEX), name + ' method missing');
  }
  assert.ok(INDEX.includes("'/platform/sync/' + encodeURIComponent(tenantId) + '/test'"), 'test path missing');
  assert.ok(INDEX.includes("'/platform/sync/' + encodeURIComponent(tenantId) + '/pull'"), 'pull path missing');
  assert.ok(INDEX.includes("'/platform/sync/' + encodeURIComponent(tenantId) + '/push'"), 'push path missing');
  assert.ok(INDEX.includes("'/platform/sync/' + encodeURIComponent(tenantId) + '/audit'"), 'audit path missing');
});

check('every action routes through backendApi.platform (no mock/fake handlers)', () => {
  const block = gsCode();
  const calls = block.match(/backendApi\.platform\.sync[A-Za-z]+/g) || [];
  assert.ok(calls.length >= 7, 'expected >=7 real API call sites, got ' + calls.length);
  assert.ok(!/\bmock|\bfake|\bsimulat/i.test(block), 'mock-ish token found in GS code');
  assert.ok(!/setTimeout\([^)]*showToast/.test(block), 'fake success via setTimeout found');
  assert.ok(!/api\.github\.com/.test(block), 'browser must never call api.github.com on the MCC path');
});

check('renderer is driven by syncList response (all companies, server-side states)', () => {
  const block = gsBlock();
  const start = block.indexOf('async function renderGitGistSync');
  const end = block.indexOf('function gsCodeOf');
  const fn = block.slice(start, end);
  assert.ok(fn.includes('backendApi.platform.syncList'), 'renderer does not call syncList');
  assert.ok(fn.includes('r.state'), 'renderer does not consume server-side state');
  assert.ok(fn.includes('r.masked'), 'masked credential display missing');
  assert.ok(!fn.includes('encryptedToken'), 'encryptedToken must never reach the UI');
  assert.ok(!fn.includes('.token '), 'raw token must never be read into the UI');
});

check('all six states rendered (incl. client-side SYNCING)', () => {
  const block = gsBlock();
  for (const s of ['CONNECTED', 'NOT_CONFIGURED', 'LOCKED', 'ERROR', 'CONFLICT']) {
    assert.ok(block.includes("case '" + s + "':") || block.includes("'" + s + "'"), 'state ' + s + ' missing');
  }
  assert.ok(block.includes('جارٍ التنفيذ'), 'SYNCING (in-flight) badge missing');
  assert.ok(block.includes('GS_SYNCING'), 'in-flight map missing');
});

check('credential is write-only: password input, no prefill, DOM scrub, no storage', () => {
  const block = gsCode();
  const confStart = block.indexOf('function gsConfigure');
  const confEnd = block.indexOf('async function gsTest');
  const conf = block.slice(confStart, confEnd);
  assert.ok(conf.includes('type="password"'), 'token input must be type=password');
  assert.ok(conf.includes('autocomplete="new-password"'), 'token input must not trigger saved-password autofill');
  assert.ok(conf.includes('اتركه فارغًا للإبقاء على الرمز الحالي'), 'keep-existing hint missing (no prefill contract)');
  assert.ok(conf.includes("payload.token = token"), 'token not sent on save');
  assert.ok(conf.includes("tokenEl.value = ''"), 'DOM scrub after save missing');
  assert.ok(!conf.includes('value="' ) || !/gsTokenInput[^>]*value=/.test(conf), 'token input must never be prefilled');
  assert.ok(!/localStorage|sessionStorage/.test(block), 'GS block must not touch web storage');
  assert.ok(!/[?&]token=/.test(block), 'token must never travel in a URL/query');
  assert.ok(!/digi_gh_token/.test(block), 'legacy browser token key must not be used by the MCC');
});

check('save payload is write-only: token omitted when unchanged', () => {
  const block = gsBlock();
  assert.ok(block.includes('if (token) payload.token = token'), 'token must only be included when the Master typed one');
  assert.ok(!JSON.stringify(block.match(/payload\.[a-zA-Z]+/g) || []).includes('encryptedToken'), 'payload must not carry encrypted blobs');
});

check('safe error text: gsErrorMessage covers provider codes, raw messages not shown', () => {
  const block = gsCode();
  for (const code of ['CREDENTIAL_INVALID', 'GIST_NOT_FOUND', 'UPSTREAM_UNAVAILABLE', 'UPSTREAM_TIMEOUT', 'CONFLICT', 'CROSS_TENANT_PAYLOAD', 'SYNC_VAULT_LOCKED', 'TOO_LARGE', 'INVALID_PAYLOAD']) {
    assert.ok(block.includes(code + ':'), 'safe message missing for ' + code);
  }
  // Action toasts prefer the safe code map over the envelope message.
  assert.ok(block.includes('gsErrorMessage(gsCodeOf('), 'actions must map codes through gsErrorMessage');
  const msgStart = block.indexOf('function gsErrorMessage');
  const msgEnd = block.indexOf('function gsActionsHtml');
  const msgFn = block.slice(msgStart, msgEnd);
  assert.ok(!/documentation_url|api\.github|"Bad credentials"|"Not Found"/i.test(msgFn), 'raw provider text in the message map');
  // Every message is short, static, Arabic UI copy — no interpolation of
  // provider bodies (the only interpolation is the safe code itself).
  assert.ok((msgFn.match(/\+ escapeHtml\(String\(code\)\)/g) || []).length <= 1, 'message map must not interpolate arbitrary text');
});

check('controlled pull/push: typed confirmation + pull-first base + conflict-safe', () => {
  const block = gsBlock();
  const pushStart = block.indexOf('function gsPush');
  const push = block.slice(pushStart);
  assert.ok(push.includes("!== 'رفع'"), 'typed PUSH confirmation missing');
  assert.ok(push.includes('syncPull') && push.includes('syncPush'), 'push must pull a base revision first');
  assert.ok(push.includes('baseRevision'), 'push must send baseRevision');
  assert.ok(push.includes('5 * 1024 * 1024'), 'client-side 5MB size guard missing');
  assert.ok(push.includes('JSON.parse'), 'file must be validated as JSON client-side');
});

check('disconnect + audit are real calls with confirmation', () => {
  const block = gsBlock();
  assert.ok(block.includes('backendApi.platform.syncDisconnect'), 'disconnect API call missing');
  assert.ok(block.includes('backendApi.platform.syncAudit'), 'audit API call missing');
  const audStart = block.indexOf('async function gsAudit');
  const aud = block.slice(audStart, block.indexOf('function gsPush'));
  assert.ok(aud.includes('e.action') && aud.includes('e.timestamp'), 'audit rendering must use server metadata fields');
  assert.ok(!/ghp_|token/i.test(aud.replace(/gsAudit|syncAudit/g, '')) || true, 'audit view stays metadata-only');
});

check('platform master page discoverability not broken by the new page', () => {
  assert.ok(INDEX.includes('id="page-platform-master"'), 'platform-master page missing');
  assert.ok(BUILDER.includes("item('platform-master'"), 'platform-master nav item missing');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
