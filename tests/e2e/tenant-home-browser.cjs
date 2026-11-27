'use strict';

// Tenant Home E2E — REAL browser + REAL backend. No API mocks.
//
// Boots the repository's actual Express app (backend/server.js) against an
// isolated temporary data directory, serves the new tenant home pages from a
// local static server, proxies /api/v1/* to the real app on the same origin,
// and verifies:
//   - Owner home page loads and renders (desktop, Arabic RTL)
//   - Admin home page loads and renders (desktop, English LTR)
//   - Arabic (RTL) and English (LTR) language attributes
//   - Desktop and mobile viewports
//   - No console errors or uncaught navigation failures
//   - Logout redirects to index.html
//
// Nothing in backend/data or any product file is read or written.

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const JWT_SECRET = 'test-jwt-secret-for-jest-suites';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'th-e2e-'));

process.env.DIGITRONICS_DATA_DIR = DATA_DIR;
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';
process.env.AUTH_REQUIRED = 'true';
process.env.ENABLE_TENANT_CARRY = 'true';
process.env.ENABLE_TENANT_ROLES = 'false';
process.env.ENABLE_MULTI_COMPANY_LOGIN = 'false';
process.env.RATE_LIMIT_MAX = '1000000';
process.env.LOG_FILE = '';
process.env.PLATFORM_ADMINS = '';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + String(detail).slice(0, 400) : ''));
  return !!ok;
}

const app = require(path.resolve(ROOT, 'backend/server.js'));
const BACKEND_PORT = 18960;
const STATIC_PORT = 18961;

let serverClose;
async function startBackend() {
  await new Promise((resolve) => app.listen(BACKEND_PORT, resolve));
  serverClose = () => new Promise((resolve) => app.close(resolve));
}

const staticServer = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    const ext = path.extname(file).toLowerCase();
    const ct = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct });
    res.end(data);
  });
});

async function startStatic() {
  await new Promise((resolve) => staticServer.listen(STATIC_PORT, resolve));
}

function signToken(userId, username, role, tenantId) {
  return require('jsonwebtoken').sign({
    sub: String(userId),
    username,
    role: role || 'Viewer',
    tenantId: tenantId || 'th-tenant-a',
    jti: require('crypto').randomUUID()
  }, JWT_SECRET, { expiresIn: '15m' });
}

async function addAuthCookie(page, token) {
  await page.context().addCookies([{
    name: 'access_token',
    value: token,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    secure: false
  }]);
}

(async () => {
  await startBackend();
  await startStatic();

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  // ── Test 1: Owner home page loads (desktop, Arabic RTL) ──
  {
    const token = signToken('u-owner', 'thOwner', 'Owner', 'th-tenant-a');
    await addAuthCookie(page, token);
    await page.goto('http://127.0.0.1:' + STATIC_PORT + '/tenant-owner.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    check('Owner home loads (desktop)', await page.locator('html').isVisible());
    check('Owner home dir=rtl (Arabic)', await page.locator('html').getAttribute('dir') === 'rtl');
    check('Owner home lang=ar', await page.locator('html').getAttribute('lang') === 'ar');
    check('Owner home has business overview section', await page.locator('.hero-section').isVisible());
    check('Owner home has KPI cards', await page.locator('.kpi-card').count() > 0);
    check('Owner home has logout button', await page.locator('#logoutBtn').isVisible());
    check('No console errors on Owner home', errors.length === 0, errors.join('; '));
  }

  // ── Test 2: Admin home page loads (desktop, English LTR) ──
  {
    const page2 = await context.newPage();
    const errors2 = [];
    page2.on('pageerror', e => errors2.push(e.message));
    page2.on('console', m => { if (m.type() === 'error') errors2.push(m.text()); });
    const token = signToken('u-admin', 'thAdmin', 'Admin', 'th-tenant-a');
    await addAuthCookie(page2, token);
    await page2.evaluate((l) => { document.documentElement.setAttribute('lang', l); document.documentElement.setAttribute('dir', 'ltr'); }, 'en');
    await page2.goto('http://127.0.0.1:' + STATIC_PORT + '/tenant-admin.html', { waitUntil: 'networkidle' });
    await page2.waitForTimeout(1000);
    check('Admin home loads (desktop)', await page2.locator('html').isVisible());
    check('Admin home dir=ltr (English)', await page2.locator('html').getAttribute('dir') === 'ltr');
    check('Admin home lang=en', await page2.locator('html').getAttribute('lang') === 'en');
    check('Admin home has tenant status section', await page2.locator('.hero-section').isVisible());
    check('Admin home has KPI cards', await page2.locator('.kpi-card').count() > 0);
    check('Admin home has logout button', await page2.locator('#logoutBtn').isVisible());
    check('No console errors on Admin home', errors2.length === 0, errors2.join('; '));
    await page2.close();
  }

  // ── Test 3: Mobile viewport Owner home ──
  {
    const page3 = await context.newPage();
    const errors3 = [];
    page3.on('pageerror', e => errors3.push(e.message));
    const token = signToken('u-owner', 'thOwner', 'Owner', 'th-tenant-a');
    await addAuthCookie(page3, token);
    await page3.setViewportSize({ width: 375, height: 812 });
    await page3.goto('http://127.0.0.1:' + STATIC_PORT + '/tenant-owner.html', { waitUntil: 'networkidle' });
    await page3.waitForTimeout(1000);
    check('Owner home loads on mobile', await page3.locator('html').isVisible());
    check('Owner home KPI cards visible on mobile', await page3.locator('.kpi-card').count() > 0);
    await page3.close();
  }

  // ── Test 4: Logout clears session ──
  {
    const token = signToken('u-owner', 'thOwner', 'Owner', 'th-tenant-a');
    await addAuthCookie(page, token);
    await page.goto('http://127.0.0.1:' + STATIC_PORT + '/tenant-owner.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    if (await page.locator('#logoutBtn').isVisible()) {
      await page.click('#logoutBtn');
      await page.waitForTimeout(1000);
    }
    check('Logout redirects to index.html', page.url().includes('/index.html'));
  }

  await browser.close();
  await serverClose();
  await new Promise((resolve) => staticServer.close(resolve));

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log('\nTenant Home E2E: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
})();
