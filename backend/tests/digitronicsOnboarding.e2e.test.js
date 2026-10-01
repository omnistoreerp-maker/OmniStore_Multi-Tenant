'use strict';

// RUNTIME TENANT SECURITY — DIGITRONICS FULL ONBOARDING E2E.
//
// Proves the production posture (AUTH_REQUIRED=true + all six tenant
// isolation flags ON — exactly what render.yaml now deploys) end to end on a
// real express app with a fully isolated mkdtemp data directory:
//
//   1. Public bootstrap still works WITH auth required: the platform-public
//      provision endpoint creates the company + Owner (server-owned role,
//      no password echo), login issues a SERVER-signed tenant-bound JWT.
//   2. The Owner runs the real business loop: dashboard, product via the
//      inventory API, customer, sale, purchase, reports — every business
//      record server-stamped to the caller's tenant.
//   3. The full cross-tenant attack matrix is DENIED before any write:
//      forged X-Tenant-Id header, forged ?tenant= query, forged tenantId
//      body claims, JWT signed with a wrong secret, and cross-tenant
//      reads/updates/deletes of customers, sales and purchases.
//   4. Platform scope is independent from tenant roles: the tenant Owner
//      cannot reach platform admin routes (403), the seeded MASTER_OWNER
//      can (200), anonymous callers get 401.
//
// Products are a SHARED GLOBAL catalog by design (documents +
// inventoryAsync.test.js assert it); the E2E pins that contract here —
// products carry no tenant data, so cross-tenant visibility of the catalog
// is intended, while customer/sale/purchase data never crosses.
//
// Production backend/data is never touched.

process.env.NODE_ENV = 'test';

const fs = require('fs');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { startServer, stopServer, TEST_JWT_SECRET } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');

jest.setTimeout(30000);

const PASSWORD = 'Pass#123';

// The full fail-closed security posture under test.
const SECURITY_FLAGS = [
  'ENABLE_TENANT_RESOLUTION',
  'ENABLE_TENANT_METADATA',
  'ENABLE_TENANT_FILTERING',
  'ENABLE_TENANT_ENTITY_ISOLATION',
  'ENABLE_TENANT_SALES_ISOLATION',
  'ENABLE_TENANT_PURCHASES_ISOLATION',
  'ENABLE_MULTI_COMPANY_LOGIN',
  'ENABLE_TENANT_USER_MEMBERSHIP',
  'ENABLE_TENANT_ROLES',
  'ENABLE_TENANT_CARRY'
];

const ORIGINAL_ENV = {
  AUTH: process.env.AUTH_REQUIRED,
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP,
  ROLES: process.env.ENABLE_TENANT_ROLES,
  CARRY: process.env.ENABLE_TENANT_CARRY,
  RES: process.env.ENABLE_TENANT_RESOLUTION,
  MD: process.env.ENABLE_TENANT_METADATA,
  FLT: process.env.ENABLE_TENANT_FILTERING,
  ISO: process.env.ENABLE_TENANT_ENTITY_ISOLATION,
  SISO: process.env.ENABLE_TENANT_SALES_ISOLATION,
  PISO: process.env.ENABLE_TENANT_PURCHASES_ISOLATION
};

const tempDirs = [];
let server;
let dataDir;
let platformToken; // Anwar — MASTER_OWNER (platform scope, tenant-less)
let digiToken;     // Digitronics Owner (JWT tenantId=digitronics)
let nileToken;     // Nile Owner (JWT tenantId=nile)
let digiProductId;
let digiCustomerId;
let digiSaleId;
let digiPurchaseId;
let nileCustomerId;
let nileSaleId;

function auth(token) {
  return { Authorization: 'Bearer ' + token };
}

function setFlags() {
  for (const k of SECURITY_FLAGS) process.env[k] = 'true';
}

describe('Runtime Tenant Security — Digitronics onboarding E2E (production posture)', () => {
  beforeAll(async () => {
    setFlags();

    dataDir = makeTempDataDir('digitronics-e2e');
    tempDirs.push(dataDir);

    // Platform admin bootstrap — server-side store + the linked real user
    // record (the same shape the PLATFORM_ADMINS env bootstrap writes).
    const stamp = new Date().toISOString();
    seed(dataDir, 'platformAdmins', {
      admins: [{ username: 'anwar', platformRole: 'MASTER_OWNER', createdAt: stamp, updatedAt: stamp }]
    });
    seed(dataDir, 'users', {
      users: [{ id: 'u-anwar', username: 'anwar', password: PASSWORD, fullName: 'Anwar', role: 'Owner', createdAt: stamp, updatedAt: stamp }]
    });

    server = (await startServer(dataDir, { AUTH_REQUIRED: 'true' })).app;

    // Platform admin logs in WITHOUT a company (platform scope is tenant-less).
    const pa = await request(server).post('/api/v1/auth/login').send({ username: 'anwar', password: PASSWORD });
    expect(pa.statusCode).toBe(200);
    platformToken = pa.body.data.accessToken;
  });

  afterAll(async () => {
    await stopServer();
    for (const key of Object.keys(ORIGINAL_ENV)) {
      if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
      else process.env[key] = ORIGINAL_ENV[key];
    }
    for (const dir of tempDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    }
  });

  // ---------------------------------------------------------------------------
  // 1. PUBLIC BOOTSTRAP — works with AUTH_REQUIRED=true (pre-gate by design)
  // ---------------------------------------------------------------------------
  describe('1. public bootstrap with AUTH_REQUIRED=true', () => {
    test('provisions Digitronics + Owner without any auth, no password echo', async () => {
      const res = await request(server)
        .post('/api/v1/platform-public/onboarding/provision')
        .send({ companyName: 'Digitronics', companyId: 'digitronics', adminUsername: 'digiOwner', adminPassword: PASSWORD });
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.company.id).toBe('digitronics');
      expect(res.body.data.admin.role).toBe('Owner');
      expect('password' in res.body.data.admin).toBe(false);
    });

    test('the Owner on disk is bound to the new tenant only (server-owned metadata)', () => {
      const users = readStore(dataDir, 'users').users;
      const owner = users.find(u => u.username === 'digiOwner');
      expect(owner.role).toBe('Owner');
      expect(owner.tenantIds).toEqual(['digitronics']);
      expect(owner.tenantRoles).toEqual({ digitronics: 'Owner' });
      const companies = readStore(dataDir, 'companies').companies;
      expect(companies.find(c => c.id === 'digitronics').provisionedBy).toBe('system');
    });

    test('provisions the rival tenant Nile (attack surface setup)', async () => {
      const res = await request(server)
        .post('/api/v1/platform-public/onboarding/provision')
        .send({ companyName: 'Nile Electronics', companyId: 'nile', adminUsername: 'nileOwner', adminPassword: PASSWORD });
      expect(res.statusCode).toBe(201);
      expect(res.body.data.company.id).toBe('nile');
      expect(res.body.data.admin.role).toBe('Owner');
    });

    test('public surfaces stay reachable with auth required (companies + health)', async () => {
      const companies = await request(server).get('/api/v1/companies');
      expect(companies.statusCode).toBe(200);
      const health = await request(server).get('/api/v1/health');
      expect(health.statusCode).toBe(200);
    });

    test('login issues a SERVER-signed JWT bound to the chosen tenant', async () => {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ username: 'digiOwner', password: PASSWORD, company: 'digitronics' });
      expect(res.statusCode).toBe(200);
      digiToken = res.body.data.accessToken;
      const claims = jwt.verify(digiToken, TEST_JWT_SECRET);
      expect(claims.tenantId).toBe('digitronics');
    });

    test('Nile owner login is bound to nile', async () => {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ username: 'nileOwner', password: PASSWORD, company: 'nile' });
      expect(res.statusCode).toBe(200);
      nileToken = res.body.data.accessToken;
      expect(jwt.verify(nileToken, TEST_JWT_SECRET).tenantId).toBe('nile');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. BUSINESS LOOP — every record server-stamped to the caller's tenant
  // ---------------------------------------------------------------------------
  describe('2. business loop as the Digitronics Owner', () => {
    test('dashboard and reports respond 200 for the Owner', async () => {
      const dash = await request(server).get('/api/v1/dashboard').set(auth(digiToken));
      expect(dash.statusCode).toBe(200);
      const reports = await request(server).get('/api/v1/reports').set(auth(digiToken));
      expect(reports.statusCode).toBe(200);
    });

    test('creates a product through the inventory API (shared catalog by design)', async () => {
      const res = await request(server)
        .post('/api/v1/inventory')
        .set(auth(digiToken))
        .send({ name: 'Laptop Charger 65W', sku: 'DIGI-CHG-65', sellPrice: 450 });
      expect(res.statusCode).toBe(201);
      digiProductId = res.body.data.id;
      expect(digiProductId).toBeTruthy();
    });

    test('creates a customer — server-stamped digitronics on disk', async () => {
      const res = await request(server)
        .post('/api/v1/customers')
        .set(auth(digiToken))
        .send({ name: 'Digi Walk-in', phone: '01012345678' });
      expect(res.statusCode).toBe(201);
      digiCustomerId = res.body.data.id;
      const rec = readStore(dataDir, 'customers').customers.find(c => c.id === digiCustomerId);
      expect(rec.tenantId).toBe('digitronics');
    });

    test('creates a sale — response stamped digitronics', async () => {
      const res = await request(server)
        .post('/api/v1/sales')
        .set(auth(digiToken))
        .send({ items: [{ productId: digiProductId, qty: 1, price: 450 }], total: 450, customer: 'Digi Walk-in', payment: 'cash' });
      expect(res.statusCode).toBe(201);
      digiSaleId = res.body.data.id;
      expect(res.body.data.tenantId).toBe('digitronics');
    });

    test('creates a purchase — response stamped digitronics', async () => {
      const res = await request(server)
        .post('/api/v1/purchases')
        .set(auth(digiToken))
        .send({ items: [{ productId: digiProductId, qty: 5, price: 300 }], total: 1500, supplier: 'Tech Distributor', payment: 'cash' });
      expect(res.statusCode).toBe(201);
      digiPurchaseId = res.body.data.id;
      expect(res.body.data.tenantId).toBe('digitronics');
    });

    test('Nile owner creates rival records (the attack targets)', async () => {
      const cust = await request(server)
        .post('/api/v1/customers')
        .set(auth(nileToken))
        .send({ name: 'Nile Walk-in', phone: '01098765432' });
      expect(cust.statusCode).toBe(201);
      nileCustomerId = cust.body.data.id;
      expect(nileCustomerId).toBeTruthy();

      const sale = await request(server)
        .post('/api/v1/sales')
        .set(auth(nileToken))
        .send({ items: [{ productId: digiProductId, qty: 1, price: 10 }], total: 10, customer: 'Nile Walk-in', payment: 'cash' });
      expect(sale.statusCode).toBe(201);
      nileSaleId = sale.body.data.id;
      expect(sale.body.data.tenantId).toBe('nile');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. CROSS-TENANT ATTACK MATRIX — denied before any persistence
  // ---------------------------------------------------------------------------
  describe('3. cross-tenant attack matrix — all denied', () => {
    test('unauthenticated ERP routes are 401 (GET and POST)', async () => {
      for (const path of ['/api/v1/customers', '/api/v1/sales', '/api/v1/inventory', '/api/v1/dashboard']) {
        const res = await request(server).get(path);
        expect(res.statusCode).toBe(401);
      }
      const post = await request(server).post('/api/v1/sales').send({ items: [], total: 0 });
      expect(post.statusCode).toBe(401);
    });

    test('forged X-Tenant-Id header cannot cross into digitronics', async () => {
      const res = await request(server)
        .get('/api/v1/customers')
        .set(auth(nileToken))
        .set('X-Tenant-Id', 'digitronics');
      expect(res.statusCode).toBe(200);
      const ids = res.body.data.customers.map(c => c.id);
      expect(ids).not.toContain(digiCustomerId);
      expect(ids).toContain(nileCustomerId);
    });

    test('forged ?tenant= query cannot cross', async () => {
      const res = await request(server)
        .get('/api/v1/customers?tenant=digitronics')
        .set(auth(nileToken));
      expect(res.statusCode).toBe(200);
      expect(res.body.data.customers.map(c => c.id)).not.toContain(digiCustomerId);
    });

    test('forged tenantId in a customer body is rejected before any write', async () => {
      const before = JSON.stringify(readStore(dataDir, 'customers'));
      const res = await request(server)
        .post('/api/v1/customers')
        .set(auth(nileToken))
        .send({ name: 'Intruder', tenantId: 'digitronics' });
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(readStore(dataDir, 'customers'))).toBe(before);
    });

    test('forged tenantId on a sale is rejected (store byte-identical)', async () => {
      const before = JSON.stringify(readStore(dataDir, 'sales'));
      const res = await request(server)
        .post('/api/v1/sales')
        .set(auth(nileToken))
        .send({ items: [{ productId: 'p1', qty: 1, price: 5 }], total: 5, tenantId: 'digitronics' });
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(readStore(dataDir, 'sales'))).toBe(before);
    });

    test('JWT signed with a WRONG secret is rejected 401', async () => {
      const forged = jwt.sign({ username: 'digiOwner', tenantId: 'digitronics' }, 'attacker-controlled-secret');
      const res = await request(server).get('/api/v1/customers').set(auth(forged));
      expect(res.statusCode).toBe(401);
    });

    test('digitronics JWT cannot read nile entities (customers/sales/purchases -> 404)', async () => {
      const cust = await request(server).get('/api/v1/customers/' + nileCustomerId).set(auth(digiToken));
      expect(cust.statusCode).toBe(404);

      const sale = await request(server).get('/api/v1/sales/' + nileSaleId).set(auth(digiToken));
      expect(sale.statusCode).toBe(404);

      const purchase = await request(server).get('/api/v1/purchases/' + digiPurchaseId).set(auth(nileToken));
      expect(purchase.statusCode).toBe(404);
    });

    test('cross-tenant updates and deletes are 404 with stores unchanged', async () => {
      const customersBefore = JSON.stringify(readStore(dataDir, 'customers'));
      const salesBefore = JSON.stringify(readStore(dataDir, 'sales'));

      const putCust = await request(server)
        .put('/api/v1/customers/' + digiCustomerId)
        .set(auth(nileToken))
        .send({ phone: '0999999999' });
      expect(putCust.statusCode).toBe(404);

      const delSale = await request(server)
        .delete('/api/v1/sales/' + digiSaleId)
        .set(auth(nileToken));
      expect(delSale.statusCode).toBe(404);

      expect(JSON.stringify(readStore(dataDir, 'customers'))).toBe(customersBefore);
      expect(JSON.stringify(readStore(dataDir, 'sales'))).toBe(salesBefore);
    });

    test('lists are tenant-scoped: nile never sees digitronics records', async () => {
      const sales = await request(server).get('/api/v1/sales').set(auth(nileToken));
      expect(sales.statusCode).toBe(200);
      const saleIds = (sales.body.data.invoices || []).map(i => i.id);
      expect(saleIds).toContain(nileSaleId);
      expect(saleIds).not.toContain(digiSaleId);

      const purchases = await request(server).get('/api/v1/purchases').set(auth(nileToken));
      expect(purchases.statusCode).toBe(200);
      const purchaseIds = (purchases.body.data.purchases || purchases.body.data.invoices || []).map(p => p.id);
      expect(purchaseIds).not.toContain(digiPurchaseId);

      const digiSales = await request(server).get('/api/v1/sales').set(auth(digiToken));
      const digiSaleIds = (digiSales.body.data.invoices || []).map(i => i.id);
      expect(digiSaleIds).toContain(digiSaleId);
      expect(digiSaleIds).not.toContain(nileSaleId);
    });

    test('shared product catalog is visible to both tenants (contract, no tenant data)', async () => {
      const nileView = await request(server).get('/api/v1/inventory').set(auth(nileToken));
      expect(nileView.statusCode).toBe(200);
      expect(nileView.body.data.products.some(p => p.id === digiProductId)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. PLATFORM SCOPE — independent from tenant roles
  // ---------------------------------------------------------------------------
  describe('4. platform scope is independent of tenant roles', () => {
    test('anonymous platform admin routes are 401', async () => {
      const res = await request(server).get('/api/v1/platform/summary');
      expect(res.statusCode).toBe(401);
    });

    test('the Digitronics Owner (not a platform admin) is rejected 403', async () => {
      const res = await request(server).get('/api/v1/platform/summary').set(auth(digiToken));
      expect(res.statusCode).toBe(403);
      expect(JSON.stringify(res.body)).toContain('PLATFORM_ADMIN_REQUIRED');
    });

    test('the seeded MASTER_OWNER reaches the platform console data', async () => {
      const res = await request(server).get('/api/v1/platform/summary').set(auth(platformToken));
      expect(res.statusCode).toBe(200);
    });

    test('a tenant Owner cannot grant platform admin rights (store unchanged)', async () => {
      const before = JSON.stringify(readStore(dataDir, 'platformAdmins'));
      const res = await request(server)
        .post('/api/v1/platform/admins')
        .set(auth(digiToken))
        .send({ username: 'digiOwner', platformRole: 'PLATFORM_ADMIN' });
      expect(res.statusCode).toBe(403);
      expect(JSON.stringify(readStore(dataDir, 'platformAdmins'))).toBe(before);
    });

    test('unauthenticated users cannot reach any platform admin data route', async () => {
      for (const path of ['/api/v1/platform/companies', '/api/v1/platform/admins', '/api/v1/platform/users']) {
        const res = await request(server).get(path);
        expect(res.statusCode).toBe(401);
      }
    });
  });
});
