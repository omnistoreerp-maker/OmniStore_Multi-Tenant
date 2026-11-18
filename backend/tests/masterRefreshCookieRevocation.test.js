'use strict';

// R2 regression: the Master OAuth session identity is derived from a refresh
// cookie only when its SQLite refresh row is active and its family is not
// revoked. Logout, rotation/replay, unknown tokens and storage failures must
// all be rejected (storage failures with 503).

const request = require('supertest');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const PASSWORD = 'Master#123';
const USERNAME = 'masteruser';
const OAUTH_ENV = {
  RATE_LIMIT_MAX: '10000',
  OAUTH_ENABLED: 'true',
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  OAUTH_MASTER_EMAIL: 'master@example.com'
};
let server;
let dataDir;
let user;

registerCleanup(() => [server], () => [dataDir]);

function seedMaster(dir) {
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const stamp = new Date().toISOString();
  seed(dir, 'users', {
    users: [{
      id: 'u-master', username: USERNAME, password: hash,
      fullName: 'Master User', role: 'Viewer', tokenVersion: 0,
      createdAt: stamp, updatedAt: stamp
    }]
  });
  seed(dir, 'platformAdmins', {
    admins: [{ username: USERNAME, platformRole: 'MASTER_OWNER', status: 'active', createdAt: stamp, updatedAt: stamp }]
  });
}

function loginCookies() {
  return request(server).post('/api/v1/auth/login').send({ username: USERNAME, password: PASSWORD });
}

function cookieValue(res, name) {
  const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith(name + '='));
  if (!cookie) return null;
  return cookie.split(';')[0].slice(name.length + 1);
}

function linkStatus(refreshToken) {
  return request(server)
    .get('/auth/google/master/link-status')
    .set('Cookie', 'refresh_token=' + refreshToken);
}

beforeAll(async () => {
  dataDir = makeTempDataDir('master-refresh');
  seedMaster(dataDir);
  const s = await startServer(dataDir, OAUTH_ENV);
  server = s.app;
  const usersService = require('../services/users.service');
  user = usersService.getByUsername(USERNAME);
});

test('a valid Master refresh cookie is accepted', async () => {
  const res = await loginCookies();
  expect(res.statusCode).toBe(200);
  const refresh = cookieValue(res, 'refresh_token');
  expect(refresh).toBeTruthy();

  const status = await linkStatus(refresh);
  expect(status.statusCode).toBe(200);
});

test('logout makes that exact refresh cookie unusable', async () => {
  const res = await loginCookies();
  const refresh = cookieValue(res, 'refresh_token');
  const access = cookieValue(res, 'access_token');

  const out = await request(server)
    .post('/api/v1/auth/logout')
    .set('Cookie', 'access_token=' + access + '; refresh_token=' + refresh);
  expect(out.statusCode).toBe(200);

  expect((await linkStatus(refresh)).statusCode).toBe(401);
});

test('a consumed (rotated) refresh cookie is rejected', async () => {
  const res = await loginCookies();
  const oldRefresh = cookieValue(res, 'refresh_token');

  const rotated = await request(server)
    .post('/api/v1/auth/refresh')
    .set('Cookie', 'refresh_token=' + oldRefresh);
  expect(rotated.statusCode).toBe(200);

  expect((await linkStatus(oldRefresh)).statusCode).toBe(401);
});

test('a family-revoked refresh cookie is rejected', async () => {
  const res = await loginCookies();
  const refresh = cookieValue(res, 'refresh_token');
  const jwt = require('../utils/jwt');
  const tokenStore = require('../utils/tokenStore.sqlite');
  const payload = jwt.verifyRefreshToken(refresh);

  const revoked = tokenStore.revokeFamily(payload.familyId, payload.sub);
  expect(revoked.revoked).toBe(true);

  expect((await linkStatus(refresh)).statusCode).toBe(401);
});

test('an unknown (never issued) refresh token is rejected', async () => {
  const jwt = require('../utils/jwt');
  const forged = jwt.signRefreshToken({
    id: user.id, username: user.username, role: user.role,
    familyId: crypto.randomUUID(), jti: crypto.randomUUID()
  });

  expect((await linkStatus(forged)).statusCode).toBe(401);
});

test('a valid unrelated Master session stays functional', async () => {
  const res = await loginCookies();
  const refresh = cookieValue(res, 'refresh_token');
  expect((await linkStatus(refresh)).statusCode).toBe(200);
});

test('storage failure fails closed with 503', async () => {
  const fs = require('fs');
  const path = require('path');
  const res = await loginCookies();
  const refresh = cookieValue(res, 'refresh_token');

  const tokenStore = require('../utils/tokenStore.sqlite');
  const storePath = path.join(dataDir, 'tokenStore.sqlite');
  tokenStore.closeDb();
  fs.writeFileSync(storePath, 'not a sqlite database');
  for (const suffix of ['-wal', '-shm']) {
    const p = storePath + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  expect((await linkStatus(refresh)).statusCode).toBe(503);
});
