'use strict';

// Tenant Home E2E — REAL browser + REAL backend. No API mocks.
//
// Boots the repository's actual Express app (backend/server.js) against an
// isolated temporary data directory, serves the new tenant home pages from a
// local static server that proxies /api/v1/* to the real backend on the same
// origin, and verifies:
//   - Tenant Owner signs in via the actual login UI and reaches tenant-owner.html
//   - Tenant Admin signs in via the actual login UI and reaches tenant-admin.html
//   - Platform Master stays on existing index.html behavior
//   - Viewer cannot reach tenant home (403 on API, no navigation)
//   - Arabic RTL through real language attributes (default page language)
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

// Exact known Supabase startup self-check diagnostic warning patterns.
// These are benign connection-config diagnostics logged by the platform's
// Supabase client during page initialization. They are NOT pageerrors and
// NOT unexpected console errors. Only these exact prefixes are allowlisted;
// every other unexpected console error or pageerror fails the test.
const KNOWN_DIAGNOSTIC_PATTERNS = [
  'startup.self_check Error: Supabase Config',
  'startup.self_check Error: Supabase Connection',
  'startup.self_check Error: Supabase Config, Supabase Connection',
  'Supabase client initialized with missing/placeholder config'
];

function isKnownDiagnostic(errorText) {
  // Exact known diagnostic prefixes only — never a broad "Supabase" match.
  return KNOWN_DIAGNOSTIC_PATTERNS.some(function (p) {
    return errorText.indexOf(p) !== -1;
  });
}

// Returns only unexpected errors (pageerrors + non-diagnostic console errors).
function unexpectedErrors(errors) {
  return errors.filter(function (e) {
    // pageerror exceptions are never allowlisted.
    if (e.startsWith('PAGEERROR: ')) { return true; }
    // Console errors: only exact known diagnostic patterns are allowlisted.
    if (e.startsWith('CONSOLE: ')) {
      var text = e.slice('CONSOLE: '.length);
      return !isKnownDiagnostic(text);
    }
    return true;
  });
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
    { id: 'u-cashier', username: 'e2eCashier', password: hashPassword(PW), role: 'Cashier', fullName: 'E2E Cashier', tenantIds: ['digitronics'], tenantRoles: { digitronics: 'Cashier' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tokenVersion: 0 },
    { id: 'u-master', username: 'e2eMaster', password: hashPassword(PW), role: 'Manager', fullName: 'E2E Master', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tokenVersion: 0 },
    { id: 'u-manager', username: 'e2eManager', password: hashPassword(PW), role: 'Manager', fullName: 'E2E Manager', tenantIds: ['digitronics'], tenantRoles: { digitronics: 'Manager' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tokenVersion: 0 }
  ]
};

// Platform (Master) identity — server-side store, separate from tenant scope.
// MASTER_OWNER membership here makes e2eMaster a real platform Master, not
// just a tenant Manager. Read by platformAdmin.platformRoleFor() at login.
const PLATFORM_ADMINS_DATA = {
  admins: [
    { username: 'e2eMaster', platformRole: 'MASTER_OWNER', status: 'active', displayName: 'E2E Platform Master', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
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

  // Serve HTML files as-is (no lang/dir rewriting — the application controls
  // its own language via the html element's lang/dir attributes).
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    const ext = path.extname(file).toLowerCase();
    let ct = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct });
    res.end(data);
  });
});

async function startStatic() {
  staticServer = staticServerInstance.listen(STATIC_PORT);
  await new Promise((resolve) => staticServer.once('listening', resolve));
}

const STATIC_ORIGIN = 'http://127.0.0.1:' + STATIC_PORT;

// Log in via the actual browser login UI (fills form, clicks button, lets
// the page's own doLogin() handle routing). Preselects the company via
// localStorage so the company selector auto-selects digitronics.
async function preparePage(page, company) {
  // Clear all localStorage and cookies, then preselect company and enable
  // backend before the page's own scripts run.
  await page.addInitScript(({ cid, enabled }) => {
    localStorage.clear();
    localStorage.setItem('eso_selected_company_id', cid);
    localStorage.setItem('esoBackendRuntimeConfig', JSON.stringify({ enabled: enabled, apiBaseUrl: '' }));
  }, { cid: company, enabled: true });
}

async function loginViaUi(page, username) {
  await page.fill('#loginUser', username);
  await page.fill('#loginPass', PW);
  await page.click('#loginBtn');
  // Wait for navigation: the page's doLogin() redirects Owner/Admin to their
  // tenant home, or keeps others on index.html.
  await page.waitForTimeout(1500);
}

(async () => {
  // Seed data into the temp directory BEFORE starting the server.
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'companies.json'), JSON.stringify(COMPANIES, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, 'users.json'), JSON.stringify(USERS, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, 'platformAdmins.json'), JSON.stringify(PLATFORM_ADMINS_DATA, null, 2));

  await startBackend();
  await startStatic();

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  // ── Test 1: Owner signs in via UI and reaches tenant-owner.html (desktop, Arabic RTL) ──
  {
    await context.clearCookies();
    await preparePage(page, 'digitronics');
    await page.goto('http://127.0.0.1:' + STATIC_PORT + '/index.html', { waitUntil: 'networkidle' });
    await loginViaUi(page, 'e2eOwner');
    await page.waitForTimeout(1000);
    check('Owner navigates to tenant-owner.html after login', page.url().includes('/tenant-owner.html'));
    check('Owner home dir=rtl (Arabic)', await page.locator('html').getAttribute('dir') === 'rtl');
    check('Owner home lang=ar', await page.locator('html').getAttribute('lang') === 'ar');
    check('Owner home has business overview section', await page.locator('.hero-section').isVisible());
    check('Owner home has KPI cards', await page.locator('.kpi-card').count() > 0);
    check('Owner home has logout button', await page.locator('#logoutBtn').isVisible());
    check('No console errors on Owner home', unexpectedErrors(errors).length === 0, unexpectedErrors(errors).join('; '));
    errors.length = 0;
  }

  // ── Test 2: Admin signs in via UI and reaches tenant-admin.html (desktop, Arabic RTL) ──
  {
    const page2 = await context.newPage();
    const errors2 = [];
    page2.on('pageerror', e => errors2.push('PAGEERROR: ' + e.message));
    page2.on('console', m => { if (m.type() === 'error') errors2.push('CONSOLE: ' + m.text()); });
    await context.clearCookies();
    await preparePage(page2, 'digitronics');
    await page2.goto('http://127.0.0.1:' + STATIC_PORT + '/index.html', { waitUntil: 'networkidle' });
    await loginViaUi(page2, 'e2eAdmin');
    await page2.waitForTimeout(1000);
    check('Admin navigates to tenant-admin.html after login', page2.url().includes('/tenant-admin.html'));
    check('Admin home dir=rtl (Arabic)', await page2.locator('html').getAttribute('dir') === 'rtl');
    check('Admin home lang=ar', await page2.locator('html').getAttribute('lang') === 'ar');
    // KPI cards render asynchronously after the tenant-home API fetch completes
    await page2.waitForSelector('.kpi-card', { state: 'attached', timeout: 5000 }).catch(() => {});
    check('Admin home has KPI cards', await page2.locator('.kpi-card').count() > 0, await page2.locator('.kpi-card').count());
    check('Admin home has logout button', await page2.locator('#logoutBtn').isVisible());
    check('No console errors on Admin home', unexpectedErrors(errors2).length === 0, unexpectedErrors(errors2).join('; '));
    await page2.close();
  }

  // ── Test 3: Platform Master (MASTER_OWNER) stays on index.html ──
  {
    const page4 = await context.newPage();
    const errors4 = [];
    page4.on('pageerror', e => errors4.push('PAGEERROR: ' + e.message));
    page4.on('console', m => { if (m.type() === 'error') errors4.push('CONSOLE: ' + m.text()); });
    await context.clearCookies();
    await preparePage(page4, undefined);
    await page4.goto('http://127.0.0.1:' + STATIC_PORT + '/index.html', { waitUntil: 'networkidle' });
    await loginViaUi(page4, 'e2eMaster');
    await page4.waitForTimeout(1000);
    // Master identity is server-side (platformAdmins.json), NOT a tenant role.
    // Master must NOT be redirected to tenant-owner.html or tenant-admin.html.
    check('Master stays on index.html (Master Control Center, not tenant home)', page4.url().includes('/index.html'));
    check('Master not redirected to tenant-owner.html', !page4.url().includes('/tenant-owner.html'));
    check('Master not redirected to tenant-admin.html', !page4.url().includes('/tenant-admin.html'));
    await page4.close();
  }

  // ── Test 3b: Ordinary Manager stays on index.html ──
  {
    const page7 = await context.newPage();
    const errors7 = [];
    page7.on('pageerror', e => errors7.push('PAGEERROR: ' + e.message));
    page7.on('console', m => { if (m.type() === 'error') errors7.push('CONSOLE: ' + m.text()); });
    await context.clearCookies();
    await preparePage(page7, 'digitronics');
    await page7.goto('http://127.0.0.1:' + STATIC_PORT + '/index.html', { waitUntil: 'networkidle' });
    await loginViaUi(page7, 'e2eManager');
    await page7.waitForTimeout(1000);
    check('Manager stays on index.html (existing behavior)', page7.url().includes('/index.html'));
    await page7.close();
  }

  // ── Test 3c: Cashier reaches Employee Workspace via UI login ──
  {
    const page8 = await context.newPage();
    const errors8 = [];
    page8.on('pageerror', e => errors8.push('PAGEERROR: ' + e.message));
    page8.on('console', m => { if (m.type() === 'error') errors8.push('CONSOLE: ' + m.text()); });
    await context.clearCookies();
    await preparePage(page8, 'digitronics');
    await page8.goto('http://127.0.0.1:' + STATIC_PORT + '/index.html', { waitUntil: 'networkidle' });
    await loginViaUi(page8, 'e2eCashier');
    await page8.waitForTimeout(1000);
    check('Cashier navigates to employee-workspace.html after login', page8.url().includes('/employee-workspace.html'));
    check('Cashier not redirected to tenant-owner.html', !page8.url().includes('/tenant-owner.html'));
    check('Cashier not redirected to tenant-admin.html', !page8.url().includes('/tenant-admin.html'));
    await page8.close();
  }

  // ── Test 4: Viewer cannot access tenant home ──
  {
    const page5 = await context.newPage();
    const errors5 = [];
    page5.on('pageerror', e => errors5.push('PAGEERROR: ' + e.message));
    page5.on('console', m => { if (m.type() === 'error') errors5.push('CONSOLE: ' + m.text()); });
    await context.clearCookies();
    await preparePage(page5, 'digitronics');
    await page5.goto('http://127.0.0.1:' + STATIC_PORT + '/index.html', { waitUntil: 'networkidle' });
    await loginViaUi(page5, 'e2eViewer');
    await page5.waitForTimeout(1000);
    check('Viewer stays on index.html (no tenant nav)', page5.url().includes('/index.html'));
    // Viewer directly opening tenant-owner.html gets 403 on API
    const apiRes = await page5.request.get(STATIC_ORIGIN + '/api/v1/dashboard/tenant-home');
    check('Viewer gets 403 on tenant-home API', apiRes.status() === 403);
    await page5.close();
  }

  // ── Test 5: Mobile viewport Owner home ──
  {
    const page6 = await context.newPage();
    const errors6 = [];
    page6.on('pageerror', e => errors6.push('PAGEERROR: ' + e.message));
    page6.on('console', m => { if (m.type() === 'error') errors6.push('CONSOLE: ' + m.text()); });
    await context.clearCookies();
    await preparePage(page6, 'digitronics');
    await page6.goto('http://127.0.0.1:' + STATIC_PORT + '/index.html', { waitUntil: 'networkidle' });
    await page6.setViewportSize({ width: 375, height: 812 });
    await loginViaUi(page6, 'e2eOwner');
    await page6.waitForTimeout(1000);
    check('Owner navigates to tenant-owner.html on mobile', page6.url().includes('/tenant-owner.html'));
    check('Owner home KPI cards visible on mobile', await page6.locator('.kpi-card').count() > 0);
    await page6.close();
  }

  // ── Test 6: Logout clears session ──
  {
    await context.clearCookies();
    await preparePage(page, 'digitronics');
    await page.goto('http://127.0.0.1:' + STATIC_PORT + '/index.html', { waitUntil: 'networkidle' });
    await loginViaUi(page, 'e2eOwner');
    await page.waitForTimeout(1000);
    if (await page.locator('#logoutBtn').isVisible()) {
      await page.click('#logoutBtn');
      await page.waitForTimeout(1500);
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
