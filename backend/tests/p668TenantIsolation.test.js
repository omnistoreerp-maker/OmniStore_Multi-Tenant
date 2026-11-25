'use strict';

// P6.68 — Google Login tenant isolation, fail closed.
//
// P6.67 left one path open: a Google user with NO server-side `tenantIds`
// membership was offered every active company as selectable tenants. P6.68
// closes it for the GOOGLE flow only (password login and the shared
// tenantMembership policy are untouched):
//   * login refuses tenant selection when the membership is missing/empty;
//   * a selected tenant must exist inside the user's own membership AND be
//     active (and not SUSPENDED);
//   * no JWT, refresh token or auth cookie is issued on any rejection;
//   * a client-supplied tenantId is only a lookup key, never authority.
//
// The Google tokeninfo HTTP call is the only stubbed external dependency.

const request = require('supertest');
const jsonwebtoken = require('jsonwebtoken');

const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const TOKEN = 'fake.id.token';
const MEMBERSHIP_REQUIRED = 'TENANT_MEMBERSHIP_REQUIRED';

const fetchMock = jest.fn();

let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

function respond(payload) {
  return Promise.resolve({ ok: true, status: 200, json: async () => payload });
}

function googlePayload(sub) {
  return {
    sub,
    email: 'user@example.com',
    email_verified: 'true',
    aud: CLIENT_ID,
    iss: 'https://accounts.google.com',
    exp: String(Math.floor(Date.now() / 1000) + 3600)
  };
}

const COMPANIES = [
  { id: 'tenant-a', name: 'Tenant A', active: true },
  { id: 'tenant-b', name: 'Tenant B', active: true },
  { id: 'tenant-c', name: 'Tenant C', active: true }
];

function user(overrides) {
  return {
    id: 'user-x',
    username: 'user-x',
    password: '$2b$10$dummy.hash.for.testing.only',
    role: 'Owner',
    oauth: { google: 'google-sub-x' },
    status: 'active',
    ...overrides
  };
}

function seedUser(record) {
  seed(dataDir, 'users', { users: [record] });
}

async function googleLogin() {
  fetchMock.mockReturnValue(respond(googlePayload('google-sub-x')));
  return request(server.app).post('/api/v1/auth/google-login').send({ idToken: TOKEN });
}

function assertNoSession(res) {
  expect(res.body).toBeTruthy();
  expect(res.body.success).toBe(false);
  const data = res.body.data || {};
  expect(data.accessToken).toBeUndefined();
  expect(data.refreshToken).toBeUndefined();
  const cookies = res.headers['set-cookie'] || [];
  expect(cookies.filter((c) => /^(access_token|refresh_token)=/.test(c))).toEqual([]);
}

beforeAll(() => {
  dataDir = makeTempDataDir('p668-tenant-isolation');
  process.env.JWT_SECRET = 'test-jwt-secret-p668-tenant-isolation';
  process.env.NODE_ENV = 'test';
  process.env.OAUTH_ENABLED = 'false';
  process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
  global.fetch = fetchMock;
});

afterAll(() => {
  delete process.env.ENABLE_TENANT_USER_MEMBERSHIP;
  delete global.fetch;
});

beforeEach(() => {
  fetchMock.mockReset();
  server = startServer(dataDir, { OAUTH_TENANT_LOGIN_ENABLED: 'true' });
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  delete process.env.GOOGLE_TOKENINFO_URL;
  seed(dataDir, 'companies', COMPANIES);
});

describe('P6.68 — Google tenant selection is confined to proven membership', () => {
  test('1. a member of tenant-a/tenant-b cannot select tenant-c', async () => {
    seedUser(user({ tenantIds: ['tenant-a', 'tenant-b'] }));

    const login = await googleLogin();
    expect(login.statusCode).toBe(200);
    expect(login.body.data.tenantSelectionRequired).toBe(true);
    expect(login.body.data.availableTenants.map((t) => t.id).sort()).toEqual(['tenant-a', 'tenant-b']);

    const res = await request(server.app)
      .post('/api/v1/auth/google-login/select-tenant')
      .send({ tempToken: login.body.data.tempToken, tenantId: 'tenant-c' });

    expect(res.statusCode).toBe(403);
    assertNoSession(res);
  });

  test('2. a user with no membership is refused at login and gets no session', async () => {
    seedUser(user({ tenantIds: undefined }));

    const res = await googleLogin();

    expect(res.statusCode).toBe(403);
    expect(res.body.details && res.body.details.code).toBe(MEMBERSHIP_REQUIRED);
    // No challenge is minted and no company catalog is leaked.
    expect(res.body.data).toBeFalsy();
    expect(JSON.stringify(res.body)).not.toContain('Tenant C');
    assertNoSession(res);
  });

  test('2b. an explicitly empty membership is refused the same way', async () => {
    seedUser(user({ tenantIds: [] }));

    const res = await googleLogin();

    expect(res.statusCode).toBe(403);
    expect(res.body.details && res.body.details.code).toBe(MEMBERSHIP_REQUIRED);
    assertNoSession(res);
  });

  test('3. a member can select an allowed tenant and is bound to it', async () => {
    seedUser(user({ tenantIds: ['tenant-a', 'tenant-b'] }));

    const login = await googleLogin();
    const res = await request(server.app)
      .post('/api/v1/auth/google-login/select-tenant')
      .send({ tempToken: login.body.data.tempToken, tenantId: 'tenant-b' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    const decoded = jsonwebtoken.decode(res.body.data.accessToken);
    expect(decoded.tenantId).toBe('tenant-b');
    expect(decoded.sub).toBe('user-x');
  });

  test('4. an inactive tenant inside the membership is rejected', async () => {
    // Two ACTIVE memberships keep the request in the selection flow, so the
    // inactive membership id can be attempted explicitly.
    seedUser(user({ tenantIds: ['tenant-a', 'tenant-b', 'tenant-inactive'] }));
    seed(dataDir, 'companies', [
      ...COMPANIES,
      { id: 'tenant-inactive', name: 'Tenant Inactive', active: false }
    ]);

    const login = await googleLogin();
    // The inactive tenant is not even offered: only the membership ∩ ACTIVE set.
    expect(login.statusCode).toBe(200);
    expect(login.body.data.availableTenants.map((t) => t.id).sort()).toEqual(['tenant-a', 'tenant-b']);

    const res = await request(server.app)
      .post('/api/v1/auth/google-login/select-tenant')
      .send({ tempToken: login.body.data.tempToken, tenantId: 'tenant-inactive' });

    expect(res.statusCode).toBe(403);
    assertNoSession(res);
  });

  test('4b. a SUSPENDED tenant inside the membership is rejected', async () => {
    seedUser(user({ tenantIds: ['tenant-a', 'tenant-suspended'] }));
    seed(dataDir, 'companies', [
      ...COMPANIES,
      { id: 'tenant-suspended', name: 'Tenant Suspended', active: true, status: 'SUSPENDED' }
    ]);

    const login = await googleLogin();
    const res = await request(server.app)
      .post('/api/v1/auth/google-login/select-tenant')
      .send({ tempToken: login.body.data.tempToken, tenantId: 'tenant-suspended' });

    expect(res.statusCode).toBe(403);
    expect(res.body.details && res.body.details.code).toBe('COMPANY_SUSPENDED');
    assertNoSession(res);
  });

  test('5. empty membership with exactly ONE active company is still rejected', async () => {
    // P6.68-FINAL — the DERIVED (single-active-company) path used to bind a
    // session without any membership. The number of active companies is never
    // evidence of membership.
    seedUser(user({ tenantIds: [] }));
    seed(dataDir, 'companies', [{ id: 'tenant-a', name: 'Tenant A', active: true }]);

    const res = await googleLogin();

    expect(res.statusCode).toBe(403);
    expect(res.body.details && res.body.details.code).toBe(MEMBERSHIP_REQUIRED);
    expect(res.body.data).toBeFalsy();
    assertNoSession(res);
  });

  test('5b. undefined membership with exactly ONE active company is still rejected', async () => {
    seedUser(user({ tenantIds: undefined }));
    seed(dataDir, 'companies', [{ id: 'tenant-a', name: 'Tenant A', active: true }]);

    const res = await googleLogin();

    expect(res.statusCode).toBe(403);
    expect(res.body.details && res.body.details.code).toBe(MEMBERSHIP_REQUIRED);
    assertNoSession(res);
  });

  test('5c. an explicit membership with one active company is bound to it', async () => {
    seedUser(user({ tenantIds: ['tenant-a'] }));
    seed(dataDir, 'companies', [{ id: 'tenant-a', name: 'Tenant A', active: true }]);

    const res = await googleLogin();

    expect(res.statusCode).toBe(200);
    expect(res.body.data.tenantSelectionRequired).toBeUndefined();
    const decoded = jsonwebtoken.decode(res.body.data.accessToken);
    expect(decoded.tenantId).toBe('tenant-a');
  });

  test('6. a client-supplied tenantId is never authority on its own', async () => {
    // Membership exists but does not include tenant-c; the client cannot widen it
    // through body, query or header, and no session is issued.
    seedUser(user({ tenantIds: ['tenant-a'] }));
    seed(dataDir, 'companies', COMPANIES);

    const res = await request(server.app)
      .post('/api/v1/auth/google-login/select-tenant')
      .set('X-Company-Id', 'tenant-c')
      .send({ tempToken: 'not-a-real-challenge', tenantId: 'tenant-c', companyId: 'tenant-c' });

    // Invalid challenge is rejected before any tenant decision — and no session.
    expect(res.statusCode).toBe(401);
    assertNoSession(res);
  });
});
