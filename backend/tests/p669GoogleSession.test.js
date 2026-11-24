'use strict';

// P6.69 — TWO REAL INTEGRATION TESTS.
//
// A. A Google-linked account with EXPLICIT membership that resolves to NO
//    active authorized tenant. The login legitimately issues a session with no
//    tenant claim; that real access token is then used against a real
//    tenant-scoped READ endpoint and a real tenant-scoped WRITE endpoint, plus
//    requests that supply tenant identifiers in the query, the body and
//    headers. Nothing may reach tenant-owned data and no write may land.
//
// B. The real MFA membership-revocation race: a real Google MFA challenge is
//    issued for tenant-a, the authoritative membership is revoked through
//    usersService.update(), and the still-valid challenge plus a still-valid
//    TOTP code are submitted. The completion must be refused with no token or
//    cookie, and the challenge must not be replayable.
//
// The ONLY stubbed external dependency is the Google tokeninfo HTTP call
// (global.fetch), exactly as the existing verified Google suites do.

const path = require('path');
const request = require('supertest');
const jsonwebtoken = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const Database = require('better-sqlite3');

const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const ID_TOKEN = 'fake.id.token';

const READ_PATH = '/api/v1/tenant/education/academic-years';

const fetchMock = jest.fn();
let server;
let dataDir;
let challengeDbPath;

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

async function googleLogin(sub) {
  fetchMock.mockReturnValue(respond(googlePayload(sub)));
  return request(server.app).post('/api/v1/auth/google-login').send({ idToken: ID_TOKEN });
}

function bearer(token) {
  return { Authorization: 'Bearer ' + token };
}

function authCookies(res) {
  return (res.headers['set-cookie'] || []).filter((c) => /^(access_token|refresh_token)=/.test(c));
}

function expectNoSession(res) {
  const data = res.body.data || {};
  expect(data.accessToken).toBeUndefined();
  expect(data.refreshToken).toBeUndefined();
  expect(authCookies(res)).toEqual([]);
}

const TENANT_A = { id: 'tenant-a', name: 'Tenant A', active: true };
const TENANT_B = { id: 'tenant-b', name: 'Tenant B', active: true };

const SEEDED_YEAR = {
  id: 'ay-p669',
  tenantId: 'tenant-a',
  centerId: 'center-a',
  yearCode: 'AY-LEAK',
  name: 'Tenant A private year',
  status: 'active'
};

const VALID_WRITE = {
  centerId: 'center-a',
  yearCode: 'P669-WRITE',
  name: 'P669 write probe',
  startDate: '2026-01-01',
  endDate: '2026-12-31'
};

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.OAUTH_ENABLED = 'false';
  process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
  global.fetch = fetchMock;
});

afterAll(() => {
  delete process.env.ENABLE_TENANT_USER_MEMBERSHIP;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.CHALLENGE_DB_PATH;
  delete global.fetch;
});

beforeEach(() => {
  dataDir = makeTempDataDir('p669-final');
  challengeDbPath = path.join(dataDir, 'login-challenges.sqlite');
  fetchMock.mockReset();
  // startServer() clears the OAuth instance env keys, so the Google client
  // id is handed to it explicitly; CHALLENGE_DB_PATH is read lazily when the
  // first challenge is persisted, so it is set once the app is booted.
  server = startServer(dataDir, { GOOGLE_CLIENT_ID: CLIENT_ID, OAUTH_TENANT_LOGIN_ENABLED: 'true' });
  process.env.CHALLENGE_DB_PATH = challengeDbPath;
});

describe('P6.69-A — explicit membership with no active tenant match', () => {
  test('A. session is issued without a tenant claim and cannot reach tenant-owned read or write resources', async () => {
    seed(dataDir, 'companies', [TENANT_A, TENANT_B]);

    // Explicit, non-empty membership that matches NO active company.
    seed(dataDir, 'users', {
      users: [
        {
          id: 'user-p669-a',
          username: 'p669-a',
          password: '$2b$10$dummy.hash.for.testing.only',
          role: 'Owner',
          status: 'active',
          oauth: { google: 'google-sub-a' },
          tenantIds: ['tenant-ghost']
        }
      ]
    });

    // Tenant-owned data + a valid center, both belonging ONLY to tenant-a.
    seed(dataDir, 'educationAcademicYears', { academicYears: [SEEDED_YEAR] });
    seed(dataDir, 'educationCenters', {
      centers: [{ id: 'center-a', tenantId: 'tenant-a', centerCode: 'C-A', name: 'Center A', status: 'active' }]
    });

    const login = await googleLogin('google-sub-a');
    expect(login.statusCode).toBe(200);

    const token = login.body.data.accessToken;
    expect(typeof token).toBe('string');

    const claims = jsonwebtoken.decode(token);
    expect(claims.sub).toBe('user-p669-a');
    // The server never invents a tenant for this account.
    expect(claims.tenantId).toBeUndefined();
    expect(login.body.data.user.tenantId).toBeUndefined();

    // 1. Real tenant-scoped READ with the real access token.
    const read = await request(server.app).get(READ_PATH).set(bearer(token));
    expect(read.statusCode).toBe(400);
    expect(read.body.message).toBe('Tenant context required');
    expect(JSON.stringify(read.body)).not.toContain('AY-LEAK');

    // 2. Real tenant-scoped WRITE with the real access token.
    const write = await request(server.app).post(READ_PATH).set(bearer(token)).send(VALID_WRITE);
    expect(write.statusCode).toBe(400);
    expect(write.body.message).toBe('Tenant context required');

    // 3. Tenant identifiers supplied in the QUERY STRING.
    const queryRead = await request(server.app)
      .get(READ_PATH + '?tenantId=tenant-a&companyId=tenant-a')
      .set(bearer(token));
    expect(queryRead.statusCode).toBe(400);
    expect(queryRead.body.message).toBe('Tenant context required');
    expect(JSON.stringify(queryRead.body)).not.toContain('AY-LEAK');

    // 4. Tenant identifiers supplied in the BODY (write).
    const bodyWrite = await request(server.app)
      .post(READ_PATH)
      .set(bearer(token))
      .send(Object.assign({}, VALID_WRITE, { tenantId: 'tenant-a', companyId: 'tenant-a', tenant: 'tenant-a' }));
    expect(bodyWrite.statusCode).toBe(400);
    expect(bodyWrite.body.message).toBe('Tenant context required');

    // 5. Tenant-identifying HEADERS on read and write.
    const headerRead = await request(server.app)
      .get(READ_PATH)
      .set(bearer(token))
      .set('x-tenant-id', 'tenant-a')
      .set('x-company-id', 'tenant-a')
      .set('x-tenant', 'tenant-a');
    expect(headerRead.statusCode).toBe(400);
    expect(headerRead.body.message).toBe('Tenant context required');
    expect(JSON.stringify(headerRead.body)).not.toContain('AY-LEAK');

    const headerWrite = await request(server.app)
      .post(READ_PATH)
      .set(bearer(token))
      .set('x-tenant-id', 'tenant-a')
      .set('x-company-id', 'tenant-a')
      .set('x-tenant', 'tenant-a')
      .send(VALID_WRITE);
    expect(headerWrite.statusCode).toBe(400);
    expect(headerWrite.body.message).toBe('Tenant context required');

    // 6. Authoritative store: the seeded tenant-owned row is untouched and no
    //    probe row from ANY attempt was persisted.
    const store = readStore(dataDir, 'educationAcademicYears');
    const years = (store && store.academicYears) || [];
    const codes = years.map((y) => y.yearCode);
    expect(codes).toContain('AY-LEAK');
    expect(codes).not.toContain('P669-WRITE');
    expect(years.filter((y) => String(y.tenantId) === 'tenant-a')).toHaveLength(1);

    // 7. No middleware selected a default/first tenant for the session.
    const me = await request(server.app).get('/api/v1/auth/me').set(bearer(token));
    expect(me.statusCode).toBe(200);
    expect(me.body.data.user.tenantId).toBeUndefined();
    expect(me.body.data.effectiveRole).toBeUndefined();
  });
});

describe('P6.69-B — MFA membership revocation race', () => {
  test('B. revoking membership before MFA verification blocks the session and the challenge cannot be replayed', async () => {
    const secret = speakeasy.generateSecret({ length: 20, name: 'p669-final' }).base32;

    seed(dataDir, 'companies', [TENANT_A]);
    seed(dataDir, 'users', {
      users: [
        {
          id: 'user-p669-b',
          username: 'p669-b',
          password: '$2b$10$dummy.hash.for.testing.only',
          role: 'Owner',
          status: 'active',
          oauth: { google: 'google-sub-b' },
          tenantIds: ['tenant-a'],
          mfaEnabled: true,
          mfaSecret: secret
        }
      ]
    });

    // 1-2. Real Google Login issues a real, persisted MFA challenge.
    const login = await googleLogin('google-sub-b');
    expect(login.statusCode).toBe(200);
    expect(login.body.data.mfaRequired).toBe(true);
    const tempToken = login.body.data.tempToken;
    expect(typeof tempToken).toBe('string');
    expectNoSession(login);

    // Real modules of THIS app instance (same registry the server uses).
    const jwtUtils = require('../utils/jwt');
    const challengeStore = require('../utils/challengeStore.sqlite');
    const mfaService = require('../services/mfa.service');
    const usersService = require('../services/users.service');

    // 3. The challenge and the MFA code are BOTH valid before the mutation.
    const payload = jwtUtils.verifyChallengeToken(tempToken, jwtUtils.CHALLENGE_PURPOSES.GOOGLE_MFA);
    expect(payload).toBeTruthy();
    expect(payload.sub).toBe('user-p669-b');
    expect(payload.tenantId).toBe('tenant-a');

    const hash = challengeStore.hashChallenge(tempToken);
    const db = new Database(challengeDbPath, { readonly: true });
    let row;
    try {
      row = db.prepare('SELECT sub, purpose, expiresAt FROM challenges WHERE hash = ?').get(hash);
    } finally {
      db.close();
    }
    expect(row).toBeTruthy();
    expect(row.sub).toBe('user-p669-b');
    expect(row.purpose).toBe('google_mfa');
    expect(Number(row.expiresAt)).toBeGreaterThan(Date.now());

    const code = speakeasy.totp({ secret, encoding: 'base32' });
    expect(mfaService.verifyToken(secret, code).verified).toBe(true);
    expect(usersService.getById('user-p669-b').tenantIds).toEqual(['tenant-a']);

    // 4. Revoke tenant-a through the authoritative service path.
    const revoked = usersService.update('user-p669-b', { tenantIds: [] });
    expect(revoked.error).toBeUndefined();
    expect(usersService.getById('user-p669-b').tenantIds).toEqual([]);

    // 5-7. Submit the still-valid challenge with the still-valid code.
    const verify = await request(server.app)
      .post('/api/v1/auth/google-login/mfa-verify')
      .send({ tempToken: tempToken, mfaToken: code });

    expect(verify.statusCode).toBe(403);
    expect(verify.body.details && verify.body.details.code).toBe('TENANT_MEMBERSHIP_REQUIRED');
    expectNoSession(verify);

    // 8. Replay of the same challenge cannot produce a session.
    const replay = await request(server.app)
      .post('/api/v1/auth/google-login/mfa-verify')
      .send({ tempToken: tempToken, mfaToken: code });

    expect(replay.statusCode).toBe(401);
    expect(replay.body.message).toBe('Invalid or expired challenge');
    expectNoSession(replay);

    // The challenge really was consumed by the refused completion.
    const db2 = new Database(challengeDbPath, { readonly: true });
    let after;
    try {
      after = db2.prepare('SELECT hash FROM challenges WHERE hash = ?').get(hash);
    } finally {
      db2.close();
    }
    expect(after).toBeUndefined();
  });
});
