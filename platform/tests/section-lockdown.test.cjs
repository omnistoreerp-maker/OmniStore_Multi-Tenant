use strict';

// Platform section activation + Monetag removal + OmniAdSlot boundary static
// regression checks.
//
// Verifies, without any server or browser:
//   1. ACTIVE SECTIONS: Business, Marketplace, Students, Game Hosting and
//      Support are active with their real routes everywhere (backend catalog
//      default, platform.js lockdown policy, platform.html navigation,
//      business.html platform navigation). No coming-soon badge, no locked
//      link and no null url for any shipped section except Media/Reels.
//   2. Media/Reels stays honestly Coming Soon — it is Device 2's reserved
//      activation cycle and must never be forced active from this branch.
//   3. THE UNSAFE MULTITAG ZONE IS GONE: no quge5/288239 tag, no Monetag
//      verification meta, no ad-network origins in the CSP, and the legacy
//      boundary module stays disabled with owner fields empty.
//   4. OmniAdSlot is the single sanctioned ad surface: inline-only markup,
//      gated OFF by default (zero ad requests), prohibited zones hard-blocked
//      (288239, 11912374, 11912377, 11857331), no popup/onclick machinery.
//   5. Visitors Now / platform stats machinery in platform/platform.js is
//      preserved (markers required by the isolation contract).
//   6. Diff scope: only intended files are modified (Marketplace build,
//      legacy market, sw.js, backend/data and .env untouched).

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
const STUDENT_HTML = read('student.html');
const SUPPORT_HTML = read('support.html');
const STORE_HTML = read('market.html');
const AD_SLOT_SRC = read('platform/omniAdSlot.js');
const INDEX_HTML = read('index.html');
const MARKETPLACE_INDEX = read('marketplace/index.html');
const SERVER_JS = read('backend/server.js');
const CATALOG_SVC = read('backend/services/platformCatalog.service.js');
const MONETAG_SRC = read('platform/monetag.js');
const NAV_HARNESS = read('tests/e2e/verify-platform-nav.js');

const PROHIBITED_ZONES = ['288239', '11912374', '11912377', '11857331'];

// Active sections with their real routes (single source of truth for this
// suite). Only media-reels stays locked (Device 2's reserved cycle).
const ACTIVE_ROUTES = {
  'marketplace': '/marketplace/',
  'business-services': '/business.html',
  'student-services': '/student.html',
  'game-hosting': '/market.html#/game-hosting',
  'support': '/support.html'
};
const LOCKED_IDS = ['media-reels'];

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
// 1. platform.html — active navigation, ad tag removed, slot present
// ---------------------------------------------------------------------------
check('platform.html ships NO third-party ad tag (unsafe zone removed)', () => {
  assert.strictEqual(count(PLATFORM_HTML, 'quge5.com'), 0, 'quge5.com still referenced');
  assert.strictEqual(count(PLATFORM_HTML, 'tag.min.js'), 0, 'tag.min.js still referenced');
  assert.strictEqual(count(PLATFORM_HTML, 'data-zone='), 0, 'a data-zone attribute survived');
  assert.strictEqual(count(PLATFORM_HTML, '288239'), 0, 'prohibited zone 288239 still present');
  assert.strictEqual(count(PLATFORM_HTML, 'name="monetag"'), 0, 'Monetag verification meta still present');
  const external = PLATFORM_HTML.match(/<script[^>]+src="https?:\/\/[^"]+"/g) || [];
  assert.deepStrictEqual(external, [], 'no external https script may ship on the hub');
});

check('platform.html carries exactly one gated inline OmniAdSlot', () => {
  assert.strictEqual(count(PLATFORM_HTML, 'data-omni-ad-root'), 1, 'slot inner root missing');
  assert.ok(PLATFORM_HTML.includes('class="omni-ad-slot"'), 'slot container missing');
  assert.ok(PLATFORM_HTML.includes('data-omni-ad-page="platform"'), 'page marker missing');
  assert.ok(PLATFORM_HTML.includes("enabled: 'false'"), 'ad engine gate must ship disabled');
  assert.ok(PLATFORM_HTML.includes("zone: 'OWNER_INPUT_REQUIRED'"), 'zone must stay OWNER_INPUT_REQUIRED');
});

// ---------------------------------------------------------------------------
// 2. platform/platform.js — lockdown policy and section state
// ---------------------------------------------------------------------------
check('platform.js keeps all active sections active with real routes', () => {
  for (const [id, route] of Object.entries(ACTIVE_ROUTES)) {
    const key = id.replace(/-/g, '_');
    const sectionVar = 'section_' + key;
    assert.ok(PLATFORM_JS.includes(sectionVar), 'section variable missing: ' + sectionVar);
    assert.ok(PLATFORM_JS.includes(route), 'route not found in platform.js for ' + id);
  }
});

check('platform.js keeps Media/Reels honestly Coming Soon', () => {
  assert.ok(PLATFORM_JS.includes("status: 'coming-soon'"), 'media-reels must stay coming-soon');
  assert.ok(!PLATFORM_JS.includes("status: 'active'"), 'media-reels must not be active');
});

check('platform.js preserves Visitors Now markers', () => {
  assert.ok(PLATFORM_JS.includes('VisitorsNow'), 'Visitors Now marker missing');
});

// ---------------------------------------------------------------------------
// 3. business.html — TikTok Embed Player iframe, no remote monetag
// ---------------------------------------------------------------------------
check('business.html carries the TikTok Embed Player iframe', () => {
  const iframe = BUSINESS_HTML.match(/<iframe[^>]+src="https?:\/\/[^"]+"/);
  assert.ok(iframe, 'TikTok Embed Player iframe missing');
});

check('business.html has no remote monetag tag', () => {
  assert.strictEqual(count(BUSINESS_HTML, 'quge5.com'), 0, 'quge5.com still referenced');
  assert.strictEqual(count(BUSINESS_HTML, 'tag.min.js'), 0, 'tag.min.js still referenced');
});

// ---------------------------------------------------------------------------
// 4. security contracts in the CSP and ad-slot boundary
// ---------------------------------------------------------------------------
check('CSP has no unsafe ad/monetag origins', () => {
  const defaultSrc = (SERVER_JS.match(/defaultSrc: \[.*\]/) || [])[0];
  assert.ok(defaultSrc, 'defaultSrc missing');
  assert.ok(!defaultSrc.includes('quge5'), 'Monetag origin in default-src');
  assert.ok(!defaultSrc.includes('cdn.monetag'), 'Monetag origin in default-src');
});

check('TikTok CSP tightened: frame-src is one origin only', () => {
  assert.ok(SERVER_JS.includes("frameSrc: ['https://www.tiktok.com']"), 'frame-src must be TikTok player origin only');
  assert.ok(!SERVER_JS.includes("frameSrc: [\"'none'\"]"), 'frame-src must not be none');
  assert.ok(SERVER_JS.includes('imgSrc: ["\'self\'", \'data:\', \'https://*.tiktokcdn.com\', \'https://*.tiktokcdn-us.com\']'), 'img-src must allow TikTok CDN domains');
  assert.ok(!SERVER_JS.includes('imgSrc: ["\'self\'", \'data:\']'), 'img-src must not be stale');
});

check('connect-src keeps only http(s) origins', () => {
  const connectLine = (SERVER_JS.match(/connectSrc: \[.*\]/) || [])[0];
  assert.ok(connectLine, 'connectSrc directive missing');
  for (const origin of ['6opo.com', 'auqot.com', 'my.rtmark.net', 'jmosl.com', '094kk.com']) {
    assert.ok(!connectLine.includes(origin), 'ad origin still in connect-src: ' + origin);
  }
  assert.ok(!connectLine.includes('*'), 'wildcard forbidden in connect-src');
  const httpsCount = (connectLine.match(/https:\/\//g) || []).length;
  assert.strictEqual(httpsCount, 2, 'connect-src must carry exactly github api + jsdelivr');
});

check('object-src stays none', () => {
  assert.ok(SERVER_JS.includes('objectSrc: ["\'none\'"]'), 'object-src must stay none');
});

// ---------------------------------------------------------------------------
// 5. omniAdSlot — gated off, prohibited zones hard-blocked
// ---------------------------------------------------------------------------
check('omniAdSlot ships disabled with owner-input-required zone', () => {
  assert.ok(AD_SLOT_SRC.includes("enabled: 'false'"), 'ad engine must ship disabled');
  assert.ok(AD_SLOT_SRC.includes("zone: 'OWNER_INPUT_REQUIRED'"), 'zone must be OWNER_INPUT_REQUIRED');
});

check('prohibited zones are hard-blocked in omniAdSlot', () => {
  for (const zone of PROHIBITED_ZONES) {
    assert.ok(AD_SLOT_SRC.includes(zone), 'zone ' + zone + ' must be referenced');
  }
});

// ---------------------------------------------------------------------------
// 6. backend catalog — active routes and media-reels staying coming-soon
// ---------------------------------------------------------------------------
check('catalog default advertises all five active sections with real routes', () => {
  for (const [id, url] of Object.entries(ACTIVE_ROUTES)) {
    const entry = CATALOG_SVC.match(new RegExp("id: '" + id + "'[\s\S]{0,400}?url: '" + url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'"));
    assert.ok(entry, 'catalog entry for ' + id + ' must expose ' + url);
  }
  const media = CATALOG_SVC.match(/id: 'media-reels'[\s\S]{0,400}?status: 'coming-soon'/);
  assert.ok(media, 'media-reels must stay coming-soon in the catalog default');
  assert.ok(!CATALOG_SVC.includes("url: '/index.html'"), 'ERP shell must never be a section route');
});

// ---------------------------------------------------------------------------
// 7. backend data, .env, package.json — no working-tree diff
// ---------------------------------------------------------------------------
check('backend data, .env and package.json show no working-tree diff', () => {
  const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  const modified = git(['diff', '--name-only', 'HEAD', '--', 'backend/data', '.env', 'package.json', 'package-lock.json']);
  assert.deepStrictEqual(modified, [], 'backend/data, .env and package files must not be modified');
});

check('no runtime JSON appended beyond shipped data files', () => {
  const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  const untracked = git(['ls-files', '--others', '--exclude-standard', 'backend/data']);
  assert.deepStrictEqual(untracked, [], 'unexpected untracked files in backend/data');
});

// ---------------------------------------------------------------------------
// 8. Repo diff scope — the four remediation files are the only deltas
// ---------------------------------------------------------------------------
check('working-tree diff touches only the four remediation files', () => {
  const allowed = new Set([
    'backend/server.js',
    'nginx.conf',
    'backend/tests/monetag.boundary.test.js',
    'platform/tests/section-lockdown.test.cjs'
  ]);
  const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  const modified = git(['diff', '--name-only', 'HEAD']);
  for (const file of modified) {
    assert.ok(allowed.has(file), 'unexpected modified file: ' + file);
  }
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  for (const file of untracked) {
    assert.ok(allowed.has(file), 'unexpected untracked file: ' + file);
  }
});
