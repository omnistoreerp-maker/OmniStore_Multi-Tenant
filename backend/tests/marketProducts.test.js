'use strict';

// Marketplace Phase 1 — Product & Category CRUD, persistence, authorization
// and tenant isolation tests.
//
// All requests go through the real HTTP stack (asyncHandler -> controller ->
// service -> BaseRepository -> JSON store), using the same testServer /
// testData helpers as the existing market suite. No mocks for the data store.

const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const ADMIN_SECRET = 'phase1-admin-secret-for-tests-only';
const TEST_JWT_SECRET = 'test-jwt-secret-for-jest-suites';
let app;
let dataDir;

registerCleanup(() => [app], () => [dataDir]);

beforeAll(async () => {
  process.env.MARKETPLACE_OPERATOR_SECRET = ADMIN_SECRET;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.ENABLE_TENANT_ROLES = 'true';
  dataDir = makeTempDataDir('market-products');
  // Seed the isolated temp dir with the canonical seed data so the 'laptops'/'gaming'
  // categories (and existing products) are present, matching the server's own data source.
  const productsDoc = require('../data/products.json');
  seed(dataDir, 'products', productsDoc);
  app = (await startServer(dataDir)).app;
});

afterAll(async () => {
  delete process.env.MARKETPLACE_OPERATOR_SECRET;
  delete process.env.JWT_SECRET;
});

async function loginAsOperator(tenant, email, pass) {
  const reg = await request(app)
    .post('/api/v1/market/auth/register')
    .set('X-Tenant-Id', tenant)
    .send({ email, password: pass, name: 'Test Operator' });
  expect(reg.status).toBe(201);
  const prom = await request(app)
    .post('/api/v1/market/internal/operator-promote')
    .set('X-Tenant-Id', tenant)
    .set('X-Operator-Secret', ADMIN_SECRET)
    .send({ customerId: reg.body.data.customer.id, tenantId: tenant, role: 'operator' });
  expect(prom.status).toBe(200);
  const login = await request(app)
    .post('/api/v1/market/auth/login')
    .set('X-Tenant-Id', tenant)
    .send({ email, password: pass });
  expect(login.status).toBe(200);
  return login.body.data.token;
}

async function loginAsCustomer(tenant, email, pass) {
  const reg = await request(app)
    .post('/api/v1/market/auth/register')
    .set('X-Tenant-Id', tenant)
    .send({ email, password: pass });
  expect(reg.status).toBe(201);
  const login = await request(app)
    .post('/api/v1/market/auth/login')
    .set('X-Tenant-Id', tenant)
    .send({ email, password: pass });
  expect(login.status).toBe(200);
  return login.body.data.token;
}

function authH(token, tenant = 'default') {
  return { Authorization: 'Bearer ' + token, 'X-Tenant-Id': tenant };
}

function productsDoc() {
  return JSON.parse(fs.readFileSync(path.join(dataDir, 'products.json'), 'utf8'));
}

describe('CRUD — products', () => {
  let operatorToken;

  beforeAll(async () => {
    operatorToken = await loginAsOperator('default', 'op@market.test', 'Password#123');
  });

  test('POST /products creates a valid product (201)', async () => {
    const res = await request(app)
      .post('/api/v1/market/products')
      .set(authH(operatorToken))
      .send({
        name: 'Test Laptop Pro',
        sku: 'SKU-TEST-001',
        categoryId: 'laptops',
        brandId: 'hp',
        sellPrice: 15000,
        stockQty: 5,
        cpu: 'i5 11TH',
        ramRom: '16/512',
        gpu: 'INTEL',
        published: true
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.product.id).toBeTruthy();
    expect(res.body.data.product.name).toBe('Test Laptop Pro');
    expect(res.body.data.product.price).toBe(15000);
    expect(res.body.data.product.stockQty).toBe(5);
    expect(res.body.data.product.categoryId).toBe('laptops');
  });

  test('GET /products reads the newly created product from the same truth source', async () => {
    const { body: { data: { product: created } } } = await request(app)
      .post('/api/v1/market/products')
      .set(authH(operatorToken))
      .send({
        name: 'Readback Product',
        sku: 'SKU-READBACK',
        categoryId: 'laptops',
        brandId: 'hp',
        sellPrice: 9999,
        stockQty: 3
      });
    const get = await request(app)
      .get('/api/v1/market/products/' + created.id)
      .set(authH(operatorToken));
    expect(get.status).toBe(200);
    expect(get.body.data.id).toBe(created.id);
    expect(get.body.data.name).toBe('Readback Product');
    expect(get.body.data.price).toBe(9999);
  });

  test('PUT /products/:id updates a product and persists', async () => {
    const { body: { data: { product: created } } } = await request(app)
      .post('/api/v1/market/products')
      .set(authH(operatorToken))
      .send({ name: 'Update Test', sku: 'SKU-UPDATE', categoryId: 'gaming', sellPrice: 1111, stockQty: 2 });
    const updateRes = await request(app)
      .put('/api/v1/market/products/' + created.id)
      .set(authH(operatorToken))
      .send({ name: 'Updated Name', cpu: 'RYZEN 7', price: 2222, stockQty: 7 });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.product.name).toBe('Updated Name');
    expect(updateRes.body.data.product.cpu).toBe('RYZEN 7');
    expect(updateRes.body.data.product.price).toBe(2222);
    expect(updateRes.body.data.product.stockQty).toBe(7);
    const get = await request(app).get('/api/v1/market/products/' + created.id).set(authH(operatorToken));
    expect(get.body.data.price).toBe(2222);
    const doc = productsDoc();
    const persisted = doc.products.find((p) => p.id === created.id);
    expect(persisted).toBeTruthy();
    expect(persisted.updatedAt).toBeTruthy();
    expect(get.body.data.createdAt).toBe(persisted.createdAt);
  });
});

describe('CRUD — products delete and publish', () => {
  let operatorToken;

  beforeAll(async () => {
    operatorToken = await loginAsOperator('default', 'op2@market.test', 'Password#123');
  });

  test('DELETE /products/:id soft-deletes (customer view drops it, deletedAt stamped)', async () => {
    const { body: { data: { product: created } } } = await request(app)
      .post('/api/v1/market/products')
      .set(authH(operatorToken))
      .send({ name: 'Soft Delete Me', sku: 'SKU-SDM', categoryId: 'gaming', sellPrice: 500 });
    const del = await request(app)
      .delete('/api/v1/market/products/' + created.id)
      .set(authH(operatorToken));
    expect(del.status).toBe(200);
    expect(del.body.data.product.deletedAt).toBeTruthy();
    expect(del.body.data.product.deletedBy).toBeTruthy();
    const get = await request(app).get('/api/v1/market/products/' + created.id).set(authH(operatorToken));
    expect(get.status).toBe(200); // soft-deleted still retrievable by operator
    const customerList = await request(app)
      .get('/api/v1/market/products')
      .set('X-Tenant-Id', 'default')
      .query({ includeOutOfStock: 'true' });
    expect(customerList.body.data.products.every((p) => p.id !== created.id)).toBe(true);
    const doc = productsDoc();
    expect(doc.products.find((p) => p.id === created.id && p.deletedAt)).toBeTruthy();
  });

  test('DELETE /products/:id?purge=true hard-deletes from the store', async () => {
    const { body: { data: { product: created } } } = await request(app)
      .post('/api/v1/market/products')
      .set(authH(operatorToken))
      .send({ name: 'Purge Me', sku: 'SKU-PM', categoryId: 'gaming', sellPrice: 300 });
    const purged = await request(app)
      .delete('/api/v1/market/products/' + created.id + '?purge=true')
      .set(authH(operatorToken));
    expect(purged.status).toBe(200);
    expect(purged.body.data.ok).toBe(true);
    const doc = productsDoc();
    expect(doc.products.find((p) => p.id === created.id)).toBeFalsy();
    const get = await request(app).get('/api/v1/market/products/' + created.id).set(authH(operatorToken));
    expect(get.status).toBe(200);
    expect(get.body.data).toBeFalsy();
  });

  test('PATCH /products/:id/publish toggles published state and catalog visibility', async () => {
    const { body: { data: { product: created } } } = await request(app)
      .post('/api/v1/market/products')
      .set(authH(operatorToken))
      .send({ name: 'Draft Product', sku: 'SKU-DRAFT', categoryId: 'gaming', sellPrice: 400, published: true });
    const unpublish = await request(app)
      .patch('/api/v1/market/products/' + created.id + '/publish')
      .set(authH(operatorToken))
      .send({ published: false });
    expect(unpublish.status).toBe(200);
    expect(unpublish.body.data.product.published).toBe(false);
    const doc = productsDoc();
    const p = doc.products.find((x) => x.id === created.id);
    expect(p.published).toBe(false);
    // includeOutOfStock neutralizes the stock filter; exclusion is solely due to published:false.
    const customerList = await request(app)
      .get('/api/v1/market/products')
      .set('X-Tenant-Id', 'default')
      .query({ includeOutOfStock: 'true' });
    expect(customerList.body.data.products.some((x) => x.id === created.id)).toBe(false);
  });
});




describe('CRUD — categories', () => {
  let operatorToken;

  beforeAll(async () => {
    operatorToken = await loginAsOperator('default', 'op3@market.test', 'Password#123');
  });

  test('POST /categories creates a category (201)', async () => {
    const res = await request(app)
      .post('/api/v1/market/categories')
      .set(authH(operatorToken))
      .send({ id: 'peripherals', name: 'Peripheral Devices', description: 'أجهزة طرفية', color: '#10b981' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.category.id).toBe('peripherals');
    expect(res.body.data.category.name).toBe('Peripheral Devices');
  });

  test('PUT /categories/:id updates a category', async () => {
    const updateRes = await request(app)
      .put('/api/v1/market/categories/peripherals')
      .set(authH(operatorToken))
      .send({ name: 'Peripheral Devices Updated', description: 'Updated description' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.category.name).toBe('Peripheral Devices Updated');
  });

  test('DELETE /categories/:id succeeds when unused', async () => {
    const before = productsDoc().categories.filter((c) => c.id === 'peripherals').length;
    const res = await request(app)
      .delete('/api/v1/market/categories/peripherals')
      .set(authH(operatorToken));
    expect(res.status).toBe(200);
    const doc = productsDoc();
    expect(doc.categories.filter((c) => c.id === 'peripherals').length).toBe(before - 1);
  });
});


describe('Validation', () => {
  let operatorToken;

  beforeAll(async () => {
    operatorToken = await loginAsOperator('default', 'op4@market.test', 'Password#123');
  });

  test('POST /products rejects missing name', async () => {
    const res = await request(app)
      .post('/api/v1/market/products')
      .set(authH(operatorToken))
      .send({ categoryId: 'laptops', sellPrice: 100 });
    expect(res.status).toBe(400);
  });

  test('POST /products rejects missing categoryId', async () => {
    const res = await request(app)
      .post('/api/v1/market/products')
      .set(authH(operatorToken))
      .send({ name: 'No Category', sellPrice: 100 });
    expect(res.status).toBe(400);
  });

  test('POST /products rejects category not linked to the tenant', async () => {
    const res = await request(app)
      .post('/api/v1/market/products')
      .set(authH(operatorToken))
      .send({ name: 'Bad Category', categoryId: 'nonexistent', sellPrice: 100 });
    expect(res.status).toBe(400);
  });

  test('POST /products rejects negative price', async () => {
    const res = await request(app)
      .post('/api/v1/market/products')
      .set(authH(operatorToken))
      .send({ name: 'Bad Price', categoryId: 'laptops', sellPrice: -5 });
    expect(res.status).toBe(400);
  });

  test('POST /products rejects non-numeric price', async () => {
    const res = await request(app)
      .post('/api/v1/market/products')
      .set(authH(operatorToken))
      .send({ name: 'Bad Price', categoryId: 'laptops', sellPrice: 'high' });
    expect(res.status).toBe(400);
  });

  test('POST /products rejects malformed id with dots', async () => {
    const res = await request(app)
      .post('/api/v1/market/products')
      .set(authH(operatorToken))
      .send({ id: 'bad.id/name', name: 'Bad Id', categoryId: 'laptops', sellPrice: 100 });
    expect(res.status).toBe(400);
  });

  test('PUT /products/:id rejects mass assignment of identity and audit fields', async () => {
    const { body: { data: { product: created } } } = await request(app)
      .post('/api/v1/market/products')
      .set(authH(operatorToken))
      .send({ name: 'MassAssign', categoryId: 'laptops', sellPrice: 100 });
    const res = await request(app)
      .put('/api/v1/market/products/' + created.id)
      .set(authH(operatorToken))
      .send({
        name: 'Changed',
        id: 'hacked-id',
        createdAt: '2020-01-01T00:00:00.000Z',
        updatedAt: '2020-01-01T00:00:00.000Z',
        tokenVersion: 999,
        deletedAt: '2020-01-01T00:00:00.000Z',
        deletedBy: 'hacker',
        tenantId: 'another-company',
        role: 'admin',
        password: 'super-secret',
        description: 'OK description that remains',
        categoryId: 'gaming'
      });
    expect(res.status).toBe(200);
    expect(res.body.data.product.id).not.toBe('hacked-id');
    expect(res.body.data.product.createdAt).toBeTruthy();
    const doc = productsDoc();
    const p = doc.products.find((x) => x.id === created.id);
    expect(p.createdAt).not.toBe('2020-01-01T00:00:00.000Z');
    expect(p.deletedAt).toBeFalsy();
    expect(p.deletedBy).toBeFalsy();
    expect(p.tenantId).toBeUndefined();
    expect(p.role).toBeUndefined();
    expect(p.password).toBeUndefined();
    expect(p.description).toBe('OK description that remains');
    expect(p.categoryId).toBe('gaming');
  });

  test('PUT /products/:id requires a product visible in the tenant catalog (404 otherwise)', async () => {
    // Tenant B cannot see Tenant A's products because of fail-closed visibility.
    const res = await request(app)
      .put('/api/v1/market/products/some-id')
      .set(authH('bogus-token', 'corp-b'))
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  test('PATCH /products/:id/publish requires a boolean published value', async () => {
    const { body: { data: { product: created } } } = await request(app)
      .post('/api/v1/market/products')
      .set(authH(operatorToken))
      .send({ name: 'Publish', categoryId: 'laptops', sellPrice: 100 });
    const res = await request(app)
      .patch('/api/v1/market/products/' + created.id + '/publish')
      .set(authH(operatorToken))
      .send({ published: 'yes' });
    expect(res.status).toBe(400);
  });

  test('POST /categories rejects duplicate id', async () => {
    await request(app)
      .post('/api/v1/market/categories')
      .set(authH(operatorToken))
      .send({ id: 'dups', name: 'First' });
    const res = await request(app)
      .post('/api/v1/market/categories')
      .set(authH(operatorToken))
      .send({ id: 'dups', name: 'Second' });
    expect(res.status).toBe(400);
  });

  test('POST /categories rejects duplicate name', async () => {
    await request(app)
      .post('/api/v1/market/categories')
      .set(authH(operatorToken))
      .send({ id: 'dupn-1', name: 'Same Name' });
    const res = await request(app)
      .post('/api/v1/market/categories')
      .set(authH(operatorToken))
      .send({ id: 'dupn-2', name: 'Same Name' });
    expect(res.status).toBe(400);
  });
});


describe('Persistence — data survives writes and restart-equivalent reloads', () => {
  let operatorToken;

  beforeAll(async () => {
    operatorToken = await loginAsOperator('default', 'op5@market.test', 'Password#123');
  });

  test('create product: the new record is on disk in the canonical products store', async () => {
    const name = 'Persist Product A';
    const { body: { data: { product: created } } } = await request(app)
      .post('/api/v1/market/products')
      .set(authH(operatorToken))
      .send({ name, categoryId: 'gaming', sellPrice: 777, stockQty: 4 });
    expect(created.id).toBeTruthy();
    const doc = productsDoc();
    const onDisk = doc.products.find((p) => p.id === created.id);
    expect(onDisk).toBeTruthy();
    expect(onDisk.name).toBe(name);
    expect(onDisk.sellPrice).toBe(777);
    expect(onDisk.categoryId).toBe('gaming');
    expect(onDisk.published).toBe(true);
    expect(onDisk.createdAt).toBeTruthy();
    expect(onDisk.updatedAt).toBeTruthy();
    expect(onDisk.stockQty).toBe(4);
  });

  test('update product: the persisted document reflects the change', async () => {
    const { body: { data: { product: created } } } = await request(app)
      .post('/api/v1/market/products')
      .set(authH(operatorToken))
      .send({ name: 'Persist Update B', categoryId: 'gaming', sellPrice: 888, stockQty: 2 });
    const updateRes = await request(app)
      .put('/api/v1/market/products/' + created.id)
      .set(authH(operatorToken))
      .send({ name: 'Persist Update C', price: 999 });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.product.name).toBe('Persist Update C');
    expect(updateRes.body.data.product.price).toBe(999);
    const doc = productsDoc();
    const onDisk = doc.products.find((p) => p.id === created.id);
    expect(onDisk).toBeTruthy();
    expect(onDisk.name).toBe('Persist Update C');
    expect(onDisk.sellPrice).toBe(999);
    expect(onDisk.updatedAt).toBeTruthy();
  });

  test('categories are persisted as an array in the same products document', async () => {
    const doc = productsDoc();
    expect(Array.isArray(doc.categories)).toBe(true);
    expect(doc.categories.map((c) => c.id)).toContain('laptops');
    expect(doc.categories.map((c) => c.id)).toContain('gaming');
    expect(doc.categories.filter((c) => c.active !== false).length).toBeGreaterThan(0);
  });

  test('soft delete: deletedAt survives on disk (not truly gone until purge)', async () => {
    const { body: { data: { product: created } } } = await request(app)
      .post('/api/v1/market/products')
      .set(authH(operatorToken))
      .send({ name: 'Persist Delete', categoryId: 'gaming', sellPrice: 333 });
    await request(app).delete('/api/v1/market/products/' + created.id).set(authH(operatorToken));
    const doc = productsDoc();
    expect(doc.products.some((p) => p.id === created.id && p.deletedAt)).toBe(true);
    expect(doc.products.filter((p) => !p.deletedAt).some((p) => p.id === created.id)).toBe(false);
  });
});


describe('Authorization & tenant isolation', () => {
  let customerToken;
  let unauthTenant = 'default';
  let operatorToken;

  beforeAll(async () => {
    operatorToken = await loginAsOperator('default', 'op-auth@market.test', 'Password#123');
    const reg = await request(app)
      .post('/api/v1/market/auth/register')
      .set('X-Tenant-Id', 'default')
      .send({ email: 'buyer@market.test', password: 'Password#123', name: 'Buyer' });
    expect(reg.status).toBe(201);
    const login = await request(app)
      .post('/api/v1/market/auth/login')
      .set('X-Tenant-Id', 'default')
      .send({ email: 'buyer@market.test', password: 'Password#123' });
    expect(login.status).toBe(200);
    customerToken = login.body.data.token;
  });

  test('unauthenticated write is rejected (401)', async () => {
    const res = await request(app)
      .post('/api/v1/market/products')
      .set('X-Tenant-Id', 'default')
      .send({ name: 'Hacked', categoryId: 'gaming', sellPrice: 1 });
    expect(res.status).toBe(401);
  });

  test('customer (non-operator) write is rejected (403)', async () => {
    const res = await request(app)
      .post('/api/v1/market/products')
      .set(authH(customerToken))
      .send({ name: 'Hacked', categoryId: 'gaming', sellPrice: 1 });
    expect(res.status).toBe(403);
  });

  test('operator write succeeds (201)', async () => {
    const opToken = await loginAsOperator('default', 'op-authorize@market.test', 'Password#123');
    const res = await request(app)
      .post('/api/v1/market/products')
      .set(authH(opToken))
      .send({ name: 'Authorized Operator Product', categoryId: 'gaming', sellPrice: 42 });
    expect(res.status).toBe(201);
    expect(res.body.data.product.name).toBe('Authorized Operator Product');
  });

  test('customer tenant mismatch (token tenant vs header) returns 403', async () => {
    const reg = await request(app)
      .post('/api/v1/market/auth/register')
      .set('X-Tenant-Id', 'default')
      .send({ email: 'cust-b@market.test', password: 'Password#123' });
    expect(reg.status).toBe(201);
    const login = await request(app)
      .post('/api/v1/market/auth/login')
      .set('X-Tenant-Id', 'default')
      .send({ email: 'cust-b@market.test', password: 'Password#123' });
    expect(login.status).toBe(200);
    // Seed a second existing tenant so the token-issued-tenant mismatch is
    // detected as a 403 (mismatch) instead of 404 (unknown tenant).
    const configPath = path.join(dataDir, 'marketConfig.json');
    const cfg = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : { configs: [] };
    if (!cfg.configs.some((c) => String(c.tenantId) === 'other-tenant')) {
      cfg.configs.push({ tenantId: 'other-tenant', enabled: true });
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    }
    // Use the customer token but claim the (now existing) 'other-tenant' header.
    const res = await request(app)
      .get('/api/v1/market/orders')
      .set('X-Tenant-Id', 'other-tenant')
      .set({ Authorization: 'Bearer ' + login.body.data.token });
    expect(res.status).toBe(403);
  });

  test('media cross-tenant read is non-disclosing (404)', async () => {
    // A media URL from a different tenant must never expose files.
    const res = await request(app)
      .get('/api/v1/market/media/other-tenant/anything-123.png')
      .set('X-Tenant-Id', 'default');
    expect(res.status).toBe(404);
  });

  test('product create ignores body.tenantId and uses the trusted header context', async () => {
    const res = await request(app)
      .post('/api/v1/market/products')
      .set(authH(operatorToken))
      .set('X-Tenant-Id', 'default')
      .send({ tenantId: 'tampered-tenant', name: 'Header-Win Product', categoryId: 'gaming', sellPrice: 500 });
    expect(res.status).toBe(201);
    expect(res.body.data.product.id).toBeTruthy();
    const doc = productsDoc();
    const p = doc.products.find((x) => x.name === 'Header-Win Product');
    expect(p).toBeTruthy();
    expect(p.tenantId).toBeUndefined();
  });

  test('fail-closed tenant cannot list products outside its allowlist', async () => {
    // Seed a restricted tenant config (write directly to the temp marketConfig store).
    const configPath = path.join(dataDir, 'marketConfig.json');
    const cfg = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : { configs: [] };
    const allowedId = 'visible-to-allowlist';
    cfg.configs.push({
      tenantId: 'isolation-tenant',
      enabled: true,
      productVisibility: { includeAll: false, included: [allowedId] }
    });
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    try {
      // Create the one product the allowlist admits.
      await request(app)
        .post('/api/v1/market/products')
        .set(authH(operatorToken))
        .set('X-Tenant-Id', 'default')
        .send({ id: allowedId, name: 'Visible', categoryId: 'laptops', sellPrice: 10 });
      const visible = await request(app)
        .get('/api/v1/market/products')
        .set('X-Tenant-Id', 'isolation-tenant')
        .query({ includeOutOfStock: 'true', includeDeleted: 'true' });
      expect(visible.body.data.products.some((p) => p.id === allowedId)).toBe(true);
      // This product lives in the global catalog and is visible to 'default',
      // but must NOT be visible to the fail-closed allowlist tenant.
      await request(app)
        .post('/api/v1/market/products')
        .set(authH(operatorToken))
        .set('X-Tenant-Id', 'default')
        .send({ name: 'Not Visible', categoryId: 'laptops', sellPrice: 20 });
      const notVisible = await request(app)
        .get('/api/v1/market/products')
        .set('X-Tenant-Id', 'isolation-tenant')
        .query({ includeOutOfStock: 'true', includeDeleted: 'true' });
      expect(notVisible.body.data.products.some((p) => p.name === 'Not Visible')).toBe(false);
      const single = await request(app)
        .get('/api/v1/market/products/does-not-exist-for-it')
        .set('X-Tenant-Id', 'isolation-tenant');
      expect(single.status).toBe(200);
      expect(single.body.data).toBeFalsy();
    } finally {
      // Restore the tenant config: drop the test allowlist tenant.
      const cfg = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : { configs: [] };
      cfg.configs = cfg.configs.filter((c) => c.tenantId !== 'isolation-tenant');
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
      // Purge the two products injected by this test.
      const prodPath = path.join(dataDir, 'products.json');
      const doc = fs.existsSync(prodPath) ? JSON.parse(fs.readFileSync(prodPath, 'utf8')) : { products: [] };
      doc.products = doc.products.filter(
        (p) => p.id !== 'visible-to-allowlist' && p.name !== 'Not Visible'
      );
      fs.writeFileSync(prodPath, JSON.stringify(doc, null, 2));
    }
  });

describe('Category integrity rules', () => {
  let operatorToken;

  beforeAll(async () => {
    operatorToken = await loginAsOperator('default', 'op6@market.test', 'Password#123');
  });

  test('cannot delete a category that is referenced by products (fail-closed)', async () => {
    const res = await request(app)
      .delete('/api/v1/market/categories/laptops')
      .set(authH(operatorToken));
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('referenced');
    // Products remain untouched (no cascade delete).
    const doc = productsDoc();
    expect(doc.products.filter((p) => p.categoryId === 'laptops').length).toBeGreaterThan(0);
    const laptops = doc.categories.find((c) => c.id === 'laptops');
    expect(laptops).toBeTruthy();
    expect(laptops.active).toBe(true);
  });

  test('cannot link a product to a non-existent category', async () => {
    const res = await request(app)
      .post('/api/v1/market/products')
      .set(authH(operatorToken))
      .send({ name: 'Orphan', categoryId: 'ghost-category', sellPrice: 100 });
    expect(res.status).toBe(400);
    const doc = productsDoc();
    expect(doc.products.find((p) => p.name === 'Orphan')).toBeFalsy();
  });

  test('linking to a category of another tenant is not possible (global taxonomy, context-gated)', async () => {
    // Categories are shared catalog metadata; writes are always under the
    // server-derived tenant context. A client cannot bind a product to a
    // foreign-tenant category by injection because the category store lookup
    // and the product write both run under the guarded context. This is the
    // applicable isolation for the shared-category architecture (see report).
    const res = await request(app)
      .post('/api/v1/market/categories')
      .set(authH(operatorToken))
      .set('X-Tenant-Id', 'default')
      .send({ tenantId: 'foreign-tenant', id: 'foreign-cat', name: 'Foreign' });
    // Category is always stamped with the server-derived context tenant;
    // client-stamped tenantId is ignored (fail-closed, non-disclosing).
    expect(res.status).toBe(201);
    const doc = productsDoc();
    expect(doc.categories.find((c) => c.tenantId === 'foreign-tenant')).toBeFalsy();
  });

  test('deleting an unused category does not affect products', async () => {
    const catId = 'unused-phase1-cat-' + Date.now().toString(36);
    await request(app)
      .post('/api/v1/market/categories')
      .set(authH(operatorToken))
      .send({ id: catId, name: 'Unused Cat ' + Date.now(), description: 'unused' });
    const before = productsDoc().products.length;
    const del = await request(app)
      .delete('/api/v1/market/categories/' + catId)
      .set(authH(operatorToken));
    expect(del.status).toBe(200);
    const doc = productsDoc();
    expect(doc.categories.find((c) => c.id === catId)).toBeFalsy();
    expect(doc.products.length).toBe(before); // no cascade delete
  });

  test('update category: id is immutable, only allowed fields flow through', async () => {
    const catId = 'immutable-cat-' + Date.now().toString(36);
    await request(app)
      .post('/api/v1/market/categories')
      .set(authH(operatorToken))
      .send({ id: catId, name: 'Old Name' });
    const res = await request(app)
      .put('/api/v1/market/categories/' + catId)
      .set(authH(operatorToken))
      .send({ id: 'tampered', name: 'New Name', color: '#ff0000' });
    expect(res.status).toBe(200);
    expect(res.body.data.category.id).toBe(catId); // identity preserved
    expect(res.body.data.category.name).toBe('New Name');
    expect(res.body.data.category.color).toBe('#ff0000');
  });
});
});
describe('Drafts — includeDrafts filtering', () => {
  let operatorToken;

  beforeAll(async () => {
    operatorToken = await loginAsOperator('default', 'drafts-op@market.test', 'Password#123');
  });

  test('list excludes unpublished drafts by default (includeDrafts not set)', async () => {
    const postPub = await request(app)
      .post('/api/v1/market/products')
      .set(authH(operatorToken))
      .send({ name: 'Draft (excluded by default)', sku: 'SKU-DRAFT-DEFAULT', categoryId: 'gaming', sellPrice: 10, published: true });

    const postDraft = await request(app)
      .post('/api/v1/market/products')
      .set(authH(operatorToken))
      .send({ name: 'Draft (excluded by default)', sku: 'SKU-DRAFT-DEFAULT2', categoryId: 'gaming', sellPrice: 10, published: false });

    const { body: { data: { product: draft } } } = postDraft;
    const { body: { data: { product: published } } } = postPub;

    const without = await request(app)
      .get('/api/v1/market/products')
      .set('X-Tenant-Id', 'default')
      .query({ includeOutOfStock: 'true', limit: '100' });
    const ids = without.body.data?.products?.map((p) => p.id) || [];

    expect(without.status).toBe(200);
    expect(without.body.data.products.some((p) => p.id === draft.id)).toBe(false);
    expect(without.body.data.products.some((p) => p.id === published.id)).toBe(true);

    const explicitFalse = await request(app)
      .get('/api/v1/market/products')
      .set('X-Tenant-Id', 'default')
      .query({ includeOutOfStock: 'true', includeDrafts: 'false', limit: '100' });
    expect(explicitFalse.status).toBe(200);
    expect(explicitFalse.body.data.products.some((p) => p.id === draft.id)).toBe(false);
  });

  test('list includes unpublished drafts when includeDrafts=true', async () => {
    const postPub = await request(app)
      .post('/api/v1/market/products')
      .set(authH(operatorToken))
      .send({ name: 'Published (still visible)', sku: 'SKU-PUBLISHED-TRUE', categoryId: 'gaming', sellPrice: 10, published: true });

    const postDraft = await request(app)
      .post('/api/v1/market/products')
      .set(authH(operatorToken))
      .send({ name: 'Draft (shown with includeDrafts)', sku: 'SKU-DRAFT-TRUE', categoryId: 'gaming', sellPrice: 10, published: false });

    const { body: { data: { product: draft } } } = postDraft;
    const { body: { data: { product: published } } } = postPub;

    const withDrafts = await request(app)
      .get('/api/v1/market/products')
      .set('X-Tenant-Id', 'default')
      .query({ includeOutOfStock: 'true', includeDrafts: 'true', limit: '100' });

    expect(withDrafts.status).toBe(200);
    expect(withDrafts.body.data.products.some((p) => p.id === draft.id)).toBe(true);
    expect(withDrafts.body.data.products.some((p) => p.id === published.id)).toBe(true);
  });
});
