// Endpoint tests for the Purchases module:
// CRUD, validation 400s, 404s, stats, and search/filter parameters.
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const PATH = '/api/v1/purchases';
let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  dataDir = makeTempDataDir('purchases');
  server = await startServer(dataDir);
  await request(server.app).post(PATH).send({
    id: 'PO-900001',
    items: [{ productId: 'p1', qty: 5, price: 20 }],
    total: 100,
    supplier: 'Cairo Components',
    payment: 'cash',
    date: '2026-07-01T10:00:00.000Z'
  });
  await request(server.app).post(PATH).send({
    id: 'PO-900002',
    items: [{ productId: 'p2', qty: 2, price: 150 }],
    total: 300,
    supplier: 'Delta Electronics',
    payment: 'credit',
    date: '2026-07-05T10:00:00.000Z'
  });
});

describe('Purchases CRUD', () => {
  test('POST creates an invoice (201) with timestamps', async () => {
    const res = await request(server.app).post(PATH).send({
      id: 'PO-900003',
      items: [{ productId: 'p3', qty: 1, price: 40 }],
      total: 40
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.id).toBe('PO-900003');
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
      id: 'PO-900001',
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
    const res = await request(server.app).get(`${PATH}/PO-900001`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.supplier).toBe('Cairo Components');
  });

  test('GET by unknown id returns 404', async () => {
    const res = await request(server.app).get(`${PATH}/PO-000000`);
    expect(res.statusCode).toBe(404);
  });

  test('PUT updates the invoice', async () => {
    const res = await request(server.app).put(`${PATH}/PO-900003`).send({ supplier: 'Updated Supplier' });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.supplier).toBe('Updated Supplier');
    expect(res.body.data.id).toBe('PO-900003');
  });

  test('PUT with unknown id returns 404', async () => {
    const res = await request(server.app).put(`${PATH}/PO-000000`).send({ supplier: 'x' });
    expect(res.statusCode).toBe(404);
  });

  test('DELETE removes the invoice', async () => {
    const res = await request(server.app).delete(`${PATH}/PO-900003`);
    expect(res.statusCode).toBe(200);
    const after = await request(server.app).get(`${PATH}/PO-900003`);
    expect(after.statusCode).toBe(404);
  });

  test('DELETE with unknown id returns 404', async () => {
    const res = await request(server.app).delete(`${PATH}/PO-000000`);
    expect(res.statusCode).toBe(404);
  });
});

describe('Purchases search and filters', () => {
  test('filter by supplier name', async () => {
    const res = await request(server.app).get(`${PATH}?supplier=cairo`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.invoices).toHaveLength(1);
    expect(res.body.data.invoices[0].id).toBe('PO-900001');
  });

  test('filter by payment type', async () => {
    const res = await request(server.app).get(`${PATH}?payment=credit`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.invoices).toHaveLength(1);
    expect(res.body.data.invoices[0].id).toBe('PO-900002');
  });

  test('search by invoice number', async () => {
    const res = await request(server.app).get(`${PATH}?invoiceNumber=900002`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.invoices.some(i => i.id === 'PO-900002')).toBe(true);
  });

  test('filter by date range', async () => {
    const res = await request(server.app).get(`${PATH}?dateFrom=2026-07-02&dateTo=2026-07-31`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.invoices.every(i => i.id !== 'PO-900001')).toBe(true);
    expect(res.body.data.invoices.some(i => i.id === 'PO-900002')).toBe(true);
  });
});

describe('Purchases stats', () => {
  test('stats aggregates count and totals', async () => {
    const res = await request(server.app).get(`${PATH}/stats`);
    expect(res.statusCode).toBe(200);
    const s = res.body.data;
    expect(s.count).toBe(2); // PO-900003 was deleted above
    expect(s.totalPurchases).toBe(400);
    expect(s.cashPurchases).toBe(100);
    expect(s.creditPurchases).toBe(300);
  });
});
