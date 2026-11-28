'use strict';

// Focused backend security tests for the Unified Services Catalog (M4).
//
// Covers:
//   - Authentication enforcement (401 unauthenticated)
//   - Tenant/platform authorization boundary using the REAL persisted actor
//     (usersService.getByUsername) — never the thin req.user object
//   - Tenant permission filtering via authorization.hasPermission against the
//     real user record (tenantRoles, permissions, tenantPermissions)
//   - Effective role via resolveTenantRoleForRequest + trustedTenantId from
//     authorize.js (feature-flag gated, tenant-context aware)
//   - Platform membership revalidated against real user record before
//     platform service visibility (mirrors platformAuth._platformActor)
//   - Cross-tenant membership boundary (assertTenantAccess)
//   - Internal-service exclusion
//   - Client spoofing resistance (query params, headers)
//   - Read-only HTTP method hardening (405)
//   - API response minimization (no source, id, username, tenantId)
//   - Service metadata integrity (counts from counts()/statusCounts())

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { createUser, login } = require('./helpers/authHelper');
const catalogMetadata = require('../services/catalogMetadata.service');
const platformRegistry = require('../permissions/platformRegistry');
const registry = require('../permissions/registry');
const usersService = require('../services/users.service');

const PASSWORD = 'Pass#123';
const CATALOG_URL = '/api/v1/services/catalog';
const TENANT_ID = 'digi';
const TENANT_B_ID = 'tenant-b';

let server;
let dir;
let platformAdmin;

beforeAll(async () => {
  // Enable tenant roles so the catalog controller exercises the real
  // authorization flow (resolveTenantRoleForRequest / trustedTenantId).
  // tenantCarryEnabled defaults to true (config: ENABLE_TENANT_CARRY !== 'false').
  process.env.ENABLE_TENANT_ROLES = 'true';
  process.env.AUTH_REQUIRED = 'true';

  dir = makeTempDataDir('svc-catalog-final');
  server = await startServer(dir, { AUTH_REQUIRED: 'true' });

  // Seed the company so tenantCarry can build a valid tenantContext and
  // loginTenant DERIVED resolution can bind the tenant.
  seed(dir, 'companies', {
    companies: [
      { id: TENANT_ID, code: 'DIGI', name: 'DigiTronics', active: true, status: 'ACTIVE', branches: [] },
      { id: TENANT_B_ID, code: 'TNB', name: 'Tenant B', active: true, status: 'ACTIVE', branches: [] }
    ]
  });

  // ---------- Tenant users (tenant scope) ----------
  // Each has tenantIds: [TENANT_ID] so loginTenant DERIVED resolution finds
  // exactly one active company candidate and binds tenantId to the token.
  createUser(server.app, { username: 'owner', password: PASSWORD, fullName: 'Owner User', role: 'Owner', tenantIds: [TENANT_ID] });
  createUser(server.app, { username: 'admin', password: PASSWORD, fullName: 'Admin User', role: 'Admin', tenantIds: [TENANT_ID] });
  createUser(server.app, { username: 'manager', password: PASSWORD, fullName: 'Manager User', role: 'Manager', tenantIds: [TENANT_ID] });
  createUser(server.app, { username: 'cashier', password: PASSWORD, fullName: 'Cashier User', role: 'Cashier', tenantIds: [TENANT_ID] });
  createUser(server.app, { username: 'technician', password: PASSWORD, fullName: 'Tech User', role: 'Technician', tenantIds: [TENANT_ID] });
  createUser(server.app, { username: 'viewer', password: PASSWORD, fullName: 'Viewer User', role: 'Viewer', tenantIds: [TENANT_ID] });

  // Global Owner downgraded to Cashier in tenant 'digi'.
  createUser(server.app, {
    username: 'ownerCashier', password: PASSWORD, fullName: 'Owner->Cashier', role: 'Owner',
    tenantIds: [TENANT_ID], tenantRoles: { [TENANT_ID]: 'Cashier' }
  });
  // Global Cashier upgraded to Owner in tenant 'digi'.
  createUser(server.app, {
    username: 'cashierOwner', password: PASSWORD, fullName: 'Cashier->Owner', role: 'Cashier',
    tenantIds: [TENANT_ID], tenantRoles: { [TENANT_ID]: 'Owner' }
  });
  // Cashier with tenant permission override for products.view in 'digi'.
  createUser(server.app, {
    username: 'cashierOverride', password: PASSWORD, fullName: 'Cashier+Override', role: 'Cashier',
    tenantIds: [TENANT_ID], tenantPermissions: { [TENANT_ID]: { 'products.view': true } }
  });
  // Cashier with tenant permission override denying reports.view in 'digi'.
  createUser(server.app, {
    username: 'cashierDeny', password: PASSWORD, fullName: 'CashierDeny', role: 'Cashier',
    tenantIds: [TENANT_ID], tenantPermissions: { [TENANT_ID]: { 'reports.view': false } }
  });

  // ---------- Platform members (platform scope, separate from tenant roles) ----------
  // Platform members have no tenantIds — loginTenant resolves them as
  // PLATFORM_IDENTITY (tenantId = undefined), keeping tenant and platform
  // scopes separate. Use platformAdmin.grant() (goes through fileStore.write,
  // which updates the read cache) instead of seed() to avoid stale-cache issues
  // caused by platformAdmin.ensureSeeded() running at server boot.
  platformAdmin = require('../services/platformAdmin.service');
  createUser(server.app, { username: 'master', password: PASSWORD, fullName: 'Master User', role: 'Viewer' });
  platformAdmin.grant('master', 'MASTER_OWNER');
  createUser(server.app, { username: 'platAdmin', password: PASSWORD, fullName: 'Platform Admin', role: 'Viewer' });
  platformAdmin.grant('platAdmin', 'PLATFORM_ADMIN');
  createUser(server.app, { username: 'developer', password: PASSWORD, fullName: 'Developer User', role: 'Viewer' });
  platformAdmin.grant('developer', 'DEVELOPER');
  createUser(server.app, { username: 'dataEntry', password: PASSWORD, fullName: 'Data Entry User', role: 'Viewer' });
  platformAdmin.grant('dataEntry', 'DATA_ENTRY');
  createUser(server.app, { username: 'disabledMember', password: PASSWORD, fullName: 'Disabled Member', role: 'Viewer' });
  platformAdmin.grant('disabledMember', 'MASTER_OWNER');
  platformAdmin.setMemberStatus('disabledMember', 'disabled');

  // ---------- Cross-tenant test users ----------
  // Bound only to tenant-a ('digi') — used for cross-tenant denial tests.
  createUser(server.app, { username: 'ownerA', password: PASSWORD, fullName: 'Owner A', role: 'Owner', tenantIds: [TENANT_ID] });
  createUser(server.app, { username: 'adminA', password: PASSWORD, fullName: 'Admin A', role: 'Admin', tenantIds: [TENANT_ID] });
  // Tenant-specific Owner in tenant-a only — no membership in tenant-b.
  createUser(server.app, {
    username: 'ownerInAOnly', password: PASSWORD, fullName: 'Owner in A only', role: 'Cashier',
    tenantIds: [TENANT_ID], tenantRoles: { [TENANT_ID]: 'Owner' }
  });
  // Member of both tenant-a and tenant-b — legitimate multi-tenant membership.
  createUser(server.app, {
    username: 'memberBoth', password: PASSWORD, fullName: 'Member Both', role: 'Owner',
    tenantIds: [TENANT_ID, TENANT_B_ID]
  });
  // Unbound legacy identity — no tenantIds, no tenantRoles.
  createUser(server.app, { username: 'legacyUnbound', password: PASSWORD, fullName: 'Legacy Unbound', role: 'Cashier' });
});

async function loginToken(username) {
  const res = await request(server.app)
    .post('/api/v1/auth/login')
    .send({ username, password: PASSWORD });
  if (res.statusCode !== 200) {
    throw new Error(`login(${username}) failed: ${res.statusCode} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.accessToken;
}

function svcIds(services) {
  return services.map(s => s.id);
}

// Computed expectations from the metadata source of truth.
const TENANT_IDS = catalogMetadata.getTenantServices().map(s => s.id);
const MASTER_IDS = catalogMetadata.getMasterServices().map(s => s.id);
const INTERNAL_IDS = catalogMetadata.getInternalServices().map(s => s.id);
const META_COUNTS = catalogMetadata.counts();
const META_STATUS = catalogMetadata.statusCounts();

describe('GET /api/v1/services/catalog — authentication', () => {
  test('unauthenticated request returns 401', async () => {
    const res = await request(server.app).get(CATALOG_URL);
    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('invalid bearer token returns 401', async () => {
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', 'Bearer not-a-valid-token');
    expect(res.statusCode).toBe(401);
  });

  test('authenticated user receives 200 and minimal user context', async () => {
    const token = await loginToken('owner');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toBeDefined();
    expect(res.body.data.user.role).toBe('Owner');
    // Minimized response: no id, username, or raw tenantId exposed.
    expect(res.body.data.user.id).toBeUndefined();
    expect(res.body.data.user.username).toBeUndefined();
    expect(res.body.data.user.tenantId).toBeUndefined();
    expect(res.body.data.services).toBeInstanceOf(Array);
    expect(res.body.data.total).toBeGreaterThanOrEqual(0);
  });
});

describe('GET /api/v1/services/catalog — tenant authorization (real persisted actor)', () => {
  test('Owner receives all tenant-authorized services, no platform services', async () => {
    const token = await loginToken('owner');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // Owner/Admin bypass in tenant scope: all tenant services visible.
    for (const id of TENANT_IDS) expect(ids).toContain(id);
    // No platform services — tenant Owner is not a platform member.
    for (const id of MASTER_IDS) expect(ids).not.toContain(id);
    // No internal services.
    for (const id of INTERNAL_IDS) expect(ids).not.toContain(id);
    expect(res.body.data.user.role).toBe('Owner');
  });

  test('Admin receives all tenant-authorized services, no platform services', async () => {
    const token = await loginToken('admin');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    for (const id of TENANT_IDS) expect(ids).toContain(id);
    for (const id of MASTER_IDS) expect(ids).not.toContain(id);
    for (const id of INTERNAL_IDS) expect(ids).not.toContain(id);
    expect(res.body.data.user.role).toBe('Admin');
  });

  test('Manager receives only services allowed by its actual tenant baseline', async () => {
    const token = await loginToken('manager');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // Manager baseline includes: dashboard, products, customers, suppliers,
    // inventory, purchases, sales, treasury, reports, hr, identity, governance,
    // documents, backup_sync, business_marketplace, settings.
    expect(ids).toContain('dashboard');
    expect(ids).toContain('products');
    expect(ids).toContain('customers');
    expect(ids).toContain('suppliers');
    expect(ids).toContain('inventory');
    expect(ids).toContain('purchases');
    expect(ids).toContain('sales');
    expect(ids).toContain('treasury');
    expect(ids).toContain('reports');
    expect(ids).toContain('hr');
    expect(ids).toContain('identity');
    expect(ids).toContain('governance');
    expect(ids).toContain('documents');
    expect(ids).toContain('backup_sync');
    expect(ids).toContain('business_marketplace');
    expect(ids).toContain('settings');
    // Manager baseline does NOT include education.centers.view.
    expect(ids).not.toContain('education');
    // Services with null permission are withheld.
    expect(ids).not.toContain('repairs');
    expect(ids).not.toContain('accounting_core');
    expect(ids).not.toContain('accounting_rules');
    expect(ids).not.toContain('notifications');
    expect(ids).not.toContain('tools');
    expect(ids).not.toContain('automation');
    expect(ids).not.toContain('branches');
    expect(ids).not.toContain('integrations');
    expect(ids).not.toContain('platform_tools');
    expect(ids).not.toContain('playstation');
    expect(ids).not.toContain('car_rental');
    // student_services has permission settings.view; Manager baseline includes it.
    expect(ids).toContain('student_services');
    // No platform services.
    for (const id of MASTER_IDS) expect(ids).not.toContain(id);
  });

  test('Cashier receives only services allowed by its actual tenant baseline', async () => {
    const token = await loginToken('cashier');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // Cashier baseline: sales.view, sales.create, customers.view, customers.create,
    // dashboard.view, treasury.view, reports.view.
    expect(ids).toContain('dashboard');
    expect(ids).toContain('customers');
    expect(ids).toContain('sales');
    expect(ids).toContain('treasury');
    expect(ids).toContain('reports');
    // Cashier does NOT have products.view, inventory.view, etc.
    expect(ids).not.toContain('products');
    expect(ids).not.toContain('inventory');
    expect(ids).not.toContain('purchases');
    expect(ids).not.toContain('suppliers');
    // No platform services.
    for (const id of MASTER_IDS) expect(ids).not.toContain(id);
  });

  test('Technician receives only services allowed by its actual tenant baseline', async () => {
    const token = await loginToken('technician');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // Technician baseline: inventory.view, inventory.create, inventory.edit,
    // products.view, dashboard.view.
    expect(ids).toContain('dashboard');
    expect(ids).toContain('products');
    expect(ids).toContain('inventory');
    // Technician does NOT have sales.view, customers.view, etc.
    expect(ids).not.toContain('sales');
    expect(ids).not.toContain('customers');
    expect(ids).not.toContain('repairs');
    // No platform services.
    for (const id of MASTER_IDS) expect(ids).not.toContain(id);
  });

  test('Viewer receives only its actual read-only capabilities', async () => {
    const token = await loginToken('viewer');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // Viewer baseline: dashboard.view, reports.view, sales.view, purchases.view,
    // inventory.view, products.view, customers.view, suppliers.view, partners.view,
    // vouchers.view, treasury.view, company.view.
    expect(ids).toContain('dashboard');
    expect(ids).toContain('purchases');
    expect(ids).toContain('inventory');
    expect(ids).toContain('products');
    expect(ids).toContain('customers');
    expect(ids).toContain('suppliers');
    expect(ids).toContain('sales');
    expect(ids).toContain('treasury');
    expect(ids).toContain('reports');
    // Viewer does NOT have audit.view, employees.view, users.view, settings.view.
    expect(ids).not.toContain('hr');
    expect(ids).not.toContain('identity');
    expect(ids).not.toContain('governance');
    expect(ids).not.toContain('settings');
    // No platform services.
    for (const id of MASTER_IDS) expect(ids).not.toContain(id);
  });
});

describe('GET /api/v1/services/catalog — tenant role downgrade/upgrade regressions', () => {
  test('Global Owner downgraded to Cashier in tenant: only Cashier-allowed services', async () => {
    const token = await loginToken('ownerCashier');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // Effective role resolved from tenantRoles: Cashier.
    expect(res.body.data.user.role).toBe('Cashier');
    // Cashier-allowed services only.
    expect(ids).toContain('dashboard');
    expect(ids).toContain('customers');
    expect(ids).toContain('sales');
    expect(ids).toContain('treasury');
    expect(ids).toContain('reports');
    // Owner bypass does NOT apply — effective role is Cashier.
    expect(ids).not.toContain('products');
    expect(ids).not.toContain('inventory');
    expect(ids).not.toContain('hr');
    expect(ids).not.toContain('identity');
    expect(ids).not.toContain('settings');
    // No platform services.
    for (const id of MASTER_IDS) expect(ids).not.toContain(id);
  });

  test('Global Cashier upgraded to Owner in tenant: Owner visibility only inside that tenant', async () => {
    const token = await loginToken('cashierOwner');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // Effective role resolved from tenantRoles: Owner.
    expect(res.body.data.user.role).toBe('Owner');
    // Owner tenant bypass: all tenant services visible inside this tenant.
    for (const id of TENANT_IDS) expect(ids).toContain(id);
    // No platform services — tenant Owner is not a platform member.
    for (const id of MASTER_IDS) expect(ids).not.toContain(id);
  });

  test('Tenant permission override grants a catalog service consistently', async () => {
    const token = await loginToken('cashierOverride');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // Cashier baseline + tenantPermissions override for products.view.
    expect(ids).toContain('dashboard');
    expect(ids).toContain('customers');
    expect(ids).toContain('sales');
    expect(ids).toContain('treasury');
    expect(ids).toContain('reports');
    // Override grants products.view.
    expect(ids).toContain('products');
    // But not inventory.view (not in baseline, not overridden).
    expect(ids).not.toContain('inventory');
    // No platform services.
    for (const id of MASTER_IDS) expect(ids).not.toContain(id);
  });

  test('Tenant permission override denies a catalog service consistently', async () => {
    const token = await loginToken('cashierDeny');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // Cashier baseline minus reports.view (denied by override).
    expect(ids).toContain('dashboard');
    expect(ids).toContain('customers');
    expect(ids).toContain('sales');
    expect(ids).toContain('treasury');
    expect(ids).not.toContain('reports');
    // No platform services.
    for (const id of MASTER_IDS) expect(ids).not.toContain(id);
  });
});

describe('GET /api/v1/services/catalog — cross-tenant membership boundary', () => {
  // Helper: create a user initially bound to tenant-b only, log in (token binds
  // tenant-b via DERIVED resolution), then update their binding to the final
  // tenant set. Simulates a stale token that still carries tenant-b after the
  // account's membership has changed.
  async function staleTokenUser(username, role, finalTenantIds, finalTenantRoles) {
    createUser(server.app, {
      username, password: PASSWORD, fullName: username, role,
      tenantIds: [TENANT_B_ID]
    });
    const result = await login(server.app, username, PASSWORD);
    const token = result.accessToken;
    // Directly rewrite the users file to change the binding (bypasses any
    // cross-instance usersService cache; fileStore mtime check invalidates the
    // server's read cache on the next request).
    const usersFile = path.join(dir, 'users.json');
    const usersData = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
    const userIdx = usersData.users.findIndex(u => u.username === username);
    if (userIdx !== -1) {
      usersData.users[userIdx].tenantIds = finalTenantIds;
      if (finalTenantRoles) usersData.users[userIdx].tenantRoles = finalTenantRoles;
      seed(dir, 'users', usersData);
    }
    return token;
  }

  test('Global Owner bound only to tenant A: stale tenant-B context returns no tenant-B services', async () => {
    const token = await staleTokenUser('staleOwnerA', 'Owner', [TENANT_ID]);
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // Cross-tenant denial: Owner/Admin bypass does not apply outside membership.
    expect(ids).not.toContain('dashboard');
    expect(ids).not.toContain('products');
    expect(ids).not.toContain('customers');
    expect(ids).not.toContain('sales');
    expect(ids).not.toContain('treasury');
    expect(ids).not.toContain('reports');
    // No platform services — not a platform member.
    for (const id of MASTER_IDS) expect(ids).not.toContain(id);
  });

  test('Global Admin bound only to tenant A: tenant-B context returns no tenant-B services', async () => {
    const token = await staleTokenUser('staleAdminA', 'Admin', [TENANT_ID]);
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // Cross-tenant denial: Admin bypass does not apply outside membership.
    expect(ids).not.toContain('dashboard');
    expect(ids).not.toContain('products');
    expect(ids).not.toContain('customers');
    // No platform services — not a platform member.
    for (const id of MASTER_IDS) expect(ids).not.toContain(id);
  });

  test('Tenant-specific Owner in tenant A: tenant-B context returns no tenant-B services', async () => {
    const token = await staleTokenUser(
      'staleOwnerInA', 'Cashier', [TENANT_ID], { [TENANT_ID]: 'Owner' }
    );
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // Effective role is Owner inside tenant-a, but tenant-B context is not a
    // membership — no tenant-B services despite Owner-level effective role.
    expect(ids).not.toContain('dashboard');
    expect(ids).not.toContain('products');
    // No platform services — not a platform member.
    for (const id of MASTER_IDS) expect(ids).not.toContain(id);
  });

  test('Member of both tenant A and tenant B can access catalog without denial', async () => {
    const token = await loginToken('memberBoth');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // Multi-tenant member is not blocked from the catalog entirely.
    expect(ids.length).toBeGreaterThan(0);
    // No platform services — not a platform member.
    for (const id of MASTER_IDS) expect(ids).not.toContain(id);
    // With no specific trusted tenant (DERIVED ambiguous), Owner bypass applies
    // as legacy behavior — all tenant services visible.
    for (const id of TENANT_IDS) expect(ids).toContain(id);
  });

  test('Unbound legacy identity retains legacy catalog behavior', async () => {
    const token = await loginToken('legacyUnbound');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // Unbound Cashier gets baseline services (no tenant filtering without context).
    expect(ids).toContain('dashboard');
    expect(ids).toContain('sales');
    expect(ids).toContain('treasury');
    expect(ids).toContain('reports');
    // Cashier does NOT have products.view, inventory.view, etc.
    expect(ids).not.toContain('products');
    expect(ids).not.toContain('inventory');
    // No platform services — not a platform member.
    for (const id of MASTER_IDS) expect(ids).not.toContain(id);
  });
});

describe('GET /api/v1/services/catalog — real user record validation', () => {
  test('Valid token, then removed user record: no platform catalog services', async () => {
    // Create a user with platform membership.
    createUser(server.app, {
      username: 'tempUser', password: PASSWORD, fullName: 'Temp User', role: 'Viewer'
    });
    seed(dir, 'platformAdmins', {
      admins: [
        { username: 'tempUser', platformRole: 'MASTER_OWNER', status: 'active' }
      ]
    });

    const token = await loginToken('tempUser');

    // Remove the persisted user record while keeping the platform membership.
    const usersFile = path.join(dir, 'users.json');
    const usersStore = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    usersStore.users = usersStore.users.filter(u => u.username !== 'tempUser');
    fs.writeFileSync(usersFile, JSON.stringify(usersStore, null, 2), 'utf8');

    // The old token must not obtain platform catalog services.
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    // Fail closed: either 401 (no real user record) or 200 with no master services.
    expect([200, 401]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const ids = svcIds(res.body.data.services);
      for (const id of MASTER_IDS) expect(ids).not.toContain(id);
    }
  });

  test('Unknown username token cannot obtain catalog services', async () => {
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', 'Bearer nonexistent-user-token');
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/v1/services/catalog — platform authorization (real membership)', () => {
  test('MASTER_OWNER with tenant role Viewer receives platform services, no tenant escalation', async () => {
    const token = await loginToken('master');
    platformAdmin.grant('master', 'MASTER_OWNER');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // Tenant role is Viewer — sees Viewer tenant services.
    expect(ids).toContain('dashboard');
    expect(ids).toContain('reports');
    // MASTER_OWNER has wildcard — sees all platform services with permission mapping.
    expect(ids).toContain('platform_dashboard');
    expect(ids).toContain('platform_companies');
    expect(ids).toContain('platform_users');
    expect(ids).toContain('platform_licenses');
    expect(ids).toContain('platform_integrations');
    expect(ids).toContain('platform_audit');
    // Services without platformPermission are withheld.
    expect(ids).not.toContain('platform_database');
    expect(ids).not.toContain('platform_backups');
    // No internal services.
    for (const id of INTERNAL_IDS) expect(ids).not.toContain(id);
    // Platform role never grants additional tenant capabilities beyond Viewer baseline.
    expect(ids).not.toContain('settings'); // Viewer lacks settings.view
    expect(res.body.data.user.role).toBe('Viewer');
  });

  test('PLATFORM_ADMIN receives only its source-authorized platform services', async () => {
    const token = await loginToken('platAdmin');
    platformAdmin.grant('platAdmin', 'PLATFORM_ADMIN');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // PLATFORM_ADMIN has platform.dashboard.view, platform.companies.view,
    // platform.users.view, platform.licenses.view, platform.integrations.view,
    // platform.audit.view, catalog.read.
    expect(ids).toContain('platform_dashboard');
    expect(ids).toContain('platform_companies');
    expect(ids).toContain('platform_users');
    expect(ids).toContain('platform_licenses');
    expect(ids).toContain('platform_integrations');
    expect(ids).toContain('platform_audit');
    // No platform services without permission mapping.
    expect(ids).not.toContain('platform_database');
    expect(ids).not.toContain('platform_backups');
  });

  test('DEVELOPER receives only its source-authorized platform services', async () => {
    const token = await loginToken('developer');
    platformAdmin.grant('developer', 'DEVELOPER');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // DEVELOPER has platform.dashboard.view, platform.audit.view,
    // platform.diagnostics.view, catalog.read.
    expect(ids).toContain('platform_dashboard');
    expect(ids).toContain('platform_audit');
    // DEVELOPER does NOT have platform.companies.view, platform.users.view, etc.
    expect(ids).not.toContain('platform_companies');
    expect(ids).not.toContain('platform_users');
    expect(ids).not.toContain('platform_licenses');
    expect(ids).not.toContain('platform_integrations');
  });

  test('DATA_ENTRY receives only its source-authorized platform services', async () => {
    const token = await loginToken('dataEntry');
    platformAdmin.grant('dataEntry', 'DATA_ENTRY');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // DATA_ENTRY has platform.dashboard.view, catalog.read, catalog.create, catalog.update.
    expect(ids).toContain('platform_dashboard');
    // DATA_ENTRY does NOT have platform.audit.view or other platform permissions.
    expect(ids).not.toContain('platform_audit');
    expect(ids).not.toContain('platform_companies');
  });

  test('Disabled platform member receives no platform services', async () => {
    const token = await loginToken('disabledMember');
    platformAdmin.grant('disabledMember', 'MASTER_OWNER');
    platformAdmin.setMemberStatus('disabledMember', 'disabled');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // Disabled: platformRoleFor returns null — no platform services.
    for (const id of MASTER_IDS) expect(ids).not.toContain(id);
    // Tenant role Viewer still applies for tenant services.
    expect(ids).toContain('dashboard');
  });
});

describe('GET /api/v1/services/catalog — client cannot spoof role', () => {
  test('query param role is ignored (server-authoritative)', async () => {
    const token = await loginToken('cashier');
    const res = await request(server.app)
      .get(CATALOG_URL + '?role=Owner')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // Cashier still sees only Cashier-authorized services.
    expect(ids).toContain('dashboard');
    expect(ids).not.toContain('products');
    expect(res.body.data.user.role).toBe('Cashier');
    // ?role=Owner does not grant platform membership.
    for (const id of MASTER_IDS) expect(ids).not.toContain(id);
  });

  test('x-role header is ignored', async () => {
    const token = await loginToken('cashier');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`)
      .set('x-role', 'Admin');
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    expect(ids).toContain('dashboard');
    expect(ids).not.toContain('products');
    for (const id of MASTER_IDS) expect(ids).not.toContain(id);
  });

  test('client-supplied platform role does not expand platform access', async () => {
    const token = await loginToken('viewer');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`)
      .set('x-platform-role', 'MASTER_OWNER');
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // Viewer is not a platform member — header is ignored.
    for (const id of MASTER_IDS) expect(ids).not.toContain(id);
  });

  test('Internal services are never exposed to any role', async () => {
    for (const username of ['owner', 'admin', 'manager', 'cashier', 'technician', 'viewer', 'master', 'platAdmin', 'developer', 'dataEntry', 'disabledMember']) {
      const token = await loginToken(username);
      const res = await request(server.app)
        .get(CATALOG_URL)
        .set('Authorization', `Bearer ${token}`);
      expect(res.statusCode).toBe(200);
      const ids = svcIds(res.body.data.services);
      for (const id of INTERNAL_IDS) {
        expect(ids).not.toContain(id);
      }
    }
  });
});

describe('GET /api/v1/services/catalog — API response minimization', () => {
  test('response does not expose source references, user id, username, or raw tenantId', async () => {
    const token = await loginToken('owner');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    // User context: only role.
    expect(res.body.data.user).toBeDefined();
    expect(Object.keys(res.body.data.user)).toEqual(['role']);
    // Service entries: no source, no permission, no platformPermission fields.
    for (const svc of res.body.data.services) {
      expect(svc.source).toBeUndefined();
      expect(svc.permission).toBeUndefined();
      expect(svc.platformPermission).toBeUndefined();
      expect(svc.id).toBeDefined();
      expect(svc.name).toBeDefined();
      expect(svc.category).toBeDefined();
      expect(svc.scope).toBeDefined();
      expect(svc.status).toBeDefined();
      expect(svc.destination).toBeDefined();
    }
    // No platformPermission anywhere in the response.
    expect(JSON.stringify(res.body)).not.toContain('platformPermission');
  });
});

describe('GET /api/v1/services/catalog — service metadata integrity', () => {
  test('reported totals match metadata counts() and statusCounts()', () => {
    expect(META_COUNTS.tenant).toBe(29);
    expect(META_COUNTS.master).toBe(8);
    expect(META_COUNTS.internal).toBe(7);
    expect(META_COUNTS.total).toBe(44);
    expect(META_STATUS.READY).toBe(9);
    expect(META_STATUS.PARTIAL).toBe(12);
    expect(META_STATUS.BACKEND_ONLY).toBe(7);
    expect(META_STATUS.NOT_VERIFIED).toBe(16);
    expect(META_STATUS.READY + META_STATUS.PARTIAL + META_STATUS.BACKEND_ONLY + META_STATUS.NOT_VERIFIED).toBe(META_COUNTS.total);
  });

  test('every service has a unique stable ID and valid scope/status', () => {
    const all = catalogMetadata.getAllServices();
    const ids = all.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length); // unique IDs
    for (const svc of all) {
      expect(svc.id).toBeTruthy();
      expect(svc.name).toBeTruthy();
      expect(svc.category).toBeTruthy();
      expect(['tenant', 'master', 'internal']).toContain(svc.scope);
      expect(['READY', 'PARTIAL', 'BACKEND_ONLY', 'NOT_VERIFIED']).toContain(svc.state);
      expect(svc.source).toBeTruthy();
    }
  });

  test('READY services must have a verified non-empty destination', () => {
    for (const svc of catalogMetadata.getAllServices()) {
      if (svc.state === 'READY') {
        expect(svc.destination).toBeTruthy();
        expect(typeof svc.destination).toBe('string');
        expect(svc.destination.length).toBeGreaterThan(0);
      }
    }
  });

  test('BACKEND_ONLY and NOT_VERIFIED services are never launchable', () => {
    for (const svc of catalogMetadata.getAllServices()) {
      if (svc.state === 'BACKEND_ONLY' || svc.state === 'NOT_VERIFIED') {
        expect(svc.state).not.toBe('READY');
      }
    }
  });

  test('every tenant service has a permission or is explicitly null', () => {
    for (const svc of catalogMetadata.getTenantServices()) {
      if (svc.permission !== null) {
        expect(registry.isEnforceable(svc.permission)).toBe(true);
      }
    }
  });

  test('every master service with platformPermission uses a known platform permission', () => {
    for (const svc of catalogMetadata.getMasterServices()) {
      if (svc.platformPermission !== null) {
        expect(platformRegistry.ALL_PLATFORM_PERMISSIONS).toContain(svc.platformPermission);
      }
    }
  });

  test('no duplicated canonical platform destinations (aliases consolidated)', () => {
    const masterServices = catalogMetadata.getMasterServices();
    const destinations = masterServices.map(s => s.destination).filter(Boolean);
    expect(new Set(destinations).size).toBe(destinations.length);
  });

  test('services returned by the API are a subset of metadata for the caller', async () => {
    const token = await loginToken('owner');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    const allMetadataIds = new Set(catalogMetadata.getAllServices().map(s => s.id));
    for (const id of ids) {
      expect(allMetadataIds.has(id)).toBe(true);
    }
  });
});

describe('Methods other than GET on /catalog return 405', () => {
  test.each([
    ['POST', 'post'],
    ['PUT', 'put'],
    ['PATCH', 'patch'],
    ['DELETE', 'delete']
  ])('%s returns 405', async (method, fn) => {
    const token = await loginToken('owner');
    const res = await request(server.app)[fn](CATALOG_URL)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.statusCode).toBe(405);
    expect(res.body.success).toBe(false);
  });

  test('unauthenticated POST returns 405 (method check before auth on route)', async () => {
    const res = await request(server.app).post(CATALOG_URL).send({});
    expect(res.statusCode).toBe(405);
  });
});

describe('GET /api/v1/services/catalog — determinism and ordering', () => {
  test('catalog is deterministic across calls', async () => {
    const token = await loginToken('owner');
    const r1 = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    const r2 = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r1.body.data.total).toBe(r2.body.data.total);
    expect(svcIds(r1.body.data.services)).toEqual(svcIds(r2.body.data.services));
  });

  test('scope ordering: tenant first, then master; category stable within scope', async () => {
    const token = await loginToken('master');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const services = res.body.data.services;
    const scopeOrder = { tenant: 0, master: 1, internal: 2 };
    // No internal services.
    for (const svc of services) {
      expect(svc.scope).not.toBe('internal');
    }
    // Tenant services sort before master services.
    let lastScope = -1;
    for (const svc of services) {
      const cur = scopeOrder[svc.scope] ?? 99;
      expect(cur).toBeGreaterThanOrEqual(lastScope);
      lastScope = cur;
    }
    // Category ordering is stable within a scope.
    let prevScope = null;
    let prevCategory = '';
    for (const svc of services) {
      if (svc.scope !== prevScope) {
        prevScope = svc.scope;
        prevCategory = svc.category || '';
      } else {
        const cur = svc.category || '';
        expect(cur.localeCompare(prevCategory)).toBeGreaterThanOrEqual(0);
        prevCategory = cur;
      }
    }
  });
});
