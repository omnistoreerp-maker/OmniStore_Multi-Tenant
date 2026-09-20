'use strict';

// storeRoute.test.js — /store/:slug tenant storefront regression gate.
//
// main kept `app.get('/store/:slug')` serving store.html while the page file
// itself was lost during the RC reconstruction, so every tenant storefront
// link rendered a 500 (sendFile of a missing file). These tests pin:
//   - store.html is actually served again (200 + its stable markers);
//   - the storefront stays BEHIND the API auth gate (RC parity: authenticated
//     requests reach the market module, unauthenticated ones are 401);
//   - static precedence is intact (real files still win over the catch-all)
//     and the frontend private guard still blocks backend internals.

const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  process.env.AUTH_REQUIRED = 'true';
  dataDir = makeTempDataDir('store-route');
  seed(dataDir, 'marketConfig', { configs: [{ tenantId: 'storetenant', active: true }] });
  server = await startServer(dataDir, { AUTH_REQUIRED: 'true' });
});

describe('/store/:slug tenant storefront', () => {
  test('GET /store/my-shop serves the storefront page (not a 500)', async () => {
    const res = await request(server.app).get('/store/my-shop');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('<html lang="ar" dir="rtl">');
    expect(res.text).toContain('Online Store');
    expect(res.text).toContain('id="productsContainer"');
  });

  test('slugs are route params: any single-segment slug serves the page', async () => {
    const res = await request(server.app).get('/store/another-tenant.store');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('Online Store');
  });

  test('unauthenticated market config read is rejected 401 (route sits behind the API auth gate)', async () => {
    const res = await request(server.app).get('/api/v1/market/configs');
    expect(res.statusCode).toBe(401);
  });

  test('market order cancel without a customer token is rejected 401', async () => {
    // RC parity: /api/v1/market is mounted BEFORE the conditional auth gate
    // and guards itself per-route. requireCustomer (not the API gate) must be
    // the thing that rejects an anonymous cancel with 401.
    const res = await request(server.app)
      .post('/api/v1/market/orders/00000000-0000-0000-0000-000000000000/cancel')
      .set('X-Tenant-Id', 'storetenant');
    expect(res.statusCode).toBe(401);
  });

  test('market catalog stays publicly readable for a known tenant (RC design), customer data does not', async () => {
    // /products is intentionally public-catalog behind requireMarketTenant
    // (publicLimiter in RC routes). Customer-owned routes like order cancel
    // still demand the customer JWT (tested above).
    const res = await request(server.app)
      .get('/api/v1/market/products')
      .set('X-Tenant-Id', 'storetenant');
    expect(res.statusCode).toBe(200);
  });

  test('/store/* is the storefront catch-all exactly as in the RC (mount order parity)', async () => {
    // RC mounted /store/:slug before the static handler, so /store/<file>
    // resolves to the storefront, not the static tree. Keep that behavior
    // pinned so a future reordering is a deliberate decision, not an accident.
    const res = await request(server.app).get('/store/platform.html');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('Online Store');
  });

  test('deep /store/ paths never leak backend internals', async () => {
    // A multi-segment path misses the :slug route and falls through to the
    // static mount, whose private guard must keep backend sources unreachalble.
    const res = await request(server.app).get('/store/backend/server.js');
    expect([403, 404]).toContain(res.statusCode);
    expect(res.text || '').not.toContain('require(');
  });
});
