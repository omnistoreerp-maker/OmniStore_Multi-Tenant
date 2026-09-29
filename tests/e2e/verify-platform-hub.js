'use strict';

// verify-platform-hub.js — Platform Home responsive + ad-slot contract.
//
// Pins, in a real browser, at 320/375/430/1440:
//   1. No horizontal overflow on the hub (OVERFLOW=0).
//   2. The inline OmniAdSlot stays IN-FLOW (position static), never an
//      overlay: it can never cover header, nav, content or dialogs.
//   3. The slot renders the disabled placeholder and zero ad-network
//      requests fire while the owner gate is off.
//   4. All five active sections are reachable from the hub markup.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const LOCAL_PORT = parseInt(process.env.HUB_PORT || '18995', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml'
};

// Any ad-network host at all — none of these may be contacted while gated.
const AD_HOSTS = /(quge5|auqot|ekhay|b3mny|6opo|jmosl|094kk|rtmark|ay267|o-set|nennne)/i;

const VIEWPORTS = [[320, 'HUB_320'], [375, 'HUB_375'], [430, 'HUB_430'], [1440, 'HUB_DESKTOP']];

const results = [];
function check(name, ok, detail) {
  results.push({ ok });
  console.log((ok ? 'PASS' : 'FAIL').padEnd(4) + ' | ' + name + (detail ? ' | ' + String(detail).slice(0, 220) : ''));
}

function startStaticServer() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(LOCAL_PORT, '127.0.0.1', () => resolve(server)));
}

async function main() {
  const { chromium } = require('playwright');
  const server = await startStaticServer();
  const base = 'http://127.0.0.1:' + LOCAL_PORT;

  const channel = process.env.PLAYWRIGHT_CHANNEL || 'msedge';
  const browser = await chromium.launch({ channel }).catch(() => chromium.launch());
  const context = await browser.newContext({ locale: 'ar-EG', viewport: { width: 1440, height: 900 } });
  let adRequests = 0;
  context.on('request', (r) => { if (AD_HOSTS.test(r.url())) adRequests += 1; });

  try {
    // Both surfaces that carry the inline slot in static HTML: the Platform
    // hub and the Game Hosting / Market storefront (market.html#/game-hosting).
    const PAGES = [['/platform.html', 'HUB', 'hub'], ['/market.html', 'STORE', 'storefront']];
    for (const [pathname, prefix, human] of PAGES) {
    for (const [width, label] of VIEWPORTS) {
      const page = await context.newPage();
      await page.setViewportSize({ width, height: Math.max(640, Math.round(width * 2.1)) });
      await page.goto(base + pathname, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(400);
      const geo = await page.evaluate(() => {
        const doc = document.documentElement;
        const slot = document.querySelector('[data-omni-ad]');
        const slotState = slot ? slot.getAttribute('data-omni-ad-state') : 'missing';
        const slotPos = slot ? getComputedStyle(slot).position : 'missing';
        const slotRoot = slot ? slot.querySelector('[data-omni-ad-root]') : null;
        return {
          overflow: doc.scrollWidth - doc.clientWidth,
          slotState,
          slotPos,
          placeholder: slotRoot ? (slotRoot.textContent || '').includes('Placeholder') : false,
          bottomNavLinks: document.querySelectorAll('.bottom-nav-link').length,
          topNavLinks: document.querySelectorAll('.glass-nav-link').length,
          footerLinks: document.querySelectorAll('.footer-links a').length
        };
      }).catch(() => ({ overflow: 9999, slotState: 'missing', slotPos: 'missing', placeholder: false, bottomNavLinks: 0, topNavLinks: 0, footerLinks: 0 }));

      const tag = prefix + '_' + width;
      check(tag + ': ' + human + ' has zero horizontal overflow', geo.overflow <= 2, 'overflowPx=' + geo.overflow);
      check(tag + ': OmniAdSlot is in-flow (never fixed/absolute/sticky)', geo.slotPos === 'static', 'position=' + geo.slotPos);
      check(tag + ': OmniAdSlot renders the disabled placeholder', geo.slotState === 'placeholder' && geo.placeholder, 'state=' + geo.slotState);
      if (prefix === 'HUB') {
        check(tag + ': all section entries present (top nav = 7 links)', geo.topNavLinks === 7, 'top=' + geo.topNavLinks + ' footer=' + geo.footerLinks + ' bottom=' + geo.bottomNavLinks);
      }
      await page.close();
    }
    }

    check('ZERO_AD_REQUESTS: no ad-network host contacted while gated', adRequests === 0, 'ad requests: ' + adRequests);

    const html = fs.readFileSync(path.join(ROOT, 'platform.html'), 'utf8');
    const count = (hay, needle) => hay.split(needle).length - 1;
    for (const route of ['/marketplace/', 'business.html', 'student.html', 'market.html#/game-hosting', 'support.html']) {
      check('SECTION_REACHABLE: ' + route, count(html, 'href="' + route + '"') >= 3, 'occurrences=' + count(html, 'href="' + route + '"'));
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await new Promise((r) => server.close(r));
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log('\nplatform hub contract | TOTAL: ' + results.length + ' | PASS: ' + (results.length - failed) + ' | FAIL: ' + failed);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error('verify-platform-hub.js crashed: ' + (err && err.message));
  process.exitCode = 1;
});
