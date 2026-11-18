'use strict';

// F4 — concurrent refresh with the SAME refresh token at the HTTP layer.
//
// Rotation is single-use: exactly one of two simultaneous requests may consume
// the token. The losing request is a replay, and replay detection revokes the
// whole session family, so the winner's successor token is dead too. This test
// pins that behavior so a future "grace window" cannot be introduced silently.

const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { createUser, login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  dataDir = makeTempDataDir('concurrent-refresh');
  const started = await startServer(dataDir);
  server = started.app;
  await createUser(server, { username: 'race1', password: 'RacePass#123', role: 'Admin' });
});

function refreshWith(token) {
  return request(server).post('/api/v1/auth/refresh').send({ refreshToken: token });
}

test('two simultaneous refreshes: one rotates, the duplicate is a replay and revokes the family', async () => {
  const session = await login(server, 'race1', 'RacePass#123');

  const [a, b] = await Promise.all([
    refreshWith(session.refreshToken),
    refreshWith(session.refreshToken)
  ]);

  const statuses = [a.statusCode, b.statusCode].sort((x, y) => x - y);
  expect(statuses).toEqual([200, 401]);

  const winner = a.statusCode === 200 ? a : b;
  const loser = a.statusCode === 200 ? b : a;
  expect(loser.body.details && loser.body.details.code).toBe('REPLAY_DETECTED');
  expect(winner.body.data.accessToken).toBeTruthy();
  expect(winner.body.data.refreshToken).toBeTruthy();
  expect(winner.body.data.refreshToken).not.toBe(session.refreshToken);

  // The winner's successor belongs to the revoked family and cannot rotate.
  const successor = await refreshWith(winner.body.data.refreshToken);
  expect(successor.statusCode).toBe(401);
  expect(['SESSION_REVOKED', 'TOKEN_REVOKED', 'REPLAY_DETECTED'])
    .toContain(successor.body.details && successor.body.details.code);

  // The access token minted by the winning request is rejected as well.
  const gated = await request(server)
    .get('/api/v1/permissions')
    .set(authHeader(winner.body.data.accessToken));
  expect(gated.statusCode).toBe(401);

  // Only that family was revoked: a fresh login works and can rotate normally.
  const fresh = await login(server, 'race1', 'RacePass#123');
  const rotated = await refreshWith(fresh.refreshToken);
  expect(rotated.statusCode).toBe(200);
  expect(rotated.body.data.refreshToken).toBeTruthy();
});
