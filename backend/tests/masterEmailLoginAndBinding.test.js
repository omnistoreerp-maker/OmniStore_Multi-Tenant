// P0 regression suite — Master email/password login + Google LOGIN binding
// cookie cross-subdomain scoping.
//
// Part 1 pins the authenticate() email fallback: the login drawer identifier
// may be an email address (the owner's production failure). Exact,
// case-insensitive email match; wrong password still rejected; unknown email
// 401; duplicate stored emails fail closed; a blank email never matches; the
// username path keeps precedence and behaves byte-for-byte as before.
//
// Part 2 pins the g_oauth_bs LOGIN binding cookie Domain scoping: the Google
// callback host (app.omnistoreerp.com per GOOGLE_MASTER_CALLBACK_URL) is a
// sibling subdomain of the site host the owner browses (omnistoreerp.com), so
// the CSRF nonce must be scoped to the parent registrable domain in
// production or every LOGIN dies with browser_binding_mismatch. Session
// cookies are NOT scoped. The post-match clear must carry the same Domain.
'use strict';

jest.mock('google-auth-library', () => {
  const mockVerifyIdToken = jest.fn();
  class OAuth2Client {
    constructor(clientId) { this.clientId = clientId; }
    verifyIdToken(args) { return mockVerifyIdToken(args); }
  }
  return { OAuth2Client, __mockVerifyIdToken: mockVerifyIdToken };
});

const fs = require('fs');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const PASSWORD = 'Pass#123';
const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const CLIENT_SECRET = 'test-client-secret';
const FAKE_ID_TOKEN = 'hdr.fake-google-id-token.pld';

const OAUTH_ENV = {
  RATE_LIMIT_MAX: '10000',
  OAUTH_ENABLED: 'true',
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: CLIENT_SECRET
};

const tempDirs = [];
const realFetch = global.fetch;
registerCleanup(() => [], () => tempDirs);

function gm() { return require('google-auth-library'); }

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

function mockVerify(payload) {
  gm().__mockVerifyIdToken.mockImplementation(async () => ({
    getPayload: () => payload
  }));
}

function seedUsers(dir, users) {
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const stamp = new Date().toISOString();
  seed(dir, 'users', {
    users: users.map(u => ({
      id: u.id, username: u.username, password: u.password || hash,
      fullName: u.fullName || u.username, role: 'Viewer', tokenVersion: 0,
      ...(u.email !== undefined ? { email: u.email } : {}),
      ...(u.oauth ? { oauth: u.oauth } : {}),
      createdAt: stamp, updatedAt: stamp
    }))
  });
  return { hash, stamp };
}

function seedAdmins(dir, admins, stamp) {
  seed(dir, 'platformAdmins', {
    admins: admins.map(a => ({
      username: a.username, platformRole: a.platformRole, status: 'active',
      createdAt: stamp, updatedAt: stamp
    }))
  });
}

// Small wrapper so each describe can boot with its own env combo.
async function startApp(dir, extraEnv) {
  const s = await startServer(dir, extraEnv);
  return s.app;
}

function setCookies(res) { return res.headers['set-cookie'] || []; }

// ---------------------------------------------------------------------------
// Part 1 — email fallback in authenticate()
// ---------------------------------------------------------------------------
describe('Master password login — email fallback (P0)', () => {
  let server, dir;

  beforeAll(async () => {
    dir = makeTempDataDir('memail');
    tempDirs.push(dir);
    seedUsers(dir, [
      { id: 'u-master', username: 'omnistore' },
      { id: 'u-owner', username: 'liveowner', email: 'Owner@Example.com' },
      { id: 'u-dup-a', username: 'dupA', email: 'dup@example.com' },
      { id: 'u-dup-b', username: 'dupB', email: 'dup@example.com' },
      { id: 'u-blank', username: 'blankMail', email: '' },
      { id: 'u-mailname', username: 'mail@example.com' }
    ]);
    seedAdmins(dir, [
      { username: 'omnistore', platformRole: 'MASTER_OWNER' },
      { username: 'liveowner', platformRole: 'PLATFORM_ADMIN' }
    ], new Date().toISOString());
    server = await startApp(dir, { AUTH_REQUIRED: 'true', RATE_LIMIT_MAX: '10000' });
  });

  afterAll(() => {
    tempDirs.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} });
  });

  function login(username, password) {
    return request(server).post('/api/v1/auth/login').send({ username, password });
  }

  it('accepts the stored email regardless of case as the login identifier', async () => {
    const lower = await login('owner@example.com', PASSWORD);
    expect(lower.status).toBe(200);
    expect(lower.body.success).toBe(true);
    expect(setCookies(lower).some(c => c.startsWith('access_token='))).toBe(true);

    const upper = await login('OWNER@EXAMPLE.COM', PASSWORD);
    expect(upper.status).toBe(200);
  });

  it('rejects a correct email with a wrong password', async () => {
    const res = await login('owner@example.com', 'wrong-password');
    expect(res.status).toBe(401);
  });

  it('rejects an unknown email with 401 (no account is invented)', async () => {
    const res = await login('nobody@example.com', PASSWORD);
    expect(res.status).toBe(401);
  });

  it('fails closed when two accounts claim the same email, even with a valid password', async () => {
    const res = await login('dup@example.com', PASSWORD);
    expect(res.status).toBe(401);
  });

  it('a blank stored email never matches a blank/unknown identifier', async () => {
    const res = await login(' ', PASSWORD);
    expect(res.status).toBe(401);
  });

  it('keeps username precedence: an email-shaped USERNAME still logs in via the username path', async () => {
    const res = await login('mail@example.com', PASSWORD);
    expect(res.status).toBe(200);
  });

  it('regression: plain username login for the Master account is unchanged', async () => {
    const res = await login('omnistore', PASSWORD);
    expect(res.status).toBe(200);
    expect(setCookies(res).some(c => c.startsWith('refresh_token='))).toBe(true);
  });

  it('email login establishes a session that /platform/me accepts', async () => {
    const res = await login('owner@example.com', PASSWORD);
    expect(res.status).toBe(200);
    const cookie = setCookies(res).map(c => c.split(';')[0]).join('; ');
    const me = await request(server).get('/api/v1/platform/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.data.username).toBe('liveowner');
  });
});

// ---------------------------------------------------------------------------
// Part 2 — g_oauth_bs binding cookie Domain scoping
// ---------------------------------------------------------------------------
describe('Google LOGIN binding cookie Domain scoping (P0)', () => {
  let dir;
  const stampOwner = { username: 'omnistore', platformRole: 'MASTER_OWNER' };

  function seedLinkedMaster(d) {
    const { stamp } = seedUsers(d, [
      { id: 'u-master', username: 'omnistore', email: 'omnistore.live@gmail.com', oauth: { google: 'g-sub-master' } }
    ]);
    seedAdmins(d, [stampOwner], stamp);
  }

  afterAll(() => {
    tempDirs.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} });
  });

  async function startLoginAttempt(app) {
    const res = await request(app).get('/auth/google/master?returnTo=%2F');
    expect(res.status).toBe(302);
    expect(String(res.headers.location)).toContain('accounts.google.com');
    return res;
  }

  describe('production with default PLATFORM_DOMAIN (app.omnistoreerp.com)', () => {
    let server;

    beforeAll(async () => {
      dir = makeTempDataDir('mbind-prod');
      tempDirs.push(dir);
      seedLinkedMaster(dir);
      server = await startApp(dir, {
        ...OAUTH_ENV,
        NODE_ENV: 'production',
        PLATFORM_DOMAIN: 'app.omnistoreerp.com'
      });
    });

    it('sets g_oauth_bs with Domain=.omnistoreerp.com so the callback subdomain receives it', async () => {
      const res = await startLoginAttempt(server);
      const nonce = setCookies(res).find(c => c.startsWith('g_oauth_bs='));
      expect(nonce).toBeTruthy();
      expect(nonce).toMatch(/Domain=\.omnistoreerp\.com/i);
      expect(nonce).toMatch(/HttpOnly/i);
      expect(nonce).toMatch(/Path=\/auth\/google\/master/i);
    });

    it('session cookies stay host-only — the Domain scope applies only to the CSRF nonce', async () => {
      const res = await startLoginAttempt(server);
      const access = setCookies(res).find(c => c.startsWith('access_token='));
      expect(access).toBeUndefined(); // no session at initiate time
    });

    it('full round-trip: binding matches, login succeeds, the clear carries the same Domain', async () => {
      const res = await startLoginAttempt(server);
      const nonceCookie = setCookies(res).find(c => c.startsWith('g_oauth_bs=')).split(';')[0];
      const state = new URL(res.headers.location).searchParams.get('state');
      const payload = JSON.parse(Buffer.from(String(state).split('.')[0], 'base64url').toString('utf8'));

      mockGoogleToken(() => ({
        ok: true, status: 200,
        json: async () => ({ id_token: FAKE_ID_TOKEN, token_type: 'Bearer', expires_in: 3900 })
      }));
      mockVerify({
        iss: 'https://accounts.google.com', sub: 'g-sub-master', aud: CLIENT_ID,
        email: 'omnistore.live@gmail.com', email_verified: true, nonce: payload.nonce,
        exp: Math.floor(Date.now() / 1000) + 3600
      });

      const cb = await request(server)
        .get('/auth/google/master/callback?code=ok-code&state=' + encodeURIComponent(state))
        .set('Cookie', nonceCookie);
      expect(cb.status).toBe(302);
      expect(cb.headers.location).toContain('gsignin=1');

      const clearing = setCookies(cb).find(c => c.startsWith('g_oauth_bs='));
      expect(clearing).toBeTruthy();
      expect(clearing).toMatch(/Domain=\.omnistoreerp\.com/i);

      const access = setCookies(cb).find(c => c.startsWith('access_token='));
      expect(access).toBeTruthy();
      expect(access).not.toMatch(/Domain=/i); // session cookie remains host-only
    });
  });

  describe('production with explicit OAUTH_COOKIE_DOMAIN override', () => {
    let server;

    beforeAll(async () => {
      dir = makeTempDataDir('mbind-override');
      tempDirs.push(dir);
      seedLinkedMaster(dir);
      server = await startApp(dir, {
        ...OAUTH_ENV,
        NODE_ENV: 'production',
        PLATFORM_DOMAIN: 'app.omnistoreerp.com',
        OAUTH_COOKIE_DOMAIN: '.custom.example'
      });
    });

    it('uses the override verbatim', async () => {
      const res = await startLoginAttempt(server);
      const nonce = setCookies(res).find(c => c.startsWith('g_oauth_bs='));
      expect(nonce).toMatch(/Domain=\.custom\.example/i);
    });
  });

  describe('production with OAUTH_COOKIE_DOMAIN explicitly empty (forced host-only)', () => {
    let server;

    beforeAll(async () => {
      dir = makeTempDataDir('mbind-empty');
      tempDirs.push(dir);
      seedLinkedMaster(dir);
      server = await startApp(dir, {
        ...OAUTH_ENV,
        NODE_ENV: 'production',
        PLATFORM_DOMAIN: 'app.omnistoreerp.com',
        OAUTH_COOKIE_DOMAIN: ''
      });
    });

    it('emits no Domain attribute (host-only, the pre-fix behavior)', async () => {
      const res = await startLoginAttempt(server);
      const nonce = setCookies(res).find(c => c.startsWith('g_oauth_bs='));
      expect(nonce).toBeTruthy();
      expect(nonce).not.toMatch(/Domain=/i);
    });
  });

  describe('non-production (dev default)', () => {
    let server;

    beforeAll(async () => {
      dir = makeTempDataDir('mbind-dev');
      tempDirs.push(dir);
      seedLinkedMaster(dir);
      server = await startApp(dir, {
        ...OAUTH_ENV,
        PLATFORM_DOMAIN: 'app.omnistoreerp.com'
      });
    });

    it('stays host-only outside production even with PLATFORM_DOMAIN set', async () => {
      const res = await startLoginAttempt(server);
      const nonce = setCookies(res).find(c => c.startsWith('g_oauth_bs='));
      expect(nonce).toBeTruthy();
      expect(nonce).not.toMatch(/Domain=/i);
    });
  });
});
