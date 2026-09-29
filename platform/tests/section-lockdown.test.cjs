'use strict';

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
  assert.ok(PLATFORM_HTML.includes("data-omni-ad-page=\"platform\""), 'page marker missing');
  assert.ok(PLATFORM_HTML.includes("enabled: 'false'"), 'ad engine gate must ship disabled');
  assert.ok(PLATFORM_HTML.includes("zone: 'OWNER_INPUT_REQUIRED'"), 'zone must stay OWNER_INPUT_REQUIRED');
  assert.strictEqual(count(PLATFORM_HTML, 'platform/omniAdSlot.js'), 1, 'slot engine must load exactly once');
});

check('platform.html links marketplace from all five spots', () => {
  assert.ok(count(PLATFORM_HTML, 'href="/marketplace/"') >= 5,
    'expected at least 5 marketplace links, got ' + count(PLATFORM_HTML, 'href="/marketplace/"'));
});

check('platform.html exposes game-hosting + support in all three nav spots', () => {
  for (const [route, min] of [['market.html#/game-hosting', 3], ['support.html', 3]]) {
    assert.ok(count(PLATFORM_HTML, 'href="' + route + '"') >= min,
      'expected >= ' + min + ' links to ' + route);
  }
});

check('platform.html student + business links stay in place', () => {
  assert.strictEqual(count(PLATFORM_HTML, 'href="student.html"'), 3, 'student links changed');
  assert.ok(count(PLATFORM_HTML, 'href="business.html"') >= 3, 'business links missing');
});

check('platform.html has no locked/soon nav item left (all sections active)', () => {
  assert.strictEqual(count(PLATFORM_HTML, 'is-soon'), 0, 'a nav item is still locked');
  assert.strictEqual(count(PLATFORM_HTML, 'nav-soon'), 0, 'a coming-soon badge survived');
  assert.strictEqual(count(PLATFORM_HTML, 'aria-disabled="true"'), 0, 'a disabled nav item survived');
});

check('platform.html keeps sections container and visitor counter markers', () => {
  assert.ok(PLATFORM_HTML.includes('id="sections"'), 'sections container missing');
  assert.ok(PLATFORM_HTML.includes('id="activity-visitors-now"'), 'visitor counter element missing');
  assert.ok(count(PLATFORM_HTML, 'id="activity-registered-users"') === 1);
  assert.ok(count(PLATFORM_HTML, 'id="activity-active-businesses"') === 1);
  assert.ok(count(PLATFORM_HTML, 'id="activity-orders-today"') === 1);
});

// ---------------------------------------------------------------------------
// 2. platform.js — new lockdown policy + preserved machinery
// ---------------------------------------------------------------------------
check('platform.js defines the new policy with five active routes', () => {
  for (const [id, url] of Object.entries(ACTIVE_ROUTES)) {
    assert.ok(PLATFORM_JS.includes("'" + id + "': '" + url + "'"),
      'active route wrong for ' + id + ' (expected ' + url + ')');
  }
  const block = PLATFORM_JS.match(/active:\s*\{[\s\S]*?\}/);
  assert.ok(block, 'active allowlist block missing');
  assert.strictEqual((block[0].match(/':\s*'/g) || []).length, 5,
    'exactly five sections may be active');
});

check('platform.js locks only media-reels (Device 2 reserved)', () => {
  const m = PLATFORM_JS.match(/lockedIds:\s*\[([^\]]*)\]/);
  assert.ok(m, 'lockedIds array missing');
  assert.strictEqual((m[1].match(/'/g) || []).length / 2, LOCKED_IDS.length,
    'unexpected id count in lockedIds');
  for (const id of LOCKED_IDS) {
    assert.ok(m[1].includes("'" + id + "'"), 'id not locked: ' + id);
  }
  for (const id of Object.keys(ACTIVE_ROUTES)) {
    assert.ok(!m[1].includes("'" + id + "'"), 'active section must not be locked: ' + id);
  }
});

check('platform.js fallback catalog matches the new reality', () => {
  const game = PLATFORM_JS.match(/id:\s*'game-hosting'[^}]+\}/);
  assert.ok(game, 'game-hosting fallback missing');
  assert.ok(game[0].includes("status: 'active'"), 'game-hosting fallback must be active');
  assert.ok(game[0].includes("url: '/market.html#/game-hosting'"), 'game-hosting must open the storefront route');
  const support = PLATFORM_JS.match(/id:\s*'support'[^}]+\}/);
  assert.ok(support, 'support fallback missing');
  assert.ok(support[0].includes("status: 'active'"), 'support fallback must be active');
  assert.ok(support[0].includes("url: '/support.html'"), 'support fallback must open /support.html');
  const media = PLATFORM_JS.match(/id:\s*'media-reels'[^}]+\}/);
  assert.ok(media, 'media-reels fallback missing');
  assert.ok(media[0].includes("status: 'coming-soon'"), 'media-reels must stay coming-soon');
  assert.ok(media[0].includes('url: null'), 'media-reels must not expose a url');
});

check('platform.js keeps policy wiring, i18n and Visitors Now machinery', () => {
  assert.ok(PLATFORM_JS.includes('function applySectionPolicy'), 'policy applier missing');
  assert.ok(/lastSections\s*=\s*applySectionPolicy\(rawSections\)/.test(PLATFORM_JS), 'init wiring missing');
  assert.ok(PLATFORM_JS.includes('if (!rawSections.length) rawSections = DEFAULT_SECTIONS;'), 'fallback missing');
  assert.ok(PLATFORM_JS.includes("SECTION_LOCK_POLICY.lockedIds.forEach"), 'locked-id append loop missing');
  assert.ok(count(PLATFORM_JS, 'nav_soon') >= 2, 'nav_soon i18n missing');
  assert.ok(count(PLATFORM_JS, 'nav_support') >= 2, 'nav_support i18n missing');
  assert.ok(count(PLATFORM_JS, 'nav_support_short') >= 2, 'nav_support_short i18n missing');
  assert.ok(PLATFORM_JS.includes('window.initOmniVisitors'), 'initOmniVisitors missing');
  assert.ok(PLATFORM_JS.includes("API + '/activity/heartbeat'"), 'heartbeat call missing');
  assert.ok(PLATFORM_JS.includes('setInterval(sendHeartbeat, 60000)'), 'heartbeat interval missing');
  assert.ok(PLATFORM_JS.includes('visitorsNow'), 'visitorsNow metric missing');
  assert.ok(PLATFORM_JS.includes("loadJSON('/stats')"), 'stats loader missing');
  assert.ok(PLATFORM_JS.toLowerCase().includes('monetag') === false, 'platform.js must stay ad-free');
});

check('platform.css styles the inline slot as in-flow only', () => {
  assert.ok(PLATFORM_CSS.includes('.omni-ad-slot'), 'slot styles missing');
  assert.ok(PLATFORM_CSS.includes('.omni-ad-inner'), 'slot inner styles missing');
  const block = (PLATFORM_CSS.split('.omni-ad-slot {')[1] || '').split('@media')[0];
  assert.ok(!block.includes('position:'), 'slot CSS must not set position (in-flow only)');
});

// ---------------------------------------------------------------------------
// 3. business.html — platform navigation + slot
// ---------------------------------------------------------------------------
check('business.html student entry points navigate to the live student.html', () => {
  assert.ok(count(BUSINESS_HTML, 'student.html') >= 4, 'student entry points missing');
  assert.strictEqual(count(BUSINESS_HTML, "window.location.href='student.html'"), 4,
    'both student cards and both CTAs must open student.html');
});

check('business.html keeps finished features (sign-in + TikTok reels feed)', () => {
  assert.ok(BUSINESS_HTML.includes('id="login-form"'), 'business sign-in form removed');
  assert.ok(BUSINESS_HTML.includes('tiktok-feed-host'), 'finished TikTok feed removed');
});

check('business.html platform navigation covers the active sections', () => {
  assert.ok(BUSINESS_HTML.includes('aria-label="Platform navigation"'), 'platform navigation missing');
  for (const route of ['/marketplace/', 'market.html#/game-hosting', 'student.html', 'support.html', 'platform.html']) {
    assert.ok(count(BUSINESS_HTML, 'href="' + route + '"') >= 1,
      'business.html must link ' + route);
  }
});

check('business.html carries the gated inline ad slot', () => {
  assert.strictEqual(count(BUSINESS_HTML, 'data-omni-ad-root'), 1, 'slot root missing');
  assert.ok(BUSINESS_HTML.includes("enabled: 'false'"), 'gate must be off');
  assert.ok(BUSINESS_HTML.includes("zone: 'OWNER_INPUT_REQUIRED'"), 'zone must stay owner input');
  assert.strictEqual(count(BUSINESS_HTML, 'platform/omniAdSlot.js'), 1, 'engine must load once');
});

// ---------------------------------------------------------------------------
// 4. student.html + support.html — slots + real API surfaces intact
// ---------------------------------------------------------------------------
check('student.html stays the live tenant-scoped Students UI', () => {
  assert.ok(STUDENT_HTML.includes("'/api/v1/tenant/student-services'"), 'student.html must call the live tenant API');
  assert.ok(/<html[^>]+dir="rtl"/.test(STUDENT_HTML), 'student.html must stay RTL');
  assert.ok(STUDENT_HTML.includes("localStorage.getItem('access_token')"), 'student.html must use the real tenant token');
  for (const marker of ['MOCK_', 'DUMMY_', 'sampleData', 'fakeOrder', 'hardcodedProducts']) {
    assert.ok(!STUDENT_HTML.includes(marker), 'mock marker present in student.html: ' + marker);
  }
  assert.strictEqual(count(STUDENT_HTML, 'data-omni-ad-root'), 1, 'student slot missing');
  assert.ok(STUDENT_HTML.includes("enabled: 'false'"), 'student gate must be off');
});

check('support.html is the real customer-request center with the slot', () => {
  assert.ok(SUPPORT_HTML.includes("var API = '/api/v1/customer'"), 'support.html must use the real customer API');
  assert.ok(SUPPORT_HTML.includes('submitRequest'), 'real submit flow missing');
  for (const marker of ['MOCK_', 'DUMMY_', 'fakeTicket', 'fakeReply', 'sampleData']) {
    assert.ok(!SUPPORT_HTML.includes(marker), 'mock marker present in support.html: ' + marker);
  }
  assert.strictEqual(count(SUPPORT_HTML, 'data-omni-ad-root'), 1, 'support slot missing');
  assert.ok(SUPPORT_HTML.includes("enabled: 'false'"), 'support gate must be off');
});

// ---------------------------------------------------------------------------
// 5. platform/omniAdSlot.js — the safe inline-only boundary
// ---------------------------------------------------------------------------
check('OmniAdSlot hard-blocks every prohibited zone', () => {
  const list = AD_SLOT_SRC.match(/PROHIBITED_ZONES\s*=\s*\[([^\]]*)\]/);
  assert.ok(list, 'PROHIBITED_ZONES missing');
  for (const zone of PROHIBITED_ZONES) {
    assert.ok(list[1].includes("'" + zone + "'"), 'zone not in blocklist: ' + zone);
  }
  assert.strictEqual((list[1].match(/'/g) || []).length / 2, PROHIBITED_ZONES.length,
    'unexpected zone count in blocklist');
});

check('OmniAdSlot is gated OFF and never invents zones', () => {
  assert.ok(AD_SLOT_SRC.includes('OWNER_INPUT_REQUIRED'), 'owner-input state missing');
  assert.ok(AD_SLOT_SRC.includes('placeholder'), 'placeholder path missing');
  assert.ok(AD_SLOT_SRC.includes('prohibited_zone_blocked'), 'blocked-state reason missing');
  // The engine carries no ad-network URL and no hardcoded zone constant:
  // prohibited zones exist ONLY in the documented blocklist array.
  assert.strictEqual(count(AD_SLOT_SRC, 'quge5'), 0, 'engine must not reference the ad tag origin');
  const list = AD_SLOT_SRC.match(/PROHIBITED_ZONES\s*=\s*\[([^\]]*)\]/)[1];
  for (const zone of PROHIBITED_ZONES) {
    assert.ok(list.includes("'" + zone + "'"), 'zone missing from blocklist: ' + zone);
  }
});

check('OmniAdSlot has no popup/onclick/overlay machinery in code', () => {
  // Comments may document what the engine refuses to do; scan code only.
  const stripped = AD_SLOT_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const banned of ['window.open', 'popunder', 'onclick', 'position: fixed', 'position:fixed', 'zIndex', 'document.write', 'iframe', 'innerHTML']) {
    assert.ok(!stripped.toLowerCase().includes(banned.toLowerCase()),
      'banned ad machinery in engine code: ' + banned);
  }
});

check('OmniAdSlot mounts in-flow inside the slot container only', () => {
  assert.ok(AD_SLOT_SRC.includes("querySelectorAll('[data-omni-ad]')"), 'slot discovery missing');
  assert.ok(AD_SLOT_SRC.includes("[data-omni-ad-root]"), 'inner root discovery missing');
  assert.ok(AD_SLOT_SRC.includes("root.appendChild(script)"), 'engine must mount inside the slot root');
  assert.ok(AD_SLOT_SRC.includes("data-omni-ad-state"), 'slot state marker missing');
});

// ---------------------------------------------------------------------------
// 6. backend/server.js — CSP without ad-network origins
// ---------------------------------------------------------------------------
check('CSP keeps no Monetag origin and stays wildcard-free', () => {
  assert.ok(SERVER_JS.includes('contentSecurityPolicy'), 'helmet CSP removed');
  assert.ok(SERVER_JS.includes('helmet('), 'helmet middleware removed');
  const scriptLine = (SERVER_JS.match(/scriptSrc: \[[^\]]*\]/) || [])[0];
  assert.ok(scriptLine, 'scriptSrc directive missing');
  for (const origin of ['quge5.com', 'auqot.com', 'ekhay.com', 'b3mny.com']) {
    assert.ok(!scriptLine.includes(origin), 'ad origin still in script-src: ' + origin);
  }
  assert.ok(!scriptLine.includes('*'), 'wildcard forbidden in script-src');
  assert.strictEqual((scriptLine.match(/https:\/\//g) || []).length, 2,
    'script-src must carry exactly cdnjs + jsdelivr');
  const connectLine = (SERVER_JS.match(/connectSrc: \[[^\]]*\]/) || [])[0];
  assert.ok(connectLine, 'connectSrc directive missing');
  for (const origin of ['6opo.com', 'auqot.com', 'my.rtmark.net', 'jmosl.com', '094kk.com']) {
    assert.ok(!connectLine.includes(origin), 'ad origin still in connect-src: ' + origin);
  }
  assert.ok(!connectLine.includes('*'), 'wildcard forbidden in connect-src');
  assert.strictEqual((connectLine.match(/https:\/\//g) || []).length, 2,
    'connect-src must carry exactly github api + jsdelivr');
  assert.ok(SERVER_JS.includes('frameSrc: ["\'none\'"]'), 'frame-src policy changed');
  assert.ok(SERVER_JS.includes('objectSrc: ["\'none\'"]'), 'object-src policy changed');
  assert.ok(SERVER_JS.includes('styleSrc: ["\'self\'", "\'unsafe-inline\'", \'https://fonts.googleapis.com\']'), 'style-src policy changed');
  assert.ok(SERVER_JS.includes('imgSrc: ["\'self\'", \'data:\']'), 'img-src policy changed');
});

// ---------------------------------------------------------------------------
// 7. backend catalog default — the same reality as the UI
// ---------------------------------------------------------------------------
check('catalog default advertises all five active sections with real routes', () => {
  for (const [id, url] of Object.entries(ACTIVE_ROUTES)) {
    const entry = CATALOG_SVC.match(new RegExp("id: '" + id + "'[\\s\\S]{0,400}?url: '" + url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'"));
    assert.ok(entry, 'catalog entry for ' + id + ' must expose ' + url);
  }
  const media = CATALOG_SVC.match(/id: 'media-reels'[\s\S]{0,400}?status: 'coming-soon'/);
  assert.ok(media, 'media-reels must stay coming-soon in the catalog default');
  assert.ok(!CATALOG_SVC.includes("url: '/index.html'"), 'ERP shell must never be a section route');
  assert.ok(!CATALOG_SVC.includes("url: '/market.html',"), 'legacy market route must go');
});

check('catalog service keeps the legacy-doc fallback contract', () => {
  assert.ok(CATALOG_SVC.includes('Array.isArray(store.sections)'), 'sections fallback missing');
  assert.ok(CATALOG_SVC.includes('never'), 'never-rewrite note missing');
});

// ---------------------------------------------------------------------------
// 8. Legacy Monetag boundary stays disabled and dormant
// ---------------------------------------------------------------------------
check('legacy monetag boundary stays disabled with empty owner fields', () => {
  assert.ok(MONETAG_SRC.includes('enabled: false'));
  assert.ok(MONETAG_SRC.includes('OWNER_INPUT_REQUIRED'));
  assert.ok(MONETAG_SRC.includes('disabled_or_owner_input_required'));
  const boundaryTag = PLATFORM_HTML.match(/<script src="platform\/monetag\.js"[\s\S]*?<\/script>/);
  assert.ok(boundaryTag, 'boundary script tag missing');
  assert.ok(boundaryTag[0].includes('data-monetag-enabled="false"'), 'boundary must stay disabled');
  assert.ok(boundaryTag[0].includes('data-monetag-publisher-id=""'), 'publisher id must stay empty');
  assert.ok(boundaryTag[0].includes('data-monetag-script-url=""'), 'script url must stay empty');
});

check('ERP index.html stays ad-free; marketplace build entry is tracked', () => {
  assert.ok(!INDEX_HTML.toLowerCase().includes('monetag'));
  assert.ok(!INDEX_HTML.includes('quge5'));
  assert.ok(MARKETPLACE_INDEX.includes('<div id="root"'), 'marketplace SPA entry missing');
});

// ---------------------------------------------------------------------------
// 9. nav harness — updated to the no-tag contract
// ---------------------------------------------------------------------------
check('nav harness pins the new contract (no tag, gated slot, section links)', () => {
  assert.ok(NAV_HARNESS.includes("NO_AD_TAG: hub ships no third-party ad script"), 'harness missing no-tag check');
  assert.ok(NAV_HARNESS.includes("'market.html#/game-hosting', 'GAME_HOSTING'"), 'harness missing game-hosting link check');
  assert.ok(NAV_HARNESS.includes("'support.html', 'SUPPORT'"), 'harness missing support link check');
  assert.ok(NAV_HARNESS.includes('OMNI_AD_SLOT_PRESENT'), 'harness missing slot presence check');
  assert.ok(NAV_HARNESS.includes("AD_ENGINE_GATE=DISABLED"), 'harness missing gate check');
});

check('hub harness pins responsive + in-flow slot + zero ad requests', () => {
  const HUB_HARNESS = read('tests/e2e/verify-platform-hub.js');
  assert.ok(HUB_HARNESS.includes('HUB_320'), 'harness missing 320 viewport');
  assert.ok(HUB_HARNESS.includes('HUB_375'), 'harness missing 375 viewport');
  assert.ok(HUB_HARNESS.includes('HUB_430'), 'harness missing 430 viewport');
  assert.ok(HUB_HARNESS.includes('HUB_DESKTOP'), 'harness missing desktop viewport');
  assert.ok(HUB_HARNESS.includes('overflow'), 'harness missing overflow check');
  assert.ok(HUB_HARNESS.includes("position") && HUB_HARNESS.includes("'static'"), 'harness missing in-flow position check');
  assert.ok(HUB_HARNESS.includes('ZERO_AD_REQUESTS'), 'harness missing zero-ad-request check');
});

// ---------------------------------------------------------------------------
// 10. Diff scope — only intended files modified in the working tree
// ---------------------------------------------------------------------------
check('working-tree diff touches only intended files', () => {
  const allowedModified = new Set([
    'platform.html',
    'platform/platform.js',
    'platform/platform.css',
    'business.html',
    'student.html',
    'support.html',
    'backend/server.js',
    'backend/services/platformCatalog.service.js',
    'backend/tests/monetag.boundary.test.js',
    'backend/tests/platformSections.students.test.js',
    'backend/tests/platformPublic.test.js',
    'platform/tests/section-lockdown.test.cjs',
    'tests/e2e/verify-platform-nav.js',
    'marketplace/src/components/layout/Footer.tsx',
    // Tracked build entry: postbuild regenerates it (hashed asset name
    // changes because Footer now imports OmniAdSlot) — the documented
    // convention from the Monetag AdSlot cycle.
    'marketplace/index.html',
    'docs/monetag-onclick-disable-and-filtering-request.md'
  ]);
  const allowedUntracked = new Set([
    'platform/omniAdSlot.js',
    'marketplace/src/components/marketplace/OmniAdSlot.tsx',
    'tests/e2e/verify-platform-hub.js'
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

check('Marketplace build, legacy market, sw.js, .env and backend/data show no working-tree diff', () => {
  const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout;
  const protectedPaths = ['market.html', 'market', 'sw.js', '.env', 'backend/data', 'marketplace/dist'];
  const dirty = git(['diff', '--name-only', 'HEAD', '--', ...protectedPaths])
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);
  assert.deepStrictEqual(dirty, [], 'forbidden diffs: ' + dirty.join(', '));
});

console.log('\nsection-lockdown.test.cjs: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
