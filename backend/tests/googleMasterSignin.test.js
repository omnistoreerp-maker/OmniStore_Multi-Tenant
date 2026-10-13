// Platform Master Google sign-in — server-side OIDC security suite.
//
// Scope: the NEW /auth/google/master surface (initiate / callback / link /
// unlink) and nothing else. Google is never contacted: the authorization
// code exchange goes through a mocked token endpoint and ID-token
// verification through the trusted library's mock. Every mandatory
// category of the implementation brief is pinned here; password login,
// MFA, JWT refresh/logout, tenant isolation and platform RBAC are
// re-asserted as regressions and additionally covered by the existing
// dedicated suites run alongside this file.
jest.mock('google-auth-library', () => {
  const mockVerifyIdToken = jest.fn();
  class OAuth2Client {
    constructor(clientId) {
      this.clientId = clientId;
    }
    verifyIdToken(args) {
      return mockVerifyIdToken(args);
    }
  }
  return { OAuth2Client, __mockVerifyIdToken: mockVerifyIdToken };
});

const request = require('supertest');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const CLIENT_SECRET = 'test-client-secret';
const MASTER_EMAIL = 'omnistore.live@gmail.com';
const PASSWORD = 'Pass#123';
const FAKE_ID_TOKEN = 'hdr.fake-google-id-token.pld';

const OAUTH_ENV = {
  RATE_LIMIT_MAX: '10000',
  OAUTH_ENABLED: 'true',
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
  OAUTH_MASTER_EMAIL: MASTER_EMAIL
};

const tempDirs = [];
const realFetch = global.fetch;
registerCleanup(() => [], () => tempDirs);

function gm() {
  return require('google-auth-library');
}

// Routes the code exchange at the mocked Google token endpoint; every
// other fetch falls through to the real one so unrelated machinery (if
// any) keeps working.
function mockGoogleToken(impl) {
  global.fetch = jest.fn(async (url, opts) => {
    if (String(url).includes('oauth2.googleapis.com')) return impl(opts);
    if (realFetch) return realFetch(url, opts);
    throw new Error('unexpected network call: ' + url);
  });
}

function okTokenResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ id_token: FAKE_ID_TOKEN, token_type: 'Bearer', expires_in: 3900 })
  };
}

function decodeState(state) {
  return JSON.parse(Buffer.from(String(state).split('.')[0], 'base64url').toString('utf8'));
}

function googlePayload(statePayload, over = {}) {
  return {
    iss: 'https://accounts.google.com',
    sub: 'g-sub-master',
    aud: CLIENT_ID,
    email: MASTER_EMAIL,
    email_verified: true,
    nonce: statePayload ? statePayload.nonce : undefined,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...over
  };
}

function mockVerify(over = {}) {
  gm().__mockVerifyIdToken.mockImplementation(async () => ({
    getPayload: () => over
  }));
}

async function startAttempt(app, returnTo = '/') {
  const res = await request(app).get('/auth/google/master?returnTo=' + encodeURIComponent(returnTo));
  expect(res.status).toBe(302);
  const location = res.headers.location || '';
  expect(location.startsWith('https://accounts.google.com/o/oauth2/v2/auth')).toBe(true);
  const url = new URL(location);
  const state = url.searchParams.get('state');
  expect(state).toBeTruthy();
  return { location, state, url, payload: decodeState(state) };
}

function cookieHeader(res) {
  const set = res.headers['set-cookie'] || [];
  return set.map((c) => c.split(';')[0]).join('; ');
}

async function callback(app, { state, code = 'ok-code', cookies, bearer } = {}) {
  let req = request(app).get(
    '/auth/google/master/callback?code=' + encodeURIComponent(code) + '&state=' + encodeURIComponent(state)
  );
  if (cookies) req = req.set('Cookie', cookies);
  if (bearer) req = req.set('Authorization', 'Bearer ' + bearer);
  return req;
}

function expectDenied(res, gerrCode) {
  expect(res.status).toBe(302);
  expect(res.headers.location).toContain('gerr=' + gerrCode);
  const set = res.headers['set-cookie'] || [];
  expect(set.some((c) => c.startsWith('access_token='))).toBe(false);
  expect(set.some((c) => c.startsWith('refresh_token='))).toBe(false);
}

function tamperState(state) {
  const [b, m] = String(state).split('.');
  const idx = Math.floor(b.length / 2);
  const ch = b[idx] === 'A' ? 'B' : 'A';
  return b.slice(0, idx) + ch + b.slice(idx + 1) + '.' + m;
}

function seedAll(dir) {
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const stamp = new Date().toISOString();
  seed(dir, 'users', {
    users: [
      // Platform team — server-side platform roles live in platformAdmins.json
      { id: 'u-master', username: 'omnistore', password: hash, fullName: 'Platform Master', role: 'Viewer', tokenVersion: 0, createdAt: stamp, updatedAt: stamp, oauth: { google: 'g-sub-master' } },
      { id: 'u-padmin', username: 'padmin', password: hash, fullName: 'Ops Admin', role: 'Viewer', tokenVersion: 0, createdAt: stamp, updatedAt: stamp },
      // Linked but WITHOUT platform membership — must never reach Master
      { id: 'u-plain', username: 'plainUser', password: hash, fullName: 'Plain User', role: 'Viewer', tokenVersion: 0, createdAt: stamp, updatedAt: stamp, oauth: { google: 'g-sub-plain' } },
      // Tenant identity — must never reach Master scope
      { id: 'u-owner', username: 'digiOwner', password: hash, fullName: 'Digi Owner', role: 'Owner', tenantIds: ['digi'], tenantRoles: { digi: 'Owner' }, tokenVersion: 0, createdAt: stamp, updatedAt: stamp, oauth: { google: 'g-sub-owner' } },
      { id: 'u-cash', username: 'digiCash', password: hash, fullName: 'Digi Cashier', role: 'Cashier', tenantIds: ['digi'], tenantRoles: { digi: 'Cashier' }, tokenVersion: 0, createdAt: stamp, updatedAt: stamp },
      // Local account that OWNS the approved Google email — an email match
      // must never link or authenticate anyone on the Master path.
      { id: 'u-email', username: 'emailClash', password: hash, fullName: 'Email Clash', role: 'Viewer', tokenVersion: 0, createdAt: stamp, updatedAt: stamp, email: MASTER_EMAIL },
      // MFA gate regression account
      { id: 'u-mfa', username: 'mfaUser', password: hash, fullName: 'MFA User', role: 'Viewer', tokenVersion: 0, mfaEnabled: true, createdAt: stamp, updatedAt: stamp }
    ]
  });
  seed(dir, 'platformAdmins', {
    admins: [
      { username: 'omnistore', platformRole: 'MASTER_OWNER', status: 'active', createdAt: stamp },
      { username: 'padmin', platformRole: 'PLATFORM_ADMIN', status: 'active', createdAt: stamp }
    ]
  });
  seed(dir, 'companies', {
    companies: [
      { id: 'digi', code: 'DIGI', name: 'DigiTronics', active: true, status: 'ACTIVE', branches: [{ id: 'MAIN', name: 'Main Branch', code: 'MAIN', isDefault: true, active: true }] }
    ]
  });
}

describe('Platform Master Google sign-in (server-side OIDC)', () => {
  let app;
  let dir;

  beforeAll(() => {
    dir = makeTempDataDir('gmaster');
    tempDirs.push(dir);
    seedAll(dir);
    app = startServer(dir, OAUTH_ENV).app;
  });

  afterEach(() => {
    global.fetch = realFetch;
    gm().__mockVerifyIdToken.mockReset();
  });

  // -------------------------------------------------------------------------
  // Initiate: signed state, nonce, PKCE, openid scope, redirect hardening
  // -------------------------------------------------------------------------
  it('initiate builds a Google OIDC URL with signed single-use state, nonce, PKCE and openid scope', async () => {
    const attempt = await startAttempt(app, '/?x=1');
    expect(attempt.url.searchParams.get('response_type')).toBe('code');
    expect(attempt.url.searchParams.get('scope')).toContain('openid');
    expect(attempt.url.searchParams.get('scope')).toContain('email');
    expect(attempt.url.searchParams.get('scope')).toContain('profile');
    expect(attempt.url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(attempt.url.searchParams.get('nonce')).toBeTruthy();
    expect(attempt.url.searchParams.get('redirect_uri')).toContain('/auth/google/master/callback');
    expect(attempt.payload.mode).toBe('login');
    expect(attempt.payload.returnTo).toBe('/?x=1');
    expect(attempt.payload.nonce).toBe(attempt.url.searchParams.get('nonce'));
    expect(attempt.payload.cv).toBeTruthy();

    // Open-redirect hardening: hostile returnTo collapses to the app root.
    const evilScheme = await startAttempt(app, 'https://evil.example/phish');
    expect(evilScheme.payload.returnTo).toBe('/');
    const protoRel = await startAttempt(app, '//evil.example');
    expect(protoRel.payload.returnTo).toBe('/');
    const nested = await startAttempt(app, '/auth/google/master');
    expect(nested.payload.returnTo).toBe('/');
  });

  // -------------------------------------------------------------------------
  // 1. Linked Google identity WITH platform membership → ALLOW (within rights)
  // -------------------------------------------------------------------------
  it('1. linked Google identity + active membership → ALLOW master surfaces', async () => {
    mockGoogleToken(okTokenResponse);
    const attempt = await startAttempt(app);
    mockVerify(googlePayload(attempt.payload));
    const cb = await callback(app, { state: attempt.state });
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toContain('gsignin=1');
    const ch = cookieHeader(cb);
    expect(ch).toContain('access_token=');
    expect(ch).toContain('refresh_token=');

    const me = await request(app).get('/api/v1/platform/me').set('Cookie', ch);
    expect(me.status).toBe(200);
    expect(me.body.data.platformRole).toBe('MASTER_OWNER');

    const cc = await request(app).get('/api/v1/platform/control-center/access').set('Cookie', ch);
    expect(cc.status).toBe(200);

    // The SPA bootstrap path (cookies only) mints a fresh access token.
    const refreshed = await request(app).post('/api/v1/auth/refresh').set('Cookie', ch).send({});
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // 2. Unlinked Google identity → DENY (no user creation, no email linking)
  // -------------------------------------------------------------------------
  it('2. unlinked Google identity → DENY, no account is created or linked', async () => {
    const before = readStore(dir, 'users');
    mockGoogleToken(okTokenResponse);
    const attempt = await startAttempt(app);
    mockVerify(googlePayload(attempt.payload, { sub: 'g-sub-nobody' }));

    const cb = await callback(app, { state: attempt.state });
    expectDenied(cb, 'not_linked');

    const after = readStore(dir, 'users');
    expect(after.users.length).toBe(before.users.length);
    expect(after.users.every((u) => !u.oauth || u.oauth.google !== 'g-sub-nobody')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 3. Linked identity WITHOUT platform membership → DENY master surfaces
  // -------------------------------------------------------------------------
  it('3. linked Google identity without platform membership → DENY master surfaces', async () => {
    mockGoogleToken(okTokenResponse);
    const attempt = await startAttempt(app);
    mockVerify(googlePayload(attempt.payload, { sub: 'g-sub-plain' }));
    const cb = await callback(app, { state: attempt.state });
    // Authentication itself succeeds (it is just a session)…
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toContain('gsignin=1');
    const ch = cookieHeader(cb);
    // …but Master authorization is refused server-side.
    const me = await request(app).get('/api/v1/platform/me').set('Cookie', ch);
    expect(me.status).toBe(404);
    const cc = await request(app).get('/api/v1/platform/control-center/access').set('Cookie', ch);
    expect(cc.status).toBe(403);
  });

  // -------------------------------------------------------------------------
  // 4. Tenant Owner (even linked) → DENY master surfaces
  // -------------------------------------------------------------------------
  it('4. tenant Owner with linked Google identity → DENY master surfaces', async () => {
    mockGoogleToken(okTokenResponse);
    const attempt = await startAttempt(app);
    mockVerify(googlePayload(attempt.payload, { sub: 'g-sub-owner' }));
    const cb = await callback(app, { state: attempt.state });
    expect(cb.status).toBe(302);
    const ch = cookieHeader(cb);
    const me = await request(app).get('/api/v1/platform/me').set('Cookie', ch);
    expect(me.status).toBe(404);
    const cc = await request(app).get('/api/v1/platform/control-center/access').set('Cookie', ch);
    expect(cc.status).toBe(403);

    // The tenant surface itself is untouched by the new flow.
    const tenantLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'digiCash', password: PASSWORD });
    expect(tenantLogin.status).toBe(200);
    const who = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer ' + tenantLogin.body.data.accessToken);
    expect(who.status).toBe(200);
    expect(who.body.data.user.username).toBe('digiCash');
  });

  // -------------------------------------------------------------------------
  // 5. Bad / expired / wrong-audience ID tokens → DENY
  // -------------------------------------------------------------------------
  it('5. invalid, expired or wrong-audience ID tokens → DENY', async () => {
    // 5a — signature/verification failure
    mockGoogleToken(okTokenResponse);
    gm().__mockVerifyIdToken.mockRejectedValueOnce(new Error('invalid signature'));
    let attempt = await startAttempt(app);
    expectDenied(await callback(app, { state: attempt.state }), 'idtoken_invalid');

    // 5b — wrong audience
    mockGoogleToken(okTokenResponse);
    const a2 = await startAttempt(app);
    mockVerify(googlePayload(a2.payload, { aud: 'someone-else.apps.googleusercontent.com' }));
    expectDenied(await callback(app, { state: a2.state }), 'idtoken_invalid');

    // 5c — expired
    mockGoogleToken(okTokenResponse);
    const a3 = await startAttempt(app);
    mockVerify(googlePayload(a3.payload, { exp: Math.floor(Date.now() / 1000) - 60 }));
    expectDenied(await callback(app, { state: a3.state }), 'idtoken_invalid');

    // 5d — wrong issuer
    mockGoogleToken(okTokenResponse);
    const a4 = await startAttempt(app);
    mockVerify(googlePayload(a4.payload, { iss: 'https://evil.example' }));
    expectDenied(await callback(app, { state: a4.state }), 'idtoken_invalid');
  });

  // -------------------------------------------------------------------------
  // 6. Bad / reused state → DENY (single-use, HMAC, TTL)
  // -------------------------------------------------------------------------
  it('6. tampered, garbage or replayed state → DENY', async () => {
    // 6a — garbage state
    expectDenied(await callback(app, { state: 'not-a-state' }), 'state_invalid');

    // 6b — tampered payload
    const attempt = await startAttempt(app);
    expectDenied(await callback(app, { state: tamperState(attempt.state) }), 'state_invalid');

    // 6c — valid flow, then REPLAY of the very same state
    mockGoogleToken(okTokenResponse);
    const b = await startAttempt(app);
    mockVerify(googlePayload(b.payload));
    const first = await callback(app, { state: b.state });
    expect(first.status).toBe(302);
    expect(first.headers.location).toContain('gsignin=1');
    expectDenied(await callback(app, { state: b.state }), 'state_invalid');
  });

  // -------------------------------------------------------------------------
  // 7. Nonce mismatch → DENY
  // -------------------------------------------------------------------------
  it('7. ID token with the wrong nonce → DENY', async () => {
    mockGoogleToken(okTokenResponse);
    const attempt = await startAttempt(app);
    mockVerify(googlePayload(attempt.payload, { nonce: 'attacker-chosen-nonce' }));
    expectDenied(await callback(app, { state: attempt.state }), 'nonce_invalid');
  });

  // -------------------------------------------------------------------------
  // 9a. Email match alone can never authenticate or link (login path)
  // -------------------------------------------------------------------------
  it('9a. Google identity with the approved email but no prior link → DENY (no email-based linking)', async () => {
    const before = readStore(dir, 'users');
    mockGoogleToken(okTokenResponse);
    const attempt = await startAttempt(app);
    mockVerify(googlePayload(attempt.payload, { sub: 'g-sub-fresh', email: MASTER_EMAIL, email_verified: true }));
    expectDenied(await callback(app, { state: attempt.state }), 'not_linked');

    const after = readStore(dir, 'users');
    expect(after.users.length).toBe(before.users.length);
    const clash = after.users.find((u) => u.username === 'emailClash');
    expect(clash && (!clash.oauth || !clash.oauth.google)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 13. Password login, MFA gate, refresh and logout preserved (OAuth on)
  // -------------------------------------------------------------------------
  it('13. password login, MFA gate, JWT refresh and logout behave exactly as before', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ username: 'omnistore', password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.data.accessToken).toBeTruthy();
    expect(login.body.data.refreshToken).toBeTruthy();

    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.data.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toBeTruthy();

    // MFA gate: an mfaEnabled user is challenged, and a bogus code is rejected.
    const mfaChallenge = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'mfaUser', password: PASSWORD });
    expect(mfaChallenge.status).toBe(200);
    expect(mfaChallenge.body.data.mfaRequired).toBe(true);
    expect(mfaChallenge.body.data.tempToken).toBeTruthy();
    const mfaBad = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'mfaUser', password: PASSWORD, mfaToken: '000000' });
    expect(mfaBad.status).toBe(401);

    // Logout revokes the presented access token. /auth/me answers its
    // documented 400 no-identity branch for a revoked token (see
    // tokenVersion.test.js / passwordChange.test.js).
    const out = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', 'Bearer ' + login.body.data.accessToken)
      .send({});
    expect(out.status).toBe(200);
    const meAfter = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer ' + login.body.data.accessToken);
    expect([400, 401]).toContain(meAfter.status);
  });

  // -------------------------------------------------------------------------
  // Linking: auth + password step-up + membership + policy + session binding
  // -------------------------------------------------------------------------
  it('8/9b. linking requires auth, password step-up, membership, policy and the bound session', async () => {
    // 8a — unauthenticated link-session → 401
    const noAuth = await request(app).post('/auth/google/master/link-session').send({ currentPassword: PASSWORD });
    expect(noAuth.status).toBe(401);

    // Member session (omnistore)
    const login = await request(app).post('/api/v1/auth/login').send({ username: 'omnistore', password: PASSWORD });
    expect(login.status).toBe(200);
    const tok = login.body.data.accessToken;
    const masterCookies = cookieHeader(login);
    expect(masterCookies).toContain('access_token=');

    // 8b — wrong step-up password → 401
    const badPw = await request(app)
      .post('/auth/google/master/link-session')
      .set('Authorization', 'Bearer ' + tok)
      .send({ currentPassword: 'wrong-password' });
    expect(badPw.status).toBe(401);

    // 8c — authenticated NON-member (tenant owner) → 403 (master-only scope)
    const ownerLogin = await request(app).post('/api/v1/auth/login').send({ username: 'digiOwner', password: PASSWORD });
    const notMember = await request(app)
      .post('/auth/google/master/link-session')
      .set('Authorization', 'Bearer ' + ownerLogin.body.data.accessToken)
      .send({ currentPassword: PASSWORD });
    expect(notMember.status).toBe(403);

    // --- happy link on the second platform member (padmin) ---
    const padminLogin = await request(app).post('/api/v1/auth/login').send({ username: 'padmin', password: PASSWORD });
    expect(padminLogin.status).toBe(200);
    const padminCookies = cookieHeader(padminLogin);
    const ticketRes = await request(app)
      .post('/auth/google/master/link-session')
      .set('Authorization', 'Bearer ' + padminLogin.body.data.accessToken)
      .send({ currentPassword: PASSWORD });
    expect(ticketRes.status).toBe(200);
    expect(ticketRes.body.data.ticket).toBeTruthy();
    const ticket = ticketRes.body.data.ticket;

    const linkStart = await request(app)
      .get('/auth/google/master/link?ticket=' + encodeURIComponent(ticket) + '&returnTo=' + encodeURIComponent('platform.html'))
      .set('Cookie', padminCookies);
    expect(linkStart.status).toBe(302);
    const lstate = new URL(linkStart.headers.location).searchParams.get('state');
    const lpayload = decodeState(lstate);
    expect(lpayload.mode).toBe('link');
    expect(lpayload.u).toBe('padmin');
    expect(lpayload.returnTo).toBe('/platform.html');

    // 8d — CROSS-SESSION callback (state bound to padmin, session is omnistore)
    mockGoogleToken(okTokenResponse);
    mockVerify(googlePayload(lpayload, { sub: 'g-sub-padmin' }));
    const crossSession = await callback(app, { state: lstate, cookies: masterCookies });
    expectDenied(crossSession, 'session_mismatch');
    let usersNow = readStore(dir, 'users');
    expect(usersNow.users.find((u) => u.username === 'padmin').oauth).toBeUndefined();

    // 8e — unauthenticated link callback (no session at all) → DENY
    const freshTicket1 = await request(app)
      .post('/auth/google/master/link-session')
      .set('Authorization', 'Bearer ' + padminLogin.body.data.accessToken)
      .send({ currentPassword: PASSWORD });
    const freshStart1 = await request(app)
      .get('/auth/google/master/link?ticket=' + encodeURIComponent(freshTicket1.body.data.ticket))
      .set('Cookie', padminCookies);
    const freshState1 = new URL(freshStart1.headers.location).searchParams.get('state');
    mockGoogleToken(okTokenResponse);
    mockVerify(googlePayload(decodeState(freshState1), { sub: 'g-sub-padmin' }));
    const noSession = await callback(app, { state: freshState1 });
    expectDenied(noSession, 'session_mismatch');

    // 9b — link policy: email must be VERIFIED and match the approved address
    const freshTicket2 = await request(app)
      .post('/auth/google/master/link-session')
      .set('Authorization', 'Bearer ' + padminLogin.body.data.accessToken)
      .send({ currentPassword: PASSWORD });
    const freshStart2 = await request(app)
      .get('/auth/google/master/link?ticket=' + encodeURIComponent(freshTicket2.body.data.ticket))
      .set('Cookie', padminCookies);
    const freshState2 = new URL(freshStart2.headers.location).searchParams.get('state');
    mockGoogleToken(okTokenResponse);
    mockVerify(googlePayload(decodeState(freshState2), { sub: 'g-sub-padmin', email: 'attacker@gmail.com' }));
    const wrongEmail = await callback(app, { state: freshState2, cookies: padminCookies });
    expectDenied(wrongEmail, 'email_mismatch');

    const freshTicket3 = await request(app)
      .post('/auth/google/master/link-session')
      .set('Authorization', 'Bearer ' + padminLogin.body.data.accessToken)
      .send({ currentPassword: PASSWORD });
    const freshStart3 = await request(app)
      .get('/auth/google/master/link?ticket=' + encodeURIComponent(freshTicket3.body.data.ticket))
      .set('Cookie', padminCookies);
    const freshState3 = new URL(freshStart3.headers.location).searchParams.get('state');
    mockGoogleToken(okTokenResponse);
    mockVerify(googlePayload(decodeState(freshState3), { sub: 'g-sub-padmin', email_verified: false }));
    const unverified = await callback(app, { state: freshState3, cookies: padminCookies });
    expectDenied(unverified, 'email_mismatch');

    // 9c — a sub already bound to ANOTHER user can never be attached again
    const freshTicket4 = await request(app)
      .post('/auth/google/master/link-session')
      .set('Authorization', 'Bearer ' + padminLogin.body.data.accessToken)
      .send({ currentPassword: PASSWORD });
    const freshStart4 = await request(app)
      .get('/auth/google/master/link?ticket=' + encodeURIComponent(freshTicket4.body.data.ticket))
      .set('Cookie', padminCookies);
    const freshState4 = new URL(freshStart4.headers.location).searchParams.get('state');
    mockGoogleToken(okTokenResponse);
    mockVerify(googlePayload(decodeState(freshState4), { sub: 'g-sub-master' }));
    const taken = await callback(app, { state: freshState4, cookies: padminCookies });
    expectDenied(taken, 'sub_taken');

    // Happy path — the bound session + verified identity + policy link the sub
    const freshTicket5 = await request(app)
      .post('/auth/google/master/link-session')
      .set('Authorization', 'Bearer ' + padminLogin.body.data.accessToken)
      .send({ currentPassword: PASSWORD });
    const freshStart5 = await request(app)
      .get('/auth/google/master/link?ticket=' + encodeURIComponent(freshTicket5.body.data.ticket))
      .set('Cookie', padminCookies);
    const freshState5 = new URL(freshStart5.headers.location).searchParams.get('state');
    mockGoogleToken(okTokenResponse);
    mockVerify(googlePayload(decodeState(freshState5), { sub: 'g-sub-padmin' }));
    const linked = await callback(app, { state: freshState5, cookies: padminCookies });
    expect(linked.status).toBe(302);
    expect(linked.headers.location).toContain('glink=1');
    usersNow = readStore(dir, 'users');
    expect(usersNow.users.find((u) => u.username === 'padmin').oauth.google).toBe('g-sub-padmin');

    // The fresh link immediately works as a login identity…
    mockGoogleToken(okTokenResponse);
    const loginAttempt = await startAttempt(app);
    mockVerify(googlePayload(loginAttempt.payload, { sub: 'g-sub-padmin' }));
    const linkedLogin = await callback(app, { state: loginAttempt.state });
    expect(linkedLogin.status).toBe(302);
    expect(linkedLogin.headers.location).toContain('gsignin=1');
    const linkedMe = await request(app).get('/api/v1/platform/me').set('Cookie', cookieHeader(linkedLogin));
    expect(linkedMe.status).toBe(200);
    expect(linkedMe.body.data.platformRole).toBe('PLATFORM_ADMIN');

    // …and can be unlinked behind the same password step-up, after which the
    // Google identity no longer authenticates (password login still does).
    const unlinkBad = await request(app)
      .post('/auth/google/master/unlink')
      .set('Authorization', 'Bearer ' + padminLogin.body.data.accessToken)
      .send({ currentPassword: 'wrong-password' });
    expect(unlinkBad.status).toBe(401);
    const unlinked = await request(app)
      .post('/auth/google/master/unlink')
      .set('Authorization', 'Bearer ' + padminLogin.body.data.accessToken)
      .send({ currentPassword: PASSWORD });
    expect(unlinked.status).toBe(200);
    usersNow = readStore(dir, 'users');
    expect(!usersNow.users.find((u) => u.username === 'padmin').oauth ||
      !usersNow.users.find((u) => u.username === 'padmin').oauth.google).toBe(true);

    mockGoogleToken(okTokenResponse);
    const afterUnlinkAttempt = await startAttempt(app);
    mockVerify(googlePayload(afterUnlinkAttempt.payload, { sub: 'g-sub-padmin' }));
    expectDenied(await callback(app, { state: afterUnlinkAttempt.state }), 'not_linked');

    const padminPass = await request(app).post('/api/v1/auth/login').send({ username: 'padmin', password: PASSWORD });
    expect(padminPass.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // 11. Google outage / token endpoint failure → DENY, password path intact
  // -------------------------------------------------------------------------
  it('11. Google unreachable or failing → DENY, never a bypass for password auth', async () => {
    // Network failure
    mockGoogleToken(() => {
      throw new Error('ECONNREFUSED');
    });
    let attempt = await startAttempt(app);
    expectDenied(await callback(app, { state: attempt.state }), 'provider_error');

    // Token endpoint error response
    mockGoogleToken(async () => ({ ok: false, status: 500, json: async () => ({ error: 'server_error' }) }));
    attempt = await startAttempt(app);
    expectDenied(await callback(app, { state: attempt.state }), 'provider_error');

    // Missing authorization code (user cancelled at Google)
    attempt = await startAttempt(app);
    expectDenied(await callback(app, { state: attempt.state, code: '' }), 'provider_error');

    // Password login keeps working throughout.
    const login = await request(app).post('/api/v1/auth/login').send({ username: 'omnistore', password: PASSWORD });
    expect(login.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // 10. Membership revocation and session invalidation take effect at once
  // -------------------------------------------------------------------------
  it('10. membership revocation and token-version bump invalidate a Google session immediately', async () => {
    mockGoogleToken(okTokenResponse);
    const attempt = await startAttempt(app);
    mockVerify(googlePayload(attempt.payload));
    const cb = await callback(app, { state: attempt.state });
    expect(cb.status).toBe(302);
    const ch = cookieHeader(cb);
    expect((await request(app).get('/api/v1/platform/me').set('Cookie', ch)).status).toBe(200);

    // — revoke the platform membership (server-side store only) —
    const admins = readStore(dir, 'platformAdmins');
    seed(dir, 'platformAdmins', { admins: admins.admins.filter((a) => a.username !== 'omnistore') });
    const revoked = await request(app).get('/api/v1/platform/me').set('Cookie', ch);
    expect(revoked.status).toBe(404);
    const ccRevoked = await request(app).get('/api/v1/platform/control-center/access').set('Cookie', ch);
    expect(ccRevoked.status).toBe(403);
    seed(dir, 'platformAdmins', admins); // restore

    // — bump tokenVersion (same mechanism a password change uses) —
    const users = readStore(dir, 'users');
    const master = users.users.find((u) => u.username === 'omnistore');
    const originalVersion = Number(master.tokenVersion) || 0;
    master.tokenVersion = originalVersion + 1;
    seed(dir, 'users', users);
    const stale = await request(app).get('/api/v1/platform/me').set('Cookie', ch);
    expect(stale.status).toBe(401);

    const usersAfter = readStore(dir, 'users');
    usersAfter.users.find((u) => u.username === 'omnistore').tokenVersion = originalVersion;
    seed(dir, 'users', usersAfter); // restore
    expect((await request(app).get('/api/v1/platform/me').set('Cookie', ch)).status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // 12. Audit coverage with zero secret/token leakage
  // -------------------------------------------------------------------------
  it('12. audit records the outcomes and never stores or echoes a secret', async () => {
    const audit = readStore(dir, 'auditLog');
    expect(audit).toBeTruthy();
    const entries = (audit && audit.entries) || [];
    const actions = entries.map((e) => e.action);
    expect(actions).toContain('GOOGLE_MASTER_LOGIN_SUCCESS');
    expect(actions).toContain('GOOGLE_MASTER_LOGIN_DENIED');
    expect(actions).toContain('GOOGLE_MASTER_LINK_SUCCESS');
    expect(actions).toContain('GOOGLE_MASTER_LINK_DENIED');
    expect(actions).toContain('GOOGLE_MASTER_UNLINK_SUCCESS');

    const dump = JSON.stringify(entries);
    expect(dump).not.toContain(CLIENT_SECRET);
    expect(dump).not.toContain(FAKE_ID_TOKEN);
    expect(dump).not.toContain(PASSWORD);

    // A failing callback redirect carries only the safe code — never the
    // client secret, the raw token or internal error text.
    mockGoogleToken(okTokenResponse);
    gm().__mockVerifyIdToken.mockRejectedValueOnce(new Error('verification exploded: ' + CLIENT_SECRET));
    const attempt = await startAttempt(app);
    const cb = await callback(app, { state: attempt.state });
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toContain('gerr=idtoken_invalid');
    expect(cb.headers.location).not.toContain(CLIENT_SECRET);
    expect(cb.headers.location).not.toContain('FAKE_ID_TOKEN');
    expect(cb.headers.location).not.toContain('exploded');
  });

  // -------------------------------------------------------------------------
  // Shipped shells: the Master UI starts the SERVER path, no credentials
  // -------------------------------------------------------------------------
  it('shipped shells wire the server-side Google path and carry no credentials', () => {
    const root = path.join(__dirname, '..', '..');
    const idx = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const platformHtml = fs.readFileSync(path.join(root, 'platform.html'), 'utf8');
    const platformJs = fs.readFileSync(path.join(root, 'platform', 'platform.js'), 'utf8');
    // The entry points navigate to the server-side Master path…
    expect(idx).toContain('/auth/google/master');
    expect(platformJs).toContain('/auth/google/master');
    // …and the drawer exposes the button that starts it.
    expect(idx).toContain('googleSignInBtn');
    expect(platformHtml).toContain('platformAuthGoogle');
    expect(platformJs).toContain('handlePlatformGoogleSigninResult');
    // No credential may ever ship in a shell.
    for (const [name, src] of [['index.html', idx], ['platform.html', platformHtml], ['platform/platform.js', platformJs]]) {
      expect(src).not.toContain(CLIENT_SECRET);
      expect(src).not.toContain(CLIENT_ID);
    }
  });
});

describe('OAuth disabled → the whole /auth surface is unreachable (no bypass)', () => {
  let offApp;

  beforeAll(() => {
    const d = makeTempDataDir('gmaster-off');
    tempDirs.push(d);
    seedAll(d);
    // No OAUTH keys passed: testServer deletes them, matching production.
    offApp = startServer(d, { RATE_LIMIT_MAX: '10000' }).app;
  });

  afterEach(() => {
    global.fetch = realFetch;
    gm().__mockVerifyIdToken.mockReset();
  });

  it('master endpoints 404 while password login still works', async () => {
    const gets = [
      '/auth/google/master',
      '/auth/google/master/callback?code=x&state=y',
      '/auth/google/master/link?ticket=x',
      '/auth/providers'
    ];
    for (const p of gets) {
      const r = await request(offApp).get(p);
      expect(r.status).toBe(404);
    }
    const post = await request(offApp)
      .post('/auth/google/master/link-session')
      .send({ currentPassword: PASSWORD });
    expect(post.status).toBe(404);

    const login = await request(offApp).post('/api/v1/auth/login').send({ username: 'omnistore', password: PASSWORD });
    expect(login.status).toBe(200);
  });
});
