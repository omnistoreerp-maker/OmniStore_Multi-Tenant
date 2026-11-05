'use strict';

// Cross-tenant role isolation — authorization service level test.
//
// Scenario:
//   - User u-x is a member of tenant-a AND tenant-b.
//   - u-x has a global `role` (Cashier) but NO explicit tenantRoles.
//   - Manager m-a in tenant-a has users.edit permission.
//
// Policy (tenant-scoped role isolation):
//   - Changing a user's role within one tenant MUST update only that
//     tenant's entry in tenantRoles.
//   - The global `role` field must NOT change as a result.
//   - Other tenants' effective roles and permissions must be unaffected.
//
// No production module is mocked. Uses the real authorization service and
// users service against isolated temp data.

const fs = require('fs');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { startServer } = require('./helpers/testServer');
const { login, authHeader } = require('./helpers/authHelper');

const PASSWORD = 'Test#1234';

let dataDir;
let server;
let managerA;
let ux;
let authorization;
let usersService;
let auditService;
let managerToken;

function userRecords() {
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const stamp = new Date().toISOString();
  const base = { password: hash, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 };
  return {
    users: [
      // Manager in tenant-a only. Has users.edit permission.
      { ...base, id: 'u-mgr-a', username: 'mgr-a', fullName: 'Manager A', role: 'Manager', tenantId: 'tenant-a', tenantIds: ['tenant-a'], permissions: ['users.edit'] },
      // Multi-tenant user: member of tenant-a and tenant-b, global role Cashier,
      // NO tenantRoles (legacy-style).
      { ...base, id: 'u-x', username: 'ux', fullName: 'User X', role: 'Cashier', tenantIds: ['tenant-a', 'tenant-b'] }
    ]
  };
}

beforeEach(async () => {
  dataDir = makeTempDataDir('cross-tenant-role-http');
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  jest.resetModules();
  server = await startServer(dataDir, { AUTH_REQUIRED: 'true' });
  seed(dataDir, 'users', userRecords());
  authorization = require('../services/authorization.service');
  usersService = require('../services/users.service');
  auditService = require('../services/audit.service');
  managerA = usersService.getById('u-mgr-a');
  ux = usersService.getById('u-x');
  managerToken = (await login(server.app, 'mgr-a', PASSWORD)).accessToken;
});

afterEach(async () => {
  try { await server.close(); } catch (_) {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
});

describe('Cross-tenant role isolation — authorization service level', () => {
  test('manager in tenant-a can manage u-x (who is in tenant-a)', () => {
    const result = authorization.canManageUser(managerA, ux, 'tenant-a');
    expect(result).toBe(true);
  });

  test('manager in tenant-a can assign a lower role (rank protection)', () => {
    const result = authorization.canManageRole(managerA, 'Technician', 'tenant-a');
    expect(result).toBe(true);
  });

  test('manager in tenant-a CANNOT assign Owner (rank protection)', () => {
    const result = authorization.canManageRole(managerA, 'Owner', 'tenant-a');
    expect(result).toBe(false);
  });

  test('u-x effective role is Cashier in both tenants before change', () => {
    expect(authorization.resolveEffectiveRole(ux, 'tenant-a')).toBe('Cashier');
    expect(authorization.resolveEffectiveRole(ux, 'tenant-b')).toBe('Cashier');
  });

  test('changing u-x role from tenant-a context changes effective role in tenant-a only', () => {
    const result = usersService.update('u-x', { role: 'Technician' }, 'tenant-a');
    expect(result.error).toBeUndefined();

    const after = usersService.getById('u-x');

    // Global role must NOT change — legacy users keep their global role.
    expect(after.role).toBe('Cashier');

    // tenantRoles must have tenant-a set to Technician.
    expect(after.tenantRoles).toEqual({ 'tenant-a': 'Technician' });

    // Effective role in tenant-a changes to Technician.
    expect(authorization.resolveEffectiveRole(after, 'tenant-a')).toBe('Technician');

    // Effective role in tenant-b remains Cashier (falls back to global role).
    expect(authorization.resolveEffectiveRole(after, 'tenant-b')).toBe('Cashier');
  });

  test('permissions change in tenant-a but not tenant-b after role change', () => {
    const permsTenantBBefore = authorization.getEffectivePermissions(ux, 'tenant-b');

    usersService.update('u-x', { role: 'Technician' }, 'tenant-a');
    const after = usersService.getById('u-x');

    const permsTenantA = authorization.getEffectivePermissions(after, 'tenant-a');
    const permsTenantB = authorization.getEffectivePermissions(after, 'tenant-b');

    // Tenant-a: Technician baseline.
    expect(permsTenantA).toContain('inventory.view');
    expect(permsTenantA).not.toContain('sales.view');

    // Tenant-b: Cashier baseline (falls back to global role).
    expect(permsTenantB).toContain('sales.view');

    // Both tenants now have different permissions.
    expect(permsTenantA).not.toEqual(permsTenantB);

    // tenant-b permissions unchanged from before.
    expect(permsTenantB).toEqual(authorization.getEffectivePermissions(ux, 'tenant-b'));
  });

  test('manager in tenant-a cannot manage a user bound ONLY to tenant-b', () => {
    const hash = bcrypt.hashSync(PASSWORD, 10);
    const stamp = new Date().toISOString();
    const db = { users: [
      { ...{ password: hash, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
        id: 'u-b-only', username: 'user-b-only', fullName: 'User B Only',
        role: 'Cashier', tenantIds: ['tenant-b'] }
    ]};
    seed(dataDir, 'users', db);
    const userBOnly = usersService.getById('u-b-only');

    expect(authorization.canManageUser(managerA, userBOnly, 'tenant-a')).toBe(false);
  });

  test('repeat role change in same tenant updates existing entry', () => {
    usersService.update('u-x', { role: 'Technician' }, 'tenant-a');
    let after = usersService.getById('u-x');
    expect(after.tenantRoles).toEqual({ 'tenant-a': 'Technician' });

    usersService.update('u-x', { role: 'Cashier' }, 'tenant-a');
    after = usersService.getById('u-x');
    expect(after.tenantRoles).toEqual({ 'tenant-a': 'Cashier' });

    // tenant-b still has no entry → falls back to global role (Cashier).
    expect(authorization.resolveEffectiveRole(after, 'tenant-b')).toBe('Cashier');
  });
});

describe('Cross-tenant role isolation — HTTP level (requireAuth → update)', () => {
  test('Manager in tenant-a changes u-x role via PUT /users/:id — global role unchanged, tenant-b unchanged', async () => {
    const before = usersService.getById('u-x');
    expect(before.role).toBe('Cashier');

    const res = await request(server.app)
      .put(`/api/v1/users/${ux.id}`)
      .set(authHeader(managerToken))
      .send({ role: 'Technician' });

    expect(res.statusCode).toBe(200);

    const after = usersService.getById('u-x');

    // Global role must NOT change — legacy users keep their global role.
    expect(after.role).toBe('Cashier');

    // tenantRoles must have tenant-a set to Technician.
    expect(after.tenantRoles).toEqual({ 'tenant-a': 'Technician' });

    // Effective role in tenant-a changes to Technician.
    expect(authorization.resolveEffectiveRole(after, 'tenant-a')).toBe('Technician');

    // Effective role in tenant-b remains Cashier (falls back to global role).
    expect(authorization.resolveEffectiveRole(after, 'tenant-b')).toBe('Cashier');

    // tenant-b permissions unchanged.
    const permsTenantB = authorization.getEffectivePermissions(after, 'tenant-b');
    expect(permsTenantB).toContain('sales.view');
  });

  test('Manager in tenant-a cannot manage a user bound ONLY to tenant-b', async () => {
    const hash = bcrypt.hashSync(PASSWORD, 10);
    const stamp = new Date().toISOString();
    const db = { users: [
      { ...{ password: hash, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
        id: 'u-b-only', username: 'user-b-only', fullName: 'User B Only',
        role: 'Cashier', tenantIds: ['tenant-b'] }
    ]};
    seed(dataDir, 'users', db);
    const userBOnly = usersService.getById('u-b-only');

    const res = await request(server.app)
      .put(`/api/v1/users/${userBOnly.id}`)
      .set(authHeader(managerToken))
      .send({ role: 'Technician' });

    expect(res.statusCode).toBe(403);

    const after = usersService.getById('u-b-only');
    expect(after.role).toBe('Cashier');
    expect(after.tenantRoles).toBeUndefined();
    expect(authorization.resolveEffectiveRole(after, 'tenant-b')).toBe('Cashier');
  });

  test('Sending tenantRoles in request body does not bypass authorization', async () => {
    const before = usersService.getById('u-x');

    const res = await request(server.app)
      .put(`/api/v1/users/${ux.id}`)
      .set(authHeader(managerToken))
      .send({ tenantRoles: { 'tenant-b': 'Owner' } });

    expect(res.statusCode).toBe(403);

    const after = usersService.getById('u-x');

    expect(after.role).toBe('Cashier');
    expect(after.tenantRoles).toBeUndefined();
    expect(authorization.resolveEffectiveRole(after, 'tenant-b')).toBe('Cashier');
  });

  test('Audit: USER_ROLE_CHANGED record includes tenantId and tenant-scoped before/after roles', async () => {
    const res = await request(server.app)
      .put(`/api/v1/users/${ux.id}`)
      .set(authHeader(managerToken))
      .send({ role: 'Technician' });

    expect(res.statusCode).toBe(200);

    const result = auditService.query({ action: 'USER_ROLE_CHANGED' });
    expect(result.entries.length).toBeGreaterThan(0);

    const entry = result.entries[0];
    expect(entry.action).toBe('USER_ROLE_CHANGED');
    expect(entry.userId).toBe('u-mgr-a');
    expect(entry.resourceId).toBe('u-x');
    expect(entry.tenantId).toBe('tenant-a');
    expect(entry.changes.before.role).toBe('Cashier');
    expect(entry.changes.after.role).toBe('Technician');
  });

  test('Audit: USER_ROLE_CHANGED record does not expose tenant-b data', async () => {
    const res = await request(server.app)
      .put(`/api/v1/users/${ux.id}`)
      .set(authHeader(managerToken))
      .send({ role: 'Technician' });

    expect(res.statusCode).toBe(200);

    const result = auditService.query({ action: 'USER_ROLE_CHANGED' });
    expect(result.entries.length).toBeGreaterThan(0);

    const entry = result.entries[0];

    // The audit record must only reference tenant-a
    expect(entry.tenantId).toBe('tenant-a');

    // The before/after roles are effective roles in tenant-a only
    expect(entry.changes.before.role).toBe('Cashier');   // effective role in tenant-a before
    expect(entry.changes.after.role).toBe('Technician');  // effective role in tenant-a after

    // No claim that the global role changed (global role stays Cashier)
    expect(entry.changes.before.globalRole).toBeUndefined();
    expect(entry.changes.after.globalRole).toBeUndefined();

    // No tenant-b data anywhere in the record
    const recordStr = JSON.stringify(entry);
    expect(recordStr).not.toContain('tenant-b');
  });
});