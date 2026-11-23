// Google Authorization Code + PKCE (regular user) — direct integration tests.
//
// Only the EXTERNAL Google token endpoint and the trusted ID-token verifier
// are mocked. The Express routes, server-side transaction store, state/PKCE
// binding, MFA, tenant selection, session issuance and audit all run for real.
// No real Google account or network call is made.
jest.mock('google-auth-library', () => {
  const mockVerifyIdToken = jest.fn();
  class OAuth2Client {
    verifyIdToken(args) { return mockVerifyIdToken(args); }
  }
  return { OAuth2Client, __mockVerifyIdToken: mockVerifyIdToken };
});
jest.mock('../utils/googleIdentity', () => ({
  verifyIdToken: jest.fn(async (token) => {
    if (typeof global.__linkVerifier !== 'function') return { error: 'Invalid Google token' };
    return global.__linkVerifier(token);
  })
}));

const request = require('supertest');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const speakeasy = require('speakeasy');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { createUser, login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');
const challengeStore = require('../utils/challengeStore.sqlite');

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const CLIENT_SECRET = 'test-client-secret';
const FAKE_ID_TOKEN = 'google-id-token';
const MFA_SECRET = 'JBSWY3DPEHPK3PXP';
const OAUTH_ENV = {
  RATE_LIMIT_MAX: '100000',
  OAUTH_ENABLED: 'true',
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
  GOOGLE_CALLBACK_URL: 'http://127.0.0.1/auth/google/callback',
  GOOGLE_AUTHCODE_CALLBACK_URL: 'http://127.0.0.1/auth/google-login-code/callback'
};
const REAL_FETCH = global.fetch;

const tempDirs = [];
registerCleanup(() => [], () => tempDirs);

function gl() { return require('google-auth-library'); }
function cookieHeader(res) {
  return (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
}
function cookieValue(res, name) {
  const hit = (res.headers['set-cookie'] || []).find(c => c.startsWith(name + '='));
  return hit ? hit.split(';')[0].slice(name.length + 1) : null;
}
function pendingPair(res) {
  const hit = (res.headers['set-cookie'] || []).find(c => c.startsWith('glogin_pending='));
  return hit ? hit.split(';')[0] : null;
}
function handoffCookies(initiation, callbackRes) {
  const binding = initiation.cookies || cookieHeader(initiation);
  return binding + '; ' + pendingPair(callbackRes);
}
function totpNow() { return speakeasy.totp({ secret: MFA_SECRET, encoding: 'base32' }); }
function sha256b64url(v) { return crypto.createHash('sha256').update(v).digest('base64url'); }

let dataDir;
let challengeDbPath;
let app;
let expectedNonce;
let verifyOverrides;
let tokenEndpointReject = false;

afterAll(() => { global.fetch = REAL_FETCH; delete global.__linkVerifier; });

beforeEach(async () => {
  dataDir = makeTempDataDir('google-authcode');
  tempDirs.push(dataDir);
  seed(dataDir, 'users', { users: [] });
  seed(dataDir, 'companies', { companies: [] });
  verifyOverrides = {};
  tokenEndpointReject = false;
  expectedNonce = undefined;
  challengeDbPath = path.join(makeTempDataDir('glogin-challenges'), 'challenges.sqlite');
  tempDirs.push(path.dirname(challengeDbPath));
  process.env.CHALLENGE_DB_PATH = challengeDbPath;
  const started = startServer(dataDir, OAUTH_ENV);
  app = started.app;
  gl().__mockVerifyIdToken.mockReset();

  global.fetch = jest.fn(async (url, opts) => {
    if (String(url).includes('oauth2.googleapis.com')) {
      const body = new URLSearchParams(opts.body);
      if (tokenEndpointReject) {
        return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) };
      }
      if (!body.get('code_verifier')) {
        return { ok: false, status: 400, json: async () => ({ error: 'missing_verifier' }) };
      }
      return { ok: true, status: 200, json: async () => ({ id_token: FAKE_ID_TOKEN }) };
    }
    if (REAL_FETCH) return REAL_FETCH(url, opts);
    throw new Error('unexpected fetch: ' + url);
  });
});

function seedUsers(users) { seed(dataDir, 'users', { users }); }
function seedCompanies(companies) { seed(dataDir, 'companies', { companies }); }
function usersOnDisk() { const d = readStore(dataDir, 'users'); return (d && d.users) || []; }

function mockVerify(over = {}) {
  gl().__mockVerifyIdToken.mockImplementation(async () => ({
    getPayload: () => ({
      iss: 'https://accounts.google.com',
      sub: 'google-sub-1',
      aud: CLIENT_ID,
      email: 'user@example.com',
      email_verified: true,
      nonce: expectedNonce,
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...verifyOverrides,
      ...over
    })
  }));
}

function openTestDb() { return challengeStore.initialise(challengeDbPath).db; }
function transactionPayload(state) {
  const db = openTestDb();
  try {
    const row = db.prepare('SELECT payload FROM oauth_login_transactions WHERE stateHash = ?')
      .get(challengeStore.hashChallenge(state));
    return row ? JSON.parse(row.payload) : null;
  } finally { challengeStore.closeDb(db); }
}
function setTransactionExpiry(state, expiresAt) {
  const db = openTestDb();
  try {
    db.prepare('UPDATE oauth_login_transactions SET expiresAt = ? WHERE stateHash = ?')
      .run(expiresAt, challengeStore.hashChallenge(state));
  } finally { challengeStore.closeDb(db); }
}

async function initiate(returnTo = '/') {
  const res = await request(app).get('/auth/google-login-code?returnTo=' + encodeURIComponent(returnTo));
  expect(res.status).toBe(302);
  const url = new URL(res.headers.location);
  const state = url.searchParams.get('state');
  expect(state).toBeTruthy();
  const payload = transactionPayload(state);
  expect(payload).toBeTruthy();
  expect(payload.mode).toBe('login');
  expectedNonce = payload.nonce;
  return { res, state, url, payload, cookies: cookieHeader(res), binding: cookieValue(res, 'glogin_bs') };
}

async function callback(state, cookies, code = 'auth-code') {
  let r = request(app).get('/auth/google-login-code/callback?code=' + encodeURIComponent(code) + '&state=' + encodeURIComponent(state));
  if (cookies) r = r.set('Cookie', cookies);
  return r;
}

function expectDenied(res, code) {
  expect(res.status).toBe(302);
  expect(res.headers.location).toContain('gerr=' + code);
  expect(cookieValue(res, 'access_token')).toBe(null);
  expect(cookieValue(res, 'refresh_token')).toBe(null);
}

function linkedUser(over = {}) {
  return {
    id: 'u-1', username: 'alice', password: 'x', fullName: 'Alice', role: 'Owner',
    oauth: { google: 'google-sub-1' }, status: 'active', tokenVersion: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...over
  };
}

// ---------------------------------------------------------------------------
describe('_safeReturnTo — same-origin relative paths only', () => {
  test.each([
    ['/dashboard', '/dashboard'],
    ['/dashboard?tab=1&x=2', '/dashboard?tab=1&x=2'],
    ['/a/b/c#section', '/a/b/c#section'],
    ['/', '/']
  ])('accepts valid same-origin path %s', async (input, expected) => {
    const a = await initiate(input);
    expect(a.payload.returnTo).toBe(expected);
  });

  test.each([
    ['//evil.example/path'],
    ['/\\evil.example'],
    ['/a\\b'],
    ['https://evil.example'],
    ['http://evil.example'],
    ['javascript:alert(1)'],
    ['/a\u0000b'],
    ['/a\nb'],
    ['/a\u007fb'],
    [''],
    ['not-a-path']
  ])('rejects unsafe return URL %p and falls back to /', async (input) => {
    const a = await initiate(input);
    expect(a.payload.returnTo).toBe('/');
  });
});

describe('1-2. Initiation + callback happy path and missing-dependency regression', () => {
  test('initiation emits PKCE S256, nonce, state, and a httpOnly binding cookie', async () => {
    const a = await initiate('/dashboard');
    expect(a.url.searchParams.get('response_type')).toBe('code');
    expect(a.url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(a.url.searchParams.get('code_challenge')).toBe(sha256b64url(a.payload.verifier));
    expect(a.url.searchParams.get('nonce')).toBe(a.payload.nonce);
    expect(a.binding).toBeTruthy();
    const set = a.res.headers['set-cookie'] || [];
    const binding = set.find(c => c.startsWith('glogin_bs='));
    expect(binding).toContain('HttpOnly');
    expect(binding).toContain('SameSite=Lax');
    // PKCE verifier is NOT in the client-visible state/URL.
    expect(JSON.stringify(a.payload)).not.toContain('redirect_uri');
    expect(a.url.searchParams.get('code_verifier')).toBe(null);
  });

  test('successful callback exchanges code and issues auth cookies (no ReferenceError)', async () => {
    seedUsers([linkedUser()]);
    const a = await initiate('/');
    mockVerify();
    const res = await callback(a.state, a.cookies);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('gsignin=1');
    expect(cookieValue(res, 'access_token')).toBeTruthy();
    expect(cookieValue(res, 'refresh_token')).toBeTruthy();
    // The PKCE verifier actually used at exchange equals the stored verifier.
    const body = global.fetch.mock.calls.find(c => String(c[0]).includes('oauth2.googleapis.com'))[1].body;
    expect(new URLSearchParams(body).get('code_verifier')).toBe(a.payload.verifier);
  });
});

describe('successful callback redirect preserves query string and fragment', () => {
  test.each([
    ['/', '/?gsignin=1'],
    ['/dashboard', '/dashboard?gsignin=1'],
    ['/dashboard?tab=users', '/dashboard?tab=users&gsignin=1'],
    ['/dashboard#settings', '/dashboard?gsignin=1#settings'],
    ['/dashboard?tab=users#settings', '/dashboard?tab=users&gsignin=1#settings']
  ])('returnTo %s redirects to %s', async (returnTo, expected) => {
    seedUsers([linkedUser()]);
    const a = await initiate(returnTo);
    mockVerify();
    const res = await callback(a.state, a.cookies);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(expected);
  });
});

describe('3. Invalid, expired, reused, and cross-browser state', () => {
  test('tampered/unknown state is rejected', async () => {
    seedUsers([linkedUser()]);
    mockVerify();
    expectDenied(await callback('not-a-real-state', 'glogin_bs=whatever'), 'state_invalid');
  });

  test('replayed state is rejected', async () => {
    seedUsers([linkedUser()]);
    const a = await initiate();
    mockVerify();
    const first = await callback(a.state, a.cookies);
    expect(first.status).toBe(302);
    expectDenied(await callback(a.state, a.cookies), 'state_invalid');
  });

  test('expired transaction is rejected', async () => {
    seedUsers([linkedUser()]);
    const a = await initiate();
    setTransactionExpiry(a.state, Date.now() - 1000);
    mockVerify();
    expectDenied(await callback(a.state, a.cookies), 'state_invalid');
  });

  test('callback from another browser (no matching binding cookie) is rejected', async () => {
    seedUsers([linkedUser()]);
    const a = await initiate();
    mockVerify();
    const otherBrowser = 'glogin_bs=' + crypto.randomBytes(32).toString('base64url');
    expectDenied(await callback(a.state, otherBrowser), 'browser_binding_mismatch');
    // Legitimate browser can still complete — mismatch did not consume it.
    const ok = await callback(a.state, a.cookies);
    expect(ok.headers.location).toContain('gsignin=1');
  });
});

describe('4-5. PKCE verifier and ID token validation', () => {
  test('PKCE verifier mismatch at Google token endpoint yields no session', async () => {
    seedUsers([linkedUser()]);
    const a = await initiate();
    mockVerify();
    tokenEndpointReject = true;
    expectDenied(await callback(a.state, a.cookies), 'exchange_failed');
  });

  test('invalid signature (verifier throws) rejected', async () => {
    seedUsers([linkedUser()]);
    const a = await initiate();
    gl().__mockVerifyIdToken.mockImplementation(async () => { throw new Error('bad signature'); });
    expectDenied(await callback(a.state, a.cookies), 'invalid_idtoken');
  });

  test.each([
    ['issuer', { iss: 'https://evil.example' }, 'invalid_idtoken'],
    ['audience', { aud: 'wrong-audience' }, 'invalid_idtoken'],
    ['expiry', { exp: Math.floor(Date.now() / 1000) - 10 }, 'invalid_idtoken'],
    ['nonce', { nonce: 'wrong-nonce' }, 'nonce_mismatch']
  ])('ID token %s mismatch rejected', async (_label, over, gerr) => {
    seedUsers([linkedUser()]);
    const a = await initiate();
    mockVerify(over);
    expectDenied(await callback(a.state, a.cookies), gerr);
  });
});

describe('6-8. Identity policy: unknown/sub-only/linked/disabled', () => {
  test('unknown Google sub rejected without creating an account', async () => {
    seedUsers([]);
    const a = await initiate();
    mockVerify({ sub: 'unknown-sub' });
    expectDenied(await callback(a.state, a.cookies), 'unlinked_identity');
    expect(usersOnDisk().length).toBe(0);
  });

  test('email match with different sub cannot authenticate', async () => {
    seedUsers([linkedUser({ oauth: { google: 'the-real-sub' } })]);
    const a = await initiate();
    mockVerify({ sub: 'attacker-sub', email: 'user@example.com' });
    expectDenied(await callback(a.state, a.cookies), 'unlinked_identity');
    expect(usersOnDisk()).toHaveLength(1);
  });

  test('existing linked account accepted', async () => {
    seedUsers([linkedUser()]);
    const a = await initiate();
    mockVerify();
    const res = await callback(a.state, a.cookies);
    expect(res.headers.location).toContain('gsignin=1');
  });

  test('disabled account rejected', async () => {
    seedUsers([linkedUser({ status: 'disabled' })]);
    const a = await initiate();
    mockVerify();
    expectDenied(await callback(a.state, a.cookies), 'account_disabled');
  });
});

describe('9-10. MFA: required, success, invalid, replay, bypass, tenant-then-MFA', () => {
  test('MFA required then successful', async () => {
    seedUsers([linkedUser({ mfaEnabled: true, mfaSecret: MFA_SECRET, tenantIds: ['t1'] })]);
    seedCompanies([{ id: 't1', name: 'T1', active: true, status: 'active' }]);
    const a = await initiate();
    mockVerify();
    const cb = await callback(a.state, a.cookies);
    expect(cb.headers.location).toContain('mfa_required=1');
    expect(cb.headers.location).not.toContain('tempToken');
    expect(cb.headers.location).not.toMatch(/token|code=/i);
    const tempToken = cookieValue(cb, 'glogin_pending');
    expect(tempToken).toBeTruthy();
    const res = await request(app).post('/api/v1/auth/google-login-code/mfa-verify')
      .set('Cookie', handoffCookies(a, cb)).send({ mfaToken: totpNow() });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
  });

  test('invalid MFA code rejected, replay of burned challenge rejected', async () => {
    seedUsers([linkedUser({ mfaEnabled: true, mfaSecret: MFA_SECRET, tenantIds: ['t1'] })]);
    seedCompanies([{ id: 't1', name: 'T1', active: true, status: 'active' }]);
    const a = await initiate();
    mockVerify();
    const cb = await callback(a.state, a.cookies);
    const cookies = handoffCookies(a, cb);
    expect(cookieValue(cb, 'glogin_pending')).toBeTruthy();

    const bad = await request(app).post('/api/v1/auth/google-login-code/mfa-verify')
      .set('Cookie', cookies).send({ mfaToken: '000000' });
    expect(bad.status).toBe(401);

    const good = await request(app).post('/api/v1/auth/google-login-code/mfa-verify')
      .set('Cookie', cookies).send({ mfaToken: totpNow() });
    expect(good.status).toBe(401); // burned by the invalid attempt
  });

  test('MFA challenge cannot be used at tenant-selection endpoint (bypass attempt)', async () => {
    seedUsers([linkedUser({ mfaEnabled: true, mfaSecret: MFA_SECRET, tenantIds: ['t1'] })]);
    seedCompanies([{ id: 't1', name: 'T1', active: true, status: 'active' }]);
    const a = await initiate();
    mockVerify();
    const cb = await callback(a.state, a.cookies);
    const bypass = await request(app).post('/api/v1/auth/google-login-code/select-tenant')
      .set('Cookie', handoffCookies(a, cb)).send({ tenantId: 't1' });
    expect(bypass.status).toBe(401);
  });

  test('MFA challenge from another browser is rejected', async () => {
    seedUsers([linkedUser({ mfaEnabled: true, mfaSecret: MFA_SECRET, tenantIds: ['t1'] })]);
    seedCompanies([{ id: 't1', name: 'T1', active: true, status: 'active' }]);
    const a = await initiate();
    mockVerify();
    const cb = await callback(a.state, a.cookies);
    const other = 'glogin_bs=' + crypto.randomBytes(32).toString('base64url');
    const res = await request(app).post('/api/v1/auth/google-login-code/mfa-verify')
      .set('Cookie', other + '; ' + pendingPair(cb)).send({ mfaToken: totpNow() });
    expect(res.status).toBe(401);
  });
});

describe('11-12. Tenant selection restricted to existing memberships', () => {
  function multiUser() {
    return linkedUser({ id: 'u-multi', username: 'multi', tenantIds: ['t1', 't2'] });
  }
  async function reachSelection() {
    seedUsers([multiUser()]);
    seedCompanies([
      { id: 't1', name: 'T1', active: true, status: 'active' },
      { id: 't2', name: 'T2', active: true, status: 'active' }
    ]);
    const a = await initiate();
    mockVerify({ sub: 'google-sub-1' });
    const cb = await callback(a.state, a.cookies);
    expect(cb.headers.location).toContain('tenant_selection_required=1');
    expect(cb.headers.location).not.toContain('tempToken');
    expect(cookieValue(cb, 'glogin_pending')).toBeTruthy();
    return { a, cb, cookies: handoffCookies(a, cb) };
  }

  test('allowed membership tenant issues tokens via cookie handoff', async () => {
    const { cookies } = await reachSelection();
    const res = await request(app).post('/api/v1/auth/google-login-code/select-tenant')
      .set('Cookie', cookies).send({ tenantId: 't1' });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
  });

  test('forged/unauthorized tenant rejected', async () => {
    const { cookies } = await reachSelection();
    const res = await request(app).post('/api/v1/auth/google-login-code/select-tenant')
      .set('Cookie', cookies).send({ tenantId: 't3-not-a-member' });
    expect(res.status).toBe(403);
  });

  test('selection challenge from another browser rejected', async () => {
    const { cb } = await reachSelection();
    const other = 'glogin_bs=' + crypto.randomBytes(32).toString('base64url');
    const res = await request(app).post('/api/v1/auth/google-login-code/select-tenant')
      .set('Cookie', other + '; ' + pendingPair(cb)).send({ tenantId: 't1' });
    expect(res.status).toBe(401);
  });
});

describe('Secure challenge handoff (no tokens in URLs)', () => {
  test('tenant selection then MFA completes entirely through httpOnly cookies', async () => {
    seedUsers([linkedUser({
      id: 'u-chain', username: 'chain', mfaEnabled: true, mfaSecret: MFA_SECRET,
      tenantIds: ['t1', 't2']
    })]);
    seedCompanies([
      { id: 't1', name: 'T1', active: true, status: 'active' },
      { id: 't2', name: 'T2', active: true, status: 'active' }
    ]);
    const a = await initiate('/home?x=1');
    mockVerify({ sub: 'google-sub-1' });
    const cb = await callback(a.state, a.cookies);
    expect(cb.headers.location).toContain('tenant_selection_required=1');
    expect(cb.headers.location).not.toContain('tempToken');
    const firstPending = pendingPair(cb);
    expect(firstPending).toBeTruthy();

    const selected = await request(app).post('/api/v1/auth/google-login-code/select-tenant')
      .set('Cookie', a.cookies + '; ' + firstPending).send({ tenantId: 't1' });
    expect(selected.status).toBe(200);
    expect(selected.body.data.mfaRequired).toBe(true);
    expect(selected.body.data.tempToken).toBeUndefined();
    const secondPending = pendingPair(selected);
    expect(secondPending).toBeTruthy();
    expect(secondPending).not.toBe(firstPending);

    const verified = await request(app).post('/api/v1/auth/google-login-code/mfa-verify')
      .set('Cookie', a.cookies + '; ' + secondPending).send({ mfaToken: totpNow() });
    expect(verified.status).toBe(200);
    expect(verified.body.data.accessToken).toBeTruthy();
  });

  test('pending challenge cookie is httpOnly, SameSite=Lax and cleared after success', async () => {
    seedUsers([linkedUser({ mfaEnabled: true, mfaSecret: MFA_SECRET, tenantIds: ['t1'] })]);
    seedCompanies([{ id: 't1', name: 'T1', active: true, status: 'active' }]);
    const a = await initiate();
    mockVerify();
    const cb = await callback(a.state, a.cookies);
    const set = cb.headers['set-cookie'] || [];
    const pending = set.find(c => c.startsWith('glogin_pending='));
    expect(pending).toContain('HttpOnly');
    expect(pending).toContain('SameSite=Lax');
    const res = await request(app).post('/api/v1/auth/google-login-code/mfa-verify')
      .set('Cookie', handoffCookies(a, cb)).send({ mfaToken: totpNow() });
    expect(res.status).toBe(200);
    const cleared = (res.headers['set-cookie'] || []).find(c => c.startsWith('glogin_pen'));
    expect(cleared).toBeTruthy();
    expect(cleared).toMatch(/glogin_pending=;/);
  });
});

describe('13. Session issuance, refresh rotation, and invalidation', () => {
  test('issued access token works; tokenVersion bump invalidates it; refresh rotates', async () => {
    seedUsers([linkedUser()]);
    const a = await initiate();
    mockVerify();
    const cb = await callback(a.state, a.cookies);
    const access = cookieValue(cb, 'access_token');
    const refresh = cookieValue(cb, 'refresh_token');
    expect(access).toBeTruthy();
    expect(refresh).toBeTruthy();

    const me = await request(app).get('/api/v1/auth/me').set(authHeader(access));
    expect(me.status).toBe(200);

    const refreshed = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: refresh });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toBeTruthy();
    const replay = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: refresh });
    expect(replay.status).toBe(401);

    const users = require('../services/users.service');
    users.bumpTokenVersion('u-1');
    const dead = await request(app).get('/api/v1/permissions').set(authHeader(access));
    expect(dead.status).toBe(401);
  });
});

describe('14-16. Authentication boundaries and regressions', () => {
  test('password login still works', async () => {
    const bcrypt = require('bcryptjs');
    seedUsers([{ ...linkedUser(), password: bcrypt.hashSync('Pass#12345', 10) }]);
    const res = await request(app).post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'Pass#12345' });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
  });

  test('existing Google linking endpoint remains functional', async () => {
    const bcrypt = require('bcryptjs');
    seedUsers([{ ...linkedUser(), oauth: undefined, password: bcrypt.hashSync('Pass#12345', 10) }]);
    const logged = await login(app, 'alice', 'Pass#12345');
    global.__linkVerifier = async () => ({ sub: 'brand-new-sub', email: 'alice@example.com' });
    const res = await request(app).post('/api/v1/auth/link/google')
      .set(authHeader(logged.accessToken)).send({ idToken: 'tok-link' });
    expect([200, 400, 409]).toContain(res.status);
    expect(res.status).not.toBe(500);
  });

  test('Master Google OAuth surface remains isolated and mounted', async () => {
    const res = await request(app).get('/auth/google/master');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com');
    expect(decodeURIComponent(res.headers.location)).toContain('/auth/google/master/callback');
  });

  test('legacy Passport Google policy rejects unknown subjects without creating accounts', async () => {
    const oauthService = require('../services/oauth.service');
    seedUsers([]);
    const result = oauthService.findByProvider('google', 'never-linked-sub');
    expect(result.error).toBeTruthy();
    expect(result.user).toBeUndefined();
    expect(usersOnDisk()).toHaveLength(0);
    const passportSrc = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'passport.js'), 'utf8');
    expect(passportSrc).not.toMatch(/findOrCreateUser\([^)]*'google'/);
  });
});

describe('Google callback URL configuration isolation', () => {
  function configEnv(overrides = {}) {
    return {
      ...OAUTH_ENV,
      BASE_URL: 'http://127.0.0.1',
      GOOGLE_CALLBACK_URL: 'http://127.0.0.1/auth/google/callback',
      GOOGLE_AUTHCODE_CALLBACK_URL: 'http://127.0.0.1/auth/google-login-code/callback',
      GOOGLE_MASTER_CALLBACK_URL: 'http://127.0.0.1/auth/google/master/callback',
      OAUTH_MASTER_EMAIL: 'master@example.com',
      ...overrides
    };
  }

  function redirectUriFor(app, path) {
    return request(app).get(path).redirects(0).then((res) => {
      expect(res.status).toBe(302);
      return new URL(res.headers.location).searchParams.get('redirect_uri');
    });
  }

  function isolatedApp(overrides) {
    const dir = makeTempDataDir('callback-config');
    tempDirs.push(dir);
    return startServer(dir, configEnv(overrides)).app;
  }

  test('each Google flow sends its own redirect_uri to Google', async () => {
    const app = isolatedApp();
    expect(await redirectUriFor(app, '/auth/google-login-code')).toBe('http://127.0.0.1/auth/google-login-code/callback');
    expect(await redirectUriFor(app, '/auth/google')).toBe('http://127.0.0.1/auth/google/callback');
    expect(await redirectUriFor(app, '/auth/google/master')).toBe('http://127.0.0.1/auth/google/master/callback');
  });

  test('changing only GOOGLE_AUTHCODE_CALLBACK_URL leaves legacy and Master untouched', async () => {
    const app = isolatedApp({ GOOGLE_AUTHCODE_CALLBACK_URL: 'http://127.0.0.1/custom/authcode/cb' });
    expect(await redirectUriFor(app, '/auth/google-login-code')).toBe('http://127.0.0.1/custom/authcode/cb');
    expect(await redirectUriFor(app, '/auth/google')).toBe('http://127.0.0.1/auth/google/callback');
    expect(await redirectUriFor(app, '/auth/google/master')).toBe('http://127.0.0.1/auth/google/master/callback');
  });

  test('GOOGLE_CALLBACK_URL cannot redirect the AuthCode flow', async () => {
    const app = isolatedApp({
      GOOGLE_CALLBACK_URL: 'http://127.0.0.1/hijacked/legacy/cb',
      GOOGLE_AUTHCODE_CALLBACK_URL: 'http://127.0.0.1/auth/google-login-code/callback'
    });
    expect(await redirectUriFor(app, '/auth/google-login-code')).toBe('http://127.0.0.1/auth/google-login-code/callback');
    expect(await redirectUriFor(app, '/auth/google')).toBe('http://127.0.0.1/hijacked/legacy/cb');
  });

  test('authCode callback falls back to the correct default when the variable is unset', async () => {
    const env = configEnv();
    delete env.GOOGLE_AUTHCODE_CALLBACK_URL;
    const dir = makeTempDataDir('callback-default');
    tempDirs.push(dir);
    const app = startServer(dir, env).app;
    expect(await redirectUriFor(app, '/auth/google-login-code')).toBe('http://127.0.0.1/auth/google-login-code/callback');
    expect(await redirectUriFor(app, '/auth/google')).toBe('http://127.0.0.1/auth/google/callback');
  });

  test('the config module exposes independent callback settings', () => {
    const env = configEnv();
    for (const k of Object.keys(env)) process.env[k] = env[k];
    jest.resetModules();
    const cfg = require('../config/oauth');
    expect(cfg.providers.google.callbackURL).toBe('http://127.0.0.1/auth/google/callback');
    expect(cfg.providers.google.authCodeCallbackURL).toBe('http://127.0.0.1/auth/google-login-code/callback');
    expect(cfg.master.callbackURL).toBe('http://127.0.0.1/auth/google/master/callback');
  });
});
