// Endpoint tests for the Sales module:
// CRUD, validation 400s, 404s, stats, and search/filter parameters.
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const PATH = '/api/v1/sales';
let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  dataDir = makeTempDataDir('sales');
  server = await startServer(dataDir);
  await request(server.app).post(PATH).send({
    id: 'INV-900001',
    items: [{ productId: 'p1', qty: 2, price: 50 }],
    total: 100,
    customer: 'Ahmed Ali',
    payment: 'cash',
    profit: 20,
    date: '2026-07-01T10:00:00.000Z'
  });
  await request(server.app).post(PATH).send({
    id: 'INV-900002',
    items: [{ productId: 'p2', qty: 1, price: 200 }],
    total: 200,
    customer: 'Mona Said',
    payment: 'credit',
    profit: 60,
    date: '2026-07-05T10:00:00.000Z'
  });
});

describe('Sales CRUD', () => {
  test('POST creates an invoice (201) with timestamps', async () => {
    const res = await request(server.app).post(PATH).send({
      id: 'INV-900003',
      items: [{ productId: 'p3', qty: 3, price: 10 }],
      total: 30
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.id).toBe('INV-900003');
    expect(res.body.data.createdAt).toBeTruthy();
    expect(res.body.data.updatedAt).toBeTruthy();
  });

  test('POST without items returns 400', async () => {
    const res = await request(server.app).post(PATH).send({ total: 10 });
    expect(res.statusCode).toBe(400);
  });

  test('POST with empty items returns 400', async () => {
    const res = await request(server.app).post(PATH).send({ items: [], total: 10 });
    expect(res.statusCode).toBe(400);
  });

  test('POST with non-number total returns 400', async () => {
    const res = await request(server.app).post(PATH).send({ items: [{ qty: 1 }], total: 'x' });
    expect(res.statusCode).toBe(400);
  });

  test('POST with a duplicate id returns 400', async () => {
    const res = await request(server.app).post(PATH).send({
      id: 'INV-900001',
      items: [{ qty: 1 }],
      total: 5
    });
    expect(res.statusCode).toBe(400);
  });

  test('GET list returns invoices with pagination metadata', async () => {
    const res = await request(server.app).get(PATH);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data.invoices)).toBe(true);
    expect(res.body.data.invoices.length).toBeGreaterThanOrEqual(3);
    expect(typeof res.body.data.total).toBe('number');
  });

  test('GET by id returns the invoice', async () => {
    const res = await request(server.app).get(`${PATH}/INV-900001`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.customer).toBe('Ahmed Ali');
  });

  test('GET by unknown id returns 404', async () => {
    const res = await request(server.app).get(`${PATH}/INV-000000`);
    expect(res.statusCode).toBe(404);
  });

  test('PUT updates the invoice', async () => {
    const res = await request(server.app).put(`${PATH}/INV-900003`).send({ customer: 'Updated Customer' });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.customer).toBe('Updated Customer');
    expect(res.body.data.id).toBe('INV-900003');
  });

  test('PUT with unknown id returns 404', async () => {
    const res = await request(server.app).put(`${PATH}/INV-000000`).send({ customer: 'x' });
    expect(res.statusCode).toBe(404);
  });

  test('DELETE removes the invoice', async () => {
    const res = await request(server.app).delete(`${PATH}/INV-900003`);
    expect(res.statusCode).toBe(200);
    const after = await request(server.app).get(`${PATH}/INV-900003`);
    expect(after.statusCode).toBe(404);
  });

  test('DELETE with unknown id returns 404', async () => {
    const res = await request(server.app).delete(`${PATH}/INV-000000`);
    expect(res.statusCode).toBe(404);
  });
});

describe('Sales search and filters', () => {
  test('filter by customer name', async () => {
    const res = await request(server.app).get(`${PATH}?customer=ahmed`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.invoices).toHaveLength(1);
    expect(res.body.data.invoices[0].id).toBe('INV-900001');
  });

  test('filter by payment type', async () => {
    const res = await request(server.app).get(`${PATH}?payment=credit`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.invoices).toHaveLength(1);
    expect(res.body.data.invoices[0].id).toBe('INV-900002');
  });

  test('search by invoice number', async () => {
    const res = await request(server.app).get(`${PATH}?invoiceNumber=900002`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.invoices.some(i => i.id === 'INV-900002')).toBe(true);
  });

  test('filter by date range', async () => {
    const res = await request(server.app).get(`${PATH}?dateFrom=2026-07-02&dateTo=2026-07-31`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.invoices.every(i => i.id !== 'INV-900001')).toBe(true);
    expect(res.body.data.invoices.some(i => i.id === 'INV-900002')).toBe(true);
  });
});

describe('Sales stats', () => {
  test('stats aggregates count, totals and profit', async () => {
    const res = await request(server.app).get(`${PATH}/stats`);
    expect(res.statusCode).toBe(200);
    const s = res.body.data;
    expect(s.count).toBe(2); // INV-900003 was deleted above
    expect(s.totalSales).toBe(300);
    expect(s.cashSales).toBe(100);
    expect(s.creditSales).toBe(200);
    expect(s.profit).toBe(80);
  });
});
