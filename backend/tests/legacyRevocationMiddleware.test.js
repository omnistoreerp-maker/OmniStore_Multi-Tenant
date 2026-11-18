'use strict';

// R7 regression: pre-F4 revocations are SHA-256 hashes of the exact token.
// After migration into SQLite legacy_revocations, the access-token middleware
// must keep rejecting those tokens without treating arbitrary hashes as
// identities.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { createUser, login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

function sha256(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

beforeAll(async () => {
  dataDir = makeTempDataDir('legacy-revocation');
  const s = await startServer(dataDir);
  server = s.app;
  await createUser(server, { username: 'legacyuser', password: 'Legacy#123', role: 'Admin' });
});

test('a migrated legacy hash blocks the exact pre-F4 access token', async () => {
  const jwt = require('../utils/jwt');
  const tokenStore = require('../utils/tokenStore.sqlite');
  const usersService = require('../services/users.service');
  const user = usersService.getByUsername('legacyuser');

  // Pre-F4 shape: no familyId, so only the legacy hash can revoke it.
  const token = jwt.signAccessToken({ id: user.id, username: user.username, role: user.role });
  const control = await request(server)
    .get('/api/v1/permissions?username=legacyuser')
    .set(authHeader(token));
  expect(control.statusCode).toBe(200);

  const legacyPath = path.join(dataDir, 'revoked-tokens.json');
  fs.writeFileSync(legacyPath, JSON.stringify([
    { hash: sha256(token), exp: Math.floor(Date.now() / 1000) + 600 }
  ]));
  const migrated = tokenStore.migrateLegacyRevocations(legacyPath);
  expect(migrated.imported).toBe(1);

  const rejected = await request(server)
    .get('/api/v1/permissions?username=legacyuser')
    .set(authHeader(token));
  expect(rejected.statusCode).toBe(401);
});

test('a different valid access token is unaffected by the migrated hash', async () => {
  const session = await login(server, 'legacyuser', 'Legacy#123');
  const ok = await request(server)
    .get('/api/v1/permissions?username=legacyuser')
    .set(authHeader(session.accessToken));
  expect(ok.statusCode).toBe(200);
});
