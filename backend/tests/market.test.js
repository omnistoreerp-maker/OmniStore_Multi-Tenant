// OmniStore Market (Phase F) end-to-end tests:
// public catalog, customer auth, atomic checkout/stock, tracking, isolation.
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const TENANT = 'default';
let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

function seedProduct(id, name, sellPrice, stockQty) {
  const file = path.join(dataDir, 'products.json');
  const db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { products: [] };
  if (!db.products) db.products = [];
  db.products.push({ id, name, sku: 'SKU-' + id, sellPrice, stockQty, categoryId: 'cat1' });
  fs.writeFileSync(file, JSON.stringify(db, null, 2));
}

function seedCoupon(code, type, value, minSubtotal, maxDiscount) {
  const file = path.join(dataDir, 'marketConfig.json');
  const db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { configs: [] };
  const cfg = db.configs.find((c) => String(c.tenantId) === TENANT);
  if (!cfg) return;
  if (!cfg.coupons) cfg.coupons = [];
  cfg.coupons.push({ code, type, value, minSubtotal: minSubtotal || 0, maxDiscount: maxDiscount || 0, active: true });
  fs.writeFileSync(file, JSON.stringify(db, null, 2));
}

function readJson(name) {
  const file = path.join(dataDir, name + '.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

beforeAll(async () => {
  dataDir = makeTempDataDir('market');
  server = await startServer(dataDir);
  seedProduct('P1', 'Widget A', 50, 100);
  seedProduct('P2', 'Widget B', 100, 50);
});

describe('Public catalog', () => {
  test('GET /products requires a known tenant (404 on unknown)', async () => {
    const res = await request(server.app).get('/api/v1/market/products').query({ tenant: 'ghost' });
    expect(res.statusCode).toBe(404);
  });

  test('GET /products returns projected safe products', async () => {
    const res = await request(server.app).get('/api/v1/market/products').query({ tenant: TENANT });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data.products)).toBe(true);
    const p = res.body.data.products.find((x) => x.id === 'P1');
    expect(p).toBeTruthy();
    expect(p.price).toBe(50);
    expect(p.stockQty).toBe(100);
    expect(p.password).toBeUndefined();
  });

  test('GET /products/:id returns a single product', async () => {
    const res = await request(server.app).get('/api/v1/market/products/P1').query({ tenant: TENANT });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.id).toBe('P1');
  });

  test('GET /categories and /availability', async () => {
    const c = await request(server.app).get('/api/v1/market/categories').query({ tenant: TENANT });
    expect(c.statusCode).toBe(200);
    const a = await request(server.app).get('/api/v1/market/availability').query({ tenant: TENANT, ids: 'P1,P2' });
    expect(a.statusCode).toBe(200);
    expect(a.body.data.availability.find((x) => x.id === 'P1').stockQty).toBe(100);
  });
});

describe('Customer authentication', () => {
  test('register creates a customer and returns a token', async () => {
    const res = await request(server.app)
      .post('/api/v1/market/auth/register')
      .set('X-Tenant-Id', TENANT)
      .send({ email: 'buyer@test.com', name: 'Buyer', password: 'Secret123', phone: '123' });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.customer.email).toBe('buyer@test.com');
    expect(res.body.data.customer.passwordHash).toBeUndefined();
  });

  test('register rejects weak password', async () => {
    const res = await request(server.app)
      .post('/api/v1/market/auth/register')
      .set('X-Tenant-Id', TENANT)
      .send({ email: 'weak@test.com', password: 'short' });
    expect(res.statusCode).toBe(400);
  });

  test('register rejects duplicate email', async () => {
    const res = await request(server.app)
      .post('/api/v1/market/auth/register')
      .set('X-Tenant-Id', TENANT)
      .send({ email: 'buyer@test.com', password: 'Secret123' });
    expect(res.statusCode).toBe(400);
  });

  test('login returns token for valid credentials', async () => {
    const res = await request(server.app)
      .post('/api/v1/market/auth/login')
      .set('X-Tenant-Id', TENANT)
      .send({ email: 'buyer@test.com', password: 'Secret123' });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.token).toBeTruthy();
  });

  test('login rejects wrong password', async () => {
    const res = await request(server.app)
      .post('/api/v1/market/auth/login')
      .set('X-Tenant-Id', TENANT)
      .send({ email: 'buyer@test.com', password: 'wrongpass' });
    expect(res.statusCode).toBe(401);
  });

  test('me requires a valid customer token', async () => {
    const loginRes = await request(server.app)
      .post('/api/v1/market/auth/login')
      .set('X-Tenant-Id', TENANT)
      .send({ email: 'buyer@test.com', password: 'Secret123' });
    const token = loginRes.body.data.token;
    const me = await request(server.app)
      .get('/api/v1/market/auth/me')
      .set('X-Tenant-Id', TENANT)
      .set('Authorization', 'Bearer ' + token);
    expect(me.statusCode).toBe(200);
    expect(me.body.data.customer.email).toBe('buyer@test.com');
    const noAuth = await request(server.app).get('/api/v1/market/auth/me').set('X-Tenant-Id', TENANT);
    expect(noAuth.statusCode).toBe(401);
  });
});

describe('Checkout + inventory authority', () => {
  test('guest checkout decrements stock, creates sale + transaction atomically', async () => {
    const before = readJson('products').products.find((p) => p.id === 'P1').stockQty;
    const res = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT)
      .send({
        items: [{ productId: 'P1', qty: 2 }],
        shippingZoneId: 'standard',
        paymentMethodId: 'cod',
        couponCode: 'WELCOME10',
        customerInfo: { name: 'Guest', email: 'guest@test.com' }
      });
    expect(res.statusCode).toBe(201);
    const order = res.body.data.order;
    expect(order.total).toBe(2 * 50 - 10 + 10); // 100 - 10 discount + 10 shipping
    expect(order.paymentStatus).toBe('pending');
    expect(order.trackingToken).toBeTruthy();

    const after = readJson('products').products.find((p) => p.id === 'P1').stockQty;
    expect(after).toBe(before - 2);

    const tx = readJson('inventoryTransactions');
    expect(tx.transactions.some((t) => t.productId === 'P1' && t.type === 'out' && t.qty === 2)).toBe(true);

    const sales = readJson('sales');
    expect(sales.invoices.some((i) => i.id === order.saleId && i.invoiceType === 'market')).toBe(true);
  });

  test('checkout rejects oversell (409) and does NOT decrement stock', async () => {
    const before = readJson('products').products.find((p) => p.id === 'P2').stockQty;
    const res = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT)
      .send({ items: [{ productId: 'P2', qty: 999 }], shippingZoneId: 'standard', paymentMethodId: 'cod' });
    expect(res.statusCode).toBe(409);
    const after = readJson('products').products.find((p) => p.id === 'P2').stockQty;
    expect(after).toBe(before);
  });

  test('server ignores client-supplied totals (price tampering)', async () => {
    const res = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT)
      .send({
        items: [{ productId: 'P1', qty: 1, price: 0.01, total: 0.01 }],
        shippingZoneId: 'standard',
        paymentMethodId: 'cod'
      });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.order.total).toBe(50 + 10); // server price, no discount, +10 shipping
  });

  test('idempotency key returns the same order on replay', async () => {
    const body = {
      items: [{ productId: 'P1', qty: 1 }],
      shippingZoneId: 'standard',
      paymentMethodId: 'cod',
      idempotencyKey: 'idem-xyz'
    };
    const r1 = await request(server.app).post('/api/v1/market/checkout').set('X-Tenant-Id', TENANT).send(body);
    const r2 = await request(server.app).post('/api/v1/market/checkout').set('X-Tenant-Id', TENANT).send(body);
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect(r2.body.data.idempotent).toBe(true);
    expect(r2.body.data.order.id).toBe(r1.body.data.order.id);
  });

  test('rejects checkout when discount exceeds subtotal + shipping (negative total)', async () => {
    seedProduct('P3', 'Cheap Widget', 1, 100);
    seedCoupon('OVERDUE', 'fixed', 20, 0, 0);
    const res = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT)
      .send({
        items: [{ productId: 'P3', qty: 1 }],
        shippingZoneId: 'standard',
        paymentMethodId: 'cod',
        couponCode: 'OVERDUE'
      });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/Invalid order total/i);
  });
});

describe('Order tracking + isolation', () => {
  test('track returns public-safe status for a valid token', async () => {
    const co = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT)
      .send({ items: [{ productId: 'P1', qty: 1 }], shippingZoneId: 'standard', paymentMethodId: 'cod' });
    const token = co.body.data.order.trackingToken;
    const res = await request(server.app).get('/api/v1/market/track/' + token);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.orderCode).toBeTruthy();
    expect(res.body.data.customerEmail).toBeUndefined();
  });

  test('track returns 404 for unknown token', async () => {
    const res = await request(server.app).get('/api/v1/market/track/deadbeef');
    expect(res.statusCode).toBe(404);
  });

  test('customer order isolation: myOrders only shows own orders', async () => {
    const reg = await request(server.app)
      .post('/api/v1/market/auth/register')
      .set('X-Tenant-Id', TENANT)
      .send({ email: 'iso@test.com', password: 'Secret123' });
    const token = reg.body.data.token;
    await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT)
      .set('Authorization', 'Bearer ' + token)
      .send({ items: [{ productId: 'P1', qty: 1 }], shippingZoneId: 'standard', paymentMethodId: 'cod' });
    const res = await request(server.app)
      .get('/api/v1/market/orders')
      .set('X-Tenant-Id', TENANT)
      .set('Authorization', 'Bearer ' + token);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data.orders)).toBe(true);
    expect(res.body.data.orders.length).toBeGreaterThanOrEqual(1);
    res.body.data.orders.forEach((o) => expect(o.customerId).toBe(reg.body.data.customer.id));
  });

  test('IDOR: cannot read another customer order via /orders/:id', async () => {
    const regA = await request(server.app)
      .post('/api/v1/market/auth/register')
      .set('X-Tenant-Id', TENANT)
      .send({ email: 'userA@test.com', password: 'Secret123' });
    const regB = await request(server.app)
      .post('/api/v1/market/auth/register')
      .set('X-Tenant-Id', TENANT)
      .send({ email: 'userB@test.com', password: 'Secret123' });
    const orderA = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT)
      .set('Authorization', 'Bearer ' + regA.body.data.token)
      .send({ items: [{ productId: 'P1', qty: 1 }], shippingZoneId: 'standard', paymentMethodId: 'cod' });
    const orderId = orderA.body.data.order.id;
    const res = await request(server.app)
      .get('/api/v1/market/orders/' + orderId)
      .set('X-Tenant-Id', TENANT)
      .set('Authorization', 'Bearer ' + regB.body.data.token);
    expect(res.statusCode).toBe(404);
  });
});

describe('Static market frontend', () => {
  test('serves market.html', async () => {
    const res = await request(server.app).get('/market.html');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('OmniStore Market');
  });

  test('serves market js bundle', async () => {
    const res = await request(server.app).get('/market/js/app.js');
    expect(res.statusCode).toBe(200);
  });
});
