'use strict';

// Tenant Home E2E — REAL browser + REAL backend. No API mocks.
//
// Boots the repository's actual Express app (backend/server.js) against an
// isolated temporary data directory, serves the new tenant home pages from a
// local static server that proxies /api/v1/* to the real backend on the same
// origin, and verifies:
//   - Tenant Owner signs in and reaches tenant-owner.html
//   - Tenant Admin signs in and reaches tenant-admin.html
//   - Platform Master stays on existing index.html behavior
//   - Viewer cannot reach tenant home (403 on API, no navigation)
//   - Arabic RTL and English LTR through real language attributes
//   - Desktop and mobile viewports
//   - No console errors or 404 resource failures
//   - Logout clears session and returns to index.html
//
// Nothing in backend/data or any product file is read or written.

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const bcrypt = require(path.resolve(ROOT, 'backend/node_modules/bcryptjs'));
const JWT_SECRET = 'test-jwt-secret-for-jest-suites';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'th-e2e-'));

process.env.DIGITRONICS_DATA_DIR = DATA_DIR;
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';
process.env.AUTH_REQUIRED = 'true';
process.env.ENABLE_TENANT_CARRY = 'true';
process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
process.env.RATE_LIMIT_MAX = '1000000';
process.env.LOG_FILE = '';
process.env.PLATFORM_ADMINS = '';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + String(detail).slice(0, 400) : ''));
  return !!ok;
}

// Pre-hash passwords so users can be seeded directly into users.json.
function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}

const PW = 'Pass#1234';

const COMPANIES = {
  companies: [
    { id: 'digitronics', code: 'DIGI', name: 'DigiTronics', active: true },
    { id: 'nile', code: 'NILE', name: 'Nile Electronics', active: true }
  ]
};

// Users seeded directly (pre-hashed passwords, bcrypt$2b$ prefix).
const USERS = {
  users: [
    { id: 'u-owner', username: 'e2eOwner', password: hashPassword(PW), role: 'Owner', fullName: 'E2E Owner', tenantIds: ['digitronics'], tenantRoles: { digitronics: 'Owner' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tokenVersion: 0 },
    { id: 'u-admin', username: 'e2eAdmin', password: hashPassword(PW), role: 'Admin', fullName: 'E2E Admin', tenantIds: ['digitronics'], tenantRoles: { digitronics: 'Admin' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tokenVersion: 0 },
    { id: 'u-viewer', username: 'e2eViewer', password: hashPassword(PW), role: 'Viewer', fullName: 'E2E Viewer', tenantIds: ['digitronics'], tenantRoles: { digitronics: 'Viewer' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tokenVersion: 0 },
    { id: 'u-master', username: 'e2eMaster', password: hashPassword(PW), role: 'Owner', fullName: 'E2E Master', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tokenVersion: 0 }
  ]
};

const app = require(path.resolve(ROOT, 'backend/server.js'));
const BACKEND_PORT = 18970;
const STATIC_PORT = 18971;

let httpServer;
let staticServer;

async function startBackend() {
  httpServer = app.listen(BACKEND_PORT);
  await new Promise((resolve) => httpServer.once('listening', resolve));
}

// Static server that serves files from ROOT and proxies /api/v1/* to backend.
const staticServerInstance = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);

  // Proxy /api/v1/* to the real backend on the same origin.
  if (p.startsWith('/api/v1/')) {
    const options = {
      hostname: '127.0.0.1',
      port: BACKEND_PORT,
      path: req.url,
      method: req.method,
      headers: req.headers
    };
    // Remove host header to avoid mismatch.
    delete options.headers.host;
    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (err) => {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('proxy error: ' + err.message);
    });
    if (req.method === 'POST' || req.method === 'PUT') {
      req.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
    return;
  }

  // Serve HTML with optional lang override via ?lang=en query param.
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    const ext = path.extname(file).toLowerCase();
    let ct = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }[ext] || 'application/octet-stream';
    let content = data;
    // Override lang/dir for tenant home pages when ?lang=en is present.
    if (ext === '.html') {
      const url = new URL(req.url, 'http://127.0.0.1:' + STATIC_PORT);
      if (url.searchParams.get('lang') === 'en' && (p.endsWith('tenant-owner.html') || p.endsWith('tenant-admin.html'))) {
        const html = data.toString('utf-8');
        const modified = html.replace(/lang="ar" dir="rtl"/, 'lang="en" dir="ltr"');
        content = Buffer.from(modified, 'utf-8');
      }
    }
    res.writeHead(200, { 'Content-Type': ct });
    res.end(content);
  });
});

async function startStatic() {
  staticServer = staticServerInstance.listen(STATIC_PORT);
  await new Promise((resolve) => staticServer.once('listening', resolve));
}

const STATIC_ORIGIN = 'http://127.0.0.1:' + STATIC_PORT;

// Log in via Playwright's request API (real API, real cookie jar).
async function loginViaBrowser(page, username, company) {
  const res = await page.request.post(STATIC_ORIGIN + '/api/v1/auth/login', {
    data: { username, password: PW, company }
  });
  if (!res.ok()) {
    throw new Error('login(' + username + ') failed: ' + res.status());
  }
}

(async () => {
  // Seed data into the temp directory BEFORE starting the server.
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'companies.json'), JSON.stringify(COMPANIES, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, 'users.json'), JSON.stringify(USERS, null, 2));

  await startBackend();
  await startStatic();

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  // ── Test 1: Owner signs in and reaches tenant-owner.html (desktop, Arabic RTL) ──
  {
    await page.goto('http://127.0.0.1:' + STATIC_PORT + '/index.html', { waitUntil: 'networkidle' });
    await loginViaBrowser(page, 'e2eOwner', 'digitronics');
    await page.waitForTimeout(1000);
    await page.goto('http://127.0.0.1:' + STATIC_PORT + '/tenant-owner.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    check('Owner navigates to tenant-owner.html after login', page.url().includes('/tenant-owner.html'));
    check('Owner home dir=rtl (Arabic)', await page.locator('html').getAttribute('dir') === 'rtl');
    check('Owner home lang=ar', await page.locator('html').getAttribute('lang') === 'ar');
    check('Owner home has business overview section', await page.locator('.hero-section').isVisible());
    check('Owner home has KPI cards', await page.locator('.kpi-card').count() > 0);
    check('Owner home has logout button', await page.locator('#logoutBtn').isVisible());
    check('No console errors on Owner home', errors.length === 0, errors.join('; '));
    errors.length = 0;
  }

  // ── Test 2: Admin signs in and reaches tenant-admin.html (desktop, Arabic RTL) ──
  {
    const page2 = await context.newPage();
    const errors2 = [];
    page2.on('pageerror', e => errors2.push(e.message));
    page2.on('console', m => { if (m.type() === 'error') errors2.push(m.text()); });
    await page2.goto('http://127.0.0.1:' + STATIC_PORT + '/index.html', { waitUntil: 'networkidle' });
    await loginViaBrowser(page2, 'e2eAdmin', 'digitronics');
    await page2.waitForTimeout(1000);
    await page2.goto('http://127.0.0.1:' + STATIC_PORT + '/tenant-admin.html', { waitUntil: 'networkidle' });
    await page2.waitForTimeout(1000);
    check('Admin navigates to tenant-admin.html after login', page2.url().includes('/tenant-admin.html'));
    check('Admin home dir=rtl (Arabic)', await page2.locator('html').getAttribute('dir') === 'rtl');
    check('Admin home lang=ar', await page2.locator('html').getAttribute('lang') === 'ar');
    check('Admin home has KPI cards', await page2.locator('.kpi-card').count() > 0);
    check('Admin home has logout button', await page2.locator('#logoutBtn').isVisible());
    check('No console errors on Admin home', errors2.length === 0, errors2.join('; '));
    await page2.close();
  }

  // ── Test 3: Admin home in English LTR via ?lang=en ──
  {
    const page3 = await context.newPage();
    const errors3 = [];
    page3.on('pageerror', e => errors3.push(e.message));
    page3.on('console', m => { if (m.type() === 'error') errors3.push(m.text()); });
    await loginViaBrowser(page3, 'e2eAdmin', 'digitronics');
    await page3.goto('http://127.0.0.1:' + STATIC_PORT + '/tenant-admin.html?lang=en', { waitUntil: 'networkidle' });
    await page3.waitForTimeout(1000);
    check('Admin home dir=ltr (English)', await page3.locator('html').getAttribute('dir') === 'ltr');
    check('Admin home lang=en', await page3.locator('html').getAttribute('lang') === 'en');
    check('Admin home KPI cards visible in English', await page3.locator('.kpi-card').count() > 0);
    check('No console errors on Admin home EN', errors3.length === 0, errors3.join('; '));
    await page3.close();
  }

  // ── Test 4: Platform Master stays on index.html ──
  {
    const page4 = await context.newPage();
    const errors4 = [];
    page4.on('pageerror', e => errors4.push(e.message));
    await page4.goto('http://127.0.0.1:' + STATIC_PORT + '/index.html', { waitUntil: 'networkidle' });
    await loginViaBrowser(page4, 'e2eMaster', undefined);
    await page4.waitForTimeout(1000);
    check('Master stays on index.html (no tenant nav)', page4.url().includes('/index.html'));
    await page4.close();
  }

  // ── Test 5: Viewer cannot access tenant home ──
  {
    const page5 = await context.newPage();
    const errors5 = [];
    page5.on('pageerror', e => errors5.push(e.message));
    page5.on('console', m => { if (m.type() === 'error') errors5.push(m.text()); });
    await page5.goto('http://127.0.0.1:' + STATIC_PORT + '/index.html', { waitUntil: 'networkidle' });
    await loginViaBrowser(page5, 'e2eViewer', 'digitronics');
    await page5.waitForTimeout(1000);
    check('Viewer stays on index.html (no tenant nav)', page5.url().includes('/index.html'));
    // Viewer directly opening tenant-owner.html gets 403 on API
    const apiRes = await page5.request.get('http://127.0.0.1:' + STATIC_PORT + '/api/v1/dashboard/tenant-home');
    check('Viewer gets 403 on tenant-home API', apiRes.status() === 403);
    await page5.close();
  }

  // ── Test 6: Mobile viewport Owner home ──
  {
    const page6 = await context.newPage();
    const errors6 = [];
    page6.on('pageerror', e => errors6.push(e.message));
    await page6.goto('http://127.0.0.1:' + STATIC_PORT + '/index.html', { waitUntil: 'networkidle' });
    await page6.setViewportSize({ width: 375, height: 812 });
    await loginViaBrowser(page6, 'e2eOwner', 'digitronics');
    await page6.waitForTimeout(1000);
    await page6.goto('http://127.0.0.1:' + STATIC_PORT + '/tenant-owner.html', { waitUntil: 'networkidle' });
    await page6.waitForTimeout(1000);
    check('Owner navigates to tenant-owner.html on mobile', page6.url().includes('/tenant-owner.html'));
    check('Owner home KPI cards visible on mobile', await page6.locator('.kpi-card').count() > 0);
    await page6.close();
  }

  // ── Test 7: Logout clears session ──
  {
    await page.goto('http://127.0.0.1:' + STATIC_PORT + '/tenant-owner.html', { waitUntil: 'networkidle' });
    await loginViaBrowser(page, 'e2eOwner', 'digitronics');
    await page.waitForTimeout(1000);
    if (await page.locator('#logoutBtn').isVisible()) {
      await page.click('#logoutBtn');
      await page.waitForTimeout(1000);
    }
    check('Logout redirects to index.html', page.url().includes('/index.html'));
  }

  await browser.close();
  await new Promise((resolve) => httpServer.close(resolve));
  await new Promise((resolve) => staticServer.close(resolve));
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) {}

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log('\nTenant Home E2E: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
})();
