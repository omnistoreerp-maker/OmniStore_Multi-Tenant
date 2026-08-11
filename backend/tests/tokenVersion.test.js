'use strict';

// Phase D — tokenVersion: the `ver` JWT claim, access/refresh validation, and
// proof that token-level revocation (tokenStore) still works alongside it.

const request = require('supertest');
const { startServer, TEST_JWT_SECRET } = require('./helpers/testServer');
const { createUser, login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  const s = await startServer();
  server = s.app;
  dataDir = s.dataDir;
});

function jwtFor() {
  jest.resetModules();
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  return require('../utils/jwt');
}

// Fresh usersService instance after resetModules; reads the SAME store file,
// so bumps are visible to the running server's auth middleware.
function usersServiceFor() {
  jest.resetModules();
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  return require('../services/users.service');
}

async function mk(username) {
  return createUser(server, { username, password: 'TvPass#123' });
}

// A token that no longer authenticates: requireAuth-gated /permissions → 401,
// while /auth/me falls back to its documented 400 no-identity branch.
async function expectDead(accessToken) {
  const gate = await request(server).get('/api/v1/permissions').set(authHeader(accessToken));
  expect(gate.statusCode).toBe(401);
  const me = await request(server).get('/api/v1/auth/me').set(authHeader(accessToken));
  expect(me.statusCode).toBe(400);
}

describe('Phase D — tokenVersion (ver claim)', () => {
  test('login tokens carry ver equal to the stored tokenVersion (0 for new users)', async () => {
    const user = await mk('tv1');
    const session = await login(server, 'tv1', 'TvPass#123');
    const jwt = jwtFor();
    const access = jwt.verifyAccessToken(session.accessToken);
    const refresh = jwt.verifyRefreshToken(session.refreshToken);
    expect(access.ver).toBe(0);
    expect(refresh.ver).toBe(0);
    expect(access.sub).toBe(user.id);
  });

  test('bumping tokenVersion kills every outstanding access + refresh token', async () => {
    const user = await mk('tv2');
    const session = await login(server, 'tv2', 'TvPass#123');
    const me = await request(server).get('/api/v1/auth/me').set(authHeader(session.accessToken));
    expect(me.statusCode).toBe(200);

    const bump = usersServiceFor().bumpTokenVersion(user.id);
    expect(bump.tokenVersion).toBe(1);

    await expectDead(session.accessToken);
    const refOld = await request(server).post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken });
    expect(refOld.statusCode).toBe(401);

    const session2 = await login(server, 'tv2', 'TvPass#123');
    expect(jwtFor().verifyAccessToken(session2.accessToken).ver).toBe(1);
    const me2 = await request(server).get('/api/v1/auth/me').set(authHeader(session2.accessToken));
    expect(me2.statusCode).toBe(200);
  });

  test('a crafted token whose ver mismatches the stored version is rejected', async () => {
    const user = await mk('tv3'); // tokenVersion 0
    const jwt = jwtFor();
    const forged = jwt.signAccessToken({ id: user.id, username: 'tv3', role: 'Cashier', tokenVersion: 1 });
    await expectDead(forged);

    const okToken = jwt.signAccessToken({ id: user.id, username: 'tv3', role: 'Cashier', tokenVersion: 0 });
    const me2 = await request(server).get('/api/v1/auth/me').set(authHeader(okToken));
    expect(me2.statusCode).toBe(200);
  });

  test('legacy tokens without a ver claim are interpreted as version 0', async () => {
    const user = await mk('tv4'); // tokenVersion 0
    const jwt = jwtFor();
    const legacy = jwt.signAccessToken({ id: user.id, username: 'tv4', role: 'Cashier' });
    expect(jwt.verifyAccessToken(legacy).ver).toBeUndefined();
    const me = await request(server).get('/api/v1/auth/me').set(authHeader(legacy));
    expect(me.statusCode).toBe(200);

    // After a bump the legacy (→ version 0) token no longer matches.
    usersServiceFor().bumpTokenVersion(user.id);
    await expectDead(legacy);
  });

  test('tokenStore revocation still works alongside the version check', async () => {
    await mk('tv5');
    const session = await login(server, 'tv5', 'TvPass#123');
    const me1 = await request(server).get('/api/v1/auth/me').set(authHeader(session.accessToken));
    expect(me1.statusCode).toBe(200);

    const out = await request(server)
      .post('/api/v1/auth/logout')
      .set(authHeader(session.accessToken))
      .send({ refreshToken: session.refreshToken });
    expect(out.statusCode).toBe(200);

    await expectDead(session.accessToken);
    const ref = await request(server).post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken });
    expect(ref.statusCode).toBe(401);
  });

  test('a ver token for a sub with NO stored record falls back to the legacy trust contract', async () => {
    // Pre-existing contract (Phase C): a validly-signed token whose sub has no
    // stored user is trusted by the middleware; downstream record lookups then
    // 404. Version enforcement applies to real records only — it never grants
    // anything here (the record is gone), it just does not add a new rejection.
    const jwt = jwtFor();
    const ghost = jwt.signAccessToken({ id: 'ghost-user-1', username: 'ghosty', role: 'Admin', tokenVersion: 0 });
    const me = await request(server).get('/api/v1/auth/me').set(authHeader(ghost));
    expect(me.statusCode).toBe(404);
  });
});