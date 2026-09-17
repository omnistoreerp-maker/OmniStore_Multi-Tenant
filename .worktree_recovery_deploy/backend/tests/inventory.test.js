// Endpoint tests for Inventory (products) and InventoryTransactions
// (stock movements): CRUD, validation, filters, stats, movement logic.
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const INV = '/api/v1/inventory';
const TXN = '/api/v1/inventory-transactions';
let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  dataDir = makeTempDataDir('inventory');
  server = await startServer(dataDir);
  await request(server.app).post(INV).send({ id: 'prod-1', name: 'RTX 3080', categoryId: 'gpu', brandId: 'nvidia', buyPrice: 500, sellPrice: 700, stockQty: 10 });
  await request(server.app).post(INV).send({ id: 'prod-2', name: 'Ryzen 9 5900X', categoryId: 'cpu', brandId: 'amd', buyPrice: 300, sellPrice: 450, stockQty: 5 });
});

describe('Inventory CRUD', () => {
  test('POST creates a product (201)', async () => {
    const res = await request(server.app).post(INV).send({ id: 'prod-3', name: 'DDR5 32GB', stockQty: 20 });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.id).toBe('prod-3');
    expect(res.body.data.createdAt).toBeTruthy();
  });

  test('POST without name returns 400', async () => {
    const res = await request(server.app).post(INV).send({ stockQty: 1 });
    expect(res.statusCode).toBe(400);
  });

  test('POST with non-number stockQty returns 400', async () => {
    const res = await request(server.app).post(INV).send({ name: 'Bad', stockQty: 'ten' });
    expect(res.statusCode).toBe(400);
  });

  test('POST with duplicate id returns 400', async () => {
    const res = await request(server.app).post(INV).send({ id: 'prod-1', name: 'Dupe' });
    expect(res.statusCode).toBe(400);
  });

  test('GET list returns products', async () => {
    const res = await request(server.app).get(INV);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.products.length).toBeGreaterThanOrEqual(3);
    expect(typeof res.body.data.total).toBe('number');
  });

  test('GET by id returns the product', async () => {
    const res = await request(server.app).get(`${INV}/prod-1`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.name).toBe('RTX 3080');
  });

  test('GET by unknown id returns 404', async () => {
    const res = await request(server.app).get(`${INV}/prod-999`);
    expect(res.statusCode).toBe(404);
  });

  test('PUT updates stock quantity', async () => {
    const res = await request(server.app).put(`${INV}/prod-3`).send({ stockQty: 15 });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.stockQty).toBe(15);
  });

  test('PUT with unknown id returns 404', async () => {
    const res = await request(server.app).put(`${INV}/prod-999`).send({ stockQty: 1 });
    expect(res.statusCode).toBe(404);
  });

  test('search filter matches product names', async () => {
    const res = await request(server.app).get(`${INV}?search=rtx`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.products).toHaveLength(1);
    expect(res.body.data.products[0].id).toBe('prod-1');
  });

  test('category filter returns only matching products', async () => {
    const res = await request(server.app).get(`${INV}?categoryId=cpu`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.products).toHaveLength(1);
    expect(res.body.data.products[0].id).toBe('prod-2');
  });

  test('stats returns count, categories and brands', async () => {
    const res = await request(server.app).get(`${INV}/stats`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.count).toBe(3);
    expect(typeof res.body.data.categories).toBe('number');
    expect(typeof res.body.data.brands).toBe('number');
  });

  test('DELETE removes the product', async () => {
    const res = await request(server.app).delete(`${INV}/prod-3`);
    expect(res.statusCode).toBe(200);
    const after = await request(server.app).get(`${INV}/prod-3`);
    expect(after.statusCode).toBe(404);
  });

  test('DELETE with unknown id returns 404', async () => {
    const res = await request(server.app).delete(`${INV}/prod-999`);
    expect(res.statusCode).toBe(404);
  });
});

describe('InventoryTransactions movement logic', () => {
  test('POST records a stock-in movement (201)', async () => {
    const res = await request(server.app).post(TXN).send({ id: 'txn-1', productId: 'prod-1', type: 'in', qty: 10, stockAfter: 10 });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.type).toBe('in');
  });

  test('POST records a stock-out movement', async () => {
    const res = await request(server.app).post(TXN).send({ id: 'txn-2', productId: 'prod-1', type: 'out', qty: 3, stockAfter: 7 });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.stockAfter).toBe(7);
  });

  test('POST records an adjustment movement', async () => {
    const res = await request(server.app).post(TXN).send({ id: 'txn-3', productId: 'prod-2', type: 'adjustment', qty: 1, stockAfter: 6 });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.type).toBe('adjustment');
  });

  test('POST without productId returns 400', async () => {
    const res = await request(server.app).post(TXN).send({ type: 'in', qty: 1 });
    expect(res.statusCode).toBe(400);
  });

  test('POST without type returns 400', async () => {
    const res = await request(server.app).post(TXN).send({ productId: 'prod-1', qty: 1 });
    expect(res.statusCode).toBe(400);
  });

  test('POST with non-number qty returns 400', async () => {
    const res = await request(server.app).post(TXN).send({ productId: 'prod-1', type: 'in', qty: 'many' });
    expect(res.statusCode).toBe(400);
  });

  test('GET list returns movements with pagination metadata', async () => {
    const res = await request(server.app).get(TXN);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.transactions).toHaveLength(3);
    expect(res.body.data.total).toBe(3);
  });

  test('filter by productId returns that product movement trail', async () => {
    const res = await request(server.app).get(`${TXN}?productId=prod-1`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.transactions).toHaveLength(2);
    expect(res.body.data.transactions.every(t => t.productId === 'prod-1')).toBe(true);
  });

  test('filter by movement type', async () => {
    const res = await request(server.app).get(`${TXN}?type=out`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.transactions).toHaveLength(1);
    expect(res.body.data.transactions[0].id).toBe('txn-2');
  });

  test('GET by id returns the movement', async () => {
    const res = await request(server.app).get(`${TXN}/txn-1`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.qty).toBe(10);
  });

  test('GET by unknown id returns 404', async () => {
    const res = await request(server.app).get(`${TXN}/txn-999`);
    expect(res.statusCode).toBe(404);
  });

  test('stats counts movements by direction', async () => {
    const res = await request(server.app).get(`${TXN}/stats`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.count).toBe(3);
    expect(res.body.data.stockIn).toBe(1);
    expect(res.body.data.stockOut).toBe(1);
    expect(res.body.data.adjustments).toBe(1);
  });

  test('PUT updates a movement record', async () => {
    const res = await request(server.app).put(`${TXN}/txn-3`).send({ qty: 2, stockAfter: 7 });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.qty).toBe(2);
  });

  test('DELETE removes a movement record', async () => {
    const res = await request(server.app).delete(`${TXN}/txn-3`);
    expect(res.statusCode).toBe(200);
    const after = await request(server.app).get(`${TXN}/txn-3`);
    expect(after.statusCode).toBe(404);
  });
});
