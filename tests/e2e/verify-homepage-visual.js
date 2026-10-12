'use strict';

// Homepage visual regression smoke (Phase: homepage-visual-redesign).
//
// Boots the REAL backend against an isolated temp data dir and drives the REAL
// platform.html in headless Chromium (global playwright-core + cached browser
// build) through: clean load, visitor browsing, drawer mechanics, failed-login
// error path, viewport overflow matrix, RTL integrity, and real-action audit
// of every button/link. Screenshots go to a temp dir (paths printed, never
// committed). No production data, no real credentials.
//
// Usage: node tests/e2e/verify-homepage-visual.js [port]
// Exit code is nonzero when any check fails.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = parseInt(process.argv[2] || '18950', 10);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + String(detail).slice(0, 200) : ''));
}

function loadPlaywright() {
  try {
    return require('playwright');
  } catch (_) {}
  try {
    return require('C:/Users/hp/AppData/Roaming/npm/node_modules/playwright-core');
  } catch (_) {}
  return null;
}

function browserExe() {
  const candidates = [
    'C:/Users/hp/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',
    'C:/Users/hp/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
  ];
  for (const exe of candidates) {
    try { if (exe && fs.existsSync(exe)) return exe; } catch (_) {}
  }
  return null;
}

function makeTempDataDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `homepage-visual-${tag || 'data'}-`));
}

async function main() {
  const pw = loadPlaywright();
  if (!pw || !pw.chromium) {
    console.log('SKIP | playwright unavailable in this environment');
    process.exitCode = 0;
    return;
  }
  const exe = browserExe();
  const dir = makeTempDataDir('run');
  let server = null;
  let browser = null;
  const shots = path.join(dir, 'shots');
  try {
    process.env.DIGITRONICS_DATA_DIR = dir;
    process.env.JWT_SECRET = 'homepage-visual-e2e-secret';
    delete process.env.AUTH_REQUIRED;
    const app = require('../../backend/server.js');
    server = await new Promise((resolve, reject) => {
      const s = app.listen(PORT, () => resolve(s));
      s.on('error', reject);
    });
    const base = 'http://127.0.0.1:' + PORT;

    browser = await pw.chromium.launch(Object.assign(
      { headless: true }, exe ? { executablePath: exe } : {}
    ));
    const errors = [];
    const failedReqs = [];
    const expectedNoise = [];
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      const text = String(m.text());
      if (m.type() !== 'error' || text.includes('favicon')) return;
      // The intentional failed-login probe below produces its own expected
      // 401; it is recorded separately and asserted explicitly, never counted
      // as page breakage.
      if (/Failed to load resource/i.test(text)) {
        expectedNoise.push(text.slice(0, 120));
        return;
      }
      errors.push('console: ' + text);
    });
    page.on('response', (r) => {
      const url = r.url();
      if (url.includes('/api/v1/auth/login')) return; // intentional negative probe, asserted below
      if (r.status() >= 400 && !url.includes('favicon')) {
        failedReqs.push(r.status() + ' ' + url.split('/').slice(3).join('/'));
      }
    });

    await page.goto(base + '/platform.html', { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    check('homepage loads with navigation', await page.evaluate(() => !!document.querySelector('.glass-nav')));
    check('drawer starts hidden; page browsable without session',
      await page.evaluate(() => {
        const d = document.getElementById('platformAuthDrawer');
        return d && d.hasAttribute('hidden') && !!document.querySelector('.glass-nav');
      }));
    check('document lang/dir pairing is coherent', await page.evaluate(() => {
      const html = document.documentElement;
      const lang = html.getAttribute('lang');
      const dir = html.getAttribute('dir');
      return (lang === 'ar' && dir === 'rtl') || (lang === 'en' && dir === 'ltr');
    }));

    // Drawer mechanics + failed login (no accounts needed).
    await page.click('#platformLoginBtn');
    await page.waitForSelector('#platformAuthDrawer:not([hidden])', { timeout: 8000 });
    check('drawer opens on explicit button click', true);
    await page.fill('#platformAuthUser', 'nobody-here');
    await page.fill('#platformAuthPass', 'wrong-password');
    await page.click('#platformAuthSubmit');
    await page.waitForSelector('#platformAuthError:not([hidden])', { timeout: 8000 });
    const stuck = await page.evaluate(() => ({
      token: localStorage.getItem('access_token'),
      url: location.pathname
    }));
    check('failed login shows an error and never navigates or stores tokens',
      !stuck.token && stuck.url.endsWith('/platform.html'), JSON.stringify(stuck));
    check('failed login produced exactly one expected 401 resource note',
      expectedNoise.length === 1 && /401/.test(expectedNoise[0]), expectedNoise.join('; '));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => {
      const d = document.getElementById('platformAuthDrawer');
      return d && d.hasAttribute('hidden');
    }, null, { timeout: 8000 });
    check('escape closes the drawer', true);
    await page.screenshot({ path: path.join(shots, 'desktop-home.png') });
    await page.click('#platformLoginBtn');
    await page.waitForSelector('#platformAuthDrawer:not([hidden])', { timeout: 8000 });
    await page.screenshot({ path: path.join(shots, 'desktop-drawer.png') });
    await page.keyboard.press('Escape');

    // Every control must do something real: links carry hrefs, buttons labels.
    const dead = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll('header a, header button, .hero-actions a').forEach((el) => {
        const label = (el.textContent || '').trim();
        if (el.tagName === 'A' && !el.getAttribute('href')) bad.push('link-without-href');
        if (el.tagName === 'BUTTON' && !label) bad.push('button-without-label');
      });
      return bad;
    });
    check('header/hero controls all carry real actions and labels', dead.length === 0, dead.join(','));

    // Viewport overflow matrix (mirrors tests/e2e/verify-lang.js thresholds).
    const bad = [];
    for (const w of [320, 375, 390, 430, 768, 1024, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(150);
      const m = await page.evaluate(() => ({
        sw: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
        iw: window.innerWidth
      }));
      if (m.sw > m.iw + 1) bad.push(w + 'px:' + m.sw + '>' + m.iw);
    }
    check('no horizontal overflow at 320/375/390/430/768/1024/1440', bad.length === 0, bad.join(','));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('#platformLoginBtn');
    await page.waitForSelector('#platformAuthDrawer:not([hidden])', { timeout: 8000 });
    const dw = await page.locator('#platformAuthDrawer').boundingBox();
    check('mobile drawer fits a 390px viewport', !!dw && dw.width <= 390, 'w=' + (dw && dw.width));
    await page.screenshot({ path: path.join(shots, 'mobile-drawer.png') });

    // Public sections still render from the live catalog API.
    const sections = await page.evaluate(() => ({
      stats: !!document.getElementById('stats'),
      sections: !!document.getElementById('sections'),
      visitors: !!document.getElementById('activity-visitors-now')
    }));
    check('public sections and visitor markers render', sections.stats && sections.sections && sections.visitors,
      JSON.stringify(sections));

    check('no page JS errors across the run', errors.length === 0, errors.slice(0, 3).join('; '));
    check('no failed subresource requests', failedReqs.length === 0, failedReqs.slice(0, 5).join('; '));
    console.log('SHOTS ' + shots);
    await page.close();
  } finally {
    try { browser && await browser.close(); } catch (_) {}
    try { server && await new Promise((r) => server.close(r)); } catch (_) {}
    // Shots are evidence: the run directory is kept and its path printed.
    // Older run directories from this task are removed by hand at the end.
  }
}

main().then(() => {
  const failed = results.filter((r) => !r.ok);
  console.log('verify-homepage-visual: ' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed');
  process.exitCode = failed.length ? 1 : 0;
}).catch((err) => {
  console.error('FATAL | ' + (err && err.stack || err));
  process.exitCode = 2;
});
