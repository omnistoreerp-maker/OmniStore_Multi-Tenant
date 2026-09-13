'use strict';

// Phase 3.5 — Cross-domain reference hardening.
//
// Verifies that Sales and Purchase services validate foreign-entity references
// against tenant ownership before persisting:
//   - Sales.create/update rejects foreign customerId
//   - Purchases.create/update rejects foreign supplierId
//
// Uses ENABLE_TENANT_SALES_ISOLATION + ENABLE_TENANT_PURCHASES_ISOLATION
// and the trusted req.tenantContext path.

const fs = require('fs');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');

const ORIGINAL_ENV = {
  ROLES: process.env.ENABLE_TENANT_ROLES,
  CARRY: process.env.ENABLE_TENANT_CARRY,
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP,
  AUTH: process.env.AUTH_REQUIRED,
  FILTER: process.env.ENABLE_TENANT_FILTERING,
  MD: process.env.ENABLE_TENANT_METADATA,
  ISO_SALES: process.env.ENABLE_TENANT_SALES_ISOLATION,
  ISO_PURCHASES: process.env.ENABLE_TENANT_PURCHASES_ISOLATION,
  DATA: process.env.DIGITRONICS_DATA_DIR
};

const companies = [
  { id: 'corp-a', name: 'Corp A', code: 'CA', active: true },
  { id: 'corp-b', name: 'Corp B', code: 'CB', active: true }
];

function hash(pw) { return bcrypt.hashSync(pw, 10); }

const users = { users: [
  {
    id: 'u-a', username: 'adminA', password: hash('Pass#123'), role: 'Owner',
    fullName: 'Admin A', tenantIds: ['corp-a'], tenantRoles: { 'corp-a': 'Owner' },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  },
  {
    id: 'u-b', username: 'adminB', password: hash('Pass#123'), role: 'Owner',
    fullName: 'Admin B', tenantIds: ['corp-b'], tenantRoles: { 'corp-b': 'Owner' },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  }
]};

const customers = {
  customers: [
    { id: 'cust-a1', name: 'Alice A', phone: '0100000001', balance: 10, tenantId: 'corp-a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'cust-b1', name: 'Bob B', phone: '0100000002', balance: 20, tenantId: 'corp-b', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  ]
};

const suppliers = {
  suppliers: [
    { id: 'supp-a1', name: 'Alice Supply', phone: '0100000001', balance: 10, tenantId: 'corp-a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'supp-b1', name: 'Bob Supply', phone: '0100000002', balance: 20, tenantId: 'corp-b', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  ]
};

function seedAll(dir) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', users);
  seed(dir, 'customers', customers);
  seed(dir, 'suppliers', suppliers);
}

async function loginAs(app, username, company) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ username, password: 'Pass#123', company });
  return res.body && res.body.data ? res.body.data.accessToken : undefined;
}

describe('Phase 3.5 — Cross-domain reference hardening', () => {
  let app;
  let dir;
  let tokenA;
  let tokenB;

  beforeAll(async () => {
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_FILTERING = 'true';
    process.env.ENABLE_TENANT_METADATA = 'true';
    process.env.ENABLE_TENANT_SALES_ISOLATION = 'true';
    process.env.ENABLE_TENANT_PURCHASES_ISOLATION = 'true';
    process.env.AUTH_REQUIRED = 'true';

    dir = makeTempDataDir('phase35-cross-domain');
    seedAll(dir);
    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    app = s.app;
    tokenA = await loginAs(app, 'adminA', 'corp-a');
    tokenB = await loginAs(app, 'adminB', 'corp-b');
  });

  afterAll(() => {
    if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
    const map = [
      ['ROLES', 'ENABLE_TENANT_ROLES'],
      ['CARRY', 'ENABLE_TENANT_CARRY'],
      ['MC', 'ENABLE_MULTI_COMPANY_LOGIN'],
      ['MEM', 'ENABLE_TENANT_USER_MEMBERSHIP'],
      ['AUTH', 'AUTH_REQUIRED'],
      ['FILTER', 'ENABLE_TENANT_FILTERING'],
      ['MD', 'ENABLE_TENANT_METADATA'],
      ['ISO_SALES', 'ENABLE_TENANT_SALES_ISOLATION'],
      ['ISO_PURCHASES', 'ENABLE_TENANT_PURCHASES_ISOLATION'],
      ['DATA', 'DIGITRONICS_DATA_DIR']
    ];
    for (const [envKey, origKey] of map) {
      const orig = ORIGINAL_ENV[envKey];
      if (orig === undefined) delete process.env[origKey];
      else process.env[origKey] = orig;
    }
  });

  const get = (path, token) => request(app).get(path).set('Authorization', `Bearer ${token}`);
  const post = (path, body, token) => request(app).post(path).send(body).set('Authorization', `Bearer ${token}`);
  const put = (path, body, token) => request(app).put(path).send(body).set('Authorization', `Bearer ${token}`);
  const del = (path, token) => request(app).delete(path).set('Authorization', `Bearer ${token}`);

  // ===================== SALES CROSS-DOMAIN (customerId) =====================

  describe('Sales — customerId cross-domain validation', () => {
    test('POST /sales with foreign customerId is rejected (400)', async () => {
      const res = await post('/api/v1/sales', {
        id: 'INV-X-A',
        items: [{ productId: 'p1', qty: 1, price: 100, total: 100 }],
        total: 100,
        customerId: 'cust-b1'
      }, tokenA);
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toBe('Customer not found');;
    });

    test('POST /sales with own customerId is accepted (201)', async () => {
      const res = await post('/api/v1/sales', {
        id: 'INV-X-OK-A',
        items: [{ productId: 'p1', qty: 1, price: 100, total: 100 }],
        total: 100,
        customerId: 'cust-a1'
      }, tokenA);
      expect(res.statusCode).toBe(201);
    });

    test('POST /sales without customerId is accepted (201)', async () => {
      const res = await post('/api/v1/sales', {
        id: 'INV-X-NULL-A',
        items: [{ productId: 'p1', qty: 1, price: 100, total: 100 }],
        total: 100
      }, tokenA);
      expect(res.statusCode).toBe(201);
    });

    test('PUT /sales with foreign customerId is rejected (400)', async () => {
      const created = await post('/api/v1/sales', {
        id: 'INV-X-UPD-A',
        items: [{ productId: 'p1', qty: 1, price: 100, total: 100 }],
        total: 100,
        customerId: 'cust-a1'
      }, tokenA);
      expect(created.statusCode).toBe(201);
      const id = created.body.data.id;

      const res = await put(`/api/v1/sales/${id}`, {
        customerId: 'cust-b1'
      }, tokenA);
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toBe('Customer not found');;
    });

    test('PUT /sales with own customerId is accepted (200)', async () => {
      const created = await post('/api/v1/sales', {
        id: 'INV-X-UPD-OK-A',
        items: [{ productId: 'p1', qty: 1, price: 100, total: 100 }],
        total: 100,
        customerId: 'cust-a1'
      }, tokenA);
      expect(created.statusCode).toBe(201);
      const id = created.body.data.id;

      const res = await put(`/api/v1/sales/${id}`, {
        customerId: 'cust-a1'
      }, tokenA);
      expect(res.statusCode).toBe(200);
    });
  });

  // ===================== PURCHASES CROSS-DOMAIN (supplierId) =====================

  describe('Purchases — supplierId cross-domain validation', () => {
    test('POST /purchases with foreign supplierId is rejected (400)', async () => {
      const res = await post('/api/v1/purchases', {
        id: 'PUR-X-A',
        items: [{ productId: 'p1', qty: 1, price: 100, total: 100 }],
        total: 100,
        supplierId: 'supp-b1'
      }, tokenA);
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toBe('Supplier not found');;
    });

    test('POST /purchases with own supplierId is accepted (201)', async () => {
      const res = await post('/api/v1/purchases', {
        id: 'PUR-X-OK-A',
        items: [{ productId: 'p1', qty: 1, price: 100, total: 100 }],
        total: 100,
        supplierId: 'supp-a1'
      }, tokenA);
      expect(res.statusCode).toBe(201);
    });

    test('POST /purchases without supplierId is accepted (201)', async () => {
      const res = await post('/api/v1/purchases', {
        id: 'PUR-X-NULL-A',
        items: [{ productId: 'p1', qty: 1, price: 100, total: 100 }],
        total: 100
      }, tokenA);
      expect(res.statusCode).toBe(201);
    });

    test('PUT /purchases with foreign supplierId is rejected (400)', async () => {
      const created = await post('/api/v1/purchases', {
        id: 'PUR-X-UPD-A',
        items: [{ productId: 'p1', qty: 1, price: 100, total: 100 }],
        total: 100,
        supplierId: 'supp-a1'
      }, tokenA);
      expect(created.statusCode).toBe(201);
      const id = created.body.data.id;

      const res = await put(`/api/v1/purchases/${id}`, {
        supplierId: 'supp-b1'
      }, tokenA);
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toBe('Supplier not found');;
    });

    test('PUT /purchases with own supplierId is accepted (200)', async () => {
      const created = await post('/api/v1/purchases', {
        id: 'PUR-X-UPD-OK-A',
        items: [{ productId: 'p1', qty: 1, price: 100, total: 100 }],
        total: 100,
        supplierId: 'supp-a1'
      }, tokenA);
      expect(created.statusCode).toBe(201);
      const id = created.body.data.id;

      const res = await put(`/api/v1/purchases/${id}`, {
        supplierId: 'supp-a1'
      }, tokenA);
      expect(res.statusCode).toBe(200);
    });
  });
});
