const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const PORT = parseInt(process.argv[2] || '18942', 10);
const PAGES = ['platform.html', 'business.html', 'student.html', 'support.html', 'media-reels.html', 'index.html'];
const VIEWPORTS = [320, 375, 390, 430, 768, 1024, 1440];

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + String(detail).slice(0, 200) : ''));
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

async function newContext(browser, seedLang) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    try { localStorage.setItem('esoBackendRuntimeConfig', JSON.stringify({ enabled: false, apiBaseUrl: '' })); } catch (e) {}
    // Kill index.html's delayed first-run modal so it can never overlay the
    // language switcher under test (shown on a timer after load).
    const inject = () => {
      try {
        const st = document.createElement('style');
        st.textContent = '#firstRunModal{display:none !important;pointer-events:none !important;}';
        (document.head || document.documentElement).appendChild(st);
      } catch (e) {}
    };
    if (document.head || document.documentElement) inject();
    else document.addEventListener('DOMContentLoaded', inject);
  });
  if (seedLang) {
    await ctx.addInitScript((lang) => {
      localStorage.setItem('omnistore_language', lang);
      localStorage.setItem('omnistore_platform_lang', lang);
    }, seedLang);
  }
  return ctx;
}

async function closeOverlays(page) {
  // index.html shows a delayed first-run modal that overlays the login card;
  // it must never block the language switcher under test.
  await page.evaluate(() => {
    const m = document.getElementById('firstRunModal');
    if (m) m.style.display = 'none';
  });
}

async function readState(page) {
  return page.evaluate(() => ({
    lang: window.OmniLang ? window.OmniLang.get() : null,
    htmlLang: document.documentElement.getAttribute('lang'),
    dir: document.documentElement.getAttribute('dir'),
    stored: localStorage.getItem('omnistore_language'),
    slots: document.querySelectorAll('[data-omni-lang-slot]').length,
    rendered: document.querySelectorAll('[data-omni-lang-slot][data-omni-rendered="1"]').length,
    buttons: Array.from(document.querySelectorAll('.omni-lang-btn')).map((b) => ({
      label: b.textContent,
      pressed: b.getAttribute('aria-pressed'),
      target: b.getAttribute('data-omni-set-lang')
    })),
    arCount: Array.from(document.body.innerText || '').filter(function (c) { return /[\u0600-\u06FF]/.test(c); }).length
  }));
}

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  let errors = [];

  // Phase 1 — default is English (no browser sniffing), switch persists.
  {
    const ctx = await newContext(browser, null);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://127.0.0.1:' + PORT + '/platform.html', { waitUntil: 'load' });
    await page.waitForSelector('.omni-lang-btn', { timeout: 15000 });
    const s0 = await readState(page);
    check('default language is English (no browser sniffing)', s0.lang === 'en' && s0.htmlLang === 'en' && s0.dir === 'ltr', JSON.stringify(s0));
    check('switcher renders with English/العربية labels in order', s0.buttons.length >= 2 && s0.buttons[0].label === 'English' && s0.buttons[1].label === 'العربية', JSON.stringify(s0.buttons));
    check('active button exposes aria-pressed=true', s0.buttons.filter((b) => b.pressed === 'true').length === 1 && s0.buttons[0].pressed === 'true', JSON.stringify(s0.buttons));

    await closeOverlays(page); await page.click('[data-omni-set-lang="ar"]');
    const s1 = await readState(page);
    check('switching to العربية sets lang=ar dir=rtl and stores pref', s1.lang === 'ar' && s1.htmlLang === 'ar' && s1.dir === 'rtl' && s1.stored === 'ar' && s1.buttons[1].pressed === 'true', JSON.stringify(s1));

    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.omni-lang-btn', { timeout: 15000 });
    const s2 = await readState(page);
    check('language preference survives reload', s2.lang === 'ar' && s2.htmlLang === 'ar' && s2.dir === 'rtl', JSON.stringify(s2));
    check('no page errors during default/persistence flow', errors.length === 0, errors.join(';'));
    await ctx.close();
  }

  // Phase 2 — every surface translates in place and reverts, no page errors.
  for (const p of PAGES) {
    errors = [];
    const ctx = await newContext(browser, 'ar');
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://127.0.0.1:' + PORT + '/' + p, { waitUntil: 'load' });
    await page.waitForSelector('.omni-lang-btn', { timeout: 15000 });

    const a0 = await readState(page);
    check(p + ': boots in Arabic source state with switcher mounted', a0.lang === 'ar' && a0.htmlLang === 'ar' && a0.dir === 'rtl' && a0.rendered === a0.slots && a0.slots >= 1, 'slots=' + a0.slots + ' rendered=' + a0.rendered);

    await closeOverlays(page); await page.click('[data-omni-set-lang="en"]');
    const a1 = await readState(page);
    const dropped = a0.arCount > 0 && a1.arCount < a0.arCount * 0.5;
    check(p + ': English mode translates the page in place', a1.lang === 'en' && a1.htmlLang === 'en' && a1.dir === 'ltr' && a1.stored === 'en' && dropped, 'ar ' + a0.arCount + ' -> ' + a1.arCount);
    check(p + ': English mode keeps switcher aria-pressed in sync', a1.buttons[0].pressed === 'true' && a1.buttons[1].pressed === 'false', JSON.stringify(a1.buttons));

    await closeOverlays(page); await page.click('[data-omni-set-lang="ar"]');
    const a2 = await readState(page);
    const restored = a2.arCount > a1.arCount * 1.5;
    check(p + ': switching back restores Arabic source text', a2.lang === 'ar' && a2.dir === 'rtl' && a2.stored === 'ar' && restored, 'ar ' + a1.arCount + ' -> ' + a2.arCount);

    if (p === 'platform.html') {
      const nav = await page.evaluate(() => document.querySelector('[data-i18n="nav_home"]').textContent.trim());
      check('platform.html: nav sentinel reverts to العربية text', nav === 'الرئيسية', nav);
      await closeOverlays(page); await page.click('[data-omni-set-lang="en"]');
      const navEn = await page.evaluate(() => document.querySelector('[data-i18n="nav_home"]').textContent.trim());
      check('platform.html: nav sentinel translates to English', navEn === 'Home', navEn);
    }
    if (p === 'index.html') {
      const slots = await page.evaluate(() => document.querySelectorAll('[data-omni-lang-slot][data-omni-rendered="1"]').length);
      check('index.html: login + sidebar language slots both mounted', slots === 2, 'slots=' + slots);
      await closeOverlays(page); await page.click('[data-omni-set-lang="en"]');
      const sub = await page.evaluate(() => document.querySelector('.login-sub').textContent.trim());
      check('index.html: login subtitle translates to English', sub === 'Professional serial management system v6', sub);
    }

    check(p + ': zero page errors', errors.length === 0, errors.join(';'));

    // Phase 3 (per page) — no horizontal overflow across the viewport matrix.
    const bad = [];
    for (const w of VIEWPORTS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(120);
      const m = await page.evaluate(() => ({
        sw: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
        iw: window.innerWidth
      }));
      if (m.sw > m.iw + 1) bad.push(w + 'px:' + m.sw + '>' + m.iw);
    }
    check(p + ': no horizontal overflow at 320/375/390/430/768/1024/1440', bad.length === 0, bad.join(','));

    await ctx.close();
  }

  await browser.close();
  server.close();

  const failed = results.filter((r) => !r.ok).length;
  console.log('\nverify-lang.js | TOTAL: ' + results.length + ' | PASS: ' + (results.length - failed) + ' | FAIL: ' + failed);
  if (failed > 0) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
