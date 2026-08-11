'use strict';

// Phase D — self-service change-password E2E over the real server.

const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { readStore } = require('./helpers/testData');
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

async function makeUser(username, password, role) {
  return createUser(server, { username, password, fullName: username, role: role || 'Cashier' });
}

function storedUser(id) {
  return readStore(dataDir, 'users').users.find((u) => u.id === id);
}

// A token that no longer authenticates: the requireAuth-gated /permissions
// endpoint returns 401, while /auth/me falls back to its documented 400
// no-identity branch (an existing /auth/me quirk — a garbage/expired token
// behaves identically, per security.test.js).
async function expectDead(accessToken) {
  const gate = await request(server).get('/api/v1/permissions').set(authHeader(accessToken));
  expect(gate.statusCode).toBe(401);
  const me = await request(server).get('/api/v1/auth/me').set(authHeader(accessToken));
  expect(me.statusCode).toBe(400);
}

describe('POST /api/v1/auth/change-password', () => {
  test('happy path: 200, bcrypt stored, tokenVersion bumped, old tokens invalidated', async () => {
    const user = await makeUser('chg', 'OldPass#123');
    const session = await login(server, 'chg', 'OldPass#123');
    const oldHash = storedUser(user.id).password;

    const res = await request(server)
      .post('/api/v1/auth/change-password')
      .set(authHeader(session.accessToken))
      .send({ currentPassword: 'OldPass#123', newPassword: 'NewPass#456' });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeNull();

    const stored = storedUser(user.id);
    expect(stored.password).not.toBe(oldHash);
    expect(stored.password.startsWith('$2')).toBe(true);
    expect(stored.tokenVersion).toBe(1);

    // Old access token is dead.
    await expectDead(session.accessToken);
    // Old refresh token is dead.
    const refOld = await request(server).post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken });
    expect(refOld.statusCode).toBe(401);

    // New credential works end to end and never echoes the hash.
    const session2 = await login(server, 'chg', 'NewPass#456');
    expect(session2.user.password).toBeUndefined();
    const me2 = await request(server).get('/api/v1/auth/me').set(authHeader(session2.accessToken));
    expect(me2.statusCode).toBe(200);
    expect(me2.body.data.user.username).toBe('chg');
  });

  test('incorrect current password → 401, password unchanged', async () => {
    const user = await makeUser('chg2', 'OldPass#123');
    const session = await login(server, 'chg2', 'OldPass#123');
    const before = storedUser(user.id).password;

    const res = await request(server)
      .post('/api/v1/auth/change-password')
      .set(authHeader(session.accessToken))
      .send({ currentPassword: 'Wrong#999', newPassword: 'NewPass#456' });
    expect(res.statusCode).toBe(401);
    expect(storedUser(user.id).password).toBe(before);
    expect(storedUser(user.id).tokenVersion).toBe(0);
  });

  test('weak new password → 400 with PASSWORD_POLICY_VIOLATION, nothing written', async () => {
    const user = await makeUser('chg3', 'OldPass#123');
    const session = await login(server, 'chg3', 'OldPass#123');
    const before = storedUser(user.id).password;

    const res = await request(server)
      .post('/api/v1/auth/change-password')
      .set(authHeader(session.accessToken))
      .send({ currentPassword: 'OldPass#123', newPassword: 'short' });
    expect(res.statusCode).toBe(400);
    expect(res.body.details && res.body.details.code).toBe('PASSWORD_POLICY_VIOLATION');
    expect(storedUser(user.id).password).toBe(before);
    expect(storedUser(user.id).tokenVersion).toBe(0);
    // The rejected password must not appear anywhere in the response.
    expect(JSON.stringify(res.body)).not.toContain('short');
  });

  test('missing fields → 400', async () => {
    const user = await makeUser('chg4', 'OldPass#123');
    const session = await login(server, 'chg4', 'OldPass#123');
    const missingCurrent = await request(server)
      .post('/api/v1/auth/change-password')
      .set(authHeader(session.accessToken))
      .send({ newPassword: 'NewPass#456' });
    expect(missingCurrent.statusCode).toBe(400);

    const missingNew = await request(server)
      .post('/api/v1/auth/change-password')
      .set(authHeader(session.accessToken))
      .send({ currentPassword: 'OldPass#123' });
    expect(missingNew.statusCode).toBe(400);
    expect(storedUser(user.id).tokenVersion).toBe(0);
  });

  test('unauthenticated → 401', async () => {
    const res = await request(server)
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: 'OldPass#123', newPassword: 'NewPass#456' });
    expect(res.statusCode).toBe(401);
  });

  test('a stale (revoked) access token cannot change the password', async () => {
    const user = await makeUser('chg5', 'OldPass#123');
    const session = await login(server, 'chg5', 'OldPass#123');
    await request(server).post('/api/v1/auth/logout').set(authHeader(session.accessToken)).send({ refreshToken: session.refreshToken });
    const res = await request(server)
      .post('/api/v1/auth/change-password')
      .set(authHeader(session.accessToken))
      .send({ currentPassword: 'OldPass#123', newPassword: 'NewPass#456' });
    expect(res.statusCode).toBe(401);
  });

  test('records USER_PASSWORD_CHANGED event with both passwords redacted', async () => {
    const user = await makeUser('chg6', 'OldPass#123');
    const session = await login(server, 'chg6', 'OldPass#123');
    await request(server)
      .post('/api/v1/auth/change-password')
      .set(authHeader(session.accessToken))
      .send({ currentPassword: 'OldPass#123', newPassword: 'Ghost#New9' });

    const store = readStore(dataDir, 'auditLog');
    const event = store.entries.find((e) => e.action === 'USER_PASSWORD_CHANGED' && e.userId === user.id);
    expect(event).toBeTruthy();
    expect(event.resource).toBe('user');
    expect(event.resourceId).toBe(user.id);

    // The audit trail must never contain either plaintext password.
    const raw = JSON.stringify(store.entries);
    expect(raw).not.toContain('Ghost#New9');
    expect(raw).not.toContain('OldPass#123');
  });
});