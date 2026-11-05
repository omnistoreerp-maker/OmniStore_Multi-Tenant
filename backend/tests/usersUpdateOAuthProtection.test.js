'use strict';

// Public user-update protection (Google linking hardening).
//
// PUT /api/v1/users/:id is a free-form profile update reached with the
// `users.edit` permission. This suite proves, over real HTTP, that it cannot
// be used to write OAuth identity, membership or session state:
//   - oauth / oauthProvider / tenantId / tokenVersion are never writable;
//   - role / tenantIds / permissions require a privileged actor;
//   - the duplicate-Google-subject invariant cannot be bypassed;
//   - legitimate profile edits and administrative role changes still work.
//
// No production module is mocked: real auth middleware, authorization engine,
// users service and JSON persistence all run.

const fs = require('fs');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const PASSWORD = 'Test#1234';
const FORGED_SUB = 'forged-google-sub';
const SHARED_SUB = 'shared-google-sub';

let server;
let dataDir;
let ownerToken;
let managerToken;

function userRecords() {
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const stamp = new Date().toISOString();
  const base = { password: hash, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 };
  return {
    users: [
      { ...base, id: 'u-owner', username: 'owner', fullName: 'Owner', role: 'Owner', tenantIds: ['t1'] },
      { ...base, id: 'u-mgr', username: 'manager', fullName: 'Manager', role: 'Manager', tenantIds: ['t1'], permissions: ['users.edit'] },
      { ...base, id: 'u-cash', username: 'cashier', fullName: 'Cashier', role: 'Cashier', tenantIds: ['t1'] },
      { ...base, id: 'u-target', username: 'target', fullName: 'Target', role: 'Cashier', tenantIds: ['t1'] },
      { ...base, id: 'u-other', username: 'other', fullName: 'Other', role: 'Cashier', tenantIds: ['t1'] }
    ]
  };
}

function record(id) {
  return readStore(dataDir, 'users').users.find((u) => u.id === id);
}

function put(token, id, body) {
  return request(server.app)
    .put('/api/v1/users/' + id)
    .set(authHeader(token))
    .send(body);
}

beforeAll(async () => {
  dataDir = makeTempDataDir('users-update-oauth');
  seed(dataDir, 'users', userRecords());
  server = await startServer(dataDir, { AUTH_REQUIRED: 'true' });

  ownerToken = (await login(server.app, 'owner', PASSWORD)).accessToken;
  managerToken = (await login(server.app, 'manager', PASSWORD)).accessToken;
  expect(ownerToken).toBeTruthy();
  expect(managerToken).toBeTruthy();
});

registerCleanup(() => [server], () => [dataDir]);

describe('PUT /users/:id cannot write OAuth identity', () => {
  test('a user with users.edit cannot bind a Google subject to their own record', async () => {
    const res = await put(managerToken, 'u-mgr', { oauth: { google: FORGED_SUB }, oauthProvider: 'google' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.oauth).toBeUndefined();

    const stored = record('u-mgr');
    expect(stored.oauth).toBeUndefined();
    expect(stored.oauthProvider).toBeUndefined();
  });

  test('a user with users.edit cannot rewrite another user OAuth identity', async () => {
    const res = await put(managerToken, 'u-target', {
      oauth: { google: FORGED_SUB },
      oauthProvider: 'google',
      fullName: 'Target Renamed'
    });

    expect(res.statusCode).toBe(200);
    expect(record('u-target').oauth).toBeUndefined();
    expect(record('u-target').fullName).toBe('Target Renamed'); // legitimate part applied
  });

  test('the duplicate Google subject invariant cannot be bypassed through the update route', async () => {
    // Attempt to give TWO accounts the same subject through the generic route.
    await put(managerToken, 'u-target', { oauth: { google: SHARED_SUB } });
    await put(managerToken, 'u-other', { oauth: { google: SHARED_SUB } });

    const users = readStore(dataDir, 'users').users;
    const forged = users.filter((u) => u.oauth && u.oauth.google === SHARED_SUB);
    expect(forged).toHaveLength(0);

    // The real linking path (users.service via oauth.service) still enforces
    // one-owner-per-subject.
    const oauthService = require('../services/oauth.service');
    const first = await oauthService.linkProvider('u-target', 'google', { id: SHARED_SUB, emails: [] });
    expect(first.error).toBeUndefined();
    expect(first.user.id).toBe('u-target');

    const second = await oauthService.linkProvider('u-other', 'google', { id: SHARED_SUB, emails: [] });
    expect(second.error).toMatch(/already linked/i);
    expect(second.conflict).toBe(true);

    const bound = readStore(dataDir, 'users').users.filter((u) => u.oauth && u.oauth.google === SHARED_SUB);
    expect(bound).toHaveLength(1);
    expect(bound[0].id).toBe('u-target');
  });
});

describe('PUT /users/:id cannot write membership, roles or sessions', () => {
  test('a Manager cannot escalate role, membership, permissions or tokenVersion', async () => {
    const before = record('u-mgr');

    const res = await put(managerToken, 'u-mgr', {
      role: 'Owner',
      tenantId: 't9',
      tenantIds: ['t9'],
      tenantRoles: { t9: 'Owner' },
      tenantPermissions: { t9: { all: true } },
      permissions: ['all'],
      tokenVersion: 99
    });

    expect(res.statusCode).toBe(403);
    expect(res.body.details).toEqual({ code: 'PERMISSION_DENIED' });

    const after = record('u-mgr');
    expect(after.role).toBe('Manager');
    expect(after.tenantIds).toEqual(['t1']);
    expect(after.permissions).toEqual(['users.edit']);
    expect(after.tenantId).toBeUndefined();
    expect(after.tenantRoles).toBeUndefined();
    expect(after.tenantPermissions).toBeUndefined();
    expect(after.tokenVersion).toBe(before.tokenVersion);
  });

  test('tenantId is stripped even when no administrative field changes', async () => {
    const res = await put(managerToken, 'u-mgr', {
      fullName: 'Manager Renamed',
      tenantId: 't9',
      tokenVersion: 42,
      oauth: { google: FORGED_SUB }
    });

    expect(res.statusCode).toBe(200);

    const stored = record('u-mgr');
    expect(stored.fullName).toBe('Manager Renamed');
    expect(stored.tenantId).toBeUndefined();
    expect(stored.tokenVersion).toBe(0);
    expect(stored.oauth).toBeUndefined();
  });

  test('legitimate profile updates keep working', async () => {
    const res = await put(managerToken, 'u-other', { fullName: 'Other Renamed', phone: '0100000000' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const stored = record('u-other');
    expect(stored.fullName).toBe('Other Renamed');
    expect(stored.phone).toBe('0100000000');
  });

  test('an Owner can still perform a legitimate administrative role change', async () => {
    const res = await put(ownerToken, 'u-cash', { role: 'Manager' });

    expect(res.statusCode).toBe(200);
    expect(record('u-cash').role).toBe('Manager');
  });
});

describe('store integrity after the protection tests', () => {
  test('the users document is valid JSON and only expected values changed', () => {
    const db = readStore(dataDir, 'users');
    expect(Array.isArray(db.users)).toBe(true);
    expect(db.users).toHaveLength(5);
    expect(fs.existsSync(dataDir)).toBe(true);

    const owner = db.users.find((u) => u.id === 'u-owner');
    expect(owner.role).toBe('Owner');
    expect(owner.oauth).toBeUndefined();
  });
});
