// Endpoint tests for Dashboard (cached summaries) and Reports:
// CRUD, validation 400s, 404s, filters, stats.
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');
const { createUser, login, authHeader } = require('./helpers/authHelper');

const DASH = '/api/v1/dashboard';
const REPORTS = '/api/v1/reports';
let server;
let dataDir;
let token;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  dataDir = makeTempDataDir('dash-reports');
  server = await startServer(dataDir);
  await createUser(server.app, { username: 'dash-tester', password: 'Dash#1234', role: 'Owner' });
  const session = await login(server.app, 'dash-tester', 'Dash#1234');
  token = session.accessToken;
  await request(server.app).post(DASH).set(authHeader(token)).send({ id: 'dash-1', key: 'sales-summary', title: 'Sales Summary', period: 'monthly', user: 'admin', data: { total: 1000 } });
  await request(server.app).post(DASH).set(authHeader(token)).send({ id: 'dash-2', key: 'stock-summary', title: 'Stock Summary', period: 'weekly' });
  await request(server.app).post(REPORTS).set(authHeader(token)).send({ id: 'rpt-1', type: 'sales', title: 'July Sales', month: '2026-07', user: 'admin', data: { rows: 10 } });
  await request(server.app).post(REPORTS).set(authHeader(token)).send({ id: 'rpt-2', type: 'inventory', title: 'July Stock', month: '2026-07' });
});

describe('Dashboard CRUD', () => {
  test('POST creates an entry (201)', async () => {
    const res = await request(server.app).post(DASH).set(authHeader(token)).send({ id: 'dash-3', key: 'profit-summary', title: 'Profit' });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.id).toBe('dash-3');
    expect(res.body.data.createdAt).toBeTruthy();
  });

  test('POST without key returns 400', async () => {
    const res = await request(server.app).post(DASH).set(authHeader(token)).send({ title: 'No key' });
    expect(res.statusCode).toBe(400);
  });

  test('GET list returns entries', async () => {
    const res = await request(server.app).get(DASH).set(authHeader(token));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.dashboard.length).toBeGreaterThanOrEqual(3);
    expect(typeof res.body.data.total).toBe('number');
  });

  test('GET by id returns the entry', async () => {
    const res = await request(server.app).get(`${DASH}/dash-1`).set(authHeader(token));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.key).toBe('sales-summary');
    expect(res.body.data.data.total).toBe(1000);
  });

  test('GET by unknown id returns 404', async () => {
    const res = await request(server.app).get(`${DASH}/dash-999`).set(authHeader(token));
    expect(res.statusCode).toBe(404);
  });

  test('filter by key', async () => {
    const res = await request(server.app).get(`${DASH}?key=stock-summary`).set(authHeader(token));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.dashboard).toHaveLength(1);
    expect(res.body.data.dashboard[0].id).toBe('dash-2');
  });

  test('filter by period', async () => {
    const res = await request(server.app).get(`${DASH}?period=weekly`).set(authHeader(token));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.dashboard).toHaveLength(1);
  });

  test('PUT updates the cached data', async () => {
    const res = await request(server.app).put(`${DASH}/dash-3`).set(authHeader(token)).send({ data: { total: 42 } });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.data.total).toBe(42);
  });

  test('PUT with unknown id returns 404', async () => {
    const res = await request(server.app).put(`${DASH}/dash-999`).set(authHeader(token)).send({ title: 'x' });
    expect(res.statusCode).toBe(404);
  });

  test('stats returns count, withData and keys', async () => {
    const res = await request(server.app).get(`${DASH}/stats`).set(authHeader(token));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.count).toBe(3);
    expect(res.body.data.withData).toBe(2);
    expect(res.body.data.keys['sales-summary']).toBe(1);
  });

  test('DELETE removes the entry', async () => {
    const res = await request(server.app).delete(`${DASH}/dash-3`).set(authHeader(token));
    expect(res.statusCode).toBe(200);
    const after = await request(server.app).get(`${DASH}/dash-3`).set(authHeader(token));
    expect(after.statusCode).toBe(404);
  });

  test('DELETE with unknown id returns 404', async () => {
    const res = await request(server.app).delete(`${DASH}/dash-999`).set(authHeader(token));
    expect(res.statusCode).toBe(404);
  });
});

describe('Reports CRUD', () => {
  test('POST creates a report (201)', async () => {
    const res = await request(server.app).post(REPORTS).set(authHeader(token)).send({ id: 'rpt-3', type: 'treasury', title: 'July Treasury' });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.id).toBe('rpt-3');
    expect(res.body.data.createdAt).toBeTruthy();
  });

  test('POST without type returns 400', async () => {
    const res = await request(server.app).post(REPORTS).set(authHeader(token)).send({ title: 'No type' });
    expect(res.statusCode).toBe(400);
  });

  test('GET list returns reports', async () => {
    const res = await request(server.app).get(REPORTS).set(authHeader(token));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.reports.length).toBeGreaterThanOrEqual(3);
    expect(typeof res.body.data.total).toBe('number');
  });

  test('GET by id returns the report', async () => {
    const res = await request(server.app).get(`${REPORTS}/rpt-1`).set(authHeader(token));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.type).toBe('sales');
    expect(res.body.data.data.rows).toBe(10);
  });

  test('GET by unknown id returns 404', async () => {
    const res = await request(server.app).get(`${REPORTS}/rpt-999`).set(authHeader(token));
    expect(res.statusCode).toBe(404);
  });

  test('filter by type', async () => {
    const res = await request(server.app).get(`${REPORTS}?type=inventory`).set(authHeader(token));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.reports).toHaveLength(1);
    expect(res.body.data.reports[0].id).toBe('rpt-2');
  });

  test('filter by month', async () => {
    const res = await request(server.app).get(`${REPORTS}?month=2026-07`).set(authHeader(token));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.reports.length).toBeGreaterThanOrEqual(2);
  });

  test('search matches titles', async () => {
    const res = await request(server.app).get(`${REPORTS}?search=stock`).set(authHeader(token));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.reports.some(r => r.id === 'rpt-2')).toBe(true);
  });

  test('PUT updates the report', async () => {
    const res = await request(server.app).put(`${REPORTS}/rpt-3`).set(authHeader(token)).send({ title: 'July Treasury v2' });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.title).toBe('July Treasury v2');
  });

  test('PUT with unknown id returns 404', async () => {
    const res = await request(server.app).put(`${REPORTS}/rpt-999`).set(authHeader(token)).send({ title: 'x' });
    expect(res.statusCode).toBe(404);
  });

  test('stats returns count, withData and types', async () => {
    const res = await request(server.app).get(`${REPORTS}/stats`).set(authHeader(token));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.count).toBe(3);
    expect(res.body.data.withData).toBe(1);
    expect(res.body.data.types.sales).toBe(1);
    expect(res.body.data.types.inventory).toBe(1);
    expect(res.body.data.types.treasury).toBe(1);
  });

  test('DELETE removes the report', async () => {
    const res = await request(server.app).delete(`${REPORTS}/rpt-3`).set(authHeader(token));
    expect(res.statusCode).toBe(200);
    const after = await request(server.app).get(`${REPORTS}/rpt-3`).set(authHeader(token));
    expect(after.statusCode).toBe(404);
  });

  test('DELETE with unknown id returns 404', async () => {
    const res = await request(server.app).delete(`${REPORTS}/rpt-999`).set(authHeader(token));
    expect(res.statusCode).toBe(404);
  });
});
