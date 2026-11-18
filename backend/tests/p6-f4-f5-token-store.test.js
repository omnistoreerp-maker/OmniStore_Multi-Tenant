'use strict';

// P6 — F4 (refresh rotation + replay detection) and F5 (durable revocation).
// Exercises the SQLite token store through the HTTP surface plus the legacy
// JSON revocation migration.

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
  dataDir = makeTempDataDir('f4f5');
  const s = await startServer(dataDir);
  server = s.app;
  for (const [username, role] of [['rot1', 'Admin'], ['rot2', 'Cashier'], ['rot3', 'Admin']]) {
    await createUser(server, { username, password: 'RotPass#123', role });
  }
});

describe('F4 — refresh token rotation', () => {
  test('each refresh consumes the presented token and issues a new one', async () => {
    const session = await login(server, 'rot1', 'RotPass#123');

    const first = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(first.statusCode).toBe(200);
    expect(first.body.data.accessToken).toBeTruthy();
    expect(first.body.data.refreshToken).toBeTruthy();
    expect(first.body.data.refreshToken).not.toBe(session.refreshToken);

    const second = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.body.data.refreshToken });
    expect(second.statusCode).toBe(200);
    expect(second.body.data.refreshToken).not.toBe(first.body.data.refreshToken);
  });

  test('replaying a consumed refresh token is rejected and revokes the family', async () => {
    const session = await login(server, 'rot2', 'RotPass#123');

    const first = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(first.statusCode).toBe(200);
    const rotated = first.body.data.refreshToken;

    const replay = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(replay.statusCode).toBe(401);
    expect(replay.body.details && replay.body.details.code).toBe('REPLAY_DETECTED');

    // The legitimate successor is dead too: the whole family was revoked.
    const afterReplay = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rotated });
    expect(afterReplay.statusCode).toBe(401);
    expect(['SESSION_REVOKED', 'TOKEN_REVOKED']).toContain(afterReplay.body.details && afterReplay.body.details.code);
  });

  test('a rotated access token authenticates while the previous one stays valid until expiry', async () => {
    const session = await login(server, 'rot3', 'RotPass#123');
    const rotated = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(rotated.statusCode).toBe(200);

    const me = await request(server)
      .get('/api/v1/auth/me')
      .set(authHeader(rotated.body.data.accessToken));
    expect(me.statusCode).toBe(200);
    expect(me.body.data.user.username).toBe('rot3');
  });
});

describe('F5 — durable revocation', () => {
  test('logout revokes the session family: refresh and access both stop working', async () => {
    const session = await login(server, 'rot1', 'RotPass#123');

    const out = await request(server)
      .post('/api/v1/auth/logout')
      .set(authHeader(session.accessToken))
      .send({ refreshToken: session.refreshToken });
    expect(out.statusCode).toBe(200);

    const ref = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(ref.statusCode).toBe(401);

    const gate = await request(server)
      .get('/api/v1/permissions')
      .set(authHeader(session.accessToken));
    expect(gate.statusCode).toBe(401);
  });

  test('legacy JSON revocations migrate into the SQLite store and are honoured', async () => {
    const legacyPath = path.join(dataDir, 'revoked-tokens.json');
    const tokenStore = require('../utils/tokenStore.sqlite');
    const jwt = require('jsonwebtoken');
    const crypto = require('crypto');
    const config = require('../config');

    const legacyToken = jwt.sign(
      { sub: 'legacy-user', jti: 'legacy-jti-1', type: 'access' },
      config.jwtSecret,
      { expiresIn: 3600 }
    );
    const hash = crypto.createHash('sha256').update(legacyToken).digest('hex');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    fs.writeFileSync(legacyPath, JSON.stringify([{ hash, exp }]), 'utf-8');

    const first = tokenStore.migrateLegacyRevocations(legacyPath);
    expect(first.imported).toBe(1);
    expect(tokenStore.isRevoked(legacyToken)).toBe(true);

    // A stale copy of the JSON (e.g. a deploy that restored the old file) must
    // not duplicate rows.
    fs.writeFileSync(legacyPath, JSON.stringify([{ hash, exp }]), 'utf-8');
    const second = tokenStore.migrateLegacyRevocations(legacyPath);
    expect(second.imported).toBe(0);
    expect(second.duplicates).toBe(1);
  });
});
