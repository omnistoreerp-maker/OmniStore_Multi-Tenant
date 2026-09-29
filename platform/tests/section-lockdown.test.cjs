'use strict';

// Platform section lockdown + Monetag boundary static regression checks.
//
// Verifies, without any server or browser:
//   1. Active sections (marketplace, business, students, game-hosting and the
//      new Media / Reels feed) expose their real shipped routes.
//   2. Support stays locked as Coming Soon everywhere; Media-Reels ships
//      active with the reels feed player /media-reels.html.
//   3. Business + Marketplace + Students are active, with Marketplace
//      pointing at the active public route /marketplace/.
//   4. Visitors Now / platform stats machinery in platform/platform.js is
//      preserved (markers required by the Monetag isolation contract).
//   5. The reused Monetag boundary stays disabled with empty owner fields and
//      no fabricated publisher ID / script URL anywhere in shipped surfaces.
//   6. Diff scope: only intended platform files are modified in the working
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
const STUDENT_HTML = read('student.html');

const FAKE_MARKERS = [
  'monetag.com/script',
  'cdn.monetag.com',
  'widget.monetag.com',
  'YOUR_MONETAG',
  'MONETAG_ID'
];

const MONETAG_META = '<meta name="monetag" content="e1700efedc78f54b923023e572faa053">';
const MONETAG_META_VALUE = 'e1700efedc78f54b923023e572faa053';

const MONETAG_TAG = '<script src="https://quge5.com/88/tag.min.js" data-zone="288239" async data-cfasync="false"></script>';
const PROHIBITED_ZONES = ['11857331', '11912374'];

// Students graduated to active in the Students activation cycle;
// game-hosting graduated in the Device 2 activation cycle; Media / Reels
// ships active with the public reels feed. Only support stays locked.
const LOCKED_IDS = ['support'];
const ACTIVE_ROUTES = {
  'marketplace': '/marketplace/',
  'business-services': '/business.html',
  'student-services': '/student.html',
  'game-hosting': '/index.html',
  'media-reels': '/media-reels.html'
};

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

check('platform.html advertises student.html from all three nav spots', () => {
  assert.strictEqual(count(PLATFORM_HTML, 'href="student.html"'), 3,
    'expected exactly 3 student links (top/footer/bottom), got ' + count(PLATFORM_HTML, 'href="student.html"'));
  assert.strictEqual(count(PLATFORM_HTML, 'class="glass-nav-link" href="student.html"'), 1, 'top nav student link missing');
  assert.strictEqual(count(PLATFORM_HTML, '<a href="student.html" data-i18n="nav_students_short">'), 1, 'footer student link missing');
  assert.strictEqual(count(PLATFORM_HTML, 'class="bottom-nav-link" href="student.html"'), 1, 'bottom nav student link missing');
});

check('platform.html student links are active links, never locked or soon-badged', () => {
  const links = PLATFORM_HTML.match(/<a[^>]*href="student\.html"[^>]*>/g) || [];
  assert.strictEqual(links.length, 3, 'expected 3 student anchors');
  for (const link of links) {
    assert.ok(!link.includes('is-soon'), 'student link must not carry the soon lock: ' + link);
    assert.ok(!link.includes('aria-disabled'), 'student link must not be disabled: ' + link);
    assert.ok(link.includes('data-i18n="nav_students'), 'student link must stay translatable: ' + link);
  }
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
check('business.html student entry points navigate to the live student.html', () => {
  assert.ok(count(BUSINESS_HTML, 'student.html') >= 4, 'student entry points missing');
  assert.strictEqual(count(BUSINESS_HTML, "window.location.href='student.html'"), 4,
    'both student cards and both CTAs must open student.html');
});

check('business.html student cards are active, no longer Coming Soon', () => {
  const start = BUSINESS_HTML.indexOf('id="student-h"');
  const end = BUSINESS_HTML.indexOf('<!-- TIKTOK REELS');
  assert.ok(start > -1 && end > start, 'student section could not be isolated');
  const section = BUSINESS_HTML.slice(start, end);
  assert.strictEqual(count(section, 'pricing-card--soon'), 0, 'student card still locked');
  assert.strictEqual(count(section, 'soon-badge'), 0, 'student card still badged Coming Soon');
  assert.strictEqual(count(section, 'aria-disabled'), 0, 'student card still disabled');
  assert.strictEqual(count(section, 'type="button" disabled'), 0, 'student CTA still disabled');
  assert.strictEqual(count(section, 'type="button"'), 2, 'both student CTAs must stay real buttons');
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

check('platform.js active allowlist matches the shipped active sections', () => {
  for (const [id, url] of Object.entries(ACTIVE_ROUTES)) {
    assert.ok(PLATFORM_JS.includes("'" + id + "': '" + url + "'"), 'active route wrong for ' + id);
  }
  const block = PLATFORM_JS.match(/active:\s*\{[\s\S]*?\}/);
  assert.ok(block, 'active allowlist block missing');
  assert.strictEqual((block[0].match(/':\s*'/g) || []).length, Object.keys(ACTIVE_ROUTES).length,
    'exactly ' + Object.keys(ACTIVE_ROUTES).length + ' sections may stay active');
});

check('platform.js locks the support id and releases graduated sections', () => {
  const m = PLATFORM_JS.match(/lockedIds:\s*\[([^\]]*)\]/);
  assert.ok(m, 'lockedIds array missing');
  for (const id of LOCKED_IDS) {
    assert.ok(m[1].includes("'" + id + "'"), 'id not locked: ' + id);
  }
  assert.ok(!m[1].includes('student-services'), 'students must no longer be a locked id');
  assert.strictEqual((m[1].match(/'/g) || []).length / 2, LOCKED_IDS.length, 'unexpected id count in lockedIds');
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

check('platform.js fallback catalog exposes students as the one active exception', () => {
  const m = PLATFORM_JS.match(/id:\s*'student-services'[^}]+\}/);
  assert.ok(m, 'student-services entry missing from DEFAULT_SECTIONS');
  assert.ok(m[0].includes("status: 'active'"), 'student fallback must be active');
  assert.ok(m[0].includes("url: '/student.html'"), 'student fallback must open /student.html');
});

check('platform.js locked fallback entries have null urls', () => {
  for (const id of LOCKED_IDS) {
    const m = PLATFORM_JS.match(new RegExp("id:\\s*'" + id + "'[^}]+\\}"));
    assert.ok(m, 'fallback entry missing: ' + id);
    assert.ok(m[0].includes('url: null'), id + ' must not expose a url');
    assert.ok(m[0].includes("status: 'coming-soon'"), id + ' must be coming-soon');
  }
});

check('platform.js fallback catalog exposes media-reels as the active reels feed', () => {
  const m = PLATFORM_JS.match(/id:\s*'media-reels'[^}]+\}/);
  assert.ok(m, 'media-reels entry missing from DEFAULT_SECTIONS');
  assert.ok(m[0].includes("status: 'active'"), 'media fallback must be active');
  assert.ok(m[0].includes("url: '/media-reels.html'"), 'media fallback must open /media-reels.html');
});

check('platform.js has i18n labels for nav badge, students and support (en+ar)', () => {
  assert.ok(count(PLATFORM_JS, 'nav_soon') >= 2, 'nav_soon i18n missing');
  assert.ok(count(PLATFORM_JS, 'section_support') >= 2, 'section_support i18n missing');
  assert.ok(count(PLATFORM_JS, 'nav_students') >= 2, 'nav_students i18n missing');
  assert.ok(count(PLATFORM_JS, 'nav_students_short') >= 2, 'nav_students_short i18n missing');
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

check('official Monetag verification meta present once inside platform.html <head>', () => {
  assert.strictEqual(count(PLATFORM_HTML, MONETAG_META_VALUE), 1, 'verification value must appear exactly once');
  assert.ok(PLATFORM_HTML.includes(MONETAG_META), 'exact official meta tag missing');
  const head = PLATFORM_HTML.match(/<head>[\s\S]*?<\/head>/);
  assert.ok(head && head[0].includes(MONETAG_META), 'meta tag must sit inside <head>');
  assert.strictEqual(count(INDEX_HTML, MONETAG_META_VALUE), 0, 'index.html must not duplicate the meta');
  assert.strictEqual(count(MONETAG_SRC, MONETAG_META_VALUE), 0, 'boundary source must not carry the meta');
  assert.strictEqual(count(BUSINESS_HTML, MONETAG_META_VALUE), 0, 'business.html must not duplicate the meta');
});

check('ERP index.html does not load the ad boundary', () => {
  assert.ok(!INDEX_HTML.toLowerCase().includes('monetag'));
  assert.ok(!INDEX_HTML.includes('platform/monetag.js'));
});

check('official Monetag Multitag present exactly once inside platform.html <head>', () => {
  assert.strictEqual(count(PLATFORM_HTML, MONETAG_TAG), 1, 'official tag must appear exactly once');
  assert.strictEqual(count(PLATFORM_HTML, 'quge5.com'), 1, 'quge5.com must appear exactly once');
  assert.strictEqual(count(PLATFORM_HTML, 'tag.min.js'), 1, 'tag.min.js must appear exactly once');
  const head = PLATFORM_HTML.match(/<head>[\s\S]*?<\/head>/);
  assert.ok(head && head[0].includes(MONETAG_TAG), 'tag must sit inside <head> for immediate load');
  assert.ok(PLATFORM_HTML.indexOf(MONETAG_TAG) < PLATFORM_HTML.indexOf('</head>'));
});

check('multitag attributes exact: zone 288239, quge5 origin, async non-blocking load', () => {
  assert.ok(MONETAG_TAG.includes('src="https://quge5.com/88/tag.min.js"'), 'official src URL mismatch');
  assert.ok(MONETAG_TAG.includes('data-zone="288239"'), 'data-zone must be 288239');
  assert.ok(/\sasync\s/.test(MONETAG_TAG), 'async attribute required (non-blocking)');
  assert.ok(MONETAG_TAG.includes('data-cfasync="false"'), 'data-cfasync required');
  const zones = PLATFORM_HTML.match(/data-zone="[^"]*"/g) || [];
  assert.deepStrictEqual(zones, ['data-zone="288239"'], 'exactly one data-zone, value 288239');
  assert.ok(!MONETAG_TAG.includes('onclick') && !MONETAG_TAG.includes('DOMContentLoaded'),
    'no interaction/delay gating on the official tag');
});

check('no prohibited Monetag zones or fake/extra external scripts on shipped surfaces', () => {
  const surfaces = PLATFORM_HTML + '\n' + INDEX_HTML + '\n' + MONETAG_SRC + '\n' + PLATFORM_JS + '\n' + BUSINESS_HTML;
  for (const zone of PROHIBITED_ZONES) {
    assert.ok(!surfaces.includes(zone), 'prohibited zone present: ' + zone);
  }
  const external = PLATFORM_HTML.match(/<script[^>]+src="https?:\/\/[^"]+"/g) || [];
  assert.strictEqual(external.length, 1, 'platform.html must carry exactly one external https script');
  assert.ok(external[0].includes('https://quge5.com/88/tag.min.js'), 'external script must be the official tag');
  for (const marker of FAKE_MARKERS) {
    assert.ok(!surfaces.includes(marker), 'fake marker present: ' + marker);
  }
});

check('CSP narrowly allows the official Monetag chain only (no wildcard, policy preserved)', () => {
  const serverJs = read('backend/server.js');
  assert.ok(serverJs.includes('contentSecurityPolicy'), 'helmet CSP removed');
  assert.ok(serverJs.includes('helmet('), 'helmet middleware removed');
  const scriptLine = (serverJs.match(/scriptSrc: \[[^\]]*\]/) || [])[0];
  assert.ok(scriptLine, 'scriptSrc directive missing');
  assert.ok(scriptLine.includes("'https://quge5.com'"), 'official tag origin missing from script-src');
  assert.ok(scriptLine.includes("'https://auqot.com'"), 'observed Multitag child origin missing');
  assert.ok(scriptLine.includes("'https://ekhay.com'"), 'observed Multitag child origin missing');
  assert.ok(scriptLine.includes("'https://b3mny.com'"), 'observed Multitag child origin missing');
  assert.ok(!scriptLine.includes('*'), 'wildcard forbidden in script-src');
  assert.strictEqual((scriptLine.match(/https:\/\//g) || []).length, 6, 'unexpected extra origin in script-src');
  const connectLine = (serverJs.match(/connectSrc: \[[^\]]*\]/) || [])[0];
  assert.ok(connectLine, 'connectSrc directive missing');
  assert.ok(connectLine.includes("'https://6opo.com'"), 'observed Multitag beacon origin missing from connect-src');
  assert.ok(connectLine.includes("'https://auqot.com'"), 'observed Multitag beacon origin missing from connect-src');
  assert.ok(connectLine.includes("'https://my.rtmark.net'"), 'observed Multitag beacon origin missing from connect-src');
  assert.ok(connectLine.includes("'https://jmosl.com'"), 'observed Multitag beacon origin missing from connect-src');
  assert.ok(connectLine.includes("'https://094kk.com'"), 'observed Multitag beacon origin missing from connect-src');
  assert.ok(!connectLine.includes('*'), 'wildcard forbidden in connect-src');
  assert.strictEqual((connectLine.match(/https:\/\//g) || []).length, 7, 'unexpected extra origin in connect-src');
  assert.ok(serverJs.includes('frameSrc: ["\'none\'"]'), 'frame-src policy changed');
  assert.ok(serverJs.includes('objectSrc: ["\'none\'"]'), 'object-src policy changed');
  assert.ok(serverJs.includes('imgSrc: ["\'self\'", \'data:\']'), 'img-src policy changed');
  assert.ok(serverJs.includes('styleSrc: ["\'self\'", "\'unsafe-inline\'", \'https://fonts.googleapis.com\']'), 'style-src policy changed');
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
// 5. student.html — the live, tenant-scoped Students UI
// ---------------------------------------------------------------------------
check('student.html is the shipped RTL Students UI wired to the tenant API', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'student.html')), 'student.html missing');
  assert.ok(STUDENT_HTML.includes("'/api/v1/tenant/student-services'"), 'student.html must call the live tenant API');
  assert.ok(/<html[^>]+dir="rtl"/.test(STUDENT_HTML), 'student.html must stay RTL');
  assert.ok(STUDENT_HTML.includes("localStorage.getItem('access_token')"), 'student.html must use the real tenant token');
});

check('student.html ships no mock/static business data', () => {
  for (const marker of ['MOCK_', 'DUMMY_', 'sampleData', 'fakeOrder', 'hardcodedProducts']) {
    assert.ok(!STUDENT_HTML.includes(marker), 'mock marker present in student.html: ' + marker);
  }
});

check('backend catalog default advertises the same student route as the UI', () => {
  const svc = read('backend/services/platformCatalog.service.js');
  assert.ok(svc.includes("id: 'student-services'"), 'catalog default student entry missing');
  assert.ok(svc.includes("status: 'active'"), 'catalog default student entry must be active');
  assert.ok(svc.includes("url: '/student.html'"), 'catalog default student url mismatch');
});

// ---------------------------------------------------------------------------
// 6. Diff scope — only intended platform files modified in working tree
// ---------------------------------------------------------------------------
check('working-tree diff touches only intended platform files', () => {
  const allowedModified = new Set([
    'platform.html',
    'platform/platform.js',
    'platform/platform.css',
    'business.html',
    // Official Multitag integration: minimal CSP change + focused tests.
    'backend/server.js',
    'backend/tests/monetag.boundary.test.js',
    'platform/tests/section-lockdown.test.cjs',
    // Pre-existing local WIP from earlier candidate work — carried across
    // branches, deliberately never staged by this change set:
    'backend/data/platformPublic.json',
    'backend/services/platformCatalog.service.js',
    'backend/tests/platformPublic.test.js',
    // Students activation cycle: catalog/sections discovery assertions.
    'backend/tests/platformSections.students.test.js',
    // Media / Reels clean port: runtime media storage stays untracked.
    '.gitignore'
  ]);
  const allowedUntracked = new Set([
    'platform/tests/section-lockdown.test.cjs',
    'backend/tests/platformSections.students.test.js',
    'CANDIDATE_HANDOFF_20260920.md',
    'docs/REAL_REPOSITORY_RECONCILIATION.md',
    'docs/TEABLE_AGENT_RECONCILIATION.md',
    // Media / Reels clean port: new feed surface files.
    'media-reels.html',
    'backend/routes/reels.routes.js',
    'backend/controllers/reels.controller.js',
    'backend/services/reels.service.js',
    'backend/tests/reelsPublic.test.js'
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

check('Marketplace, legacy market, sw.js, .env and backend/data show no working-tree diff', () => {
  const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout;
  const protectedPaths = ['marketplace', 'market.html', 'market', 'sw.js', '.env', 'backend/data'];
  const dirty = git(['diff', '--name-only', 'HEAD', '--', ...protectedPaths])
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean)
    // backend/data/platformPublic.json is pre-existing local WIP and must never
    // be staged by this change set (re-checked at commit time by the diff scope
    // report); every other protected path must stay byte-identical.
    .filter((f) => f !== 'backend/data/platformPublic.json');
  assert.deepStrictEqual(dirty, [], 'forbidden diffs: ' + dirty.join(', '));
});

console.log('\nsection-lockdown.test.cjs: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
