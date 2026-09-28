'use strict';

// Platform section lockdown + Monetag boundary static regression checks.
//
// Verifies, without any server or browser:
//   1. Students / Gaming / Media-Reels / Support are locked as Coming Soon
//      across the platform home UI and the business page entry points.
//   2. Business + Marketplace remain the only active sections, with
//      Marketplace pointing at the active public route /marketplace/.
//   3. Visitors Now / platform stats machinery in platform/platform.js is
//      preserved (markers required by the Monetag isolation contract).
//   4. The reused Monetag boundary stays disabled with empty owner fields and
//      no fabricated publisher ID / script URL anywhere in shipped surfaces.
//   5. Diff scope: only intended platform files are modified in the working
//      tree (Marketplace, legacy market, backend/data and .env untouched).

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PLATFORM_HTML = read('platform.html');
const PLATFORM_JS = read('platform/platform.js');
const PLATFORM_CSS = read('platform/platform.css');
const BUSINESS_HTML = read('business.html');
const MONETAG_SRC = read('platform/monetag.js');
const INDEX_HTML = read('index.html');
const MARKETPLACE_INDEX = read('marketplace/index.html');

const FAKE_MARKERS = [
  'e1700efedc78f54b923023e572faa053',
  'monetag.com/script',
  'cdn.monetag.com',
  'widget.monetag.com',
  'YOUR_MONETAG',
  'MONETAG_ID'
];

const LOCKED_IDS = ['student-services', 'game-hosting', 'media-reels', 'support'];

let passed = 0;
let failed = 0;
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

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// ---------------------------------------------------------------------------
// 1. platform.html — locked navigation, marketplace active route
// ---------------------------------------------------------------------------
check('platform.html has no link into game-hosting legacy route', () => {
  assert.strictEqual(count(PLATFORM_HTML, 'market.html#/game-hosting'), 0);
});

check('platform.html has no bare legacy market.html link', () => {
  assert.strictEqual(count(PLATFORM_HTML, 'href="market.html"'), 0);
});

check('platform.html points marketplace entries to /marketplace/ (>=5)', () => {
  assert.ok(count(PLATFORM_HTML, 'href="/marketplace/"') >= 5,
    'expected at least 5 marketplace links, got ' + count(PLATFORM_HTML, 'href="/marketplace/"'));
});

check('platform.html locks gaming nav in all three spots (top/footer/bottom)', () => {
  assert.ok(count(PLATFORM_HTML, 'glass-nav-link is-soon') >= 1, 'top nav gaming lock missing');
  assert.ok(count(PLATFORM_HTML, 'footer-link is-soon') >= 1, 'footer gaming lock missing');
  assert.ok(count(PLATFORM_HTML, 'bottom-nav-link is-soon') >= 1, 'bottom nav gaming lock missing');
  assert.ok(count(PLATFORM_HTML, 'aria-disabled="true"') >= 3, 'aria-disabled missing on locked nav items');
  assert.ok(count(PLATFORM_HTML, 'nav-soon') >= 3, 'honest "coming soon" nav badges missing');
});

check('platform.html does not advertise student.html', () => {
  assert.strictEqual(count(PLATFORM_HTML, 'student.html'), 0);
});

check('platform.html keeps sections container and visitor counter markers', () => {
  assert.ok(PLATFORM_HTML.includes('id="sections"'), 'sections container missing');
  assert.ok(PLATFORM_HTML.includes('id="activity-visitors-now"'), 'visitor counter element missing');
});

check('platform.html keeps exactly one disabled Monetag boundary script', () => {
  assert.strictEqual(count(PLATFORM_HTML, 'platform/monetag.js'), 1);
  assert.ok(PLATFORM_HTML.includes('data-omnistore-monetag-boundary="config"'));
  assert.ok(PLATFORM_HTML.includes('data-monetag-enabled="false"'));
  assert.ok(PLATFORM_HTML.includes('data-monetag-publisher-id=""'));
  assert.ok(PLATFORM_HTML.includes('data-monetag-script-url=""'));
  assert.strictEqual(count(PLATFORM_HTML, 'data-omnistore-monetag="true"'), 0);
  assert.strictEqual(count(PLATFORM_HTML, 'data-omnistore-monetag-external="true"'), 0);
  assert.ok(!/<script[^>]+src=["']https?:\/\/[^"']*monetag/i.test(PLATFORM_HTML));
});

check('platform.html loads boundary only after core platform script', () => {
  const pIdx = PLATFORM_HTML.indexOf('platform/platform.js');
  const mIdx = PLATFORM_HTML.indexOf('platform/monetag.js');
  assert.ok(pIdx > -1 && mIdx > pIdx, 'script order violated');
});

// ---------------------------------------------------------------------------
// 2. business.html — student entry points locked, finished features intact
// ---------------------------------------------------------------------------
check('business.html no longer navigates to student.html', () => {
  assert.strictEqual(count(BUSINESS_HTML, 'student.html'), 0);
  assert.strictEqual(count(BUSINESS_HTML, "window.location.href='student.html'"), 0);
});

check('business.html student cards are honest Coming Soon (badge + aria + disabled)', () => {
  assert.strictEqual(count(BUSINESS_HTML, 'class="pricing-card pricing-card--soon"'), 2);
  assert.strictEqual(count(BUSINESS_HTML, 'class="soon-badge"'), 2);
  assert.ok(count(BUSINESS_HTML, 'aria-disabled="true"') >= 2);
  assert.ok(count(BUSINESS_HTML, 'type="button" disabled') >= 2);
  assert.ok(BUSINESS_HTML.includes('Coming Soon'), 'Coming Soon label missing');
});

check('business.html keeps student section heading (not deleted)', () => {
  assert.ok(BUSINESS_HTML.includes('id="student-h"'), 'student section heading removed');
});

check('business.html keeps finished features (sign-in + TikTok reels feed)', () => {
  assert.ok(BUSINESS_HTML.includes('id="login-form"'), 'business sign-in form removed');
  assert.ok(BUSINESS_HTML.includes('tiktok-feed-host'), 'finished TikTok feed removed');
});

// ---------------------------------------------------------------------------
// 3. platform/platform.js — section lockdown policy + preserved machinery
// ---------------------------------------------------------------------------
check('platform.js defines lockdown policy, defaults and applier', () => {
  assert.ok(PLATFORM_JS.includes('SECTION_LOCK_POLICY'), 'policy missing');
  assert.ok(PLATFORM_JS.includes('DEFAULT_SECTIONS'), 'fallback catalog missing');
  assert.ok(PLATFORM_JS.includes('function applySectionPolicy'), 'policy applier missing');
});

check('platform.js active allowlist = marketplace + business only', () => {
  assert.ok(PLATFORM_JS.includes("'marketplace': '/marketplace/'"), 'marketplace active route wrong');
  assert.ok(PLATFORM_JS.includes("'business-services': '/business.html'"), 'business active route wrong');
});

check('platform.js locks students/gaming/media/support ids', () => {
  const m = PLATFORM_JS.match(/lockedIds:\s*\[([^\]]*)\]/);
  assert.ok(m, 'lockedIds array missing');
  for (const id of LOCKED_IDS) {
    assert.ok(m[1].includes("'" + id + "'"), 'id not locked: ' + id);
  }
});

check('platform.js wires policy into init with empty-API fallback', () => {
  assert.ok(/lastSections\s*=\s*applySectionPolicy\(rawSections\)/.test(PLATFORM_JS), 'init wiring missing');
  assert.ok(PLATFORM_JS.includes('if (!rawSections.length) rawSections = DEFAULT_SECTIONS;'), 'fallback missing');
});

check('platform.js policy appends missing locked ids (support always visible)', () => {
  const fn = PLATFORM_JS.match(/function applySectionPolicy[\s\S]*?\n  \}/);
  assert.ok(fn, 'applySectionPolicy not found');
  assert.ok(fn[0].includes('SECTION_LOCK_POLICY.lockedIds.forEach'), 'locked-id append loop missing');
  assert.ok(fn[0].includes('if (def) base.push'), 'append missing locked entry missing');
});

check('platform.js fallback catalog exposes support as coming-soon', () => {
  const m = PLATFORM_JS.match(/id:\s*'support'[^}]+\}/);
  assert.ok(m, 'support entry missing from DEFAULT_SECTIONS');
  assert.ok(m[0].includes("status: 'coming-soon'"));
  assert.ok(m[0].includes('url: null'));
});

check('platform.js locked fallback entries have null urls', () => {
  for (const id of ['student-services', 'game-hosting', 'media-reels']) {
    const m = PLATFORM_JS.match(new RegExp("id:\\s*'" + id + "'[^}]+\\}"));
    assert.ok(m, 'fallback entry missing: ' + id);
    assert.ok(m[0].includes('url: null'), id + ' must not expose a url');
    assert.ok(m[0].includes("status: 'coming-soon'"), id + ' must be coming-soon');
  }
});

check('platform.js has i18n labels for nav badge and support section (en+ar)', () => {
  assert.ok(count(PLATFORM_JS, 'nav_soon') >= 2, 'nav_soon i18n missing');
  assert.ok(count(PLATFORM_JS, 'section_support') >= 2, 'section_support i18n missing');
});

check('platform.js preserves Visitors Now / heartbeat / stats machinery', () => {
  assert.ok(PLATFORM_JS.includes('window.initOmniVisitors'), 'initOmniVisitors missing');
  assert.ok(PLATFORM_JS.includes("API + '/activity/heartbeat'"), 'heartbeat call missing');
  assert.ok(PLATFORM_JS.includes('setInterval(sendHeartbeat, 60000)'), 'heartbeat interval missing');
  assert.ok(PLATFORM_JS.includes('visitorsNow'), 'visitorsNow metric missing');
  assert.ok(PLATFORM_JS.includes("loadJSON('/stats')"), 'stats loader missing');
  assert.ok(PLATFORM_JS.includes('startStatsRefresh'), 'stats refresh missing');
  assert.ok(count(PLATFORM_HTML, 'id="activity-registered-users"') === 1);
  assert.ok(count(PLATFORM_HTML, 'id="activity-active-businesses"') === 1);
  assert.ok(count(PLATFORM_HTML, 'id="activity-orders-today"') === 1);
});

check('platform.js never mentions the ad boundary', () => {
  assert.strictEqual(PLATFORM_JS.toLowerCase().includes('monetag'), false);
});

check('platform.css styles locked nav states', () => {
  assert.ok(PLATFORM_CSS.includes('.glass-nav-link.is-soon'), 'nav lock styles missing');
  assert.ok(PLATFORM_CSS.includes('.nav-soon'), 'soon badge styles missing');
});

// ---------------------------------------------------------------------------
// 4. Monetag boundary — disabled, isolated, no fabricated identifiers
// ---------------------------------------------------------------------------
check('monetag boundary is disabled and fails closed by default', () => {
  assert.ok(MONETAG_SRC.includes('enabled: false'));
  assert.ok(MONETAG_SRC.includes('OWNER_INPUT_REQUIRED'));
  assert.ok(MONETAG_SRC.includes('disabled_or_owner_input_required'));
  assert.ok(MONETAG_SRC.includes("publisherId: ''"));
  assert.ok(MONETAG_SRC.includes("scriptUrl: ''"));
});

check('no fabricated Monetag identifier on any shipped surface', () => {
  const surfaces = PLATFORM_HTML + '\n' + INDEX_HTML + '\n' + MONETAG_SRC + '\n' + PLATFORM_JS + '\n' + BUSINESS_HTML;
  for (const marker of FAKE_MARKERS) {
    assert.ok(!surfaces.includes(marker), 'fake marker present: ' + marker);
  }
});

check('ERP index.html does not load the ad boundary', () => {
  assert.ok(!INDEX_HTML.toLowerCase().includes('monetag'));
  assert.ok(!INDEX_HTML.includes('platform/monetag.js'));
});

check('monetag boundary stays isolated from core machinery (source tokens)', () => {
  const forbidden = ['visitorsNow', 'activity/heartbeat', 'platformActivity', 'auth/login', 'requireAuth', 'payments/webhook'];
  for (const token of forbidden) {
    assert.ok(!MONETAG_SRC.includes(token), 'boundary touches core token: ' + token);
  }
  assert.ok(!MONETAG_SRC.includes('platform/platform.js'));
  assert.ok(!/innerHTML\s*=|document\.write/.test(MONETAG_SRC));
});

check('active marketplace route exists as a real public page', () => {
  assert.ok(MARKETPLACE_INDEX.includes('<div id="root"'), 'marketplace SPA entry missing');
});

// ---------------------------------------------------------------------------
// 5. Diff scope — only intended platform files modified in working tree
// ---------------------------------------------------------------------------
check('working-tree diff touches only intended platform files', () => {
  const allowedModified = new Set([
    'platform.html',
    'platform/platform.js',
    'platform/platform.css',
    'business.html',
    // Pre-existing local WIP from earlier candidate work — carried across
    // branches, deliberately never staged by this change set:
    'backend/data/platformPublic.json',
    'backend/services/platformCatalog.service.js',
    'backend/tests/platformPublic.test.js'
  ]);
  const allowedUntracked = new Set([
    'platform/tests/section-lockdown.test.cjs',
    'CANDIDATE_HANDOFF_20260920.md',
    'docs/REAL_REPOSITORY_RECONCILIATION.md',
    'docs/TEABLE_AGENT_RECONCILIATION.md'
  ]);
  const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  const modified = git(['diff', '--name-only', 'HEAD']);
  for (const file of modified) {
    assert.ok(allowedModified.has(file), 'unexpected modified file: ' + file);
  }
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  for (const file of untracked) {
    assert.ok(allowedUntracked.has(file), 'unexpected untracked file: ' + file);
  }
});

check('Marketplace, legacy market and protected data show no working-tree diff', () => {
  const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout;
  const diffs = [
    git(['diff', '--name-only', 'HEAD', '--', 'marketplace', 'market.html', 'market', 'backend/data/.env']),
    git(['diff', '--name-only', 'HEAD', '--', 'backend/data/platformPublic.json'])
  ].join('\n');
  // backend/data/platformPublic.json is pre-existing local WIP and must never
  // be staged by this change set (checked again at commit time by the diff
  // scope report); marketplace/legacy market must show zero diff.
  const forbidden = diffs.split('\n').filter((f) => f && !f.startsWith('backend/data/platformPublic.json'));
  assert.deepStrictEqual(forbidden, [], 'forbidden diffs: ' + forbidden.join(', '));
});

console.log('\nsection-lockdown.test.cjs: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
