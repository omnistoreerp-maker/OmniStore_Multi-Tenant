'use strict';

// Education settings E2E — REAL browser + REAL backend, isolated temp data.
// Reproduces the render-time failure where paintPackSettings assigned to the
// readonly HTMLButtonElement.form property, which aborted before the save
// control was associated with its form. The test never touches backend/data.

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');

const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');

const ROOT = path.resolve(__dirname, '..', '..');
const JWT_SECRET = 'test-jwt-secret-for-jest-suites';
const STAMP = '2026-01-01T00:00:00.000Z';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-settings-e2e-'));

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

const OWNER = {
  id: 'u-set-owner', username: 'setOwner', role: 'Owner', tenantIds: ['set-a'],
  tokenVersion: 0, createdAt: STAMP, updatedAt: STAMP
};

function seed(name, payload) {
  fs.writeFileSync(path.join(DATA_DIR, name + '.json'), JSON.stringify(payload, null, 2), 'utf-8');
}

function seedStores() {
  seed('companies', [{
    id: 'set-a', name: 'Settings Tenant', code: 'SET', active: true,
    status: 'ACTIVE', createdAt: STAMP, updatedAt: STAMP
  }]);
  seed('users', { users: [OWNER] });
  seed('educationPack', {
    packs: [{
      tenantId: 'set-a', academicYear: '2025', timezone: 'Africa/Cairo',
      currency: 'EGP', createdAt: STAMP, updatedAt: STAMP
    }]
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function startStaticProxy(apiPort) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(String(req.url || '/').split('?')[0]);
    if (urlPath.startsWith('/api/')) {
      const headers = Object.assign({}, req.headers);
      headers.host = '127.0.0.1:' + apiPort;
      const proxied = http.request({
        hostname: '127.0.0.1', port: apiPort, path: req.url, method: req.method, headers
      }, upstream => {
        res.writeHead(upstream.statusCode || 502, upstream.headers);
        upstream.pipe(res);
      });
      proxied.on('error', err => {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('proxy error: ' + err.message);
      });
      req.pipe(proxied);
      return;
    }
    const rel = urlPath === '/' ? 'education/index.html' : urlPath.replace(/^\/+/, '');
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function listenApp(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');
    server.on('listening', () => resolve(server));
    server.on('error', reject);
  });
}

function signOwnerToken() {
  return jwt.sign({
    sub: OWNER.id, username: OWNER.username, role: OWNER.role,
    tenantId: 'set-a', jti: crypto.randomUUID(), ver: 0
  }, JWT_SECRET, { expiresIn: '15m' });
}

function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
  return !!ok;
}

(async () => {
  let apiServer = null;
  let staticServer = null;
  let browser = null;
  let context = null;
  const result = {
    TEST_EXECUTED: 'NO',
    SETTINGS_RENDER: 'NOT_COVERED',
    SAVE_FORM_ASSOCIATION: 'NOT_COVERED',
    SAVE_ACTION: 'NOT_COVERED',
    CONSOLE_ERRORS: 0,
    PAGE_ERRORS: 0,
    FAILED_REQUESTS: 'none',
    BLOCKER: 'none'
  };

  try {
    seedStores();
    const app = require(path.join(ROOT, 'backend', 'server.js'));
    apiServer = await listenApp(app);
    staticServer = await startStaticProxy(apiServer.address().port);
    const base = 'http://127.0.0.1:' + staticServer.address().port;

    browser = await chromium.launch();
    context = await browser.newContext();
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const failedApi = [];
    const packResponses = [];

    page.on('console', message => {
      if (message.type() !== 'error') return;
      consoleErrors.push(message.text());
    });
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('response', async response => {
      const url = response.url();
      if (url.indexOf('/api/v1/tenant/education/pack') !== -1) {
        let body = null;
        try { body = await response.json(); } catch (_) {}
        packResponses.push({
          status: response.status(), method: response.request().method(),
          success: body ? body.success === true : null
        });
      }
      if (response.status() >= 400 && url.indexOf('/api/v1/') !== -1) {
        failedApi.push({ status: response.status(), method: response.request().method(), url });
      }
    });

    await page.addInitScript(token => {
      try {
        localStorage.setItem('access_token', token);
        localStorage.setItem('omnistore_language', 'ar');
        localStorage.setItem('omnistore_platform_lang', 'ar');
      } catch (_) {}
    }, signOwnerToken());

    await page.goto(base + '/education/index.html#settings', { waitUntil: 'load', timeout: 30000 });
    const rendered = await page.waitForFunction(() => {
      const form = document.getElementById('edu-pack-form');
      const save = document.getElementById('edu-pack-save');
      return !!(form && save && save.form === form && document.querySelector('.edu-actions'));
    }, null, { timeout: 25000 }).then(() => true, () => false);

    const dom = await page.evaluate(() => {
      const form = document.getElementById('edu-pack-form');
      const save = document.getElementById('edu-pack-save');
      const actions = document.querySelector('.edu-actions');
      const field = name => {
        const input = form && form.querySelector('[data-pack-field="' + name + '"]');
        return input ? input.value : null;
      };
      return {
        formPresent: !!form,
        savePresent: !!save,
        saveFormId: save && save.form ? save.form.id : '',
        saveType: save ? save.type : '',
        saveFormAttribute: save ? save.getAttribute('form') : '',
        actionsPresent: !!actions,
        actionsButtons: actions ? Array.from(actions.querySelectorAll('button')).map(b => b.textContent.trim()) : [],
        values: {
          academicYear: field('academicYear'),
          timezone: field('timezone'),
          currency: field('currency')
        }
      };
    });

    const saveResponsePromise = page.waitForResponse(response => {
      const url = response.url();
      return response.request().method() === 'PUT' &&
        url.indexOf('/api/v1/tenant/education/pack') !== -1;
    }, { timeout: 20000 }).then(r => r.status(), () => 0);
    await page.click('#edu-pack-save');
    const saveResponse = await saveResponsePromise;
    await page.waitForTimeout(900);
    const status = await page.$eval('#edu-pack-status', el => ({
      text: String(el.textContent || '').trim(),
      className: el.className
    })).catch(() => ({ text: '', className: '' }));

    const settingsRender = rendered && dom.formPresent && dom.savePresent &&
      dom.values.academicYear === '2025' && dom.values.timezone === 'Africa/Cairo' &&
      dom.values.currency === 'EGP' && pageErrors.length === 0;
    const association = dom.saveFormId === 'edu-pack-form' &&
      dom.saveFormAttribute === 'edu-pack-form' && dom.saveType === 'submit' &&
      dom.actionsPresent && dom.actionsButtons.length >= 2;
    const saveAction = saveResponse === 200 &&
      packResponses.some(r => r.method === 'PUT' && r.status === 200 && r.success === true) &&
      !/is-error/.test(status.className) && status.text.length > 0;

    check('SETTINGS_RENDER: pack form rendered with the stored values and no page error', settingsRender,
      JSON.stringify({ dom, pageErrors }));
    check('SAVE_FORM_ASSOCIATION: save button resolves to the pack form', association,
      JSON.stringify({ form: dom.saveFormId, attr: dom.saveFormAttribute, type: dom.saveType, actions: dom.actionsButtons }));
    check('SAVE_ACTION: submit produced a real PUT /pack 200 and a saved status', saveAction,
      JSON.stringify({ saveResponse, status, packResponses }));
    check('NO_CONSOLE_OR_PAGE_ERRORS', consoleErrors.length === 0 && pageErrors.length === 0,
      JSON.stringify({ consoleErrors, pageErrors }));
    check('NO_FAILED_REQUESTS', failedApi.length === 0, JSON.stringify(failedApi));

    result.TEST_EXECUTED = 'YES';
    result.SETTINGS_RENDER = settingsRender ? 'PASS' : 'FAIL';
    result.SAVE_FORM_ASSOCIATION = association ? 'PASS' : 'FAIL';
    result.SAVE_ACTION = saveAction ? 'PASS' : 'FAIL';
    result.CONSOLE_ERRORS = consoleErrors.length;
    result.PAGE_ERRORS = pageErrors.length;
    result.FAILED_REQUESTS = failedApi.length ? JSON.stringify(failedApi.slice(0, 10)) : 'none';
  } catch (error) {
    result.BLOCKER = String(error && error.message ? error.message : error);
    console.log('ERROR | ' + result.BLOCKER);
  } finally {
    try { if (context) await context.close(); } catch (_) {}
    try { if (browser) await browser.close(); } catch (_) {}
    try { if (apiServer) await new Promise(resolve => apiServer.close(resolve)); } catch (_) {}
    try { if (staticServer) await new Promise(resolve => staticServer.close(resolve)); } catch (_) {}
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) {}
  }

  console.log('');
  console.log('EDUCATION_SETTINGS_E2E');
  console.log('TEST_EXECUTED=' + result.TEST_EXECUTED);
  console.log('SETTINGS_RENDER=' + result.SETTINGS_RENDER);
  console.log('SAVE_FORM_ASSOCIATION=' + result.SAVE_FORM_ASSOCIATION);
  console.log('SAVE_ACTION=' + result.SAVE_ACTION);
  console.log('CONSOLE_ERRORS=' + result.CONSOLE_ERRORS);
  console.log('PAGE_ERRORS=' + result.PAGE_ERRORS);
  console.log('FAILED_REQUESTS=' + result.FAILED_REQUESTS);
  console.log('BLOCKER=' + result.BLOCKER);

  const pass = result.SETTINGS_RENDER === 'PASS' &&
    result.SAVE_FORM_ASSOCIATION === 'PASS' &&
    result.SAVE_ACTION === 'PASS' &&
    result.CONSOLE_ERRORS === 0 &&
    result.PAGE_ERRORS === 0 &&
    result.FAILED_REQUESTS === 'none' &&
    result.BLOCKER === 'none';
  process.exit(pass ? 0 : 1);
})();
