'use strict';

// verify-platform-nav.js — Platform Home -> Marketplace navigation contract.
//
// Rule under test:
//   MARKETPLACE_NAVIGATION_MUST_NOT_BE_REPLACED_BY_AD
//
// Why this file exists: the Platform Home loads the official ad tag, whose
// OnClick / Popunder format acts on the visitor's first click on the page.
// Every Platform -> Marketplace entry point is a plain same-tab link, so when
// that format redirects the current tab the destination is replaced by the ad.
// Direct URL entry to /marketplace/ is unaffected — that page carries no ad tag.
//
// Usage:
//   node tests/e2e/verify-platform-nav.js                                 # local checkout
//   node tests/e2e/verify-platform-nav.js --base https://omnistoreerp.com # real deployment
//
// Browser: an installed browser is reused by default so no Playwright browser
// download is required. Override with PLAYWRIGHT_CHANNEL=msedge|chrome|chromium.
//
// IMPORTANT — conclusiveness:
// Automated browsers are frequently excluded by ad networks (they refuse to
// serve popunder/OnClick inventory to `navigator.webdriver` clients). This
// harness therefore reports the journey checks as INCONCLUSIVE — never as a
// pass — unless it actually observed the OnClick chain on the wire. A real
// field reproduction must be run in a normal, non-automated browser session.

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const argv = process.argv.slice(2);
const BASE_ARG = argv.includes('--base') ? String(argv[argv.indexOf('--base') + 1] || '').replace(/\/+$/, '') : null;
const LOCAL_PORT = parseInt(process.env.NAV_PORT || '18992', 10);
const NAV_TIMEOUT = parseInt(process.env.NAV_TIMEOUT || '9000', 10);
const ARM_MS = parseInt(process.env.NAV_ARM_MS || '6000', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// Any ad-network traffic at all, vs. specifically the OnClick/Popunder chain
// (iClick build, its zone param, or a redirect endpoint).
const AD_TRAFFIC = /(quge5|auqot|ekhay|b3mny|6opo|jmosl|094kk|rtmark|ay267|o-set|nennne|zoneid=)/i;
const ONCLICK_TRAFFIC = /(6opo|iclick|zoneid=11912374|t=onclick|afu\.php|wm=11912374)/i;

const results = [];
function record(state, name, detail) {
  results.push({ state, name });
  console.log(state.padEnd(4) + ' | ' + name + (detail ? ' | ' + String(detail).slice(0, 300) : ''));
}
function check(name, ok, detail) {
  record(ok ? 'PASS' : 'FAIL', name, detail);
}
function inconclusive(name, detail) {
  record('SKIP', name, detail);
}

function startStaticServer() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(LOCAL_PORT, '127.0.0.1', () => resolve(server)));
}

// The ad-armed navigation hub: served at the site root in production and at
// platform.html in a local checkout (where "/" is the ERP index).
function hubPath(base) {
  return base === 'http://127.0.0.1:' + LOCAL_PORT ? '/platform.html' : '/';
}

// The ad stack is injected asynchronously, so a click fired immediately after
// load would test nothing. Waiting for ad traffic — or ARM_MS at worst, plus a
// settle delay — reproduces the field condition: the visitor clicks after the
// page has settled, and that click is the one the armed format acts on.
async function waitForAdArmed(page, ms) {
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      page.off('request', onReq);
      resolve();
    };
    const onReq = (r) => { if (AD_TRAFFIC.test(r.url())) finish(); };
    page.on('request', onReq);
    setTimeout(finish, ms);
  });
  await page.waitForTimeout(1200);
}

async function main() {
  const { chromium } = require('playwright');

  let server = null;
  let base = BASE_ARG;
  if (!base) {
    server = await startStaticServer();
    base = 'http://127.0.0.1:' + LOCAL_PORT;
  }
  const hub = base + hubPath(base);
  const marketplace = base + '/marketplace/';

  const channel = process.env.PLAYWRIGHT_CHANNEL || 'msedge';
  const browser = await chromium.launch({ channel }).catch(() => chromium.launch());
  const context = await browser.newContext({ locale: 'ar-EG', viewport: { width: 1440, height: 900 } });
  let adTraffic = false;
  let onclickTraffic = false;
  context.on('request', (r) => {
    const url = r.url();
    if (AD_TRAFFIC.test(url)) adTraffic = true;
    if (ONCLICK_TRAFFIC.test(url)) onclickTraffic = true;
  });

  try {
    // ---------- static contract: the hub still ships the official ad tag ----------
    const hubHtml = await (await fetch(hub)).text();
    const tags = hubHtml.match(/quge5\.com\/88\/tag\.min\.js/g) || [];
    const zones = hubHtml.match(/data-zone="[^"]*"/g) || [];
    check('MONETAG_PRESENT: hub ships the official tag exactly once', tags.length === 1, 'tag occurrences: ' + tags.length);
    check('MONETAG_ZONE=288239 (single data-zone, unchanged)',
      zones.length === 1 && zones[0] === 'data-zone="288239"', zones.join(', '));
    check('hub links to the marketplace from its navigation',
      (hubHtml.match(/href="\/marketplace\/"/g) || []).length >= 5,
      'links: ' + (hubHtml.match(/href="\/marketplace\/"/g) || []).length);

    // ---------- DIRECT_MARKETPLACE ----------
    const page = await context.newPage();
    await page.goto(marketplace, { waitUntil: 'domcontentloaded' }).catch(() => {});
    const direct = new URL(page.url());
    check('DIRECT_MARKETPLACE: /marketplace/ opens on its own route',
      direct.origin + direct.pathname.replace(/\/+$/, '') === marketplace.replace(/\/+$/, ''),
      'landed on ' + direct.href);
    const rendered = await page.evaluate(() => (document.body ? document.body.innerText.trim().length : 0)).catch(() => 0);
    // A bare checkout has no built marketplace bundle (dist/ is produced at
    // deploy time), so an empty body locally is not a marketplace failure.
    if (rendered > 40) {
      check('MARKETPLACE_CONTENT_VISIBLE: marketplace renders content', true, 'visible text length: ' + rendered);
    } else if (BASE_ARG) {
      check('MARKETPLACE_CONTENT_VISIBLE: marketplace renders content', false, 'visible text length: ' + rendered);
    } else {
      inconclusive('MARKETPLACE_CONTENT_VISIBLE: NOT evaluated — local checkout has no built marketplace bundle', '');
    }
    await page.close();

    // ---------- ROOT_TO_MARKETPLACE: the real user journey ----------
    const journey = await context.newPage();
    await journey.goto(hub, { waitUntil: 'domcontentloaded' });
    const entry = journey.locator('a[href="/marketplace/"]:visible').first();
    await entry.waitFor({ timeout: NAV_TIMEOUT });
    check('VISITOR_COUNTER: visitor hook present on the hub',
      await journey.evaluate(() => typeof window.initOmniVisitors === 'function'));

    await waitForAdArmed(journey, ARM_MS);
    await entry.click();
    const reached = await journey
      .waitForURL((u) => u.pathname.replace(/\/+$/, '') === '/marketplace', { timeout: NAV_TIMEOUT })
      .then(() => true)
      .catch(() => false);
    const landed = journey.url();
    const landedUrl = new URL(landed);
    const onMarketplace = landedUrl.origin + landedUrl.pathname.replace(/\/+$/, '') === marketplace.replace(/\/+$/, '');

    // Asymmetric on purpose (see the header): a hijack is a hard, real failure,
    // while a clean navigation in an automated browser proves nothing — the ad
    // simply may not have acted — so it is reported as inconclusive rather than
    // as a pass.
    if (!onMarketplace) {
      check('ROOT_TO_MARKETPLACE: clicking Marketplace from the hub reaches /marketplace/', false, 'landed on ' + landed);
      check('MONETAG_NOT_BLOCKING_MARKETPLACE: the ad replaced the destination', false,
        'destination replaced by ' + landedUrl.host + ' (OnClick chain seen: ' + (onclickTraffic ? 'yes' : 'no') + ')');
    } else {
      inconclusive('ROOT_TO_MARKETPLACE: navigation reached /marketplace/ — inconclusive by design',
        'a clean run in an automated browser cannot prove the field behaviour (ad traffic seen: ' +
        (adTraffic ? 'yes' : 'no') + ', OnClick chain: ' + (onclickTraffic ? 'yes' : 'no') +
        '); reproduce in a normal browser session before treating this as green');
      inconclusive('MONETAG_NOT_BLOCKING_MARKETPLACE: inconclusive by design', 'derived from the journey check above');
    }
    void reached;

    // Diagnostic: an OnClick/Popunder format may legitimately open its own tab
    // and leave our navigation intact. Listing the open tabs tells that apart
    // from a replaced destination.
    record('INFO', 'tabs open after the journey (OnClick armed: ' + (onclickTraffic ? 'yes' : 'no') + ')',
      context.pages().map((p) => { try { return p.url(); } catch (_) { return '?'; } }).join(' | '));

    // ---------- return journey ----------
    if (onMarketplace) {
      await journey.goto(marketplace, { waitUntil: 'domcontentloaded' });
      const back = await journey.evaluate((origin) => {
        const hit = Array.from(document.querySelectorAll('a[href]')).find((a) => {
          try {
            const u = new URL(a.href, location.href);
            return u.origin === origin && u.pathname.replace(/\/+$/, '') === '';
          } catch (_) {
            return false;
          }
        });
        return hit ? hit.getAttribute('href') : null;
      }, new URL(base).origin);
      if (back) {
        check('RETURN_PATH: marketplace offers a way back to the platform', true, 'back link: ' + back);
      } else if (BASE_ARG) {
        check('RETURN_PATH: marketplace offers a way back to the platform', false, 'no same-origin back link found');
      } else {
        inconclusive('RETURN_PATH: NOT evaluated — local checkout has no built marketplace bundle', '');
      }
    }
    await journey.close();
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    if (server) await new Promise((r) => server.close(r));
  }

  const failed = results.filter((r) => r.state === 'FAIL');
  const skipped = results.filter((r) => r.state === 'SKIP');
  console.log('\nplatform navigation contract | BASE: ' + (BASE_ARG || base) +
    ' | TOTAL: ' + results.length + ' | PASS: ' + results.filter((r) => r.state === 'PASS').length +
    ' | FAIL: ' + failed.length + ' | INCONCLUSIVE: ' + skipped.length);
  if (skipped.length) {
    console.log('NOTE: inconclusive checks are the ones an automated browser cannot settle — the ad may simply not have\n' +
      '      acted on the click. Treat them as "not proven": reproduce the journey in a normal browser session.');
  }
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('verify-platform-nav.js crashed: ' + (err && err.message));
  process.exitCode = 1;
});
