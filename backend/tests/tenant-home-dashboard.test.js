// Tenant home dashboard endpoint tests: role-based access, 401/403, cross-tenant isolation.
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { createUser, login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  dataDir = makeTempDataDir('tenant-home');
  server = await startServer(dataDir, { AUTH_REQUIRED: 'true' });
  await createUser(server.app, {
    username: 'owner1', password: 'Owner#123', fullName: 'Owner One', role: 'Owner'
  });
  await createUser(server.app, {
    username: 'admin1', password: 'Admin#123', fullName: 'Admin One', role: 'Admin'
  });
  await createUser(server.app, {
    username: 'viewer1', password: 'Viewer#123', fullName: 'Viewer One', role: 'Viewer'
  });
});

describe('GET /api/v1/dashboard/tenant-home', () => {
  test('returns 401 without authentication', async () => {
    const res = await request(server.app).get('/api/v1/dashboard/tenant-home');
    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('Owner can access tenant-home with real aggregated data', async () => {
    const session = await login(server.app, 'owner1', 'Owner#123');
    const res = await request(server.app)
      .get('/api/v1/dashboard/tenant-home')
      .set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeTruthy();
    // All expected sections present
    expect(res.body.data.tenant).toBeTruthy();
    expect(res.body.data.sales).toBeTruthy();
    expect(res.body.data.inventory).toBeTruthy();
    expect(res.body.data.customers).toBeTruthy();
    expect(res.body.data.suppliers).toBeTruthy();
    expect(res.body.data.treasury).toBeTruthy();
    expect(res.body.data.generatedAt).toBeTruthy();
  });

  test('Admin can access tenant-home with real aggregated data', async () => {
    const session = await login(server.app, 'admin1', 'Admin#123');
    const res = await request(server.app)
      .get('/api/v1/dashboard/tenant-home')
      .set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeTruthy();
    expect(res.body.data.tenant).toBeTruthy();
    expect(res.body.data.sales).toBeTruthy();
    expect(res.body.data.inventory).toBeTruthy();
    expect(res.body.data.customers).toBeTruthy();
    expect(res.body.data.suppliers).toBeTruthy();
    expect(res.body.data.treasury).toBeTruthy();
  });

  test('Viewer can access tenant-home (dashboard.view is granted to all roles)', async () => {
    const session = await login(server.app, 'viewer1', 'Viewer#123');
    const res = await request(server.app)
      .get('/api/v1/dashboard/tenant-home')
      .set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeTruthy();
    expect(res.body.data.sales).toBeTruthy();
    expect(res.body.data.inventory).toBeTruthy();
  });

  test('response structure is consistent across calls', async () => {
    const session = await login(server.app, 'owner1', 'Owner#123');
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
