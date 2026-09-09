'use strict';

// v1.0.1 — UPDATE/APPLY EFFECTIVE-ROLE AUTHORIZATION (P3).
//
// The audit found POST /api/v1/update/apply authorized on the RAW global role
// (`user.role`) instead of the per-tenant EFFECTIVE role. A user holding the
// global role Manager but acting as Viewer inside a tenant could have started
// the updater.
//
// v1.0.1 routes apply through requireRole('Owner','Admin','Manager') which
// resolves the per-tenant effective role (tenantRoles) and rewrote the
// controller to honor user.effectiveRole as defense-in-depth.
//
// Proves:
//  - effective Viewer in the tenant (raw role Manager) is denied 403.
//  - effective Manager in the tenant passes the gate and reaches the disabled
//    updater path (500 — updates disabled, nothing launched).

const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const ORIGINAL_ENV = {
  ROLES: process.env.ENABLE_TENANT_ROLES,
  CARRY: process.env.ENABLE_TENANT_CARRY,
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP,
  UPDATE: process.env.UPDATE_ENABLED,
  AUTH: process.env.AUTH_REQUIRED,
  DATA: process.env.DIGITRONICS_DATA_DIR
};

let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  for (const key of ['ENABLE_TENANT_ROLES', 'ENABLE_TENANT_CARRY', 'ENABLE_MULTI_COMPANY_LOGIN', 'ENABLE_TENANT_USER_MEMBERSHIP']) {
    process.env[key] = 'true';
  }
  // Never let the authorized-manager assertion reach the real updater: the
  // upate rail must be reported as disabled (500) without spawning anything.
  process.env.UPDATE_ENABLED = 'false';
  dataDir = makeTempDataDir('v101-update-apply');
  seed(dataDir, 'companies', [{ id: 'acme', name: 'Acme Trading', code: 'ACME', active: true }]);
  const hash = bcrypt.hashSync('Pass#123', 10);
  const stamp = new Date().toISOString();
  seed(dataDir, 'users', {
    users: [
      { id: 'u-mgr', username: 'manager', password: hash, fullName: 'Manager', role: 'Manager', tenantIds: ['acme'], tenantRoles: { acme: 'Manager' }, createdAt: stamp, updatedAt: stamp },
      { id: 'u-look', username: 'managerIsViewer', password: hash, fullName: 'Manager But Viewer', role: 'Manager', tenantIds: ['acme'], tenantRoles: { acme: 'Viewer' }, createdAt: stamp, updatedAt: stamp }
    ]
  });
  server = await startServer(dataDir, { AUTH_REQUIRED: 'true' });
});

afterAll(() => {
  for (const [key, original] of Object.entries(ORIGINAL_ENV)) {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

async function tokenFor(username) {
  const session = await login(server.app, username, 'Pass#123', 'acme');
  return session.accessToken;
}

describe('v1.0.1 — update/apply uses the effective tenant role', () => {
  test('Manager acting as Viewer inside the tenant is denied 403', async () => {
    const res = await request(server.app)
      .post('/api/v1/update/apply')
      .set(authHeader(await tokenFor('managerIsViewer')));
    expect(res.statusCode).toBe(403);
  });

  test('Manager whose effective role is Manager passes the gate (disabled updater -> 500)', async () => {
    const res = await request(server.app)
      .post('/api/v1/update/apply')
      .set(authHeader(await tokenFor('manager')));
    // UPDATE_ENABLED is not set, so the updater is disabled and apply reports
    // the disabled state (500). A 403 here would mean the effective-role
    // resolution wrongly failed.
    expect(res.statusCode).toBe(500);
  });

  test('unauthenticated is 401', async () => {
    const res = await request(server.app).post('/api/v1/update/apply');
    expect(res.statusCode).toBe(401);
  });
});