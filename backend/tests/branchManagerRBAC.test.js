'use strict';

// BranchManager RBAC Test Suite
// Tests that BranchManager has correct permissions and is denied correctly.
//
// Users are seeded directly into the data store (the repo's `seed` convention)
// rather than POSTed, because with AUTH_REQUIRED=true the user-creation
// endpoint itself requires authorization.

const fs = require('fs');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

function hash(pw) { return bcrypt.hashSync(pw, 10); }

const USERS = { users: [
  { id: 'u-owner', username: 'owner1', password: hash('Owner#123'), role: 'Owner', fullName: 'Owner One', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'u-admin', username: 'admin1', password: hash('Admin#123'), role: 'Admin', fullName: 'Admin One', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'u-manager', username: 'manager1', password: hash('Mgr#1234'), role: 'Manager', fullName: 'Manager One', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'u-bm', username: 'bm1', password: hash('BranchMgr#1'), role: 'BranchManager', fullName: 'Branch Manager', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'u-cashier', username: 'cashier1', password: hash('Cash#1234'), role: 'Cashier', fullName: 'Cashier One', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'u-viewer', username: 'viewer1', password: hash('View#1234'), role: 'Viewer', fullName: 'Viewer One', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'u-padmin', username: 'padmin1', password: hash('Plat#1234'), role: 'Owner', fullName: 'Platform Admin', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
]};

const now = new Date().toISOString();
const PLATFORM_ADMINS = { admins: [
  { username: 'padmin1', platformRole: 'PLATFORM_ADMIN', createdAt: now, updatedAt: now }
]};

let server;
let dataDir;
let bmToken, ownerToken, adminToken, managerToken, cashierToken, viewerToken, platformToken;

registerCleanup(() => [server], () => [dataDir]);

async function loginAs(app, username, password) {
  const res = await request(app).post('/api/v1/auth/login').send({ username, password });
  if (res.statusCode !== 200) throw new Error(`login(${username}) failed: ${res.statusCode} ${JSON.stringify(res.body)}`);
  return res.body.data.accessToken;
}

beforeAll(async () => {
  process.env.AUTH_REQUIRED = 'true';
  dataDir = makeTempDataDir('branch-manager-rbac');
  seed(dataDir, 'users', USERS);
  seed(dataDir, 'platformAdmins', PLATFORM_ADMINS);
  server = await startServer(dataDir, { AUTH_REQUIRED: 'true' });

  ownerToken = await loginAs(server.app, 'owner1', 'Owner#123');
  adminToken = await loginAs(server.app, 'admin1', 'Admin#123');
  managerToken = await loginAs(server.app, 'manager1', 'Mgr#1234');
  bmToken = await loginAs(server.app, 'bm1', 'BranchMgr#1');
  cashierToken = await loginAs(server.app, 'cashier1', 'Cash#1234');
  viewerToken = await loginAs(server.app, 'viewer1', 'View#1234');
  platformToken = await loginAs(server.app, 'padmin1', 'Plat#1234');
});

afterAll(() => {
  if (dataDir) { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {} }
  delete process.env.AUTH_REQUIRED;
});

describe('BranchManager RBAC — ALLOWED operations', () => {
  test('BranchManager can GET /sales', async () => {
    const res = await request(server.app).get('/api/v1/sales').set('Authorization', 'Bearer ' + bmToken);
    expect(res.statusCode).toBe(200);
  });

  test('BranchManager can POST /sales (create)', async () => {
    const res = await request(server.app).post('/api/v1/sales')
      .set('Authorization', 'Bearer ' + bmToken)
      .send({ id: 'BM-SALE-1', items: [{ productId: 'p1', qty: 1, price: 10 }], total: 10, customer: 'Test', payment: 'cash' });
    expect([201, 400]).toContain(res.statusCode); // 400 only if product validation; both acceptable for allow-path
  });

  test('BranchManager can PUT /sales/:id (edit)', async () => {
    await request(server.app).post('/api/v1/sales')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ id: 'BM-SALE-EDIT', items: [{ productId: 'p1', qty: 1, price: 10 }], total: 10, customer: 'Test', payment: 'cash' });
    const res = await request(server.app).put('/api/v1/sales/BM-SALE-EDIT')
      .set('Authorization', 'Bearer ' + bmToken)
      .send({ total: 20 });
    expect([200, 404]).toContain(res.statusCode);
  });

  test('BranchManager can GET /purchases', async () => {
    const res = await request(server.app).get('/api/v1/purchases').set('Authorization', 'Bearer ' + bmToken);
    expect(res.statusCode).toBe(200);
  });

  test('BranchManager can GET /customers', async () => {
    const res = await request(server.app).get('/api/v1/customers').set('Authorization', 'Bearer ' + bmToken);
    expect(res.statusCode).toBe(200);
  });

  test('BranchManager can POST /customers (create)', async () => {
    const res = await request(server.app).post('/api/v1/customers')
      .set('Authorization', 'Bearer ' + bmToken)
      .send({ name: 'BM Customer', phone: '1234567890' });
    expect(res.statusCode).toBe(201);
  });

  test('BranchManager can GET /suppliers', async () => {
    const res = await request(server.app).get('/api/v1/suppliers').set('Authorization', 'Bearer ' + bmToken);
    expect(res.statusCode).toBe(200);
  });

  test('BranchManager can POST /suppliers (create)', async () => {
    const res = await request(server.app).post('/api/v1/suppliers')
      .set('Authorization', 'Bearer ' + bmToken)
      .send({ name: 'BM Supplier', phone: '0987654321' });
    expect(res.statusCode).toBe(201);
  });

  test('BranchManager can GET /inventory', async () => {
    const res = await request(server.app).get('/api/v1/inventory').set('Authorization', 'Bearer ' + bmToken);
    expect(res.statusCode).toBe(200);
  });

  test('BranchManager can GET /dashboard', async () => {
    const res = await request(server.app).get('/api/v1/dashboard').set('Authorization', 'Bearer ' + bmToken);
    expect(res.statusCode).toBe(200);
  });

  test('BranchManager has products.view (products are served via /inventory)', async () => {
    const registry = require('../permissions/registry');
    const baseline = registry.getRoleBaseline('BranchManager');
    expect(baseline).toContain('products.view');
  });
});

describe('BranchManager RBAC — DENIED operations', () => {
  test('BranchManager CANNOT GET /treasury', async () => {
    const res = await request(server.app).get('/api/v1/treasury').set('Authorization', 'Bearer ' + bmToken);
    expect(res.statusCode).toBe(403);
  });

  test('BranchManager CANNOT POST /treasury (create)', async () => {
    const res = await request(server.app).post('/api/v1/treasury')
      .set('Authorization', 'Bearer ' + bmToken)
      .send({ type: 'in', amount: 100, desc: 'test' });
    expect(res.statusCode).toBe(403);
  });

  test('BranchManager CANNOT GET /treasury/stats', async () => {
    const res = await request(server.app).get('/api/v1/treasury/stats').set('Authorization', 'Bearer ' + bmToken);
    expect(res.statusCode).toBe(403);
  });

  test('BranchManager CANNOT GET /users', async () => {
    const res = await request(server.app).get('/api/v1/users').set('Authorization', 'Bearer ' + bmToken);
    expect(res.statusCode).toBe(403);
  });

  test('BranchManager CANNOT GET /audit-log', async () => {
    const res = await request(server.app).get('/api/v1/audit-log').set('Authorization', 'Bearer ' + bmToken);
    expect(res.statusCode).toBe(403);
  });

  test('BranchManager CANNOT GET /reports (no reports permission)', async () => {
    const res = await request(server.app).get('/api/v1/reports').set('Authorization', 'Bearer ' + bmToken);
    expect(res.statusCode).toBe(403);
  });

  test('BranchManager CANNOT GET /reports?type=financial', async () => {
    const res = await request(server.app).get('/api/v1/reports?type=financial').set('Authorization', 'Bearer ' + bmToken);
    expect(res.statusCode).toBe(403);
  });

  test('BranchManager CANNOT GET /permissions', async () => {
    const res = await request(server.app).get('/api/v1/permissions').set('Authorization', 'Bearer ' + bmToken);
    expect(res.statusCode).toBe(403);
  });

  test('BranchManager CANNOT DELETE /sales/:id', async () => {
    await request(server.app).post('/api/v1/sales')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ id: 'BM-DEL-TEST', items: [{ productId: 'p1', qty: 1, price: 10 }], total: 10, customer: 'Test', payment: 'cash' });
    const res = await request(server.app).delete('/api/v1/sales/BM-DEL-TEST').set('Authorization', 'Bearer ' + bmToken);
    expect(res.statusCode).toBe(403);
  });

  test('BranchManager CANNOT DELETE /purchases/:id', async () => {
    await request(server.app).post('/api/v1/purchases')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ id: 'BM-PUR-DEL', items: [{ productId: 'p1', qty: 1, price: 10 }], total: 10, supplier: 'Test', payment: 'cash' });
    const res = await request(server.app).delete('/api/v1/purchases/BM-PUR-DEL').set('Authorization', 'Bearer ' + bmToken);
    expect(res.statusCode).toBe(403);
  });

  test('BranchManager CANNOT DELETE /inventory item', async () => {
    const res = await request(server.app).delete('/api/v1/inventory/BM-INV-DEL').set('Authorization', 'Bearer ' + bmToken);
    expect(res.statusCode).toBe(403);
  });
});

describe('BranchManager RBAC — platform isolation (separate from tenant roles)', () => {
  const platformEndpoints = [
    '/api/v1/platform/me',
    '/api/v1/platform/summary',
    '/api/v1/platform/companies',
    '/api/v1/platform/users',
    '/api/v1/platform/admins'
  ];

  for (const ep of platformEndpoints) {
    test(`BranchManager CANNOT access ${ep} (denied)`, async () => {
      const res = await request(server.app).get(ep).set('Authorization', 'Bearer ' + bmToken);
      expect([403, 404]).toContain(res.statusCode);
    });
    test(`Owner (tenant) CANNOT access ${ep} (platform is separate)`, async () => {
      const res = await request(server.app).get(ep).set('Authorization', 'Bearer ' + ownerToken);
      expect([403, 404]).toContain(res.statusCode);
    });
    test(`Admin (tenant) CANNOT access ${ep} (platform is separate)`, async () => {
      const res = await request(server.app).get(ep).set('Authorization', 'Bearer ' + adminToken);
      expect([403, 404]).toContain(res.statusCode);
    });
  }

  test('PLATFORM_ADMIN CAN access platform endpoints', async () => {
    const me = await request(server.app).get('/api/v1/platform/me').set('Authorization', 'Bearer ' + platformToken);
    expect(me.statusCode).toBe(200);
    expect(me.body.data.platformRole).toBe('PLATFORM_ADMIN');
    const summary = await request(server.app).get('/api/v1/platform/summary').set('Authorization', 'Bearer ' + platformToken);
    expect(summary.statusCode).toBe(200);
    const users = await request(server.app).get('/api/v1/platform/users').set('Authorization', 'Bearer ' + platformToken);
    expect(users.statusCode).toBe(200);
    const admins = await request(server.app).get('/api/v1/platform/admins').set('Authorization', 'Bearer ' + platformToken);
    expect(admins.statusCode).toBe(200);
  });
});

describe('Financial report authorization (server-side)', () => {
  let finId;
  let opId;

  beforeAll(async () => {
    const fin = await request(server.app).post('/api/v1/reports')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ id: 'RPT-FIN-1', type: 'financial', title: 'Financial Report 1', month: '2026-07', user: 'owner1', data: { revenue: 5000 } });
    expect(fin.statusCode).toBe(201);
    finId = fin.body.data.id;

    const op = await request(server.app).post('/api/v1/reports')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ id: 'RPT-OP-1', type: 'sales', title: 'Sales Report 1', month: '2026-07', user: 'owner1', data: { rows: 3 } });
    expect(op.statusCode).toBe(201);
    opId = op.body.data.id;
  });

  test('BranchManager CANNOT read financial reports', async () => {
    const res = await request(server.app).get('/api/v1/reports?type=financial').set('Authorization', 'Bearer ' + bmToken);
    expect(res.statusCode).toBe(403);
  });
  test('Cashier CANNOT read financial reports', async () => {
    const res = await request(server.app).get('/api/v1/reports?type=financial').set('Authorization', 'Bearer ' + cashierToken);
    expect(res.statusCode).toBe(403);
  });
  test('Viewer CANNOT read financial reports', async () => {
    const res = await request(server.app).get('/api/v1/reports?type=financial').set('Authorization', 'Bearer ' + viewerToken);
    expect(res.statusCode).toBe(403);
  });
  test('Manager CANNOT read financial reports (not expanded)', async () => {
    const res = await request(server.app).get('/api/v1/reports?type=financial').set('Authorization', 'Bearer ' + managerToken);
    expect(res.statusCode).toBe(403);
  });
  test('Owner CAN read financial reports', async () => {
    const res = await request(server.app).get('/api/v1/reports?type=financial').set('Authorization', 'Bearer ' + ownerToken);
    expect(res.statusCode).toBe(200);
  });
  test('Admin CAN read financial reports', async () => {
    const res = await request(server.app).get('/api/v1/reports?type=financial').set('Authorization', 'Bearer ' + adminToken);
    expect(res.statusCode).toBe(200);
  });
  test('Cashier CAN read operational reports (sales)', async () => {
    const res = await request(server.app).get('/api/v1/reports?type=sales').set('Authorization', 'Bearer ' + cashierToken);
    expect(res.statusCode).toBe(200);
  });
  test('Cashier CANNOT GET a financial report by ID (403, reports.financial.view required)', async () => {
    const res = await request(server.app).get(`/api/v1/reports/${finId}`).set('Authorization', 'Bearer ' + cashierToken);
    expect(res.statusCode).toBe(403);
  });
  test('Owner CAN GET a financial report by ID (has reports.financial.view)', async () => {
    const res = await request(server.app).get(`/api/v1/reports/${finId}`).set('Authorization', 'Bearer ' + ownerToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.type).toBe('financial');
  });
  test('Cashier CAN GET a non-financial report by ID (reports.view only)', async () => {
    const res = await request(server.app).get(`/api/v1/reports/${opId}`).set('Authorization', 'Bearer ' + cashierToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.type).toBe('sales');
  });
  test('Cashier CANNOT PUT a financial report by ID (403, reports.financial.view required)', async () => {
    const res = await request(server.app).put(`/api/v1/reports/${finId}`)
      .set('Authorization', 'Bearer ' + cashierToken)
      .send({ title: 'Hijack' });
    expect(res.statusCode).toBe(403);
  });
  test('Cashier CAN GET /reports/stats (aggregate counts only; no financial figures exposed)', async () => {
    const res = await request(server.app).get('/api/v1/reports/stats').set('Authorization', 'Bearer ' + cashierToken);
    expect(res.statusCode).toBe(200);
  });
});

describe('Financial report DELETE authorization (server-side)', () => {
  let finDeleteId;
  let opDeleteId;

  beforeAll(async () => {
    const fin = await request(server.app).post('/api/v1/reports')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ id: 'RPT-FIN-DEL', type: 'financial', title: 'Financial Delete Target', month: '2026-07', user: 'owner1', data: { revenue: 9000 } });
    expect(fin.statusCode).toBe(201);
    finDeleteId = fin.body.data.id;

    const op = await request(server.app).post('/api/v1/reports')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ id: 'RPT-OP-DEL', type: 'purchases', title: 'Non-Financial Delete Target', month: '2026-07', user: 'owner1' });
    expect(op.statusCode).toBe(201);
    opDeleteId = op.body.data.id;
  });

  test('Cashier CANNOT DELETE a financial report (403) and the report survives', async () => {
    const res = await request(server.app).delete(`/api/v1/reports/${finDeleteId}`).set('Authorization', 'Bearer ' + cashierToken);
    expect(res.statusCode).toBe(403);

    const still = await request(server.app).get(`/api/v1/reports/${finDeleteId}`).set('Authorization', 'Bearer ' + ownerToken);
    expect(still.statusCode).toBe(200);
    expect(still.body.data.type).toBe('financial');
  });

  test('Owner CAN DELETE a financial report (200) and it is gone', async () => {
    const res = await request(server.app).delete(`/api/v1/reports/${finDeleteId}`).set('Authorization', 'Bearer ' + ownerToken);
    expect(res.statusCode).toBe(200);

    const gone = await request(server.app).get(`/api/v1/reports/${finDeleteId}`).set('Authorization', 'Bearer ' + ownerToken);
    expect(gone.statusCode).toBe(404);
  });

  test('Cashier CAN DELETE a non-financial report (reports.view, legacy behavior preserved)', async () => {
    const res = await request(server.app).delete(`/api/v1/reports/${opDeleteId}`).set('Authorization', 'Bearer ' + cashierToken);
    expect(res.statusCode).toBe(200);

    const gone = await request(server.app).get(`/api/v1/reports/${opDeleteId}`).set('Authorization', 'Bearer ' + ownerToken);
    expect(gone.statusCode).toBe(404);
  });
});

describe('BranchManager RBAC — Owner/Admin still work', () => {
  test('Owner can GET /treasury', async () => {
    const res = await request(server.app).get('/api/v1/treasury').set('Authorization', 'Bearer ' + ownerToken);
    expect(res.statusCode).toBe(200);
  });
  test('Admin can GET /treasury', async () => {
    const res = await request(server.app).get('/api/v1/treasury').set('Authorization', 'Bearer ' + adminToken);
    expect(res.statusCode).toBe(200);
  });
  test('Owner can GET /users', async () => {
    const res = await request(server.app).get('/api/v1/users').set('Authorization', 'Bearer ' + ownerToken);
    expect(res.statusCode).toBe(200);
  });
  test('Admin can GET /users', async () => {
    const res = await request(server.app).get('/api/v1/users').set('Authorization', 'Bearer ' + adminToken);
    expect(res.statusCode).toBe(200);
  });
});

describe('BranchManager RBAC — Manager role preserved', () => {
  test('Manager can GET /treasury (has treasury.view)', async () => {
    const res = await request(server.app).get('/api/v1/treasury').set('Authorization', 'Bearer ' + managerToken);
    expect(res.statusCode).toBe(200);
  });
  test('Manager can GET /users (has users.view)', async () => {
    const res = await request(server.app).get('/api/v1/users').set('Authorization', 'Bearer ' + managerToken);
    expect(res.statusCode).toBe(200);
  });
  test('Manager can GET /audit-log (has audit.view)', async () => {
    const res = await request(server.app).get('/api/v1/audit-log').set('Authorization', 'Bearer ' + managerToken);
    expect(res.statusCode).toBe(200);
  });
});

describe('BranchManager RBAC — Cashier role preserved', () => {
  test('Cashier can GET /sales (has sales.view)', async () => {
    const res = await request(server.app).get('/api/v1/sales').set('Authorization', 'Bearer ' + cashierToken);
    expect(res.statusCode).toBe(200);
  });
  test('Cashier can GET /treasury (has treasury.view)', async () => {
    const res = await request(server.app).get('/api/v1/treasury').set('Authorization', 'Bearer ' + cashierToken);
    expect(res.statusCode).toBe(200);
  });
  test('Cashier can GET /reports (has reports.view)', async () => {
    const res = await request(server.app).get('/api/v1/reports?type=sales').set('Authorization', 'Bearer ' + cashierToken);
    expect(res.statusCode).toBe(200);
  });
  test('Cashier CANNOT GET /purchases (no purchases.view)', async () => {
    const res = await request(server.app).get('/api/v1/purchases').set('Authorization', 'Bearer ' + cashierToken);
    expect(res.statusCode).toBe(403);
  });
  test('Cashier CANNOT GET /users (no users.view)', async () => {
    const res = await request(server.app).get('/api/v1/users').set('Authorization', 'Bearer ' + cashierToken);
    expect(res.statusCode).toBe(403);
  });
});

describe('BranchManager RBAC — Direct API bypass prevention', () => {
  test('BranchManager JWT cannot bypass protection for restricted endpoints', async () => {
    const endpoints = [
      '/api/v1/treasury',
      '/api/v1/treasury/stats',
      '/api/v1/users',
      '/api/v1/permissions',
      '/api/v1/audit-log',
      '/api/v1/reports',
      '/api/v1/reports?type=financial',
      '/api/v1/platform/me',
      '/api/v1/platform/companies',
      '/api/v1/platform/users',
      '/api/v1/platform/admins'
    ];
    for (const ep of endpoints) {
      const res = await request(server.app).get(ep).set('Authorization', 'Bearer ' + bmToken);
      expect([403, 404]).toContain(res.statusCode);
    }
  });

  test('Unauthenticated request is rejected', async () => {
    const res = await request(server.app).get('/api/v1/sales');
    expect([401, 403]).toContain(res.statusCode);
  });

  test('Invalid token is rejected', async () => {
    const res = await request(server.app).get('/api/v1/sales').set('Authorization', 'Bearer invalid.token.here');
    expect([401, 403]).toContain(res.statusCode);
  });
});

describe('BranchManager RBAC — role management / escalation boundaries', () => {
  const authorization = require('../services/authorization.service');
  const registry = require('../permissions/registry');
  const actor = (role) => ({ username: role.toLowerCase() + '-actor', role });

  test('Owner/Admin/Manager can manage the BranchManager role (rank hierarchy)', () => {
    expect(authorization.canManageRole(actor('Owner'), 'BranchManager')).toBe(true);
    expect(authorization.canManageRole(actor('Admin'), 'BranchManager')).toBe(true);
    expect(authorization.canManageRole(actor('Manager'), 'BranchManager')).toBe(true);
  });

  test('BranchManager cannot manage users (lacks users.create/users.edit)', () => {
    expect(authorization.hasPermission(actor('BranchManager'), 'users.create')).toBe(false);
    expect(authorization.hasPermission(actor('BranchManager'), 'users.edit')).toBe(false);
  });

  test('BranchManager cannot escalate to higher ranks', () => {
    expect(authorization.canManageRole(actor('BranchManager'), 'Owner')).toBe(false);
    expect(authorization.canManageRole(actor('BranchManager'), 'Admin')).toBe(false);
    expect(authorization.canManageRole(actor('BranchManager'), 'Manager')).toBe(false);
    expect(authorization.canManageRole(actor('BranchManager'), 'BranchManager')).toBe(false);
  });

  test('Manager cannot promote to Owner/Admin/platform roles', () => {
    expect(authorization.canManageRole(actor('Manager'), 'Owner')).toBe(false);
    expect(authorization.canManageRole(actor('Manager'), 'Admin')).toBe(false);
  });

  test('BranchManager is NOT an Owner/Admin bypass role in the registry', () => {
    expect(registry.roleRank('BranchManager')).toBeLessThan(registry.roleRank('Owner'));
    expect(registry.roleRank('BranchManager')).toBeLessThan(registry.roleRank('Admin'));
    expect(registry.roleRank('BranchManager')).toBeLessThanOrEqual(registry.roleRank('Manager'));
  });
});

describe('BranchManager RBAC — role exists in registry (global, non-tenant-specific)', () => {
  const registry = require('../permissions/registry');
  test('BranchManager is a known global role', () => {
    expect(registry.knownRoles()).toContain('BranchManager');
  });
  test('BranchManager baseline matches the operational branch workflow', () => {
    const baseline = registry.getRoleBaseline('BranchManager');
    expect(baseline).toEqual(expect.arrayContaining([
      'sales.view', 'sales.create', 'sales.edit',
      'purchases.view', 'purchases.create', 'purchases.edit',
      'customers.view', 'customers.create', 'customers.edit',
      'suppliers.view', 'suppliers.create', 'suppliers.edit',
      'inventory.view', 'inventory.create', 'inventory.edit',
      'products.view', 'dashboard.view'
    ]));
    expect(baseline).not.toEqual(expect.arrayContaining([
      'treasury.view', 'treasury.create', 'treasury.edit', 'treasury.delete',
      'reports.view', 'reports.financial.view',
      'users.view', 'users.create', 'users.edit', 'users.delete',
      'users.password.reset', 'users.permissions.view', 'users.permissions.edit',
      'users.enable', 'users.disable',
      'audit.view', 'settings.view', 'settings.edit', 'company.view'
    ]));
    expect(baseline).not.toEqual(expect.arrayContaining([
      'sales.delete', 'purchases.delete', 'inventory.delete',
      'customers.delete', 'suppliers.delete'
    ]));
  });
});

describe('Customer/Supplier dual-role capability', () => {
  test('Same person can be both customer and supplier', async () => {
    const cust = await request(server.app).post('/api/v1/customers')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ name: 'Dual Role Person', phone: '5555555555' });
    expect(cust.statusCode).toBe(201);
    const custId = cust.body.data.id;

    const sup = await request(server.app).post('/api/v1/suppliers')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ name: 'Dual Role Person', phone: '5555555555' });
    expect(sup.statusCode).toBe(201);
    const supId = sup.body.data.id;

    const custGet = await request(server.app).get(`/api/v1/customers/${custId}`).set('Authorization', 'Bearer ' + ownerToken);
    expect(custGet.statusCode).toBe(200);

    const supGet = await request(server.app).get(`/api/v1/suppliers/${supId}`).set('Authorization', 'Bearer ' + ownerToken);
    expect(supGet.statusCode).toBe(200);

    expect(custId).not.toBe(supId);
  });

  test('BranchManager can create a customer that is also a supplier', async () => {
    const cust = await request(server.app).post('/api/v1/customers')
      .set('Authorization', 'Bearer ' + bmToken)
      .send({ name: 'BM Dual', phone: '6666666666' });
    expect(cust.statusCode).toBe(201);
    const sup = await request(server.app).post('/api/v1/suppliers')
      .set('Authorization', 'Bearer ' + bmToken)
      .send({ name: 'BM Dual', phone: '6666666666' });
    expect(sup.statusCode).toBe(201);
  });
});
