'use strict';

// P6.65 — Controller-level integration tests for the durable, single-use
// Google Login challenge.
//
// These tests drive the REAL Express endpoints. The only things replaced are
// (a) the external Google tokeninfo HTTP response and (b) the challenge store's
// database handle, which is injected through the controller's `_setChallengeDbForTests`
// seam so database failures can be simulated deterministically.
//
// Proven here:
//   10. Database unavailable        → no session issued.
//   11. Transaction/write failure   → no session issued.
//   12. Commit failure              → no session issued.
//   13. MFA verify cannot issue tokens after a failed consumption.
//   14. Tenant selection cannot issue tokens after a failed consumption.
//   15. Successful tenant selection binds the selected tenant.
//   16. Cross-tenant isolation (a burned selection challenge cannot be reused
//       to obtain a differently-bound session).

const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');
const speakeasy = require('speakeasy');
const jsonwebtoken = require('jsonwebtoken');

const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const TOKEN = 'fake.id.token';
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

const fetchMock = jest.fn();

let server;
let dataDir;
let controller;
const extraDirs = [];
const challengeDbs = [];

registerCleanup(() => [server], () => [dataDir, ...extraDirs, ...challengeDbs]);

function respond(payload, { ok = true, status = 200 } = {}) {
  return Promise.resolve({ ok, status, json: async () => payload });
}

function goodPayload(overrides = {}) {
  return {
    sub: 'google-sub-challenge',
    email: 'user@example.com',
    email_verified: 'true',
    aud: CLIENT_ID,
    iss: 'https://accounts.google.com',
    exp: String(Math.floor(Date.now() / 1000) + 3600),
    ...overrides
  };
}

function seedUser(user) {
  seed(dataDir, 'users', { users: [user] });
}

function mfaUser(overrides = {}) {
  return {
    id: 'user-mfa',
    username: 'mfa-user',
    password: '$2b$10$dummy.hash.for.testing.only',
    role: 'Teacher',
    oauth: { google: 'google-sub-challenge' },
    status: 'active',
    mfaEnabled: true,
    mfaSecret: TOTP_SECRET,
    ...overrides
  };
}

function multiTenantUser() {
  return {
    id: 'user-multi',
    username: 'multi-user',
    password: '$2b$10$dummy.hash.for.testing.only',
    role: 'Owner',
    oauth: { google: 'google-sub-challenge' },
    status: 'active',
    tenantIds: ['tenant-a', 'tenant-b']
  };
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

// A database handle that exists but cannot serve queries — the shape a caller
// sees when SQLite is locked/unavailable.
function unavailableDb() {
  const fail = () => {
    const err = new Error('database is locked');
    err.code = 'SQLITE_BUSY';
    throw err;
  };
  return { open: true, prepare: () => ({ run: fail, get: fail }) };
}

// INSERT fails (issuance write/transaction failure); consumption path intact.
function insertFailingDb() {
  const fail = () => {
    const err = new Error('disk I/O error');
    err.code = 'SQLITE_IOERR';
    throw err;
  };
  return {
    open: true,
    prepare(sql) {
      if (/^\s*INSERT/i.test(sql)) return { run: fail, get: fail };
      return { run: () => ({ changes: 1 }), get: () => undefined };
    }
  };
}

// DELETE fails (commit/write failure at consumption time).
function deleteFailingDb() {
  const fail = () => {
    const err = new Error('disk I/O error');
    err.code = 'SQLITE_IOERR';
    throw err;
  };
  return {
    open: true,
    prepare(sql) {
      if (/^\s*DELETE/i.test(sql)) return { run: fail, get: fail };
      return { run: () => ({ changes: 1 }), get: () => undefined };
    }
  };
}

async function loginMfaUser() {
  const res = await request(server.app)
    .post('/api/v1/auth/google-login')
    .send({ idToken: TOKEN });
  expect(res.statusCode).toBe(200);
  expect(res.body.data.mfaRequired).toBe(true);
  expect(res.body.data.tempToken).toBeTruthy();
  return res.body.data.tempToken;
}

async function loginMultiTenantUser(tenantId) {
  const loginRes = await request(server.app)
    .post('/api/v1/auth/google-login')
    .send({ idToken: TOKEN });
  expect(loginRes.statusCode).toBe(200);
  expect(loginRes.body.data.tenantSelectionRequired).toBe(true);
  const tempToken = loginRes.body.data.tempToken;
  expect(tempToken).toBeTruthy();
  return request(server.app)
    .post('/api/v1/auth/google-login/select-tenant')
    .send({ tempToken, tenantId });
}

beforeAll(() => {
  dataDir = makeTempDataDir('google-challenge');
  process.env.JWT_SECRET = 'test-jwt-secret-for-google-challenge-suites';
  process.env.NODE_ENV = 'test';
  process.env.OAUTH_ENABLED = 'false';
  global.fetch = fetchMock;
});

beforeEach(async () => {
  fetchMock.mockReset();
  server = await startServer(dataDir);
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  delete process.env.GOOGLE_TOKENINFO_URL;
  // The data directory is shared by this suite, so clear the company catalog:
  // a leftover multi-company catalog would make ambiguous tenant resolution
  // intercept single-tenant users before they reach the MFA branch.
  seed(dataDir, 'companies', []);

  // Isolated challenge database per test, so no test can consume another's row.
  const dbPath = path.join(
    os.tmpdir(),
    `omnistore-challenge-it-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`
  );
  challengeDbs.push(dbPath);
  process.env.CHALLENGE_DB_PATH = dbPath;
  controller = require('../controllers/auth.controller');
  controller._setChallengeDbForTests(null);
});

afterAll(() => {
  delete process.env.CHALLENGE_DB_PATH;
  for (const file of challengeDbs) {
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(file + suffix); } catch (_) {}
    }
  }
});

describe('Google Login challenge — storage failures never issue a session', () => {
  test('10. database unavailable while issuing the MFA challenge: no session', async () => {
    seedUser(mfaUser());
    fetchMock.mockReturnValue(respond(goodPayload()));
    controller._setChallengeDbForTests(unavailableDb());

    const res = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });

    expect(res.statusCode).toBe(500);
    assertNoSession(res);
    expect(res.body.data && res.body.data.tempToken).toBeUndefined();
  });

  test('11. transaction/write failure while issuing the MFA challenge: no session', async () => {
    seedUser(mfaUser());
    fetchMock.mockReturnValue(respond(goodPayload()));
    controller._setChallengeDbForTests(insertFailingDb());

    const res = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });

    expect(res.statusCode).toBe(500);
    assertNoSession(res);
    expect(res.body.data && res.body.data.tempToken).toBeUndefined();
  });

  test('10b. database unavailable while consuming the MFA challenge: no session', async () => {
    seedUser(mfaUser());
    fetchMock.mockReturnValue(respond(goodPayload()));
    const tempToken = await loginMfaUser();

    controller._setChallengeDbForTests(unavailableDb());
    const totp = speakeasy.totp({ secret: TOTP_SECRET, encoding: 'base32' });
    const res = await request(server.app)
      .post('/api/v1/auth/google-login/mfa-verify')
      .send({ tempToken, mfaToken: totp });

    expect(res.statusCode).toBe(401);
    assertNoSession(res);
  });

  test('12. commit failure while consuming the MFA challenge: no session', async () => {
    seedUser(mfaUser());
    fetchMock.mockReturnValue(respond(goodPayload()));
    const tempToken = await loginMfaUser();

    controller._setChallengeDbForTests(deleteFailingDb());
    const totp = speakeasy.totp({ secret: TOTP_SECRET, encoding: 'base32' });
    const res = await request(server.app)
      .post('/api/v1/auth/google-login/mfa-verify')
      .send({ tempToken, mfaToken: totp });

    expect(res.statusCode).toBe(401);
    assertNoSession(res);
  });

  test('10c. database unavailable while consuming tenant selection: no session', async () => {
    seedUser(multiTenantUser());
    seed(dataDir, 'companies', [
      { id: 'tenant-a', name: 'Tenant A', active: true },
      { id: 'tenant-b', name: 'Tenant B', active: true }
    ]);
    fetchMock.mockReturnValue(respond(goodPayload()));

    const loginRes = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });
    const tempToken = loginRes.body.data.tempToken;
    expect(tempToken).toBeTruthy();

    controller._setChallengeDbForTests(unavailableDb());
    const res = await request(server.app)
      .post('/api/v1/auth/google-login/select-tenant')
      .send({ tempToken, tenantId: 'tenant-a' });

    expect(res.statusCode).toBe(401);
    assertNoSession(res);
  });

  test('12b. commit failure while consuming tenant selection: no session', async () => {
    seedUser(multiTenantUser());
    seed(dataDir, 'companies', [
      { id: 'tenant-a', name: 'Tenant A', active: true },
      { id: 'tenant-b', name: 'Tenant B', active: true }
    ]);
    fetchMock.mockReturnValue(respond(goodPayload()));

    const loginRes = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });
    const tempToken = loginRes.body.data.tempToken;

    controller._setChallengeDbForTests(deleteFailingDb());
    const res = await request(server.app)
      .post('/api/v1/auth/google-login/select-tenant')
      .send({ tempToken, tenantId: 'tenant-a' });

    expect(res.statusCode).toBe(401);
    assertNoSession(res);
  });

  test('14. MFA verify does not issue tokens once the challenge is consumed', async () => {
    seedUser(mfaUser());
    fetchMock.mockReturnValue(respond(goodPayload()));
    const tempToken = await loginMfaUser();

    const totp = speakeasy.totp({ secret: TOTP_SECRET, encoding: 'base32' });
    const first = await request(server.app)
      .post('/api/v1/auth/google-login/mfa-verify')
      .send({ tempToken, mfaToken: totp });
    expect(first.statusCode).toBe(200);
    expect(first.body.data.accessToken).toBeTruthy();

    const replay = await request(server.app)
      .post('/api/v1/auth/google-login/mfa-verify')
      .send({ tempToken, mfaToken: totp });
    expect(replay.statusCode).toBe(401);
    assertNoSession(replay);
  });
});

describe('Google Login challenge — tenant binding and isolation', () => {
  test('15. successful tenant selection binds the selected tenant in the session', async () => {
    seedUser(multiTenantUser());
    seed(dataDir, 'companies', [
      { id: 'tenant-a', name: 'Tenant A', active: true },
      { id: 'tenant-b', name: 'Tenant B', active: true }
    ]);
    fetchMock.mockReturnValue(respond(goodPayload()));

    const res = await loginMultiTenantUser('tenant-a');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();

    const decoded = jsonwebtoken.decode(res.body.data.accessToken);
    expect(decoded.tenantId).toBe('tenant-a');
    expect(decoded.sub).toBe('user-multi');
  });

  test('16. a consumed selection challenge cannot be reused for another tenant', async () => {
    seedUser(multiTenantUser());
    seed(dataDir, 'companies', [
      { id: 'tenant-a', name: 'Tenant A', active: true },
      { id: 'tenant-b', name: 'Tenant B', active: true }
    ]);
    fetchMock.mockReturnValue(respond(goodPayload()));

    const loginRes = await request(server.app)
      .post('/api/v1/auth/google-login')
      .send({ idToken: TOKEN });
    const tempToken = loginRes.body.data.tempToken;

    const first = await request(server.app)
      .post('/api/v1/auth/google-login/select-tenant')
      .send({ tempToken, tenantId: 'tenant-a' });
    expect(first.statusCode).toBe(200);
    expect(jsonwebtoken.decode(first.body.data.accessToken).tenantId).toBe('tenant-a');

    const replay = await request(server.app)
      .post('/api/v1/auth/google-login/select-tenant')
      .send({ tempToken, tenantId: 'tenant-b' });
    expect(replay.statusCode).toBe(401);
    assertNoSession(replay);
  });

  test('16b. selecting a company the user does not belong to is rejected', async () => {
    seedUser(multiTenantUser());
    seed(dataDir, 'companies', [
      { id: 'tenant-a', name: 'Tenant A', active: true },
      { id: 'tenant-b', name: 'Tenant B', active: true },
      { id: 'tenant-c', name: 'Tenant C', active: true }
    ]);
    fetchMock.mockReturnValue(respond(goodPayload()));

    const res = await loginMultiTenantUser('tenant-c');
    expect(res.statusCode).toBe(403);
    assertNoSession(res);
  });
});
