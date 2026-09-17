// Metrics API integration tests + ETag behavior on GET endpoints.
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { createUser, login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

let server;
let dataDir;
let accessToken;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  dataDir = makeTempDataDir('metrics-it');
  server = await startServer(dataDir);
  await createUser(server.app, { username: 'metadmin', password: 'MetAdmin#1', fullName: 'Met Admin', role: 'Admin' });
  const loginData = await login(server.app, 'metadmin', 'MetAdmin#1');
  accessToken = loginData.accessToken;
});

describe('Metrics API Endpoints', () => {
  test('GET /api/v1/metrics requires authentication', async () => {
    const res = await request(server.app).get('/api/v1/metrics');
    expect(res.statusCode).toBe(401);
  });

  test('GET /api/v1/metrics returns Prometheus text', async () => {
    const res = await request(server.app)
      .get('/api/v1/metrics')
      .set(authHeader(accessToken));

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(typeof res.text).toBe('string');
    expect(res.text.length).toBeGreaterThan(0);
  });

  test('GET /api/v1/metrics/json returns structured metrics', async () => {
    const res = await request(server.app)
      .get('/api/v1/metrics/json')
      .set(authHeader(accessToken));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('counters');
    expect(res.body.data).toHaveProperty('gauges');
    expect(res.body.data).toHaveProperty('histograms');
  });

  test('Metrics reflect API traffic', async () => {
    // Generate some traffic
    await request(server.app).get('/api/v1/health');
    const res = await request(server.app)
      .get('/api/v1/metrics/json')
      .set(authHeader(accessToken));
    const counters = Object.values(res.body.data.counters);
    const total = counters.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
  });
});

describe('ETag / Conditional Requests', () => {
  test('GET endpoints include ETag header', async () => {
    const res = await request(server.app)
      .get('/api/v1/sales')
      .set(authHeader(accessToken));

    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toBeTruthy();
  });

  test('Conditional request returns 304 on match', async () => {
    const res1 = await request(server.app)
      .get('/api/v1/sales')
      .set(authHeader(accessToken));
    const etag = res1.headers.etag;

    const res2 = await request(server.app)
      .get('/api/v1/sales')
      .set(authHeader(accessToken))
      .set('If-None-Match', etag);

    expect(res2.statusCode).toBe(304);
    expect(res2.body).toEqual({});
  });

  test('ETag changes after data mutation', async () => {
    const before = await request(server.app)
      .get('/api/v1/sales')
      .set(authHeader(accessToken));
    const etagBefore = before.headers.etag;

    await request(server.app)
      .post('/api/v1/sales')
      .send({ id: 'INV-ETAG-1', items: [{ productId: 'p1', qty: 1, price: 10 }], total: 10, customer: 'X', payment: 'cash' });

    const after = await request(server.app)
      .get('/api/v1/sales')
      .set(authHeader(accessToken));
    expect(after.headers.etag).not.toBe(etagBefore);
  });
});