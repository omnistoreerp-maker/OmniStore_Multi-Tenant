'use strict';

// P6.67 — M-4: what Universal Google Login does with tenant membership when
// the strict membership policy is ON (ENABLE_TENANT_USER_MEMBERSHIP=true).
//
// Findings this file pins down (no policy changes were made in P6.67):
//   * Google Login filters the selectable tenants by the user's stored
//     `tenantIds` whenever that membership is non-empty, so a member cannot
//     select an active company they do not belong to.
//   * For a Google user with an EMPTY membership the login flow used to fall
//     back to every active company. P6.68 closed that: Google tenant selection
//     now fails closed with TENANT_MEMBERSHIP_REQUIRED (password login and the
//     tenantMembership policy are unchanged). See p668TenantIsolation.test.js.
//
// Deployment prerequisite: every Google-linked account that must be confined to
// a tenant needs a provisioned `tenantIds` membership. Cross-tenant isolation is
// only as strong as that provisioning; this suite does not claim otherwise.

const request = require('supertest');
const jsonwebtoken = require('jsonwebtoken');

const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const TOKEN = 'fake.id.token';

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

function seedUser(user) {
  seed(dataDir, 'users', { users: [user] });
}

function memberUser() {
  return {
    id: 'user-member',
    username: 'member-user',
    password: '$2b$10$dummy.hash.for.testing.only',
    role: 'Owner',
    oauth: { google: 'google-sub-member' },
    status: 'active',
    tenantIds: ['tenant-a', 'tenant-b']
  };
}

function unprovisionedUser() {
  return {
    id: 'user-no-membership',
    username: 'no-membership-user',
    password: '$2b$10$dummy.hash.for.testing.only',
    role: 'Owner',
    oauth: { google: 'google-sub-no-membership' },
    status: 'active'
  };
}

async function startLogin(sub) {
  fetchMock.mockReturnValue(respond(googlePayload(sub)));
  return request(server.app).post('/api/v1/auth/google-login').send({ idToken: TOKEN });
}

function assertNoSession(res) {
  expect(res.body).toBeTruthy();
  expect(res.body.success).toBe(false);
  const data = res.body.data || {};
  expect(data.accessToken).toBeUndefined();
  expect(data.refreshToken).toBeUndefined();
}

beforeAll(() => {
  dataDir = makeTempDataDir('p667-tenant-policy');
  process.env.JWT_SECRET = 'test-jwt-secret-p667-tenant-policy';
  process.env.NODE_ENV = 'test';
  process.env.OAUTH_ENABLED = 'false';
  // The strict membership policy this file is about.
  process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
  global.fetch = fetchMock;
});

afterAll(() => {
  delete process.env.ENABLE_TENANT_USER_MEMBERSHIP;
  delete global.fetch;
});

beforeEach(() => {
  fetchMock.mockReset();
  server = startServer(dataDir);
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  delete process.env.GOOGLE_TOKENINFO_URL;
  seed(dataDir, 'companies', COMPANIES);
});

describe('P6.67 M-4 — strict tenant membership (ENABLE_TENANT_USER_MEMBERSHIP=true)', () => {
  test('a member only sees the active companies in their own membership', async () => {
    seedUser(memberUser());
    const res = await startLogin('google-sub-member');

    expect(res.statusCode).toBe(200);
    expect(res.body.data.tenantSelectionRequired).toBe(true);

    const offered = res.body.data.availableTenants.map((t) => t.id).sort();
    expect(offered).toEqual(['tenant-a', 'tenant-b']);
    expect(offered).not.toContain('tenant-c');
  });

  test('a member cannot select an active company outside their membership', async () => {
    seedUser(memberUser());
    const login = await startLogin('google-sub-member');
    const tempToken = login.body.data.tempToken;
    expect(tempToken).toBeTruthy();

    const res = await request(server.app)
      .post('/api/v1/auth/google-login/select-tenant')
      .send({ tempToken, tenantId: 'tenant-c' });

    expect(res.statusCode).toBe(403);
    assertNoSession(res);
  });

  test('a member can select a company inside their membership and is bound to it', async () => {
    seedUser(memberUser());
    const login = await startLogin('google-sub-member');
    const tempToken = login.body.data.tempToken;

    const res = await request(server.app)
      .post('/api/v1/auth/google-login/select-tenant')
      .send({ tempToken, tenantId: 'tenant-a' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    const decoded = jsonwebtoken.decode(res.body.data.accessToken);
    expect(decoded.tenantId).toBe('tenant-a');
  });

  test('P6.68 fail-closed: an EMPTY membership is refused and offered no companies', async () => {
    // Updated by P6.68. Provision `tenantIds` for every Google user that must
    // sign in through a multi-company catalog; the flow no longer falls back to
    // the whole active catalog.
    seedUser(unprovisionedUser());
    const res = await startLogin('google-sub-no-membership');

    expect(res.statusCode).toBe(403);
    expect(res.body.details && res.body.details.code).toBe('TENANT_MEMBERSHIP_REQUIRED');
    expect(res.body.data).toBeFalsy();
    expect(JSON.stringify(res.body)).not.toContain('Tenant C');
  });
});
