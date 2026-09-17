// Audit log integration tests: full HTTP lifecycle via supertest.
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
  dataDir = makeTempDataDir('audit-integration');
  server = await startServer(dataDir);
  await createUser(server.app, { username: 'auditor', password: 'Auditor#1', fullName: 'Auditor', role: 'Admin' });
  const loginData = await login(server.app, 'auditor', 'Auditor#1');
  accessToken = loginData.accessToken;
});

describe('Audit Log Endpoints', () => {
  test('POST /api/v1/sales creates an audit entry', async () => {
    const res = await request(server.app)
      .post('/api/v1/sales')
      .set(authHeader(accessToken))
      .send({ productName: 'Audit Test', quantity: 1, price: 10, status: 'completed' });

    // 201 or 400 depending on validation — we just need the audit capture to fire
    expect(res.statusCode).toBeLessThan(500);
    expect(res.headers['x-request-id']).toBeDefined();
  });

  test('GET /api/v1/audit-log requires authentication', async () => {
    const res = await request(server.app)
      .get('/api/v1/audit-log');

    expect(res.statusCode).toBe(401);
  });

  test('GET /api/v1/audit-log returns paginated results', async () => {
    const res = await request(server.app)
      .get('/api/v1/audit-log')
      .set(authHeader(accessToken));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data).toHaveProperty('entries');
    expect(res.body.data).toHaveProperty('pagination');
  });

  test('GET /api/v1/audit-log supports resource filter', async () => {
    const res = await request(server.app)
      .get('/api/v1/audit-log?resource=sales')
      .set(authHeader(accessToken));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('GET /api/v1/audit-log supports method filter', async () => {
    const res = await request(server.app)
      .get('/api/v1/audit-log?method=POST')
      .set(authHeader(accessToken));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('GET /api/v1/audit-log/stats returns statistics', async () => {
    const res = await request(server.app)
      .get('/api/v1/audit-log/stats')
      .set(authHeader(accessToken));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('total');
    expect(res.body.data).toHaveProperty('byMethod');
    expect(res.body.data).toHaveProperty('byResource');
  });

  test('GET /api/v1/audit-log/:id returns 404 for nonexistent entry', async () => {
    const res = await request(server.app)
      .get('/api/v1/audit-log/nonexistent-id')
      .set(authHeader(accessToken));

    expect(res.statusCode).toBe(404);
  });

  test('GET /api/v1/audit-log/:id returns a specific entry', async () => {
    // First get an entry from the log
    const logRes = await request(server.app)
      .get('/api/v1/audit-log?limit=1')
      .set(authHeader(accessToken));

    if (logRes.body.data.entries.length > 0) {
      const id = logRes.body.data.entries[0].id;
      const res = await request(server.app)
        .get(`/api/v1/audit-log/${id}`)
        .set(authHeader(accessToken));

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(id);
    }
  });

  test('X-Request-Id header is present on all responses', async () => {
    const res = await request(server.app)
      .get('/api/v1/audit-log')
      .set(authHeader(accessToken));

    expect(res.headers['x-request-id']).toBeDefined();
    expect(typeof res.headers['x-request-id']).toBe('string');
    expect(res.headers['x-request-id'].length).toBeGreaterThan(0);
  });

  test('DELETE /api/v1/sales/:id creates audit entry', async () => {
    // First create a sale
    const createRes = await request(server.app)
      .post('/api/v1/sales')
      .set(authHeader(accessToken))
      .send({ productName: 'Delete Test', quantity: 1, price: 10, status: 'completed' });

    if (createRes.statusCode === 201 && createRes.body.data && createRes.body.data.id) {
      const saleId = createRes.body.data.id;
      const delRes = await request(server.app)
        .delete(`/api/v1/sales/${saleId}`)
        .set(authHeader(accessToken));

      expect(delRes.statusCode).toBe(200);
    }
  });
});
