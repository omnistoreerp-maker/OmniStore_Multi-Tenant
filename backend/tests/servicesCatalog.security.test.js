'use strict';

// Focused backend security tests for the Unified Services Catalog (M4).
//
// Covers:
//   - Authentication enforcement (401 unauthenticated)
//   - Tenant/platform authorization boundary (strict separation)
//   - Tenant permission filtering by canonical registry permissions
//   - Platform membership gating via platformAdmin + platformRegistry
//   - Internal-service exclusion
//   - Client spoofing resistance (query params, headers)
//   - Read-only HTTP method hardening (405)
//   - Service metadata integrity (counts from counts()/statusCounts())

const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { createUser, login } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');
const catalogMetadata = require('../services/catalogMetadata.service');
const platformRegistry = require('../permissions/platformRegistry');
const registry = require('../permissions/registry');

const PASSWORD = 'Pass#123';
const CATALOG_URL = '/api/v1/services/catalog';

let server;
let dir;

registerCleanup(() => [server], () => [dir]);

beforeAll(async () => {
  dir = makeTempDataDir('svc-catalog');
  server = await startServer(dir);

  // ---------- Tenant users (tenant scope only) ----------
  createUser(server.app, { username: 'owner', password: PASSWORD, fullName: 'Owner User', role: 'Owner' });
  createUser(server.app, { username: 'admin', password: PASSWORD, fullName: 'Admin User', role: 'Admin' });
  createUser(server.app, { username: 'manager', password: PASSWORD, fullName: 'Manager User', role: 'Manager' });
  createUser(server.app, { username: 'cashier', password: PASSWORD, fullName: 'Cashier User', role: 'Cashier' });
  createUser(server.app, { username: 'technician', password: PASSWORD, fullName: 'Tech User', role: 'Technician' });
  createUser(server.app, { username: 'viewer', password: PASSWORD, fullName: 'Viewer User', role: 'Viewer' });

  // ---------- Platform members (platform scope, separate from tenant roles) ----------
  // All platform members have tenant role 'Viewer' — platform membership is
  // resolved independently from the platform admin store. User records must
  // exist for login to work; platform membership is seeded separately.
  createUser(server.app, { username: 'master', password: PASSWORD, fullName: 'Master User', role: 'Viewer' });
  createUser(server.app, { username: 'platAdmin', password: PASSWORD, fullName: 'Platform Admin', role: 'Viewer' });
  createUser(server.app, { username: 'developer', password: PASSWORD, fullName: 'Developer User', role: 'Viewer' });
  createUser(server.app, { username: 'dataEntry', password: PASSWORD, fullName: 'Data Entry User', role: 'Viewer' });
  createUser(server.app, { username: 'disabledMember', password: PASSWORD, fullName: 'Disabled Member', role: 'Viewer' });

  seed(dir, 'platformAdmins', {
    admins: [
      { username: 'master', platformRole: 'MASTER_OWNER', status: 'active' },
      { username: 'platAdmin', platformRole: 'PLATFORM_ADMIN', status: 'active' },
      { username: 'developer', platformRole: 'DEVELOPER', status: 'active' },
      { username: 'dataEntry', platformRole: 'DATA_ENTRY', status: 'active' },
      { username: 'disabledMember', platformRole: 'MASTER_OWNER', status: 'disabled' }
    ]
  });
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

// ---------- Computed expectations from the metadata source of truth ----------
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

  test('authenticated user receives 200 and a user context block', async () => {
    const token = await loginToken('owner');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toBeDefined();
    expect(res.body.data.user.username).toBe('owner');
    expect(res.body.data.services).toBeInstanceOf(Array);
    expect(res.body.data.total).toBeGreaterThanOrEqual(0);
  });
});

describe('GET /api/v1/services/catalog — tenant authorization (canonical permissions)', () => {
  test('Owner receives all tenant-authorized services, no platform services', async () => {
    const token = await loginToken('owner');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // Owner bypass in tenant scope: all tenant services visible.
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
    // Manager baseline includes these canonical permissions:
    // dashboard.view, products.view, customers.view, suppliers.view,
    // inventory.view, purchases.view, sales.view, treasury.view,
    // reports.view, audit.view, employees.view, users.view, settings.view
    expect(ids).toContain('dashboard');
    expect(ids).toContain('products');
    expect(ids).toContain('customers');
    expect(ids).toContain('suppliers');
    expect(ids).toContain('inventory');
    expect(ids).toContain('purchases');
    expect(ids).toContain('sales');
    expect(ids).toContain('treasury');
    expect(ids).toContain('reports');
    expect(ids).toContain('accounting_core');
    expect(ids).toContain('accounting_rules');
    expect(ids).toContain('hr');
    expect(ids).toContain('identity');
    expect(ids).toContain('governance');
    expect(ids).toContain('documents');
    expect(ids).toContain('backup_sync');
    expect(ids).toContain('business_marketplace');
    expect(ids).toContain('playstation');
    expect(ids).toContain('car_rental');
    expect(ids).toContain('student_services');
    expect(ids).toContain('settings');
    // Manager baseline does NOT include education.centers.view.
    expect(ids).not.toContain('education');
    // Services with null permission are withheld.
    expect(ids).not.toContain('repairs');
    expect(ids).not.toContain('notifications');
    expect(ids).not.toContain('tools');
    expect(ids).not.toContain('automation');
    expect(ids).not.toContain('branches');
    expect(ids).not.toContain('integrations');
    expect(ids).not.toContain('platform_tools');
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
    // dashboard.view, treasury.view, reports.view
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
    // products.view, dashboard.view
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
    // vouchers.view, treasury.view, company.view
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

describe('GET /api/v1/services/catalog — platform authorization (platform membership)', () => {
  test('MASTER_OWNER with tenant role Viewer receives platform services, no tenant escalation', async () => {
    const token = await loginToken('master');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // Tenant role is Viewer — sees Viewer tenant services.
    expect(ids).toContain('dashboard');
    // MASTER_OWNER has wildcard — sees all platform services with permission mapping.
    expect(ids).toContain('platform_master');
    expect(ids).toContain('platform_dashboard');
    expect(ids).toContain('platform_companies');
    expect(ids).toContain('platform_users');
    expect(ids).toContain('platform_licenses');
    expect(ids).toContain('platform_integrations');
    expect(ids).toContain('platform_audit');
    expect(ids).toContain('platform_overview');
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
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // PLATFORM_ADMIN has platform.dashboard.view, platform.companies.view,
    // platform.users.view, platform.licenses.view, platform.integrations.view,
    // platform.audit.view, catalog.read
    expect(ids).toContain('platform_master');
    expect(ids).toContain('platform_dashboard');
    expect(ids).toContain('platform_companies');
    expect(ids).toContain('platform_users');
    expect(ids).toContain('platform_licenses');
    expect(ids).toContain('platform_integrations');
    expect(ids).toContain('platform_audit');
    expect(ids).toContain('platform_overview');
    // No platform services without permission mapping.
    expect(ids).not.toContain('platform_database');
    expect(ids).not.toContain('platform_backups');
  });

  test('DEVELOPER receives only its source-authorized platform services', async () => {
    const token = await loginToken('developer');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // DEVELOPER has platform.dashboard.view, platform.audit.view,
    // platform.diagnostics.view, catalog.read
    expect(ids).toContain('platform_master');
    expect(ids).toContain('platform_dashboard');
    expect(ids).toContain('platform_audit');
    expect(ids).toContain('platform_overview');
    // DEVELOPER does NOT have platform.companies.view, platform.users.view, etc.
    expect(ids).not.toContain('platform_companies');
    expect(ids).not.toContain('platform_users');
    expect(ids).not.toContain('platform_licenses');
    expect(ids).not.toContain('platform_integrations');
  });

  test('DATA_ENTRY receives only its source-authorized platform services', async () => {
    const token = await loginToken('dataEntry');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const ids = svcIds(res.body.data.services);
    // DATA_ENTRY has platform.dashboard.view, catalog.read, catalog.create, catalog.update
    expect(ids).toContain('platform_master');
    expect(ids).toContain('platform_dashboard');
    expect(ids).toContain('platform_overview');
    // DATA_ENTRY does NOT have platform.audit.view or other platform permissions.
    expect(ids).not.toContain('platform_audit');
    expect(ids).not.toContain('platform_companies');
  });

  test('Disabled platform member receives no platform services', async () => {
    const token = await loginToken('disabledMember');
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
    // No platform services — ?role=Owner does not grant platform membership.
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

  test('client-supplied platformRole does not expand platform access', async () => {
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
    const INTERNAL_IDS = catalogMetadata.getInternalServices().map(s => s.id);
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

describe('GET /api/v1/services/catalog — service metadata integrity', () => {
  test('reported totals match metadata counts() and statusCounts()', () => {
    expect(META_COUNTS.tenant).toBe(29);
    expect(META_COUNTS.master).toBe(10);
    expect(META_COUNTS.internal).toBe(7);
    expect(META_COUNTS.total).toBe(46);
    expect(META_STATUS.READY).toBe(10);
    expect(META_STATUS.PARTIAL).toBe(14);
    expect(META_STATUS.BACKEND_ONLY).toBe(7);
    expect(META_STATUS.NOT_VERIFIED).toBe(15);
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

  test('every tenant service has a permission or is explicitly null (permission-mapping incomplete)', () => {
    for (const svc of catalogMetadata.getTenantServices()) {
      if (svc.permission !== null) {
        // Must be a known, enforceable tenant permission.
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

describe('GET /api/v1/services/catalog — determinism', () => {
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
});
