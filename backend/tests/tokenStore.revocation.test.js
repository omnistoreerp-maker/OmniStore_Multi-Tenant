'use strict';

// D4 regression: individual access/refresh revocation uses the real schema,
// is idempotent, is enforced by middleware/rotation, and never reports success
// when the storage itself fails.

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { createUser, login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  dataDir = makeTempDataDir('d4-revocation');
  const s = await startServer(dataDir);
  server = s.app;
  await createUser(server, { username: 'rev1', password: 'RevPass#123', role: 'Admin' });
});

test('direct access-token revocation succeeds, is idempotent, and blocks the token', async () => {
  const jwt = require('../utils/jwt');
  const tokenStore = require('../utils/tokenStore.sqlite');
  const session = await login(server, 'rev1', 'RevPass#123');
  const payload = jwt.verifyAccessToken(session.accessToken);

  expect(tokenStore.revokeAccessToken(payload.jti, payload.sub, payload.exp)).toEqual({ revoked: true });
  expect(tokenStore.revokeAccessToken(payload.jti, payload.sub, payload.exp)).toEqual({ revoked: false });
  expect(tokenStore.isAccessTokenRevoked(payload.jti)).toBe(true);

  const gate = await request(server)
    .get('/api/v1/permissions?username=rev1')
    .set(authHeader(session.accessToken));
  expect(gate.statusCode).toBe(401);
});

test('direct refresh-token revocation succeeds, is idempotent, and blocks rotation', async () => {
  const jwt = require('../utils/jwt');
  const tokenStore = require('../utils/tokenStore.sqlite');
  const session = await login(server, 'rev1', 'RevPass#123');
  const payload = jwt.verifyRefreshToken(session.refreshToken);

  expect(tokenStore.revokeRefreshToken(payload.jti, payload.sub, payload.exp)).toMatchObject({ revoked: true });
  expect(tokenStore.revokeRefreshToken(payload.jti, payload.sub, payload.exp)).toMatchObject({ revoked: false });

  const rotated = await request(server)
    .post('/api/v1/auth/refresh')
    .send({ refreshToken: session.refreshToken });
  expect(rotated.statusCode).toBe(401);
  expect(rotated.body.details && rotated.body.details.code).toBe('SESSION_REVOKED');
});

test('storage failure is an error, never a successful revocation', async () => {
  const tokenStore = require('../utils/tokenStore.sqlite');
  const storePath = path.join(dataDir, 'tokenStore.sqlite');

  tokenStore.closeDb();
  fs.writeFileSync(storePath, 'not a sqlite database');
  for (const suffix of ['-wal', '-shm']) {
    const p = storePath + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  expect(() => tokenStore.revokeAccessToken('any-jti', 'any-sub', Math.floor(Date.now() / 1000) + 60)).toThrow();
  expect(() => tokenStore.revokeRefreshToken('any-jti', 'any-sub', Math.floor(Date.now() / 1000) + 60)).toThrow();
});
