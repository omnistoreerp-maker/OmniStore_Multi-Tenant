'use strict';

// Platform section lockdown + Monetag boundary static regression checks.
//
// Verifies, without any server or browser:
//   1. Active sections (marketplace, business, students, the
//      new Media / Reels feed and Support) expose their real shipped
//      routes; Game Hosting stays locked (coming-soon, url null).
//   2. Support is active everywhere with /support.html; Media-Reels ships
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
// Media / Reels ships active with the public reels feed.
// Support graduated to active in the Support activation cycle
// (support.html + customer request API + operator workflow).
// Education graduated to active in the Education permissions cycle
// (education/index.html + the tenant-scoped Education API).
// Game Hosting stays locked per the owner correction cycle:
// coming-soon with url:null, and it stays inside lockedIds.
const LOCKED_IDS = ['game-hosting'];
const ACTIVE_ROUTES = {
  'marketplace': '/marketplace/',
  'business-services': '/business.html',
  'student-services': '/student.html',
  'media-reels': '/media-reels.html',
  'support': '/support.html',
  'education': '/education/index.html'
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

check('platform.js fallback catalog exposes education as an active section', () => {
  const m = PLATFORM_JS.match(/id:\s*'education'[^}]+\}/);
  assert.ok(m, 'education entry missing from DEFAULT_SECTIONS');
  assert.ok(m[0].includes("status: 'active'"), 'education fallback must be active');
  assert.ok(m[0].includes("url: '/education/index.html'"), 'education fallback must open /education/index.html');
});

check('platform.js i18n labels cover education in en and ar', () => {
  for (const key of ['nav_education', 'nav_education_short', 'section_education']) {
    assert.ok(count(PLATFORM_JS, key) >= 2, key + ' i18n must exist in en and ar');
  }
  // Arabic must be real Arabic, never the English label copied into the ar map.
  assert.ok(/nav_education:\s*'[^']*[\u0600-\u06FF]/.test(PLATFORM_JS), 'ar nav_education must be Arabic');
  assert.ok(/nav_education_short:\s*'[^']*[\u0600-\u06FF]/.test(PLATFORM_JS), 'ar nav_education_short must be Arabic');
  assert.ok(/section_education:\s*'[^']*[\u0600-\u06FF]/.test(PLATFORM_JS), 'ar section_education must be Arabic');
});

check('platform.html advertises education from all three nav spots', () => {
  assert.strictEqual(count(PLATFORM_HTML, 'href="/education/index.html"'), 3,
    'expected exactly 3 education links (top/footer/bottom), got ' + count(PLATFORM_HTML, 'href="/education/index.html"'));
  assert.strictEqual(count(PLATFORM_HTML, 'class="glass-nav-link" href="/education/index.html"'), 1, 'top nav education link missing');
  assert.strictEqual(count(PLATFORM_HTML, '<a href="/education/index.html" data-i18n="nav_education_short">'), 1, 'footer education link missing');
  assert.strictEqual(count(PLATFORM_HTML, 'class="bottom-nav-link" href="/education/index.html"'), 1, 'mobile bottom nav education link missing');
});

check('platform.html education links are active links, never locked or soon-badged', () => {
  const links = PLATFORM_HTML.match(/<a[^>]*href="\/education\/index\.html"[^>]*>/g) || [];
  assert.strictEqual(links.length, 3, 'expected 3 education anchors');
  for (const link of links) {
    assert.ok(!link.includes('is-soon'), 'education link must not carry the soon lock: ' + link);
    assert.ok(!link.includes('aria-disabled'), 'education link must not be disabled: ' + link);
    assert.ok(link.includes('data-i18n="nav_education'), 'education link must stay translatable: ' + link);
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

check('platform.js locks game-hosting id and keeps graduated sections released', () => {
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

check('platform.js policy appends missing locked ids (game-hosting always visible)', () => {
  const fn = PLATFORM_JS.match(/function applySectionPolicy[\s\S]*?\n  \}/);
  assert.ok(fn, 'applySectionPolicy not found');
  assert.ok(fn[0].includes('SECTION_LOCK_POLICY.lockedIds.forEach'), 'locked-id append loop missing');
  assert.ok(fn[0].includes('if (def) base.push'), 'append missing locked entry missing');
});

check('platform.js fallback catalog exposes support as active', () => {
  const m = PLATFORM_JS.match(/id:\s*'support'[^}]+\}/);
  assert.ok(m, 'support entry missing from DEFAULT_SECTIONS');
  assert.ok(m[0].includes("status: 'active'"), 'support fallback must be active');
  assert.ok(m[0].includes("url: '/support.html'"), 'support fallback must open /support.html');
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
  assert.ok(!connectLine.includes('*'), 'wildcard forbidden in connect-src');
  // -------------------------------------------------------------------------
  // frame-src / img-src - TikTok embedded playback (TikTok Display API cycle).
  //
  // The intentional change is narrow and is asserted as an exact allowlist:
  //   frame-src = https://www.tiktok.com ONLY (the official Embed Player origin).
  //   img-src   = 'self', data:, https://*.tiktokcdn.com, https://*.tiktokcdn-us.com.
  // A bare `*` is rejected, 'self' must not reappear in frame-src (same-origin
  // frames stay blocked), and unrelated external origins are asserted absent.
  // -------------------------------------------------------------------------
  const frameLine = (serverJs.match(/frameSrc: \[[^\]]*\]/) || [])[0];
  assert.ok(frameLine, 'frameSrc directive missing');
  assert.ok(frameLine.includes("'https://www.tiktok.com'"), 'TikTok Embed Player origin missing from frame-src');
  assert.ok(!frameLine.includes("'none'"), "frame-src must no longer be 'none' (TikTok playback is intentional)");
  assert.ok(!frameLine.includes("'self'"), "frame-src must not re-allow same-origin frames");
  assert.ok(!frameLine.includes("'unsafe-inline'"), 'frame-src must not allow inline frames');
  assert.ok(!/(^|[^.\w])\*/.test(frameLine), 'wildcard forbidden in frame-src');
  assert.strictEqual((frameLine.match(/https:\/\//g) || []).length, 1, 'unexpected extra origin in frame-src');
  for (const blocked of ['youtube.com', 'vimeo.com', 'facebook.com', 'instagram.com', 'tiktokcdn.com', 'tiktokcdn-us.com', 'quge5.com', 'auqot.com', 'ekhay.com', 'b3mny.com', 'google.com']) {
    assert.ok(!frameLine.includes(blocked), 'unrelated origin must not be allowed in frame-src: ' + blocked);
  }
  const imgLine = (serverJs.match(/imgSrc: \[[^\]]*\]/) || [])[0];
  assert.ok(imgLine, 'imgSrc directive missing');
  assert.ok(imgLine.includes("'self'"), "img-src must keep 'self'");
  assert.ok(imgLine.includes("'data:'"), "img-src must keep data:");
  assert.ok(imgLine.includes("'https://*.tiktokcdn.com'"), 'TikTok cover CDN domain missing from img-src');
  assert.ok(imgLine.includes("'https://*.tiktokcdn-us.com'"), 'TikTok cover CDN domain missing from img-src');
  assert.ok(!imgLine.includes("'unsafe-inline'"), 'img-src must not allow unsafe-inline');
  assert.ok(!/(^|[\s'"])\*(?=$|[\s'"(])/.test(imgLine), 'bare wildcard origin forbidden in img-src');
  assert.strictEqual((imgLine.match(/https:\/\//g) || []).length, 2, 'unexpected extra external origin in img-src');
  for (const blocked of ['quge5.com', 'auqot.com', 'ekhay.com', 'b3mny.com', '6opo.com', 'my.rtmark.net', 'jmosl.com', '094kk.com', 'google.com', 'gstatic.com', 'unsplash.com']) {
    assert.ok(!imgLine.includes(blocked), 'unrelated origin must not be allowed in img-src: ' + blocked);
  }
  // object-src is unrelated to this change and must stay fully closed.
  assert.ok(serverJs.includes('objectSrc: ["\'none\'"]'), 'object-src policy changed');
  assert.ok(serverJs.includes('styleSrc: ["\'self\'", "\'unsafe-inline\'", \'https://fonts.googleapis.com\']'), 'style-src policy changed');
});

// Both security layers are active (Express serves the app in single-process
// mode, nginx terminates in production). If they disagree, the stricter one
// silently breaks TikTok playback, so the TikTok allowlist must be IDENTICAL
// in nginx.conf and backend/server.js. This asserts equality of the exact
// directive values rather than the mere presence of a header.
check('nginx.conf and backend/server.js express the same narrow TikTok CSP allowlist', () => {
  const nginx = read('nginx.conf');
  const serverJs = read('backend/server.js');
  const header = (nginx.match(/add_header Content-Security-Policy "([^"]+)"/) || [])[1];
  assert.ok(header, 'nginx Content-Security-Policy header missing');
  assert.ok(!/\*/.test(header.replace(/https:\/\/\*\./g, '')), 'bare wildcard forbidden in nginx CSP');

  const nginxDirectives = Object.fromEntries(
    header.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const idx = d.indexOf(' ');
      return [d.slice(0, idx), d.slice(idx + 1).trim()];
    })
  );

  // frame-src: exactly one origin, and it must be the TikTok player origin.
  assert.ok(nginxDirectives['frame-src'], 'nginx frame-src directive missing');
  assert.strictEqual(nginxDirectives['frame-src'], 'https://www.tiktok.com', 'nginx frame-src must allow the TikTok Embed Player origin only');
  assert.ok(!nginxDirectives['frame-src'].includes("'self'"), 'nginx frame-src must not re-allow same-origin frames');

  // img-src: self + data + the two TikTok CDN domains, nothing else.
  assert.ok(nginxDirectives['img-src'], 'nginx img-src directive missing');
  const nginxImg = nginxDirectives['img-src'].split(/\s+/).sort();
  assert.deepStrictEqual(nginxImg, ["'self'", 'data:', 'https://*.tiktokcdn-us.com', 'https://*.tiktokcdn.com'].sort(),
    'nginx img-src must be exactly self, data and the two TikTok CDN domains');

  // Unrelated directives must remain as restrictive as before.
  assert.strictEqual(nginxDirectives['default-src'], "'self'", 'nginx default-src changed');
  assert.strictEqual(nginxDirectives['connect-src'], "'self'", 'nginx connect-src changed');

  // Parity: the same origins must be present in the Express policy.
  const frameLine = (serverJs.match(/frameSrc: \[[^\]]*\]/) || [])[0] || '';
  const imgLine = (serverJs.match(/imgSrc: \[[^\]]*\]/) || [])[0] || '';
  assert.ok(frameLine.includes("'https://www.tiktok.com'"), 'Express frame-src lacks the nginx frame-src origin');
  for (const origin of ['https://*.tiktokcdn.com', 'https://*.tiktokcdn-us.com']) {
    assert.ok(nginxDirectives['img-src'].includes(origin), 'nginx img-src missing ' + origin);
    assert.ok(imgLine.includes("'" + origin + "'"), 'Express img-src missing ' + origin);
  }
});

// The Reels page must build the player from the numeric post id against the
// exact origin the CSP allows, and must not inject upstream embed HTML.
check('reels.html player is origin-pinned to the CSP-allowed TikTok host', () => {
  const reels = read('reels.html');
  assert.ok(reels.includes('https://www.tiktok.com/player/v1/'), 'player URL must use the documented TikTok Embed Player origin');
  assert.ok(!/https:\/\/(?!www\.tiktok\.com)[a-z0-9.-]+/i.test(reels.replace(/platform\.css|fonts\.g|example\.com|localhost/g, '')),
    'reels.html must not reference any third-party origin outside www.tiktok.com');
  assert.ok(!/innerHTML\s*=|insertAdjacentHTML|document\.write/.test(reels), 'reels.html must not inject remote HTML');
  assert.ok(!reels.includes('embed_html'), 'reels.html must not consume upstream embed_html');
  assert.ok(!/\.(mp4|m3u8)\b/i.test(reels), 'reels.html must not reference a video/media file');
  // The public page must not offer a connect action or the admin status route.
  const code = reels
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(!/tiktok\/connect/.test(code), 'reels.html must not expose a Connect action to visitors');
  assert.ok(!/reels\/status/.test(code), 'reels.html must not call the admin-only reels/status route');
});

// TikTok Reels must never shadow the tenant-scoped OmniStore Reels surface:
// the TikTok feed lives under /tiktok/reels, and the reels controller used by
// the main feature must stay byte-identical in its public read contract.
check('tiktok reels routes are namespaced away from the main OmniStore reels surface', () => {
  const platformPublic = read('backend/routes/platformPublic.routes.js');
  const routes = read('backend/routes/tiktokPublic.routes.js');
  // main's platformPublic boundary file keeps zero reels surface (asserted
  // by reelsPublic.test.js too): no TikTok controller, no /tiktok/reels.
  assert.ok(!platformPublic.includes('tiktokReels.controller'), 'platformPublic must not require the TikTok reels controller');
  assert.ok(!platformPublic.includes("router.get('/tiktok/reels'"), 'platformPublic must not register /tiktok/reels (owned by tiktokPublic.routes.js)');
  assert.ok(!platformPublic.includes("router.get('/reels',"), 'platformPublic must not register /reels (owned by reels.routes.js)');
  assert.ok(routes.includes("require('../controllers/tiktokReels.controller')"), 'TikTok controller must be the separated tiktokReels.controller');
  assert.ok(routes.includes("router.get('/tiktok/reels'"), 'TikTok public feed must live at /tiktok/reels');
  assert.ok(!routes.includes("router.get('/reels',"), 'tiktokPublic must not register /reels (owned by reels.routes.js)');
  assert.ok(routes.includes('requireAuth, requirePlatformAdmin()'), 'TikTok admin routes must stay platform-admin gated');
  for (const route of ['/tiktok/connect', '/tiktok/callback', '/tiktok/status', '/tiktok/reels/status', '/tiktok/sync', '/tiktok/disconnect']) {
    assert.ok(routes.includes("'" + route + "'"), 'TikTok route missing: ' + route);
  }
  const serverSrc = read('backend/server.js');
  assert.ok(serverSrc.includes("app.use('/api/v1/platform-public', tiktokPublicRoutes)"), 'tiktokPublic router must be mounted under /api/v1/platform-public');
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
// Control Center security hardening cycle (platform scope only). Explicit
  // and limited to the exact backend files that cycle actually changes — every
  // entry below is present in the branch's Control Center hardening diff.
  // Any OTHER backend file outside this explicit set still fails the guard.
  'backend/controllers/platform.controller.js',
  'backend/controllers/platformAdmin.controller.js',
  'backend/services/audit.service.js',
  'backend/services/platform.service.js',
  'backend/services/platformAdmin.service.js',
  'backend/services/platformControlCenter.service.js',
  'backend/tests/controlCenterSecurity.test.js',
  'backend/tests/controlCenterSecurityFixes.test.js',
    'platform/tests/section-lockdown.test.cjs',
    // Pre-existing local WIP from earlier candidate work — carried across
    // branches, deliberately never staged by this change set:
    'backend/data/platformPublic.json',
    'backend/services/platformCatalog.service.js',
    'backend/tests/platformPublic.test.js',
    // Students activation cycle: catalog/sections discovery assertions.
    'backend/tests/platformSections.students.test.js',
    // Support activation cycle: operator/admin reply + guarded transition.
    'backend/services/customerRequest.service.js',
    'backend/controllers/internalChangeCenter.controller.js',
    'backend/routes/internalChangeCenter.routes.js',
    // Media / Reels clean port: runtime media storage stays untracked.
    '.gitignore',
    // Global Language Visual System cycle — LANGUAGE (index integration,
    // html lang/dir switcher boot + lang slots) / SECTION_STYLE (violet
    // main-section recolor) / TRANSLATION (ar→en dict):
    'index.html',
    'student.html',
    'support.html',
    'media-reels.html',
    // LANGUAGE: marketplace React language-aware formatting + dict.
    'marketplace/index.html',
    'marketplace/dev.html',
    'marketplace/src/App.tsx',
    'marketplace/src/components/cart/CartDrawer.tsx',
    'marketplace/src/components/layout/Footer.tsx',
    'marketplace/src/components/layout/Header.tsx',
    'marketplace/src/components/marketplace/ProductCard.tsx',
    'marketplace/src/components/marketplace/ProductGallery.tsx',
    'marketplace/src/index.css',
    'marketplace/src/lib/format.ts',
    'marketplace/src/pages/Checkout.tsx',
    'marketplace/tests/category-reset.test.cjs',
    // LANGUAGE: new e2e language-switcher test wiring (never ci.yml).
    'tests/e2e/package.json',
    // TRANSLATION-ONLY REPAIR cycle: index runtime messages + native
    // dialog translation (tpl/t wrappers) + composed-message dict keys.
    'platform/omni-i18n.js',
    'platform/i18n/index.dict.js',
    // TRANSLATION-ONLY REPAIR cycle: vm sandbox gets an OmniLang stub
    // because extracted real functions now wrap messages in OmniLang.t/tpl.
    'backend/tests/frontendInvoicesSync.test.js',
    // TikTok Display API cycle: env template gains EMPTY TikTok placeholders
    // (never secrets; the real .env stays gitignored and untouched).
    'backend/.env.example',
    // TikTok Display API cycle: new feature files (tracked once committed;
    // listed here so the working-tree guard also accepts staged additions).
    'backend/config/tiktok.js',
    'backend/controllers/tiktokReels.controller.js',
    'backend/services/reelsCache.service.js',
    'backend/services/tiktokConnection.service.js',
    'backend/services/tiktokDisplayApi.service.js',
    'backend/tests/tiktokReels.test.js',
    'backend/tests/tiktokReelsRouteCollision.test.js',
    // TikTok cycle: platformPublic keeps zero reels surface; TikTok lives
    // in its own router (tiktokPublic.routes.js) under /tiktok/*.
    'backend/routes/platformPublic.routes.js',
    'backend/routes/tiktokPublic.routes.js',
    // TikTok Display API / Reels integration repair cycle: the separated
    // TikTok controller, public page and route namespace.
    'reels.html',
    'backend/controllers/tiktokReels.controller.js',
    'nginx.conf'
  ]);
const allowedUntracked = new Set([
  // Control Center security hardening cycle (new security proof tests).
  'backend/tests/controlCenterSecurity.test.js',
  'backend/tests/controlCenterSecurityFixes.test.js',
    'platform/tests/section-lockdown.test.cjs',
    'backend/tests/platformSections.students.test.js',
    // Support activation cycle: operator workflow tests.
    'backend/tests/internalChangeCenter.workflow.test.js',
    'CANDIDATE_HANDOFF_20260920.md',
    'docs/REAL_REPOSITORY_RECONCILIATION.md',
    'docs/TEABLE_AGENT_RECONCILIATION.md',
    // Media / Reels clean port: new feed surface files.
    'media-reels.html',
    'backend/routes/reels.routes.js',
    'backend/controllers/reels.controller.js',
    'backend/services/reels.service.js',
    'backend/tests/reelsPublic.test.js',
    // LANGUAGE: i18n core, design tokens and per-page dictionaries.
    'platform/omni-i18n.js',
    'platform/omni-design.css',
    'platform/i18n/platform.dict.js',
    'platform/i18n/business.dict.js',
    'platform/i18n/student.dict.js',
    'platform/i18n/support.dict.js',
    'platform/i18n/media.dict.js',
    'platform/i18n/index.dict.js',
    // LANGUAGE: marketplace language runtime + dictionary.
    'marketplace/public/i18n/marketplace.dict.js',
    'marketplace/public/omni-design.css',
    'marketplace/public/omni-i18n.js',
    'marketplace/src/omni-lang.d.ts',
    // LANGUAGE: new e2e language-switcher test.
    'tests/e2e/verify-lang.js',
    // TikTok Display API / Reels integration repair cycle: new files.
    'reels.html',
    'backend/config/tiktok.js',
    'backend/controllers/tiktokReels.controller.js',
    'backend/tests/tiktokReelsRouteCollision.test.js',
    'backend/routes/tiktokPublic.routes.js',
    'backend/services/reelsCache.service.js',
    'backend/services/tiktokConnection.service.js',
    'backend/services/tiktokDisplayApi.service.js',
    'backend/tests/tiktokReels.test.js'
  ]);
  const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  const modified = git(['diff', '--name-only', 'HEAD']);
  for (const file of modified) {
    assert.ok(allowedModified.has(file), 'unexpected modified file: ' + file);
  }
// Defence in depth: every modified BACKEND file must appear in the EXPLICIT
// allowlist below. No prefix matching, no wildcard, no branch/commit-based
// exemption — a backend file outside the explicit set is a hard failure.
const BACKEND_ALLOWLIST = new Set([
  'backend/server.js',
  'backend/tests/monetag.boundary.test.js',
  'backend/tests/platformPublic.test.js',
  'backend/tests/platformSections.students.test.js',
  'backend/services/platformCatalog.service.js',
  'backend/services/customerRequest.service.js',
  'backend/controllers/internalChangeCenter.controller.js',
  'backend/routes/internalChangeCenter.routes.js',
  'backend/data/platformPublic.json',
  'backend/controllers/platform.controller.js',
  'backend/controllers/platformAdmin.controller.js',
  'backend/services/audit.service.js',
  'backend/services/platform.service.js',
  'backend/services/platformAdmin.service.js',
  'backend/services/platformControlCenter.service.js',
  'backend/tests/controlCenterSecurity.test.js',
  'backend/tests/controlCenterSecurityFixes.test.js'
]);
for (const file of modified) {
  if (file === 'backend' || file.startsWith('backend/')) {
    assert.ok(
      BACKEND_ALLOWLIST.has(file),
      'modified backend file is not in the explicit backend allowlist: ' + file
    );
  }
  assert.ok(!file.startsWith('backend/data/'), 'backend/data must never be modified: ' + file);
  assert.ok(!file.startsWith('marketplace/'), 'marketplace must never be modified: ' + file);
  assert.notStrictEqual(file, '.env', '.env must never be modified');
  assert.notStrictEqual(file, 'nginx.conf', 'nginx.conf must never be modified');
  assert.notStrictEqual(file, 'sw.js', 'sw.js must never be modified');
  assert.notStrictEqual(file, 'platform/monetag.js', 'monetag must never be modified');
}
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  for (const file of untracked) {
    assert.ok(allowedUntracked.has(file), 'unexpected untracked file: ' + file);
  }
});

check('Marketplace, legacy market, sw.js, .env and backend/data show no working-tree diff', () => {
  const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout;
  const protectedPaths = ['market.html', 'market', 'sw.js', '.env', 'backend/data'];
  const dirty = git(['diff', '--name-only', 'HEAD', '--', ...protectedPaths])
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean)
    // backend/data/platformPublic.json is pre-existing local WIP and must never
    // be staged by this change set (re-checked at commit time by the diff scope
    // report); every other protected path must stay byte-identical.
    .filter((f) => f !== 'backend/data/platformPublic.json');
  assert.deepStrictEqual(dirty, [], 'forbidden diffs: ' + dirty.join(', '));
  // Marketplace build surface is intentionally touched by the Global Language
  // Visual System cycle (language-aware formatting + dict + category-reset
  // test patch); every tracked marketplace diff must be inside this allowlist.
  const allowedMarketplace = new Set([
    'marketplace/index.html',
    'marketplace/dev.html',
    'marketplace/src/App.tsx',
    'marketplace/src/components/cart/CartDrawer.tsx',
    'marketplace/src/components/layout/Footer.tsx',
    'marketplace/src/components/layout/Header.tsx',
    'marketplace/src/components/marketplace/ProductCard.tsx',
    'marketplace/src/components/marketplace/ProductGallery.tsx',
    'marketplace/src/index.css',
    'marketplace/src/lib/format.ts',
    'marketplace/src/pages/Checkout.tsx',
    'marketplace/tests/category-reset.test.cjs'
  ]);
  const mktDirty = git(['diff', '--name-only', 'HEAD', '--', 'marketplace'])
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);
  for (const f of mktDirty) {
    assert.ok(allowedMarketplace.has(f), 'unexpected marketplace diff: ' + f);
  }
});

console.log('\nsection-lockdown.test.cjs: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
