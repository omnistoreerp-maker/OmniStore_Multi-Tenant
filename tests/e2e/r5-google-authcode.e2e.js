const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = __dirname;
const TEMP_ROOT = path.resolve(ROOT, '..', '..', '..');
const A = path.join(TEMP_ROOT, 'A');
const B = path.join(TEMP_ROOT, 'B');
const BACKEND = path.join(A, 'backend');

const PROXY_PORT = 19050;
const BACKEND_PORT = 3001;
const FRONTEND_PORT = 3002;
const ECHO_PORT = 3003;
const ORIGIN = 'http://127.0.0.1:' + PROXY_PORT;
const CLIENT_ID = 'e2e-client-id.apps.googleusercontent.com';
const CLIENT_SECRET = 'e2e-client-secret';
const MFA_SECRET = 'JBSWY3DPEHPK3PXP';
const GOOGLE_SUB = 'e2e-linked-sub';
const SYNTHETIC_IP = '198.51.100.77';
const SPOOFED_IP = '203.0.113.99';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail === undefined ? '' : String(detail).slice(0, 240) });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail !== undefined ? ' | ' + String(detail).slice(0, 240) : ''));
}
function assert(cond, message) { if (!cond) throw new Error(message); }
function listen(server, port) { return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); }
function close(server) { return new Promise((resolve) => { if (!server || !server.listening) return resolve(); server.close(resolve); }); }

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function removeTempDir(dir) {
  if (!dir) return;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; }
    catch (err) { if (attempt === 4) console.error('CLEANUP_FAILED', dir, err.message); else sleepSync(200); }
  }
}

async function waitForObservedMarker(getSeen, name, timeout) {
  const deadline = Date.now() + (timeout || 15000);
  while (Date.now() < deadline) {
    if (getSeen()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('redirect marker not observed: ' + name);
}

async function stopFrontend() {
  if (!frontend || frontend.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000);
    frontend.once('exit', () => { clearTimeout(timer); resolve(); });
    frontend.kill('SIGTERM');
  });
}

function mkdtemp(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), 'r5-' + tag + '-')); }
function writeStore(dir, name, payload) { fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(payload, null, 2), 'utf8'); }

let dataDir;
let challengeDir;
let profileDir;
let challengeDbPath;
let backend;
let echoServer;
let proxy;
let frontend;
let browser;
let context;
let challengeStore;
let challengeDbHandle;
const openedChallengeDbs = [];

function setNonceFromState(state) {
  const db = challengeStore.initialise(challengeDbPath).db;
  challengeDbHandle = db;
  try {
    const row = db.prepare('SELECT payload FROM oauth_login_transactions WHERE stateHash = ?')
      .get(challengeStore.hashChallenge(state));
    global.__nonce = row ? JSON.parse(row.payload).nonce : null;
  } finally {
    challengeStore.closeDb(db);
    challengeDbHandle = null;
  }
}

async function main() {
  dataDir = mkdtemp('data');
  challengeDir = mkdtemp('challenges');
  challengeDbPath = path.join(challengeDir, 'challenges.sqlite');

  process.env.NODE_ENV = 'test';
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  process.env.TOKEN_STORE_PATH = path.join(dataDir, 'tokenStore.sqlite');
  process.env.CHALLENGE_DB_PATH = challengeDbPath;
  process.env.JWT_SECRET = 'r5-local-jwt-secret';
  process.env.SESSION_SECRET = 'r5-local-session-secret';
  process.env.OAUTH_ENABLED = 'true';
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  process.env.GOOGLE_CLIENT_SECRET = CLIENT_SECRET;
  process.env.GOOGLE_CALLBACK_URL = ORIGIN + '/auth/google/callback';
  process.env.GOOGLE_AUTHCODE_CALLBACK_URL = ORIGIN + '/auth/google-login-code/callback';
  process.env.RATE_LIMIT_MAX = '100000';
  process.env.CORS_ORIGINS = '';
  process.env.LOG_FILE = '';
  process.env.ENABLE_TENANT_ROLES = 'true';
  process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';

  const bcrypt = require(path.join(BACKEND, 'node_modules', 'bcryptjs'));
  const speakeasy = require(path.join(BACKEND, 'node_modules', 'speakeasy'));

  writeStore(dataDir, 'users', {
    users: [{
      id: 'u-e2e', username: 'e2e-user', password: bcrypt.hashSync('E2e#12345', 10),
      fullName: 'E2E User', role: 'Owner', oauth: { google: GOOGLE_SUB },
      status: 'active', tokenVersion: 0, mfaEnabled: true, mfaSecret: MFA_SECRET,
      tenantIds: ['t1', 't2'], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }]
  });
  writeStore(dataDir, 'companies', {
    companies: [
      { id: 't1', name: 'Tenant One', active: true, status: 'active' },
      { id: 't2', name: 'Tenant Two', active: true, status: 'active' }
    ]
  });

  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).includes('oauth2.googleapis.com')) {
      return { ok: true, status: 200, json: async () => ({ id_token: 'r5-synthetic-id-token' }) };
    }
    if (realFetch) return realFetch(url, opts);
    throw new Error('unexpected fetch ' + url);
  };

  const gal = require(path.join(BACKEND, 'node_modules', 'google-auth-library'));
  gal.OAuth2Client.prototype.verifyIdToken = async function () {
    return {
      getPayload: () => ({
        iss: 'https://accounts.google.com', sub: GOOGLE_SUB, aud: CLIENT_ID,
        email: 'e2e@example.com', email_verified: true, nonce: global.__nonce || null,
        exp: Math.floor(Date.now() / 1000) + 3600
      })
    };
  };

  challengeStore = require(path.join(BACKEND, 'utils', 'challengeStore.sqlite'));
  const originalInitialise = challengeStore.initialise;
  challengeStore.initialise = function trackedInitialise(dbPath) {
    const result = originalInitialise(dbPath);
    openedChallengeDbs.push(result.db);
    return result;
  };
  const app = require(path.join(BACKEND, 'server.js'));
  echoServer = http.createServer((req, res) => {
    const xff = req.headers['x-forwarded-for'] || '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { xff: xff || null, ip: xff.split(',')[0].trim(), peer: req.socket.remoteAddress } }));
  });
  await listen(echoServer, ECHO_PORT);
  backend = http.createServer(app);
  await listen(backend, BACKEND_PORT);

  frontend = spawn(process.execPath, [path.join(B, '.output', 'server', 'index.mjs')], {
    cwd: B,
    env: { ...process.env, NITRO_PORT: String(FRONTEND_PORT), NITRO_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  frontend.stdout.on('data', () => {});
  frontend.stderr.on('data', (chunk) => process.stderr.write('[frontend] ' + chunk));
  await waitForPort(FRONTEND_PORT);

  proxy = http.createServer((req, res) => {
    const isEcho = req.url === '/__test/echo' || req.url.startsWith('/__test/echo?');
    const isBackend = /^\/(auth|api)(\/|$)/.test(req.url);
    const port = isEcho ? ECHO_PORT : (isBackend ? BACKEND_PORT : FRONTEND_PORT);
    const headers = Object.assign({}, req.headers, { host: '127.0.0.1:' + port });
    delete headers['x-forwarded-for'];
    headers['x-forwarded-for'] = SYNTHETIC_IP;
    const upstream = http.request({ hostname: '127.0.0.1', port, path: req.url, method: req.method, headers }, (up) => {
      const outHeaders = Object.assign({}, up.headers);
      if (up.statusCode === 302 && typeof outHeaders.location === 'string' && outHeaders.location.startsWith('https://accounts.google.com/')) {
        const state = new URL(outHeaders.location).searchParams.get('state');
        setNonceFromState(state);
        outHeaders.location = ORIGIN + '/auth/google-login-code/callback?code=r5-synthetic-code&state=' + encodeURIComponent(state);
      }
      res.writeHead(up.statusCode || 502, outHeaders);
      up.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end('proxy error'); });
    req.pipe(upstream);
  });
  await listen(proxy, PROXY_PORT);

  profileDir = mkdtemp('pwprofile');
  context = await chromium.launchPersistentContext(profileDir, { channel: 'msedge' });
  const page = context.pages()[0] || await context.newPage();
  const apiResponses = [];
  page.on('response', (res) => {
    const u = res.url();
    if (u.includes('/api/') || u.includes('/auth/')) apiResponses.push({ url: u, status: res.status(), setCookie: res.headers()['set-cookie'] || [] });
  });

  let markerSeen = false;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      console.log('NAV ' + frame.url());
      if (frame.url().includes('tenant_selection_required=1')) markerSeen = true;
    }
  });
  await page.route('**/auth/google-login-code**', async (route) => {
    console.log('AUTH_ROUTE ' + route.request().url());
    await route.continue();
  });
  await page.route('https://accounts.google.com/**', async (route) => {
    try {
      const googleUrl = new URL(route.request().url());
      const state = googleUrl.searchParams.get('state');
      console.log('GOOGLE_ROUTE state=' + state);
      setNonceFromState(state);
      await route.fulfill({
        status: 302,
        headers: { location: ORIGIN + '/auth/google-login-code/callback?code=r5-synthetic-code&state=' + encodeURIComponent(state) },
        body: ''
      });
    } catch (err) {
      console.error('GOOGLE_ROUTE_ERROR', err && err.message);
      await route.continue();
    }
  });

  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  check('Repo B login page loads through same-origin proxy', (await page.locator('#platformAuthGoogle').count()) === 1);

  await page.locator('#platformLoginBtn').click();
  await page.evaluate(() => document.getElementById('platformAuthGoogle').click());
  await waitForObservedMarker(() => markerSeen, 'tenant_selection_required=1');
  await page.waitForTimeout(500);
  check('AuthCode start redirected through synthetic Google callback', markerSeen, page.url());

  const forbidden = await page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/google-login-code/select-tenant', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: 't3' })
    });
    return res.status;
  });
  check('Unauthorized tenant rejected before session issuance', forbidden === 403, forbidden);

  await page.locator('#platformLoginBtn').click();
  const tenantButton = page.getByRole('button', { name: 'Tenant One' });
  await tenantButton.waitFor({ timeout: 15000 });
  await tenantButton.click();
  const mfaInput = page.getByLabel('Verification code');
  await mfaInput.waitFor({ timeout: 15000 });
  check('Tenant selection followed by MFA challenge', true);

  const totp = speakeasy.totp({ secret: MFA_SECRET, encoding: 'base32' });
  await mfaInput.fill(totp);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await page.waitForTimeout(2000);

  const me = await page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'same-origin' });
    return { status: res.status, body: await res.json().catch(() => null) };
  });
  check('Authenticated /me hydration succeeds', me.status === 200 && me.body && me.body.success === true, me.status);

  const refresh = await page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/refresh', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  });
  check('Session refresh succeeds', refresh.status === 200 && refresh.body && refresh.body.success === true, refresh.status);

  const storage = await page.evaluate(() => ({
    local: Object.keys(localStorage), session: Object.keys(sessionStorage),
    docCookie: document.cookie
  }));
  const suspiciousStorage = [].concat(storage.local, storage.session).filter((key) => /token|secret|auth|session|access|refresh|id[_-]?token/i.test(key));
  check('No tokens in browser storage', suspiciousStorage.length === 0, JSON.stringify(storage));
  check('Session cookie not readable by JavaScript', !storage.docCookie.includes('access_token'), storage.docCookie);

  const cookies = await context.cookies(ORIGIN);
  const access = cookies.find((c) => c.name === 'access_token');
  check('Session cookie is HttpOnly and SameSite=Lax', Boolean(access && access.httpOnly && access.sameSite === 'Lax'), JSON.stringify(access || {}));
  check('Session cookie is host-only', Boolean(access && access.domain === '127.0.0.1' && !access.domain.startsWith('.')), JSON.stringify(access ? { domain: access.domain } : {}));

  const frontendSetCookies = apiResponses.filter((r) => r.url.startsWith(ORIGIN + '/') && !r.url.includes('/api/') && !r.url.includes('/auth/') && r.setCookie.length > 0);
  check('Repo B does not issue session cookies', frontendSetCookies.length === 0, JSON.stringify(frontendSetCookies).slice(0, 200));

  const logout = await page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/logout', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    return res.status;
  });
  check('Logout succeeds', logout === 200 || logout === 204, logout);

  const afterLogout = await page.evaluate(async () => {
    const res = await fetch('/api/v1/permissions', { credentials: 'same-origin' });
    return res.status;
  });
  check('Unauthenticated after logout', afterLogout === 401, afterLogout);

  const echo = await page.evaluate(async () => {
    const res = await fetch('/__test/echo?spoof=' + encodeURIComponent('203.0.113.99'), {
      credentials: 'same-origin', headers: { 'X-Forwarded-For': '203.0.113.99' }
    });
    return res.json();
  });
  check('Proxy header provenance test: spoofed XFF discarded', echo && echo.data && echo.data.ip === SYNTHETIC_IP && echo.data.xff === SYNTHETIC_IP, JSON.stringify(echo));

  await context.close();
  context = null;
}

async function waitForPort(port) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await new Promise((resolve, reject) => {
        const req = http.get({ hostname: '127.0.0.1', port, path: '/' }, (r) => { r.resume(); resolve(r.statusCode); });
        req.on('error', reject);
        req.setTimeout(1000, () => reject(new Error('timeout')));
      });
      if (res) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('port ' + port + ' did not open');
}

(async () => {
  try {
    await main();
  } catch (err) {
    console.error('E2E_ERROR', err && err.stack ? err.stack : err);
    check('E2E harness completed without fatal error', false, err && err.message);
  } finally {
    if (context) await context.close().catch(() => {});
    await close(proxy);
    await close(echoServer);
    await close(backend);
    await stopFrontend();
    for (const db of openedChallengeDbs) { try { challengeStore.closeDb(db); } catch (_) {} }
    try { if (challengeDbHandle) challengeStore.closeDb(challengeDbHandle); } catch (_) {}
    try { require(path.join(BACKEND, 'utils', 'tokenStore.sqlite')).closeDb(); } catch (_) {}
    for (const dir of [profileDir, challengeDir, dataDir]) removeTempDir(dir);
    const failed = results.filter((r) => !r.ok);
    console.log('\nSUMMARY total=' + results.length + ' passed=' + (results.length - failed.length) + ' failed=' + failed.length);
    process.exit(failed.length ? 1 : 0);
  }
})();
