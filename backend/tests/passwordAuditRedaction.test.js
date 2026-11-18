'use strict';

// Phase 6 regression: password-change and admin password-reset audit events
// must never contain plaintext passwords or password hashes, while retaining
// actor/target/action metadata.

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { createUser, login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

let server;
let dataDir;
const OLD = 'OldPass#111';
const NEW = 'NewPass#222';
const RESET = 'ResetPass#333';

registerCleanup(() => [server], () => [dataDir]);

function readJson(file) {
  const full = path.join(dataDir, file);
  if (!fs.existsSync(full)) return null;
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

beforeAll(async () => {
  dataDir = makeTempDataDir('p6-audit');
  const s = await startServer(dataDir);
  server = s.app;
  await createUser(server, { username: 'auditadmin', password: OLD, role: 'Admin' });
  await createUser(server, { username: 'audittarget', password: OLD, role: 'Cashier' });
});

test('self-service password change audit entry contains no password material', async () => {
  const session = await login(server, 'auditadmin', OLD);
  const change = await request(server)
    .post('/api/v1/auth/change-password')
    .set(authHeader(session.accessToken))
    .send({ currentPassword: OLD, newPassword: NEW });
  expect(change.statusCode).toBe(200);

  const raw = fs.readFileSync(path.join(dataDir, 'auditLog.json'), 'utf8');
  const entries = JSON.parse(raw).entries;
  const event = entries.find((e) => e.action === 'USER_PASSWORD_CHANGED');
  expect(event).toBeTruthy();
  expect(event.userId).toBeTruthy();
  expect(event.resourceId).toBe(event.userId);

  expect(raw).not.toContain(OLD);
  expect(raw).not.toContain(NEW);
  expect(raw).not.toMatch(/\$2[aby]\$/);

  const users = readJson('users.json');
  const list = Array.isArray(users) ? users : (users && users.users) || [];
  const stored = list.find((u) => u && u.username === 'auditadmin');
  if (stored && stored.password) {
    expect(raw).not.toContain(stored.password);
  }
});

test('admin password reset audit entry contains no password material', async () => {
  const usersService = require('../services/users.service');
  const usersController = require('../controllers/users.controller');
  const target = usersService.getByUsername('audittarget');
  const actor = usersService.getByUsername('auditadmin');

  const captured = {};
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };

  await usersController.resetPassword(
    {
      user: { id: actor.id, username: actor.username, role: actor.role },
      params: { id: target.id },
      body: { newPassword: RESET },
      headers: {},
      method: 'POST',
      path: '/api/v1/users/' + target.id + '/reset-password',
      ip: '127.0.0.1',
      get: () => 'jest'
    },
    res
  );

  expect(res.statusCode).toBe(200);
  const raw = fs.readFileSync(path.join(dataDir, 'auditLog.json'), 'utf8');
  const entries = JSON.parse(raw).entries;
  const event = entries.find((e) => e.action === 'USER_PASSWORD_RESET');
  expect(event).toBeTruthy();
  expect(event.userId).toBe(actor.id);
  expect(event.resourceId).toBe(target.id);

  expect(raw).not.toContain(RESET);
  expect(raw).not.toContain(OLD);
  expect(raw).not.toMatch(/\$2[aby]\$/);

  const users = readJson('users.json');
  const list = Array.isArray(users) ? users : (users && users.users) || [];
  const stored = list.find((u) => u && u.username === 'audittarget');
  if (stored && stored.password) {
    expect(raw).not.toContain(stored.password);
  }
});
