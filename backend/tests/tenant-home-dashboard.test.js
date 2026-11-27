// Tenant home dashboard endpoint tests: role-based access, 401/403, cross-tenant isolation.
const fs = require('fs');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { createUser, login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

let server;
let dataDir;

const COMPANIES = {
  companies: [
    { id: 'digitronics', code: 'DIGI', name: 'DigiTronics', active: true },
    { id: 'nile', code: 'NILE', name: 'Nile Electronics', active: true }
  ]
};

const SALES = {
  invoices: [
    { id: 'INV-A-001', total: 500, profit: 100, payment: 'cash', tenantId: 'digitronics', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'INV-A-002', total: 300, profit: 60, payment: 'credit', tenantId: 'digitronics', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
    { id: 'INV-B-001', total: 9999, profit: 999, payment: 'cash', tenantId: 'nile', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
  ]
};

const CUSTOMERS = {
  customers: [
    { id: 'cust-a-1', fullName: 'Customer A1', phone: '111', email: 'a1@example.com', tenantId: 'digitronics', createdAt: '2026-01-01T00:00:00Z' },
    { id: 'cust-b-1', fullName: 'Customer B1', phone: '222', email: 'b1@example.com', tenantId: 'nile', createdAt: '2026-01-01T00:00:00Z' }
  ]
};

const SUPPLIERS = {
  suppliers: [
    { id: 'supp-a-1', fullName: 'Supplier A1', phone: '333', email: 'a1supp@example.com', tenantId: 'digitronics', createdAt: '2026-01-01T00:00:00Z' },
    { id: 'supp-b-1', fullName: 'Supplier B1', phone: '444', email: 'b1supp@example.com', tenantId: 'nile', createdAt: '2026-01-01T00:00:00Z' }
  ]
};

const TREASURY = {
  entries: [
    { id: 'tx-a-1', type: 'in', amount: 1000, description: 'Treasury A1', tenantId: 'digitronics', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'tx-b-1', type: 'out', amount: 500, description: 'Treasury B1', tenantId: 'nile', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
  ]
};

registerCleanup(() => [server], () => [dataDir]);

afterAll(() => {
  delete process.env.ENABLE_TENANT_CARRY;
  delete process.env.ENABLE_MULTI_COMPANY_LOGIN;
});

beforeAll(async () => {
  process.env.ENABLE_TENANT_CARRY = 'true';
  process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
  dataDir = makeTempDataDir('tenant-home');
  seed(dataDir, 'companies', COMPANIES);
  seed(dataDir, 'sales', SALES);
  seed(dataDir, 'customers', CUSTOMERS);
  seed(dataDir, 'suppliers', SUPPLIERS);
  seed(dataDir, 'treasury', TREASURY);

  server = await startServer(dataDir, {
    AUTH_REQUIRED: 'true'
  });

  await createUser(server.app, {
    username: 'owner1', password: 'Owner#123', fullName: 'Owner One', role: 'Owner', tenantIds: ['digitronics']
  });
  await createUser(server.app, {
    username: 'admin1', password: 'Admin#123', fullName: 'Admin One', role: 'Admin', tenantIds: ['digitronics']
  });
  await createUser(server.app, {
    username: 'viewer1', password: 'Viewer#123', fullName: 'Viewer One', role: 'Viewer', tenantIds: ['digitronics']
  });
  await createUser(server.app, {
    username: 'ownerB', password: 'OwnerB#123', fullName: 'Owner B', role: 'Owner', tenantIds: ['nile']
  });
  await createUser(server.app, {
    username: 'notenant', password: 'NoTenant#123', fullName: 'No Tenant', role: 'Owner'
  });
});

describe('GET /api/v1/dashboard/tenant-home', () => {
  test('returns 401 without authentication', async () => {
    const res = await request(server.app).get('/api/v1/dashboard/tenant-home');
    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('Owner can access tenant-home with tenant-scoped data', async () => {
    const session = await login(server.app, 'owner1', 'Owner#123', 'digitronics');
    const res = await request(server.app)
      .get('/api/v1/dashboard/tenant-home')
      .set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tenant.id).toBe('digitronics');
    expect(res.body.data.tenant.available).toBe(true);
    expect(res.body.data.sales.available).toBe(true);
    expect(res.body.data.sales.count).toBe(2);
    expect(res.body.data.sales.totalSales).toBe(800);
    expect(res.body.data.customers.available).toBe(true);
    expect(res.body.data.customers.count).toBe(1);
    expect(res.body.data.suppliers.available).toBe(true);
    expect(res.body.data.suppliers.count).toBe(1);
    expect(res.body.data.treasury.available).toBe(true);
    expect(res.body.data.treasury.recentTransactions.length).toBe(1);
    // Inventory: products are global, not tenant-scoped -> unavailable
    expect(res.body.data.inventory.available).toBe(false);
    expect(res.body.data.inventory.totalItems).toBe(0);
    expect(res.body.data.generatedAt).toBeTruthy();
  });

  test('Admin can access tenant-home with tenant-scoped data', async () => {
    const session = await login(server.app, 'admin1', 'Admin#123', 'digitronics');
    const res = await request(server.app)
      .get('/api/v1/dashboard/tenant-home')
      .set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tenant.id).toBe('digitronics');
    expect(res.body.data.sales.count).toBe(2);
    expect(res.body.data.customers.count).toBe(1);
  });

  test('Viewer is rejected (dashboard.view is insufficient)', async () => {
    const session = await login(server.app, 'viewer1', 'Viewer#123', 'digitronics');
    const res = await request(server.app)
      .get('/api/v1/dashboard/tenant-home')
      .set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test('Missing tenant context returns 403 (fail closed)', async () => {
    // Login without company parameter; user has no tenantIds so no tenant is
    // derived (2 active companies = ambiguous). Token has no tenantId claim.
    const res = await request(server.app)
      .post('/api/v1/auth/login')
      .send({ username: 'notenant', password: 'NoTenant#123' });
    expect(res.statusCode).toBe(200);
    const session = res.body.data;
    const res2 = await request(server.app)
      .get('/api/v1/dashboard/tenant-home')
      .set(authHeader(session.accessToken));
    expect(res2.statusCode).toBe(403);
    expect(res2.body.details.code).toBe('TENANT_CONTEXT_REQUIRED');
  });

  test('Tenant A sees only Tenant A records (cross-tenant isolation)', async () => {
    const session = await login(server.app, 'owner1', 'Owner#123', 'digitronics');
    const res = await request(server.app)
      .get('/api/v1/dashboard/tenant-home')
      .set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.sales.totalSales).toBe(800);
    expect(res.body.data.customers.count).toBe(1);
    expect(res.body.data.customers.recentCustomers[0].name).toBe('Customer A1');
    expect(res.body.data.suppliers.count).toBe(1);
    expect(res.body.data.suppliers.recentSuppliers[0].name).toBe('Supplier A1');
    expect(res.body.data.treasury.recentTransactions[0].amount).toBe(1000);
    // Tenant B data must not appear
    expect(res.body.data.sales.totalSales).not.toBe(9999);
    expect(res.body.data.customers.recentCustomers.find(c => c.name === 'Customer B1')).toBeUndefined();
    expect(res.body.data.suppliers.recentSuppliers.find(s => s.name === 'Supplier B1')).toBeUndefined();
    expect(res.body.data.treasury.recentTransactions.find(t => t.description === 'Treasury B1')).toBeUndefined();
    // No global products leak
    expect(res.body.data.inventory.available).toBe(false);
  });

  test('Tenant B sees only Tenant B records (cross-tenant isolation)', async () => {
    const session = await login(server.app, 'ownerB', 'OwnerB#123', 'nile');
    const res = await request(server.app)
      .get('/api/v1/dashboard/tenant-home')
      .set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.tenant.id).toBe('nile');
    expect(res.body.data.sales.count).toBe(1);
    expect(res.body.data.sales.totalSales).toBe(9999);
    expect(res.body.data.customers.count).toBe(1);
    expect(res.body.data.customers.recentCustomers[0].name).toBe('Customer B1');
    expect(res.body.data.suppliers.count).toBe(1);
    expect(res.body.data.suppliers.recentSuppliers[0].name).toBe('Supplier B1');
    expect(res.body.data.treasury.recentTransactions[0].amount).toBe(500);
    // Tenant A data must not appear
    expect(res.body.data.customers.recentCustomers.find(c => c.name === 'Customer A1')).toBeUndefined();
    expect(res.body.data.suppliers.recentSuppliers.find(s => s.name === 'Supplier A1')).toBeUndefined();
    expect(res.body.data.treasury.recentTransactions.find(t => t.description === 'Treasury A1')).toBeUndefined();
    // No global products leak
    expect(res.body.data.inventory.available).toBe(false);
  });

  test('response structure is consistent across calls', async () => {
    const session = await login(server.app, 'owner1', 'Owner#123', 'digitronics');
    const res1 = await request(server.app)
      .get('/api/v1/dashboard/tenant-home')
      .set(authHeader(session.accessToken));
    const res2 = await request(server.app)
      .get('/api/v1/dashboard/tenant-home')
      .set(authHeader(session.accessToken));
    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(Object.keys(res1.body.data)).toEqual(Object.keys(res2.body.data));
    expect(res1.body.data.tenant).toEqual(res2.body.data.tenant);
  });
});
