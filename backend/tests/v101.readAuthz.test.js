'use strict';

// v1.0.1 — READ-AUTHORIZATION REGRESSION SUITES (P1).
//
// The Production Security Regression Audit rated the open reads on
// employees / partners / vouchers as MEDIUM: any authenticated user could list
// salary-bearing employee records, capital partners and money vouchers.
//
// v1.0.1 added REAL permission groups (employees/partners/vouchers) to the
// permission registry and wired requirePermissionIfAuth onto every route.
// These tests prove:
//  - Owner/Admin still pass (short-circuit).
//  - A role WITHOUT the permission (Cashier) is denied 403 PERMISSION_DENIED.
//  - A role granted partners.view/vouchers.view but not employees.view
//    (Viewer) sees partners/vouchers but is STILL denied on employees.

const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const ORIGINAL_ENV = {
  AUTH: process.env.AUTH_REQUIRED,
  DATA: process.env.DIGITRONICS_DATA_DIR
};

let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  dataDir = makeTempDataDir('v101-read-authz');
  const hash = bcrypt.hashSync('Pass#123', 10);
  const stamp = new Date().toISOString();
  seed(dataDir, 'users', {
    users: [
      { id: 'u-owner', username: 'boss', password: hash, fullName: 'Boss', role: 'Owner', createdAt: stamp, updatedAt: stamp },
      { id: 'u-cash', username: 'cashier', password: hash, fullName: 'Cashier', role: 'Cashier', createdAt: stamp, updatedAt: stamp },
      { id: 'u-viewer', username: 'viewer', password: hash, fullName: 'Viewer', role: 'Viewer', createdAt: stamp, updatedAt: stamp }
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
  const session = await login(server.app, username, 'Pass#123');
  return session.accessToken;
}

const EXPECT_403 = { message: 'Insufficient permission', details: { code: 'PERMISSION_DENIED' } };

describe('v1.0.1 — employees reads are permission-gated', () => {
  test('Owner can list employees', async () => {
    const res = await request(server.app).get('/api/v1/employees').set(authHeader(await tokenFor('boss')));
    expect(res.statusCode).toBe(200);
  });

  test('Cashier is denied employees list (403 PERMISSION_DENIED)', async () => {
    const res = await request(server.app).get('/api/v1/employees').set(authHeader(await tokenFor('cashier')));
    expect(res.statusCode).toBe(403);
    expect(res.body.message).toBe(EXPECT_403.message);
    expect(res.body.details).toEqual(EXPECT_403.details);
  });

  test('Viewer is denied employees list (employees.view not granted)', async () => {
    const res = await request(server.app).get('/api/v1/employees').set(authHeader(await tokenFor('viewer')));
    expect(res.statusCode).toBe(403);
    expect(res.body.details).toEqual(EXPECT_403.details);
  });

  test('unauthenticated is 401', async () => {
    const res = await request(server.app).get('/api/v1/employees');
    expect(res.statusCode).toBe(401);
  });
});

describe('v1.0.1 — partners reads are permission-gated', () => {
  test('Owner can list partners', async () => {
    const res = await request(server.app).get('/api/v1/partners').set(authHeader(await tokenFor('boss')));
    expect(res.statusCode).toBe(200);
  });

  test('Cashier is denied partners list', async () => {
    const res = await request(server.app).get('/api/v1/partners').set(authHeader(await tokenFor('cashier')));
    expect(res.statusCode).toBe(403);
    expect(res.body.details).toEqual(EXPECT_403.details);
  });

  test('Viewer (has partners.view) can list partners', async () => {
    const res = await request(server.app).get('/api/v1/partners').set(authHeader(await tokenFor('viewer')));
    expect(res.statusCode).toBe(200);
  });
});

describe('v1.0.1 — vouchers reads are permission-gated', () => {
  test('Cashier is denied vouchers list', async () => {
    const res = await request(server.app).get('/api/v1/vouchers').set(authHeader(await tokenFor('cashier')));
    expect(res.statusCode).toBe(403);
    expect(res.body.details).toEqual(EXPECT_403.details);
  });

  test('Viewer (has vouchers.view) can list vouchers', async () => {
    const res = await request(server.app).get('/api/v1/vouchers').set(authHeader(await tokenFor('viewer')));
    expect(res.statusCode).toBe(200);
  });
});

describe('v1.0.1 — diagnostic/doc surfaces are auth-gated (P4)', () => {
  test('raw OpenAPI spec requires authentication when AUTH_REQUIRED', async () => {
    const res = await request(server.app).get('/api-docs.json');
    expect(res.statusCode).toBe(401);
  });

  test('deep health requires authentication when AUTH_REQUIRED', async () => {
    const res = await request(server.app).get('/api/v1/health/deep');
    expect(res.statusCode).toBe(401);
  });

  test('an authenticated user can still read the spec and deep health', async () => {
    const head = authHeader(await tokenFor('boss'));
    const spec = await request(server.app).get('/api-docs.json').set(head);
    expect(spec.statusCode).toBe(200);
    const deep = await request(server.app).get('/api/v1/health/deep').set(head);
    expect([200, 503]).toContain(deep.statusCode);
  });
});