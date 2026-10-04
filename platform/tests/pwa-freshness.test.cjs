'use strict';
// ---------------------------------------------------------------------------
// PWA freshness contract.
//
// Root cause this suite pins down: sw.js used a cache-first fetch handler
// (`return cached || network`), so after a release a returning visitor kept
// getting the precached shell (old platform.html / platform.js) while the
// origin already reported the new state — the visible symptom was the
// Education card stuck on "قريباً" although production stored
// education=active. The Service Worker must be network-first (live origin
// always wins, cache is the offline fallback) and its version constant must
// track the current build so activate() purges every older shell cache.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..', '..');
const SW = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
// Code-only view: prose in comments may quote the old strategy without
// violating the contract below.
const SW_CODE = SW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let passed = 0;
let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed++;
    console.log('ok - ' + name);
  } catch (err) {
    failed++;
    console.error('not ok - ' + name + ': ' + err.message);
  }
};

check('the cache version is the current freshness build (activate purges the stale v47 shell)', () => {
  const m = SW.match(/DIGITRONICS_PWA_VERSION\s*=\s*'([^']+)'/);
  assert.ok(m, 'missing DIGITRONICS_PWA_VERSION constant');
  assert.strictEqual(m[1], 'omnistore-erp-v48-freshness-v1');
});

check('the fetch handler is network-first: the live origin wins over any cache', () => {
  assert.ok(/self\.addEventListener\('fetch'/.test(SW_CODE), 'missing fetch handler');
  assert.ok(/event\.respondWith\(\s*fetch\(request\)/.test(SW_CODE),
    'respondWith must start with fetch(request) (network-first)');
  assert.ok(!SW_CODE.includes('return cached || network'),
    'the stale cache-first strategy `return cached || network` must be gone');
});

check('offline falls back to the cache and documents fall back to the precached shell', () => {
  assert.ok(/\.catch\(\(\)\s*=>\s*caches\.match\(request\)/.test(SW),
    'network failure must fall back to caches.match(request)');
  assert.ok(/request\.mode === 'navigate'/.test(SW),
    'navigations must be detected for the document fallback');
  assert.ok(/if \(isDocument\)\s*return caches\.match\('\.\/index\.html'\)/.test(SW),
    'documents must fall back to ./index.html when neither network nor cache has them');
});

check('successful responses refresh the shell cache so the next fallback is current', () => {
  assert.ok(/cache\.put\(request,\s*copy\)/.test(SW), 'cache.put(request, copy) missing');
  assert.ok(/response\.ok && response\.type === 'basic'/.test(SW),
    'only same-origin ok responses may be cached');
  assert.ok(/response\.clone\(\)/.test(SW), 'the body must be cloned before caching');
});

check('the precached app shell still pins the platform pages (platformMvp contract)', () => {
  assert.ok(SW.includes("'./platform.html'"), "missing './platform.html'");
  assert.ok(SW.includes("'./business.html'"), "missing './business.html'");
  assert.ok(SW.includes("'./platform/platform.css'"), "missing './platform/platform.css'");
  assert.ok(SW.includes("'./platform/platform.js'"), "missing './platform/platform.js'");
});

check('activate purges every older omnistore-erp/digitronics cache', () => {
  assert.ok(/key\.startsWith\('digitronics-pwa-'\)\s*\|\|\s*key\.startsWith\('omnistore-erp-'\)/.test(SW),
    'cache purge prefix conditions missing');
  assert.ok(/caches\.delete\(key\)/.test(SW), 'caches.delete(key) missing');
  assert.ok(/self\.skipWaiting\(\)/.test(SW) && /self\.clients\.claim\(\)/.test(SW),
    'the new worker must take over immediately (skipWaiting + clients.claim)');
});

check('the uat/uatFeedback precache entries stay (their suites pin them)', () => {
  assert.ok(SW.includes("'./services/uat/UATEngine.js'"), "missing './services/uat/UATEngine.js'");
  assert.ok(SW.includes("'./services/uatFeedback/UATFeedbackEngine.js'"), "missing './services/uatFeedback/UATFeedbackEngine.js'");
  assert.ok(!SW.includes('services/dataLayer/'), 'sw.js must never precache services/dataLayer/');
});

console.log('\npwa-freshness.test.cjs: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
