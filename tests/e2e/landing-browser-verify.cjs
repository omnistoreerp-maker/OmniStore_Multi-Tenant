const { chromium, devices } = require('playwright');
const path = require('path');

(async () => {
  const PORT = 8765;
  const ROOT = path.resolve(__dirname, '..', '..');
  const server = require('http').createServer((req, res) => {
    const fs = require('fs');
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let filePath = path.join(ROOT, url.pathname === '/' ? '/landing.html' : url.pathname);
    if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      const ext = path.extname(filePath).toLowerCase();
      const ct = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }[ext] || 'text/plain';
      res.writeHead(200, { 'Content-Type': ct });
      res.end(data);
    });
  });
  await new Promise((resolve) => server.listen(PORT, resolve));

  const browser = await chromium.launch({ headless: true });
  const results = [];

  const check = (name, cond, detail = '') => {
    results.push({ name, pass: cond, detail });
    console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' :: ' + detail : ''));
  };

  // Desktop RTL (Arabic default)
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`http://localhost:${PORT}/landing.html`, { waitUntil: 'networkidle' });
    const html = page.locator('html');
    check('desktop RTL: lang=ar', await html.getAttribute('lang') === 'ar');
    check('desktop RTL: dir=rtl', await html.getAttribute('dir') === 'rtl');
    check('desktop title present', (await page.title()).length > 0);
    check('desktop hero section visible', await page.locator('#home').isVisible());
    check('desktop services section visible', await page.locator('#services').isVisible());
    check('desktop footer visible', await page.locator('#footer').isVisible());
    check('desktop bottom nav visible', await page.locator('.bottom-nav').isVisible());
    check('desktop auth drawer button visible', await page.locator('#landingLoginBtn').isVisible());
    check('desktop language switcher slot present', await page.locator('#lang-switch').count() > 0);
    check('desktop registration inputs disabled', await page.locator('#regFullName').isDisabled() && await page.locator('#regEmail').isDisabled() && await page.locator('#regPhone').isDisabled());
    const serviceLinks = await page.locator('.section-card').count();
    check(`desktop service cards count: ${serviceLinks}`, serviceLinks === 7);
    await page.screenshot({ path: 'tests/e2e/screenshot-desktop-ar.png', fullPage: true });
    await page.close();
  }

  // Desktop English
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`http://localhost:${PORT}/landing.html`, { waitUntil: 'networkidle' });
    const langBtns = page.locator('.lang-btn');
    const enBtn = langBtns.filter({ hasText: /English/ }).first();
    await enBtn.click();
    await page.waitForTimeout(300);
    const html = page.locator('html');
    check('desktop EN: lang=en after switch', await html.getAttribute('lang') === 'en');
    check('desktop EN: dir=ltr after switch', await html.getAttribute('dir') === 'ltr');
    check('desktop EN: platform_name in English', await page.locator('[data-i18n="platform_name"]').textContent() === 'OmniStore — Unified Services Platform');
    await page.screenshot({ path: 'tests/e2e/screenshot-desktop-en.png', fullPage: true });
    await page.close();
  }

  // Mobile RTL
  {
    const page = await browser.newPage({ ...devices['iPhone 12'] });
    await page.goto(`http://localhost:${PORT}/landing.html`, { waitUntil: 'networkidle' });
    const html = page.locator('html');
    check('mobile RTL: lang=ar', await html.getAttribute('lang') === 'ar');
    check('mobile RTL: dir=rtl', await html.getAttribute('dir') === 'rtl');
    check('mobile hero section visible', await page.locator('#home').isVisible());
    check('mobile bottom nav visible', await page.locator('.bottom-nav').isVisible());
    check('mobile auth drawer button visible', await page.locator('#landingLoginBtn').isVisible());
    check('mobile language switcher slot present', await page.locator('#lang-switch').count() > 0);
    await page.screenshot({ path: 'tests/e2e/screenshot-mobile-ar.png', fullPage: true });
    await page.close();
  }

  // Auth drawer open/close + Escape
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`http://localhost:${PORT}/landing.html`, { waitUntil: 'networkidle' });
    check('drawer starts hidden', !await page.locator('#landingAuthDrawer').isVisible());
    await page.locator('#landingLoginBtn').click();
    await page.waitForTimeout(300);
    check('drawer opens on login click', await page.locator('#landingAuthDrawer').isVisible());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check('drawer closes on Escape', !await page.locator('#landingAuthDrawer').isVisible());
    await page.close();
  }

  await browser.close();
  await new Promise((resolve) => server.close(resolve));

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`\nBrowser verification: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
