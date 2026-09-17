'use strict';

// Phase D — strict user DTO allowlist. Unit coverage of sanitizeUser plus an
// HTTP check proving that secrets mirrored onto a stored record are persisted
// (so hiding is real) yet never exposed through any user endpoint.

const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { readStore, makeTempDataDir } = require('./helpers/testData');
const { createUser, login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');
const { removeDir } = require('./helpers/cleanup');

describe('Phase D — usersService.sanitizeUser allowlist (unit)', () => {
  let dataDir;
  let usersService;

  beforeAll(() => {
    dataDir = makeTempDataDir('user-dto-unit');
    process.env.DIGITRONICS_DATA_DIR = dataDir;
    jest.resetModules();
    usersService = require('../services/users.service');
  });

  afterAll(() => removeDir(dataDir));

  test('only allowlisted fields survive; secrets and internals never leak', () => {
    const stored = {
      id: 'u-1',
      username: 'alice',
      fullName: 'Alice Admin',
      role: 'Admin',
      phone: '555-0100',
      email: 'alice@example.com',
      tenantIds: ['a'],
      tenantRoles: { a: 'Admin' },
      tenantPermissions: ['users.view'],
      mfaEnabled: 'true',
      status: 'active',
      lastLogin: '2026-01-01T00:00:00Z',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
      // must never be exposed:
      password: '$2a$10$hash.hash',
      passwordHash: 'x',
      currentPassword: 'cur',
      newPassword: 'new',
      accessToken: 'tok',
      refreshToken: 'rt',
      tokenVersion: 7,
      apiKey: 'ak',
      apiKeyHash: 'ah',
      keyHash: 'kh',
      mfaSecret: 'secret',
      mfaBackupCodes: ['c1'],
      backupCodes: ['c2'],
      secretAnswer: 's',
      someInternalField: 'internal-leak'
    };

    const safe = usersService.sanitizeUser(stored);

    expect(safe.id).toBe('u-1');
    expect(safe.username).toBe('alice');
    expect(safe.fullName).toBe('Alice Admin');
    expect(safe.role).toBe('Admin');
    expect(safe.phone).toBe('555-0100');
    expect(safe.email).toBe('alice@example.com');
    expect(safe.tenantIds).toEqual(['a']);
    expect(safe.tenantRoles).toEqual({ a: 'Admin' });
    expect(safe.mfaEnabled).toBe(true);
    expect(safe.status).toBe('active');
    expect(safe.lastLogin).toBe('2026-01-01T00:00:00Z');
    expect(safe.createdAt).toBe('2025-01-01T00:00:00Z');
    expect(safe.updatedAt).toBe('2026-02-01T00:00:00Z');

    expect(safe.password).toBeUndefined();
    expect(safe.passwordHash).toBeUndefined();
    expect(safe.currentPassword).toBeUndefined();
    expect(safe.newPassword).toBeUndefined();
    expect(safe.accessToken).toBeUndefined();
    expect(safe.refreshToken).toBeUndefined();
    expect(safe.apiKey).toBeUndefined();
    expect(safe.apiKeyHash).toBeUndefined();
    expect(safe.keyHash).toBeUndefined();
    expect(safe.mfaSecret).toBeUndefined();
    expect(safe.mfaBackupCodes).toBeUndefined();
    expect(safe.backupCodes).toBeUndefined();
    expect(safe.secretAnswer).toBeUndefined();
    expect(safe.someInternalField).toBeUndefined();
    expect(safe.tokenVersion).toBeUndefined();
  });

  test('mfaEnabled is normalized to a boolean', () => {
    const usersService2 = usersService;
    expect(usersService2.sanitizeUser({ mfaEnabled: 'true', username: 'x' }).mfaEnabled).toBe(true);
    expect(usersService2.sanitizeUser({ mfaEnabled: 'false', username: 'x' }).mfaEnabled).toBe(false);
    expect(usersService2.sanitizeUser({ mfaEnabled: true, username: 'x' }).mfaEnabled).toBe(true);
  });

  test('non-object input passes through unchanged', () => {
    expect(usersService.sanitizeUser(null)).toBeNull();
    expect(usersService.sanitizeUser(undefined)).toBeUndefined();
    expect(usersService.sanitizeUser('str')).toBe('str');
  });
});

describe('Phase D — HTTP: user endpoints never leak stored secrets', () => {
  let server;
  let dataDir;

  registerCleanup(() => [server], () => [dataDir]);

  beforeAll(async () => {
    const s = await startServer();
    server = s.app;
    dataDir = s.dataDir;
  });

  test('secrets mirrored onto a record are persisted but hidden from every response', async () => {
    const res = await request(server)
      .post('/api/v1/users')
      .send({
        username: 'dto1',
        password: 'DtoPass#1',
        fullName: 'DTO One',
        role: 'Cashier',
        status: 'active',
        email: 'dto1@example.com',
        mfaSecret: 'mirrored-secret',
        apiKey: 'mirrored-key',
        randomToken: 'mirrored-token',
        someInternalField: 'internal-stuff'
      });
    expect(res.statusCode).toBe(201);
    const id = res.body.data.id;

    // Persisted as-is (proving the create path stores the payload sprawl)...
    const store = readStore(dataDir, 'users');
    const stored = store.users.find((u) => u.id === id);
    expect(stored.mfaSecret).toBe('mirrored-secret');
    expect(stored.someInternalField).toBe('internal-stuff');

    // ...but the DTO allowlist hides it everywhere.
    const got = await request(server).get(`/api/v1/users/${id}`);
    expect(got.statusCode).toBe(200);
    expect(got.body.data.mfaSecret).toBeUndefined();
    expect(got.body.data.apiKey).toBeUndefined();
    expect(got.body.data.randomToken).toBeUndefined();
    expect(got.body.data.someInternalField).toBeUndefined();
    expect(got.body.data.password).toBeUndefined();
    expect(got.body.data.status).toBe('active');
    expect(got.body.data.username).toBe('dto1');

    const list = await request(server).get('/api/v1/users');
    expect(list.statusCode).toBe(200);
    const listed = list.body.data.users.find((u) => u.id === id);
    expect(listed.mfaSecret).toBeUndefined();
    expect(listed.someInternalField).toBeUndefined();
    expect(listed.mfaEnabled).toBeUndefined();
  });

  test('a logged-in user only ever sees allowlisted fields via /auth/me', async () => {
    const { createUser } = require('./helpers/authHelper');
    const created = await createUser(server, {
      username: 'dto2',
      password: 'DtoPass#2',
      fullName: 'DTO Two',
      role: 'Cashier',
      extra: { someInternalField: 'leak-me' }
    });
    const session = await login(server, 'dto2', 'DtoPass#2');
    const me = await request(server).get('/api/v1/auth/me').set(authHeader(session.accessToken));
    expect(me.statusCode).toBe(200);
    const u = me.body.data.user;
    expect(u.username).toBe('dto2');
    expect(u.password).toBeUndefined();
    expect(u.someInternalField).toBeUndefined();
    expect(u.mfaSecret).toBeUndefined();
    expect(u.tokenVersion).toBeUndefined();
    expect(u.createdAt).toBeDefined();
    expect(created).toBeTruthy();
  });
});