const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.js': 'application/javascript' };
const PAGE = 'brand/components/header.html';
const PORT = parseInt(process.argv[2] || '18950', 10);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + String(detail).slice(0, 200) : ''));
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/' + PAGE;
  const file = path.join(ROOT, p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ channel: 'chromium' });
  let errors = [];
  const consoleErrs = [];

  pageSetup = async (page) => {
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text()); });
    // Disable backend to avoid API noise
    await page.addInitScript(() => {
      localStorage.setItem('esoBackendRuntimeConfig', JSON.stringify({ enabled: false, apiBaseUrl: '' }));
    });
  };

  // --- Phase 1: Light/Dark toggle ---
  {
    const page = await browser.newPage();
    await pageSetup(page);
    await page.goto('http://127.0.0.1:' + PORT + '/' + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(1000);

    const themeBtn = await page.$('#os-theme-toggle');
    check('theme toggle button exists', !!themeBtn);

    const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await themeBtn.click();
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    check('Light/Dark toggle changes data-theme', before !== after, 'before=' + before + ' after=' + after);

    // Second click reverts
    await themeBtn.click();
    await page.waitForTimeout(300);
    const after2 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    check('Light/Dark toggle reverts on second click', after2 === before, 'after2=' + after2 + ' before=' + before);

    await page.close();
  }

  // --- Phase 2: RTL/LTR toggle ---
  {
    const page = await browser.newPage();
    await pageSetup(page);
    await page.goto('http://127.0.0.1:' + PORT + '/' + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(1000);

    const langBtn = await page.$('#os-language-toggle');
    check('language toggle button exists', !!langBtn);

    const beforeDir = await page.evaluate(() => document.documentElement.getAttribute('dir'));
    const beforeLang = await page.evaluate(() => document.documentElement.getAttribute('lang'));
    await langBtn.click();
    await page.waitForTimeout(300);
    const afterDir = await page.evaluate(() => document.documentElement.getAttribute('dir'));
    const afterLang = await page.evaluate(() => document.documentElement.getAttribute('lang'));
    check('RTL/LTR toggle changes dir and lang', beforeDir !== afterDir && beforeLang !== afterLang, 'before dir=' + beforeDir + ' lang=' + beforeLang + ' after dir=' + afterDir + ' lang=' + afterLang);

    // Second click reverts
    await langBtn.click();
    await page.waitForTimeout(300);
    const after2Dir = await page.evaluate(() => document.documentElement.getAttribute('dir'));
    const after2Lang = await page.evaluate(() => document.documentElement.getAttribute('lang'));
    check('RTL/LTR toggle reverts on second click', after2Dir === beforeDir && after2Lang === beforeLang);

    await page.close();
  }

  // --- Phase 3: Persistence after reload ---
  {
    const page = await browser.newPage();
    await pageSetup(page);
    await page.goto('http://127.0.0.1:' + PORT + '/' + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(1000);

    // Set dark mode + RTL
    await page.click('#os-theme-toggle');
    await page.click('#os-language-toggle');
    await page.waitForTimeout(300);

    const themeBefore = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const dirBefore = await page.evaluate(() => document.documentElement.getAttribute('dir'));
    const storedTheme = await page.evaluate(() => localStorage.getItem('os-theme'));
    const storedDir = await page.evaluate(() => localStorage.getItem('os-dir'));
    check('theme persisted to localStorage', storedTheme === 'dark', 'storedTheme=' + storedTheme);
    check('dir persisted to localStorage', storedDir === 'rtl', 'storedDir=' + storedDir);

    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1000);

    const themeAfter = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const dirAfter = await page.evaluate(() => document.documentElement.getAttribute('dir'));
    check('theme survives reload', themeAfter === themeBefore, 'before=' + themeBefore + ' after=' + themeAfter);
    check('dir survives reload', dirAfter === dirBefore, 'before=' + dirBefore + ' after=' + dirAfter);

    await page.close();
  }

  // --- Phase 4: Mobile menu at <=768px ---
  {
    const page = await browser.newPage();
    await pageSetup(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('http://127.0.0.1:' + PORT + '/' + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(1000);

    const mobileBtn = await page.$('.os-mobile-menu');
    check('mobile menu button exists', !!mobileBtn);

    // Nav should be hidden by default on mobile
    const navDisplay = await page.evaluate(() => {
      const nav = document.querySelector('.os-nav');
      return nav ? window.getComputedStyle(nav).display : 'not-found';
    });
    check('mobile nav hidden by default (display none)', navDisplay === 'none', 'display=' + navDisplay);

    // Click mobile menu button - nav should appear
    await mobileBtn.click();
    await page.waitForTimeout(300);
    const navDisplayOpen = await page.evaluate(() => {
      const nav = document.querySelector('.os-nav');
      return nav ? window.getComputedStyle(nav).display : 'not-found';
    });
    const ariaExpanded = await page.evaluate(() => {
      const btn = document.querySelector('.os-mobile-menu');
      return btn ? btn.getAttribute('aria-expanded') : 'not-found';
    });
    check('mobile nav opens on click', navDisplayOpen === 'flex', 'display=' + navDisplayOpen);
    check('aria-expanded=true when open', ariaExpanded === 'true', 'aria-expanded=' + ariaExpanded);

    // Click again - nav should close
    await mobileBtn.click();
    await page.waitForTimeout(300);
    const navDisplayClose = await page.evaluate(() => {
      const nav = document.querySelector('.os-nav');
      return nav ? window.getComputedStyle(nav).display : 'not-found';
    });
    const ariaExpandedClosed = await page.evaluate(() => {
      const btn = document.querySelector('.os-mobile-menu');
      return btn ? btn.getAttribute('aria-expanded') : 'not-found';
    });
    check('mobile nav closes on second click', navDisplayClose === 'none', 'display=' + navDisplayClose);
    check('aria-expanded=false when closed', ariaExpandedClosed === 'false', 'aria-expanded=' + ariaExpandedClosed);

    await page.close();
  }

  // --- Phase 5: Desktop (>768px) nav visible ---
  {
    const page = await browser.newPage();
    await pageSetup(page);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('http://127.0.0.1:' + PORT + '/' + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(1000);

    const navDisplay = await page.evaluate(() => {
      const nav = document.querySelector('.os-nav');
      return nav ? window.getComputedStyle(nav).display : 'not-found';
    });
    const mobileBtnDisplay = await page.evaluate(() => {
      const btn = document.querySelector('.os-mobile-menu');
      return btn ? window.getComputedStyle(btn).display : 'not-found';
    });
    check('desktop nav visible by default', navDisplay === 'flex', 'display=' + navDisplay);
    check('mobile menu button hidden on desktop', mobileBtnDisplay === 'none', 'display=' + mobileBtnDisplay);

    await page.close();
  }

  // --- Phase 6: Keyboard accessibility ---
  {
    const page = await browser.newPage();
    await pageSetup(page);
    await page.goto('http://127.0.0.1:' + PORT + '/' + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(1000);

    // Focus theme toggle via Tab
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    const focusedTheme = await page.evaluate(() => document.activeElement && document.activeElement.id === 'os-theme-toggle' ? document.activeElement.id : 'not-focused');
    check('theme toggle reachable via Tab', focusedTheme === 'os-theme-toggle', 'focused=' + focusedTheme);

    // Press Enter to activate theme toggle
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const themeAfterEnter = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    check('theme toggle activatable via Enter', themeAfterEnter === 'dark', 'data-theme=' + themeAfterEnter);

    // Tab to language toggle
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    const focusedLang = await page.evaluate(() => document.activeElement && document.activeElement.id === 'os-language-toggle' ? document.activeElement.id : 'not-focused');
    check('language toggle reachable via Tab', focusedLang === 'os-language-toggle', 'focused=' + focusedLang);

    // Press Escape - should not crash
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check('Escape key does not cause JS errors', errors.length === 0, errors.join(';'));

    await page.close();
  }

  // --- Phase 7: Links have real destinations ---
  {
    const page = await browser.newPage();
    await pageSetup(page);
    await page.goto('http://127.0.0.1:' + PORT + '/' + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(1000);

    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('header a[href]')).map((a) => ({
        href: a.getAttribute('href'),
        text: a.textContent.trim()
      }));
    });
    const dummyLinks = links.filter((l) => l.href === '#');
    check('no dummy href="#" links in header', dummyLinks.length === 0, 'dummy links: ' + JSON.stringify(dummyLinks));
    const realAnchors = links.filter((l) => l.href.startsWith('#') && l.href.length > 1);
    check('all anchors use named destinations (#name)', realAnchors.length === links.length, 'links: ' + JSON.stringify(links));

    await page.close();
  }

  console.log('---');
  const failed = results.filter((r) => !r.ok);
  console.log('header.html | TOTAL: ' + results.length + ' | PASS: ' + (results.length - failed.length) + ' | FAIL: ' + failed.length);
  if (failed.length > 0) {
    failed.forEach((f) => console.log('  FAIL: ' + f.name));
  }
  await browser.close();
  server.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
