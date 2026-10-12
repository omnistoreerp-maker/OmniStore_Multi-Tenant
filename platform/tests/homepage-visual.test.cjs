'use strict';

// Homepage visual redesign regression suite (Phase: homepage-visual).
//
// Pins the redesign contract without a browser: the public link inventory is
// byte-stable (section-lockdown owns the exact counts, this suite guards the
// redesign surface), the PR #48 auth drawer is intact, the hero composition
// carries no links/text/data, and every drawer i18n key resolves in both
// language tables. Live rendering, overflow, and drawer behavior are covered
// by tests/e2e/verify-homepage-visual.js against a real backend.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'platform.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'platform', 'platform.css'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'platform', 'platform.js'), 'utf8');

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
function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// ---------------------------------------------------------------------------
// 1. Public link inventory unchanged by the redesign
// ---------------------------------------------------------------------------
check('marketplace entry still referenced exactly 5 times', () => {
  assert(count(HTML, 'href="/marketplace/"') === 5, 'marketplace href count drifted');
});

check('student entries still exactly 3 with honest active states', () => {
  assert(count(HTML, 'href="student.html"') === 3, 'student href count drifted');
});

check('education entries still exactly 3', () => {
  assert(count(HTML, 'href="/education/index.html"') === 3, 'education href count drifted');
});

check('monetag boundary untouched (meta + tag exactly once, order kept)', () => {
  assert(count(HTML, '<meta name="monetag" content="e1700efedc78f54b923023e572faa053">') === 1, 'monetag meta drifted');
  assert(count(HTML, 'data-zone="288239"') === 1, 'monetag tag drifted');
  assert(HTML.indexOf('platform/platform.js') < HTML.indexOf('platform/monetag.js'),
    'script order violated');
});

check('favicon resolves to a real repo asset', () => {
  assert(HTML.includes('<link rel="icon" href="/icons/digitronics-icon-192.svg" type="image/svg+xml">'),
    'favicon link missing');
  assert(fs.existsSync(path.join(ROOT, 'icons', 'digitronics-icon-192.svg')),
    'favicon target missing from the tree');
});

// ---------------------------------------------------------------------------
// 2. PR #48 auth drawer preserved byte-for-byte in behavior contract
// ---------------------------------------------------------------------------
check('login button and drawer markup intact with safe defaults', () => {
  assert(HTML.includes('id="platformLoginBtn"'), 'header login button missing');
  assert(HTML.includes('id="platformAuthOverlay" class="auth-drawer-overlay" hidden'), 'overlay missing');
  assert(HTML.includes('aria-labelledby="platformAuthTitle" hidden'), 'drawer missing');
  assert(HTML.includes("AUTH_API = '/api/v1/auth'") || JS.includes("AUTH_API = '/api/v1/auth'"),
    'auth API base drifted');
});

check('no blocking login screen introduced on the public page', () => {
  assert(!HTML.includes('id="loginScreen"'), 'a blocking login screen appeared on the homepage');
});

// ---------------------------------------------------------------------------
// 3. Hero composition is decorative only
// ---------------------------------------------------------------------------
check('hero visual carries no links, text, or data hooks', () => {
  const start = HTML.indexOf('<div class="hero-visual"');
  const end = HTML.indexOf('<div class="hero-trust"');
  assert(start > -1 && end > start, 'hero visual block boundaries missing');
  const block = HTML.slice(start, end);
  assert(!/<a[\s>]/.test(block), 'hero visual must not introduce links');
  assert(!/data-i18n/.test(block), 'hero visual must not introduce translatable strings');
  const text = block.replace(/<[^>]+>/g, '').trim();
  assert(text === '', 'hero visual must not introduce readable text');
});

check('hero-visual styles exist and stay inside an overflow-clipped frame', () => {
  for (const sel of ['.hero-visual', '.hero-orbit-1', '.hero-orbit-2', '.hero-orbit-3', '.hero-core']) {
    assert(CSS.includes(sel), 'missing style: ' + sel);
  }
  const frame = CSS.slice(CSS.indexOf('.hero-visual'), CSS.indexOf('.hero-visual') + 900);
  assert(frame.includes('overflow: hidden') || frame.includes('overflow:hidden'), 'hero frame must clip orbits');
});

// ---------------------------------------------------------------------------
// 4. Drawer i18n keys resolve in both language tables
// ---------------------------------------------------------------------------
check('every auth drawer string resolves in English and Arabic', () => {
  const drawer = HTML.slice(HTML.indexOf('id="platformAuthDrawer"'));
  const keys = Array.from(drawer.matchAll(/data-i18n="([^"]+)"/g)).map((m) => m[1]);
  assert(keys.length > 0, 'no i18n keys in drawer');
  const enBlock = JS.slice(JS.indexOf('en: {'), JS.indexOf('ar: {'));
  const arBlock = JS.slice(JS.indexOf('ar: {'));
  for (const key of new Set(keys)) {
    assert(new RegExp(key + ":\\s*'[^']+'").test(enBlock), 'en table missing ' + key);
    assert(new RegExp(key + ":\\s*'[^']+'").test(arBlock), 'ar table missing ' + key);
  }
});

// ---------------------------------------------------------------------------
// 5. Keyboard access contract
// ---------------------------------------------------------------------------
check(':focus-visible rules cover links, buttons and form controls', () => {
  assert(CSS.includes(':focus-visible'), 'no focus-visible rules');
  for (const sel of ['a:focus-visible', 'button:focus-visible', 'input:focus-visible']) {
    assert(CSS.includes(sel), 'missing focus rule: ' + sel);
  }
});

setTimeout(() => {
  console.log('\nhomepage-visual.test.cjs: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
}, 200);
