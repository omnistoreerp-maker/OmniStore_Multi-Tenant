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
    // ---------- static contract: no ad tag on the hub + all active sections ----------
    // The unsafe Multitag zone (288239, OnClick/Popunder runtime sub-zone
    // 11912374) was REMOVED from the hub after the reproduced navigation
    // hijack; the only sanctioned ad surface is the gated inline OmniAdSlot,
    // which makes zero requests while the owner gate is off.
    const hubHtml = await (await fetch(hub)).text();
    const countIn = (hay, needle) => hay.split(needle).length - 1;
    const tags = hubHtml.match(/quge5\.com\/88\/tag\.min\.js/g) || [];
    const zones = hubHtml.match(/data-zone="[^"]*"/g) || [];
    check('NO_AD_TAG: hub ships no third-party ad script', tags.length === 0, 'tag occurrences: ' + tags.length);
    check('NO_PROHIBITED_ZONE: no data-zone attribute anywhere on the hub', zones.length === 0, zones.join(', '));
    check('hub links to the marketplace from its navigation',
      (hubHtml.match(/href="\/marketplace\/"/g) || []).length >= 5,
      'links: ' + (hubHtml.match(/href="\/marketplace\/"/g) || []).length);
    const SECTION_LINKS = [
      ['business.html', 'BUSINESS'],
      ['student.html', 'STUDENTS'],
      ['support.html', 'SUPPORT'],
      ['market.html#/game-hosting', 'GAME_HOSTING']
    ];
    for (const [route, label] of SECTION_LINKS) {
      check(label + '_LINK: hub links to ' + route,
        countIn(hubHtml, 'href="' + route + '"') >= 1,
        'occurrences: ' + countIn(hubHtml, 'href="' + route + '"'));
    }
    check('OMNI_AD_SLOT_PRESENT: hub carries the inline gated ad slot',
      hubHtml.includes('data-omni-ad') && hubHtml.includes('OWNER_INPUT_REQUIRED'),
      'slot marker + owner gate present');
    check('AD_ENGINE_GATE=DISABLED on the hub (zero ad requests possible)',
      hubHtml.includes("enabled: 'false'"),
      'OMNI_AD_CONFIG.enabled=false');

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

    // ---------- C. responsive: marketplace content stays primary ----------
    // The marketplace content — header, search, categories, product cards — is
    // the page. At every supported viewport the content must be visible, must
    // not overflow horizontally, and nothing may cover most of the screen.
    // This harness never clicks, requests or interacts with any ad; the overlay
    // probe is purely a passive geometry read.
    const VIEWPORTS = [[320, 'AD_LAYOUT_320'], [375, 'AD_LAYOUT_375'], [390, 'AD_LAYOUT_390'], [430, 'AD_LAYOUT_430'], [1440, 'AD_LAYOUT_DESKTOP']];
    for (const [width, label] of VIEWPORTS) {
      const vp = await context.newPage();
      await vp.setViewportSize({ width, height: Math.max(640, Math.round(width * 2.1)) });
      await vp.goto(marketplace, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await vp.waitForTimeout(400);
      const geo = await vp.evaluate(() => {
        const doc = document.documentElement;
        const vpArea = innerWidth * innerHeight;
        let cover = 0;
        document.querySelectorAll('body *').forEach((e) => {
          const cs = getComputedStyle(e);
          if (cs.position !== 'fixed' && cs.position !== 'absolute') return;
          if (parseInt(cs.zIndex || '0', 10) <= 1000) return;
          // Closed drawers/backdrops (off-canvas or opacity-0) are part of the
          // app itself and must not count as a cover; only an overlay that is
          // both opaque and actually intersecting the viewport does.
          if (parseFloat(cs.opacity) < 0.5 || cs.visibility === 'hidden' || cs.pointerEvents === 'none') return;
          const r = e.getBoundingClientRect();
          const ix = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
          const iy = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
          if ((ix * iy) / vpArea >= 0.5 && ix * iy > cover) cover = ix * iy;
        });
        return {
          text: document.body ? document.body.innerText.trim().length : 0,
          overflow: doc.scrollWidth - doc.clientWidth,
          coverRatio: cover / Math.max(1, vpArea)
        };
      }).catch(() => ({ text: 0, overflow: 9999, coverRatio: 1 }));
      const ok = geo.text > 40 && geo.overflow <= 2 && geo.coverRatio < 0.8;
      if (geo.text > 40) {
        check(label + ': marketplace content visible, no overflow, no full-screen cover', ok,
          'text=' + geo.text + ' overflowPx=' + geo.overflow + ' cover=' + Math.round(geo.coverRatio * 100) + '%');
      } else if (BASE_ARG) {
        check(label + ': marketplace content visible', false, 'no visible content (text=' + geo.text + ')');
      } else {
        inconclusive(label + ': NOT evaluated — local checkout has no built marketplace bundle', '');
      }
      await vp.close();
    }

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
