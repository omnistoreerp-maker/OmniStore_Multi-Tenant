'use strict';

// R1 regression: marketplace logout and marketplace authentication must use the
// same authoritative SQLite revocation store, and storage failures must not
// authenticate.

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const TENANT = 'default';
let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

async function register(email) {
  const res = await request(server)
    .post('/api/v1/market/auth/register')
    .set('X-Tenant-Id', TENANT)
    .send({ email, name: 'Buyer', password: 'Secret123' });
  expect(res.statusCode).toBe(201);
  return res.body.data.token;
}

function authed(method, url, token) {
  return request(server)[method](url)
    .set('X-Tenant-Id', TENANT)
    .set('Authorization', 'Bearer ' + token);
}

beforeAll(async () => {
  dataDir = makeTempDataDir('market-revocation');
  const s = await startServer(dataDir);
  server = s.app;
});

test('marketplace token authenticates before logout', async () => {
  const token = await register('one@test.com');
  const me = await authed('get', '/api/v1/market/auth/me', token);
  expect(me.statusCode).toBe(200);
  expect(me.body.data.customer.email).toBe('one@test.com');
});

test('marketplace logout revokes the token on every authenticated route', async () => {
  const token = await register('two@test.com');

  const out = await authed('post', '/api/v1/market/auth/logout', token);
  expect(out.statusCode).toBe(200);

  for (const [method, url] of [
    ['get', '/api/v1/market/auth/me'],
    ['get', '/api/v1/market/orders'],
    ['put', '/api/v1/market/customers/me']
  ]) {
    const res = await authed(method, url, token).send({});
    expect(res.statusCode).toBe(401);
  }
});

test('a different marketplace session remains accepted', async () => {
  await register('three@test.com');
  const other = await register('four@test.com');
  const me = await authed('get', '/api/v1/market/auth/me', other);
  expect(me.statusCode).toBe(200);
});

test('SQLite unavailability fails closed for marketplace auth', async () => {
  const token = await register('five@test.com');
  const tokenStore = require('../utils/tokenStore.sqlite');
  const storePath = path.join(dataDir, 'tokenStore.sqlite');

  tokenStore.closeDb();
  fs.writeFileSync(storePath, 'not a sqlite database');
  for (const suffix of ['-wal', '-shm']) {
    const p = storePath + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  const me = await authed('get', '/api/v1/market/auth/me', token);
  expect(me.statusCode).toBe(503);
});
