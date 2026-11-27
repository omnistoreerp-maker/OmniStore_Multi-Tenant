// Verifies the shared test helpers themselves: boot, isolation, cleanup.
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, readStore } = require('./helpers/testData');
const { createUser, login } = require('./helpers/authHelper');
const { createUser: fixtureCreateUser } = require('./helpers/userFixture');
const { registerCleanup } = require('./helpers/cleanup');

const PROD_DATA_DIR = path.join(__dirname, '..', 'data');

let server;
let dataDir;
let prodFilesBefore;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  dataDir = makeTempDataDir('helpers');
  prodFilesBefore = fs.existsSync(PROD_DATA_DIR) ? fs.readdirSync(PROD_DATA_DIR).sort() : [];

  // Enable tenant membership normalization for this isolated test instance so
  // userFixture.createUser() exercises the same service path as application code
  // when ENABLE_TENANT_USER_MEMBERSHIP is on. Restore the original value
  // immediately so the flag does not leak into other suites.
  const originalMembershipFlag = process.env.ENABLE_TENANT_USER_MEMBERSHIP;
  process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
  try {
    server = await startServer(dataDir);
  } finally {
    if (originalMembershipFlag === undefined) {
      delete process.env.ENABLE_TENANT_USER_MEMBERSHIP;
    } else {
      process.env.ENABLE_TENANT_USER_MEMBERSHIP = originalMembershipFlag;
    }
  }
});

describe('test helpers', () => {
  test('server boots and answers health', async () => {
    const res = await request(server.app).get('/api/v1/health');
    expect(res.statusCode).toBe(200);
  });

  test('records are written to the isolated temp store', async () => {
    await createUser(server.app, { username: 'helper-user', password: 'Pass#1234', role: 'Admin' });
    const store = readStore(dataDir, 'users');
    expect(store).not.toBeNull();
    expect(store.users).toHaveLength(1);
    expect(store.users[0].username).toBe('helper-user');
  });

  test('login works through authHelper', async () => {
    const session = await login(server.app, 'helper-user', 'Pass#1234');
    expect(session.accessToken).toBeTruthy();
    expect(session.user.username).toBe('helper-user');
  });

  test('production data directory is untouched', () => {
    const after = fs.existsSync(PROD_DATA_DIR) ? fs.readdirSync(PROD_DATA_DIR).sort() : [];
    expect(after).toEqual(prodFilesBefore);
  });
});

describe('userFixture regression', () => {
  test('extra fields are flattened onto the created user', async () => {
    const created = fixtureCreateUser(server.app, {
      username: 'uf-extra',
      password: 'Extra#1234',
      extra: { tenantIds: ['t1'], tenantRoles: { t1: 'Admin' } }
    });
    expect(created.tenantIds).toEqual(['t1']);
    expect(created.tenantRoles).toEqual({ t1: 'Admin' });
    expect(created.extra).toBeUndefined();
  });

  test('extra overrides conflicting direct fields (legacy override semantics)', async () => {
    const created = fixtureCreateUser(server.app, {
      username: 'uf-override',
      password: 'Override#1234',
      role: 'Cashier',
      extra: { role: 'Manager', tenantIds: ['t1'] }
    });
    expect(created.role).toBe('Manager');
    expect(created.tenantIds).toEqual(['t1']);
  });

  test('arbitrary direct fixture fields are preserved', async () => {
    const created = fixtureCreateUser(server.app, {
      username: 'uf-direct',
      password: 'Direct#1234',
      role: 'Admin',
      phone: '0555123456',
      email: 'uf-direct@example.com',
      status: 'active',
      branchId: 'main'
    });
    expect(created.phone).toBe('0555123456');
    expect(created.email).toBe('uf-direct@example.com');
    expect(created.status).toBe('active');
    expect(created.branchId).toBe('main');
  });

  test('missing fullName defaults to username', async () => {
    const created = fixtureCreateUser(server.app, {
      username: 'uf-fullname',
      password: 'FullName#1234'
    });
    expect(created.fullName).toBe('uf-fullname');
  });

  test('missing role defaults to Cashier', async () => {
    const created = fixtureCreateUser(server.app, {
      username: 'uf-role',
      password: 'Role#1234'
    });
    expect(created.role).toBe('Cashier');
  });

  test('sanitized output excludes password and sensitive fields', async () => {
    const created = fixtureCreateUser(server.app, {
      username: 'uf-sanitize',
      password: 'Sanitize#1234',
      role: 'Cashier'
    });
    expect(created.password).toBeUndefined();
    expect(created.username).toBe('uf-sanitize');
    expect(created.createdAt).toBeDefined();
    expect(created.updatedAt).toBeDefined();
  });

  test('tenant normalization works through the real service', async () => {
    const created = fixtureCreateUser(server.app, {
      username: 'uf-norm',
      password: 'Norm#1234',
      role: 'Manager',
      tenantIds: ['digitronics', 'nile', 'nile']
    });
    expect(Array.isArray(created.tenantIds)).toBe(true);
    expect(created.tenantIds).toEqual(['digitronics', 'nile']);
  });

  test('authHelper.createUser delegates to userFixture and returns sanitized user', async () => {
    const created = await createUser(server.app, {
      username: 'uf-delegate',
      password: 'Delegate#1234',
      role: 'Admin',
      extra: { tenantIds: ['t1'] }
    });
    expect(created.password).toBeUndefined();
    expect(created.tenantIds).toEqual(['t1']);
    expect(created.role).toBe('Admin');
  });
});
