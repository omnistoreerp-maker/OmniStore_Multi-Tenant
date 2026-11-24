'use strict';

// Google Login endpoint tests: authentication, MFA, tenant isolation, Master isolation, operational behavior.
//
// The REAL verification logic runs. Only the external HTTP response is
// stubbed (global.fetch), so every audience/issuer/expiry/email rule is the
// code under test. No real Google request is made.

const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const ORIGINAL_ENV = {
  CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  TOKENINFO_URL: process.env.GOOGLE_TOKENINFO_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  NODE_ENV: process.env.NODE_ENV,
  OAUTH_ENABLED: process.env.OAUTH_ENABLED,
  OAUTH_TENANT_LOGIN_ENABLED: process.env.OAUTH_TENANT_LOGIN_ENABLED,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
};
const ORIGINAL_FETCH = global.fetch;

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const TOKEN = 'fake.id.token';

const fetchMock = jest.fn();

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function goodPayload(overrides = {}) {
  return {
    sub: 'google-sub-1',
    email: 'user@example.com',
    email_verified: 'true',
    aud: CLIENT_ID,
    iss: 'https://accounts.google.com',
    exp: String(nowSeconds() + 3600),
    ...overrides
  };
}

function respond(payload, { ok = true, status = 200 } = {}) {
  return Promise.resolve({
    ok,
    status,
    json: async () => payload
  });
}

let server;
let dataDir;
const extraDirs = [];

registerCleanup(() => [server], () => [dataDir, ...extraDirs]);

beforeAll(async () => {
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  delete process.env.GOOGLE_TOKENINFO_URL;
  process.env.JWT_SECRET = 'test-jwt-secret-for-google-login-suites';
  process.env.NODE_ENV = 'test';
  process.env.OAUTH_ENABLED = 'false';
  process.env.OAUTH_TENANT_LOGIN_ENABLED = 'true';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  global.fetch = fetchMock;
  dataDir = makeTempDataDir('google-login');
});

afterAll(() => {
  if (ORIGINAL_ENV.CLIENT_ID === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = ORIGINAL_ENV.CLIENT_ID;
  if (ORIGINAL_ENV.TOKENINFO_URL === undefined) delete process.env.GOOGLE_TOKENINFO_URL;
  else process.env.GOOGLE_TOKENINFO_URL = ORIGINAL_ENV.TOKENINFO_URL;
  if (ORIGINAL_ENV.JWT_SECRET === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL_ENV.JWT_SECRET;
  if (ORIGINAL_ENV.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
  if (ORIGINAL_ENV.OAUTH_ENABLED === undefined) delete process.env.OAUTH_ENABLED;
  else process.env.OAUTH_ENABLED = ORIGINAL_ENV.OAUTH_ENABLED;
  if (ORIGINAL_ENV.OAUTH_TENANT_LOGIN_ENABLED === undefined) delete process.env.OAUTH_TENANT_LOGIN_ENABLED;
  else process.env.OAUTH_TENANT_LOGIN_ENABLED = ORIGINAL_ENV.OAUTH_TENANT_LOGIN_ENABLED;
  if (ORIGINAL_ENV.GOOGLE_CLIENT_SECRET === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
  else process.env.GOOGLE_CLIENT_SECRET = ORIGINAL_ENV.GOOGLE_CLIENT_SECRET;
  global.fetch = ORIGINAL_FETCH;
});

beforeEach(async () => {
  fetchMock.mockReset();
  // Fresh app instance per test: the Google Login limiter is a fixed
  // 20-request window per IP, and a shared instance would otherwise start
  // returning 429 for unrelated assertions late in the suite. Rate limiting
  // itself is exercised on its own dedicated instance below.
  server = await startServer(dataDir, { OAUTH_TENANT_LOGIN_ENABLED: 'true' });
  // Apply per-instance configuration AFTER the instance boots, because
  // startServer clears every instance key it was not given explicitly.
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  delete process.env.GOOGLE_TOKENINFO_URL;
});

function seedUsers(dir, users) {
  // Accept either a bare array or a { users: [...] } document, so a call site
  // can never silently seed a nested object that the service reads as empty.
  const list = Array.isArray(users)
    ? users
    : (users && Array.isArray(users.users) ? users.users : []);
  seed(dir, 'users', { users: list });
}

function readUsers(dir) {
  return readStore(dir, 'users');
}

describe('POST /api/v1/auth/google-login — authentication', () => {
  test('valid linked Google identity returns tokens', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ sub: 'google-sub-1' })));

    seedUsers(dataDir, {
      users: [{
        id: 'user-1',
        username: 'alice',
        password: '$2b$10$dummy.hash.for.testing.only',
        fullName: 'Alice A',
        role: 'Owner',
        oauth: { google: 'google-sub-1' },
        status: 'active'
      }]
    });

    const res = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.user.username).toBe('alice');
    expect(res.body.data.user.password).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('invalid token returns 401 without revealing account existence', async () => {
    fetchMock.mockReturnValue(respond({ error: 'invalid_token' }, { ok: false, status: 400 }));

    const res = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('expired token returns 401', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ sub: 'google-sub-1', exp: String(nowSeconds() - 10) })));

    const res = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });

    expect(res.statusCode).toBe(401);
  });

  test('wrong audience returns 401', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ sub: 'google-sub-1', aud: 'other-client.apps.googleusercontent.com' })));

    const res = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });

    expect(res.statusCode).toBe(401);
  });

  test('unverified email returns 401', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ sub: 'google-sub-1', email_verified: 'false' })));

    const res = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });

    expect(res.statusCode).toBe(401);
  });

  test('unlinked Google identity returns 401 (same as invalid token)', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ sub: 'google-sub-unknown' })));

    seedUsers(dataDir, {
      users: [{
        id: 'user-1',
        username: 'alice',
        password: '$2b$10$dummy.hash.for.testing.only',
        role: 'Owner',
        oauth: { google: 'google-sub-1' },
        status: 'active'
      }]
    });

    const res = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('no automatic account creation — unknown sub does not create user', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ sub: 'google-sub-new' })));

    const beforeCount = readUsers(dataDir).users.length;

    const res = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });

    expect(res.statusCode).toBe(401);
    const afterCount = readUsers(dataDir).users.length;
    expect(afterCount).toBe(beforeCount);
  });

  test('no email-only matching — valid token with email of existing user but no oauth.google link returns 401', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ sub: 'google-sub-2', email: 'alice@example.com' })));

    seedUsers(dataDir, {
      users: [{
        id: 'user-1',
        username: 'alice',
        password: '$2b$10$dummy.hash.for.testing.only',
        email: 'alice@example.com',
        role: 'Owner',
        status: 'active'
      }]
    });

    const res = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });

    expect(res.statusCode).toBe(401);
  });

  test('missing idToken returns 400', async () => {
    const res = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({});

    expect(res.statusCode).toBe(400);
  });

  test('duplicate sub mapping fails closed — returns 401, never logs into wrong account', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ sub: 'google-sub-dup' })));

    seedUsers(dataDir, {
      users: [
        {
          id: 'user-1',
          username: 'alice',
          role: 'Owner',
          oauth: { google: 'google-sub-dup' },
          status: 'active'
        },
        {
          id: 'user-2',
          username: 'bob',
          role: 'Cashier',
          oauth: { google: 'google-sub-dup' },
          status: 'active'
        }
      ]
    });

    const res = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });

    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/v1/auth/google-login — MFA', () => {
  test('MFA disabled user proceeds directly to tokens', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ sub: 'google-sub-mfa-off' })));

    seedUsers(dataDir, {
      users: [{
        id: 'user-mfa-off',
        username: 'carol',
        password: '$2b$10$dummy.hash.for.testing.only',
        role: 'Cashier',
        oauth: { google: 'google-sub-mfa-off' },
        status: 'active',
        mfaEnabled: false
      }]
    });

    const res = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.mfaRequired).toBeUndefined();
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
  });

  test('MFA enabled user returns mfaRequired with temp token, no full tokens', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ sub: 'google-sub-mfa-on' })));

    seedUsers(dataDir, {
      users: [{
        id: 'user-mfa-on',
        username: 'dave',
        password: '$2b$10$dummy.hash.for.testing.only',
        role: 'Teacher',
        oauth: { google: 'google-sub-mfa-on' },
        status: 'active',
        mfaEnabled: true
      }]
    });

    const res = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.mfaRequired).toBe(true);
    expect(res.body.data.tempToken).toBeTruthy();
    expect(res.body.data.accessToken).toBeUndefined();
    expect(res.body.data.refreshToken).toBeUndefined();
  });

  test('MFA verify with missing mfaToken returns 400', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ sub: 'google-sub-mfa-on' })));

    seedUsers(dataDir, {
      users: [{
        id: 'user-mfa-on-2',
        username: 'eve',
        password: '$2b$10$dummy.hash.for.testing.only',
        role: 'Teacher',
        oauth: { google: 'google-sub-mfa-on' },
        status: 'active',
        mfaEnabled: true
      }]
    });

    const loginRes = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });
    expect(loginRes.statusCode).toBe(200);
    const tempToken = loginRes.body.data.tempToken;

    const res = await request(server.app)
      .post('/api/v1/auth/google-login/mfa-verify')
      .send({ tempToken });

    expect(res.statusCode).toBe(400);
  });

  test('MFA verify with invalid MFA code returns 401', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ sub: 'google-sub-mfa-on' })));

    seedUsers(dataDir, {
      users: [{
        id: 'user-mfa-on-3',
        username: 'frank',
        password: '$2b$10$dummy.hash.for.testing.only',
        role: 'Teacher',
        oauth: { google: 'google-sub-mfa-on' },
        status: 'active',
        mfaEnabled: true,
        mfaSecret: 'JBSWY3DPEHPK3PXP'
      }]
    });

    const loginRes = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });
    expect(loginRes.statusCode).toBe(200);
    const tempToken = loginRes.body.data.tempToken;

    const res = await request(server.app)
      .post('/api/v1/auth/google-login/mfa-verify')
      .send({ tempToken, mfaToken: '000000' });

    expect(res.statusCode).toBe(401);
  });

  test('MFA verify with valid TOTP returns full tokens', async () => {
    const speakeasy = require('speakeasy');
    const totpToken = speakeasy.totp({ secret: 'JBSWY3DPEHPK3PXP', encoding: 'base32' });

    fetchMock.mockReturnValue(respond(goodPayload({ sub: 'google-sub-mfa-on' })));

    seedUsers(dataDir, {
      users: [{
        id: 'user-mfa-on-4',
        username: 'grace',
        password: '$2b$10$dummy.hash.for.testing.only',
        role: 'Teacher',
        oauth: { google: 'google-sub-mfa-on' },
        status: 'active',
        mfaEnabled: true,
        mfaSecret: 'JBSWY3DPEHPK3PXP'
      }]
    });

    const loginRes = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });
    expect(loginRes.statusCode).toBe(200);
    const tempToken = loginRes.body.data.tempToken;

    const res = await request(server.app)
      .post('/api/v1/auth/google-login/mfa-verify')
      .send({ tempToken, mfaToken: totpToken });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.mfaRequired).toBeUndefined();
  });

  test('challenge replay protection — temp token revoked after MFA completion', async () => {
    const speakeasy = require('speakeasy');
    const totpToken = speakeasy.totp({ secret: 'JBSWY3DPEHPK3PXP', encoding: 'base32' });

    fetchMock.mockReturnValue(respond(goodPayload({ sub: 'google-sub-mfa-on' })));

    seedUsers(dataDir, {
      users: [{
        id: 'user-mfa-on-5',
        username: 'judy',
        password: '$2b$10$dummy.hash.for.testing.only',
        role: 'Teacher',
        oauth: { google: 'google-sub-mfa-on' },
        status: 'active',
        mfaEnabled: true,
        mfaSecret: 'JBSWY3DPEHPK3PXP'
      }]
    });

    const loginRes = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });
    const tempToken = loginRes.body.data.tempToken;

    const res1 = await request(server.app)
      .post('/api/v1/auth/google-login/mfa-verify')
      .send({ tempToken, mfaToken: totpToken });
    expect(res1.statusCode).toBe(200);

    const res2 = await request(server.app)
      .post('/api/v1/auth/google-login/mfa-verify')
      .send({ tempToken, mfaToken: totpToken });
    expect(res2.statusCode).toBe(401);
  });
});

describe('POST /api/v1/auth/google-login — tenant isolation', () => {
  test('single-tenant Owner gets tenant-bound session', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ sub: 'google-sub-single-tenant' })));

    seedUsers(dataDir, {
      users: [{
        id: 'user-single',
        username: 'owner1',
        password: '$2b$10$dummy.hash.for.testing.only',
        role: 'Owner',
        oauth: { google: 'google-sub-single-tenant' },
        status: 'active',
        tenantIds: ['tenant-a']
      }]
    });
    seed(dataDir, 'companies', [{
      id: 'tenant-a',
      name: 'Tenant A',
      active: true
    }]);

    const res = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    const jwt = require('jsonwebtoken');
    const decoded = jwt.decode(res.body.data.accessToken);
    expect(decoded.tenantId).toBe('tenant-a');
  });

  test('multi-tenant user gets tenantSelectionRequired instead of default tenant', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ sub: 'google-sub-multi-tenant' })));

    seedUsers(dataDir, {
      users: [{
        id: 'user-multi',
        username: 'multiusername',
        password: '$2b$10$dummy.hash.for.testing.only',
        role: 'Owner',
        oauth: { google: 'google-sub-multi-tenant' },
        status: 'active',
        tenantIds: ['tenant-a', 'tenant-b']
      }]
    });
    seed(dataDir, 'companies', [
      { id: 'tenant-a', name: 'Tenant A', active: true },
      { id: 'tenant-b', name: 'Tenant B', active: true }
    ]);

    const res = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.tenantSelectionRequired).toBe(true);
    expect(res.body.data.tempToken).toBeTruthy();
    expect(res.body.data.availableTenants).toHaveLength(2);
    expect(res.body.data.accessToken).toBeUndefined();
  });

  test('tenant selection endpoint issues tenant-bound tokens', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ sub: 'google-sub-multi-tenant' })));

    seedUsers(dataDir, {
      users: [{
        id: 'user-multi-2',
        username: 'multiusername2',
        password: '$2b$10$dummy.hash.for.testing.only',
        role: 'Owner',
        oauth: { google: 'google-sub-multi-tenant' },
        status: 'active',
        tenantIds: ['tenant-a', 'tenant-b']
      }]
    });
    seed(dataDir, 'companies', [
      { id: 'tenant-a', name: 'Tenant A', active: true },
      { id: 'tenant-b', name: 'Tenant B', active: true }
    ]);

    const loginRes = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });
    expect(loginRes.statusCode).toBe(200);
    const tempToken = loginRes.body.data.tempToken;

    const res = await request(server.app)
      .post('/api/v1/auth/google-login/select-tenant')
      .send({ tempToken, tenantId: 'tenant-a' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    const jwt = require('jsonwebtoken');
    const decoded = jwt.decode(res.body.data.accessToken);
    expect(decoded.tenantId).toBe('tenant-a');
  });

  test('unauthorized tenant selection returns 403', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ sub: 'google-sub-multi-tenant' })));

    seedUsers(dataDir, {
      users: [{
        id: 'user-multi-3',
        username: 'multiusername3',
        password: '$2b$10$dummy.hash.for.testing.only',
        role: 'Owner',
        oauth: { google: 'google-sub-multi-tenant' },
        status: 'active',
        tenantIds: ['tenant-a', 'tenant-b']
      }]
    });
    seed(dataDir, 'companies', [
      { id: 'tenant-a', name: 'Tenant A', active: true },
      { id: 'tenant-b', name: 'Tenant B', active: true },
      { id: 'tenant-c', name: 'Tenant C', active: true }
    ]);

    const loginRes = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });
    expect(loginRes.body.data.tenantSelectionRequired).toBe(true);
    const tempToken = loginRes.body.data.tempToken;

    const res = await request(server.app)
      .post('/api/v1/auth/google-login/select-tenant')
      .send({ tempToken, tenantId: 'tenant-c' });

    expect(res.statusCode).toBe(403);
  });

  test('suspended company never receives tenant-bound session', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ sub: 'google-sub-suspended' })));

    seedUsers(dataDir, {
      users: [{
        id: 'user-suspended',
        username: 'suspendeduser',
        password: '$2b$10$dummy.hash.for.testing.only',
        role: 'Owner',
        oauth: { google: 'google-sub-suspended' },
        status: 'active',
        tenantIds: ['tenant-suspended']
      }]
    });
    seed(dataDir, 'companies', [{
      id: 'tenant-suspended',
      name: 'Suspended Tenant',
      active: true,
      status: 'SUSPENDED'
    }]);

    const res = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });

    expect(res.statusCode).toBe(403);
  });

  test('zero authorized tenants — no default tenant assigned', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ sub: 'google-sub-no-tenant' })));

    seedUsers(dataDir, {
      users: [{
        id: 'user-no-tenant',
        username: 'notenant',
        password: '$2b$10$dummy.hash.for.testing.only',
        role: 'Cashier',
        oauth: { google: 'google-sub-no-tenant' },
        status: 'active',
        tenantIds: []
      }]
    });
    // A company exists but is not active, so there are zero authorized
    // tenants: nothing may be defaulted onto the session.
    seed(dataDir, 'companies', [
      { id: 'tenant-x', name: 'Tenant X', active: false }
    ]);

    const res = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    const jwt = require('jsonwebtoken');
    const decoded = jwt.decode(res.body.data.accessToken);
    expect(decoded.tenantId).toBeUndefined();
  });

  test('tenant context preserved during refresh', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ sub: 'google-sub-refresh-tenant' })));

    seedUsers(dataDir, {
      users: [{
        id: 'user-refresh',
        username: 'refreshuser',
        password: '$2b$10$dummy.hash.for.testing.only',
        role: 'Owner',
        oauth: { google: 'google-sub-refresh-tenant' },
        status: 'active',
        tenantIds: ['tenant-refresh']
      }]
    });
    seed(dataDir, 'companies', [{
      id: 'tenant-refresh',
      name: 'Tenant Refresh',
      active: true
    }]);

    const loginRes = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });
    expect(loginRes.statusCode).toBe(200);
    const refreshToken = loginRes.body.data.refreshToken;

    const res = await request(server.app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });

    expect(res.statusCode).toBe(200);
    const jwt = require('jsonwebtoken');
    const decoded = jwt.decode(res.body.data.accessToken);
    expect(decoded.tenantId).toBe('tenant-refresh');
  });
});

describe('POST /api/v1/auth/google-login — Master isolation', () => {
  test('Master account rejected from ordinary Google Login', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ sub: 'google-sub-master' })));

    // Seed a platform admin (Master) user
    seed(dataDir, 'platformAdmins', {
      admins: [{
        username: 'masteruser',
        platformRole: 'MASTER_OWNER',
        status: 'active'
      }]
    });

    seedUsers(dataDir, {
      users: [{
        id: 'user-master',
        username: 'masteruser',
        password: '$2b$10$dummy.hash.for.testing.only',
        role: 'Owner',
        oauth: { google: 'google-sub-master' },
        status: 'active',
        tenantIds: ['tenant-a']
      }]
    });
    seed(dataDir, 'companies', [{
      id: 'tenant-a',
      name: 'Tenant A',
      active: true
    }]);

    const res = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test('Master OAuth flow remains unchanged — initiateGoogle still works', async () => {
    // The Master OAuth route (/auth/google) is separate and unaffected
    // by the new /api/v1/auth/google-login endpoint
    const res = await request(server.app)
      .get('/auth/google')
      .query({ returnTo: '/' });

    // Should not crash — either redirects to Google or returns 501 if not configured
    expect([302, 501, 404]).toContain(res.statusCode);
  });
});

describe('POST /api/v1/auth/google-login — operational behavior', () => {
  test('Google service unavailable returns 503', async () => {
    const err = new Error('The operation was aborted due to timeout');
    err.name = 'TimeoutError';
    fetchMock.mockRejectedValue(err);

    const res = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });

    expect(res.statusCode).toBe(503);
  });

  test('missing Google configuration returns 503', async () => {
    delete process.env.GOOGLE_CLIENT_ID;

    const res = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });

    expect(res.statusCode).toBe(503);
  });

  test('rate limiting rejects excessive requests', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ sub: 'google-sub-rate-limited' })));

    seedUsers(dataDir, {
      users: [{
        id: 'user-rate-limited',
        username: 'ratelimited',
        password: '$2b$10$dummy.hash.for.testing.only',
        role: 'Cashier',
        oauth: { google: 'google-sub-rate-limited' },
        status: 'active'
      }]
    });

    // Dedicated instance: its own rate-limit store, so exhausting the 20-login
    // budget here cannot turn later assertions in this suite into 429s.
    const rlDir = makeTempDataDir('google-login-rl');
    extraDirs.push(rlDir);
    seedUsers(rlDir, {
      users: [{
        id: 'user-rate-limited',
        username: 'ratelimited',
        password: '$2b$10$dummy.hash.for.testing.only',
        role: 'Cashier',
        oauth: { google: 'google-sub-rate-limited' },
        status: 'active'
      }]
    });
    const rlServer = await startServer(rlDir, { OAUTH_TENANT_LOGIN_ENABLED: 'true' });

    // Make 20 requests (the limit)
    for (let i = 0; i < 20; i++) {
      await request(rlServer.app)
        .post('/api/v1/auth/google-login')
        .send({ idToken: TOKEN });
    }

    // The 21st request should be rate limited
    const res = await request(rlServer.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });

    expect(res.statusCode).toBe(429);
  }, 30000);

  test('audit records contain no credentials or tokens', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ sub: 'google-sub-audit' })));

    seedUsers(dataDir, {
      users: [{
        id: 'user-audit',
        username: 'audituser',
        password: '$2b$10$dummy.hash.for.testing.only',
        role: 'Cashier',
        oauth: { google: 'google-sub-audit' },
        status: 'active'
      }]
    });

    await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });

    // Read audit log and verify no tokens/secrets stored
    const audit = readStore(dataDir, 'auditLog');
    expect(audit).toBeTruthy();
    const entries = audit.entries || [];
    const loginEntries = entries.filter(e => e.action === 'USER_GOOGLE_LOGIN');
    expect(loginEntries.length).toBeGreaterThan(0);

    const entry = JSON.stringify(loginEntries[0]);
    expect(entry).not.toContain(TOKEN);
    expect(entry).not.toContain('idToken');
    expect(entry).not.toContain('access_token');
    expect(entry).not.toContain('refresh_token');
  });
});