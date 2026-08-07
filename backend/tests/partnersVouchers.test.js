// Endpoint tests for Partners and Vouchers:
// CRUD, validation 400s, 404s, search/filters, stats.
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const PARTNERS = '/api/v1/partners';
const VOUCHERS = '/api/v1/vouchers';
let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  dataDir = makeTempDataDir('partners-vouchers');
  server = await startServer(dataDir);
  await request(server.app).post(PARTNERS).send({ id: 'ptn-1', name: 'Hassan Partner', phone: '0101', capital: 10000, percent: 40 });
  await request(server.app).post(VOUCHERS).send({ id: 'vch-1', type: 'receipt', partyName: 'Ahmed Ali', partyType: 'customer', method: 'cash', amount: 500, date: '2026-07-01' });
  await request(server.app).post(VOUCHERS).send({ id: 'vch-2', type: 'payment', partyName: 'Cairo Components', partyType: 'supplier', method: 'bank', amount: 800, date: '2026-07-03' });
});

describe('Partners CRUD', () => {
  test('POST creates a partner (201)', async () => {
    const res = await request(server.app).post(PARTNERS).send({ id: 'ptn-2', name: 'Second Partner', capital: 5000 });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.id).toBe('ptn-2');
    expect(res.body.data.createdAt).toBeTruthy();
  });

  test('POST without name returns 400', async () => {
    const res = await request(server.app).post(PARTNERS).send({ capital: 100 });
    expect(res.statusCode).toBe(400);
  });

  test('POST with non-number capital returns 400', async () => {
    const res = await request(server.app).post(PARTNERS).send({ name: 'Bad', capital: 'lots' });
    expect(res.statusCode).toBe(400);
  });

  test('GET list returns partners', async () => {
    const res = await request(server.app).get(PARTNERS);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.partners).toHaveLength(2);
    expect(res.body.data.total).toBe(2);
  });

  test('GET by id returns the partner', async () => {
    const res = await request(server.app).get(`${PARTNERS}/ptn-1`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.percent).toBe(40);
  });

  test('GET by unknown id returns 404', async () => {
    const res = await request(server.app).get(`${PARTNERS}/ptn-999`);
    expect(res.statusCode).toBe(404);
  });

  test('PUT updates the partner', async () => {
    const res = await request(server.app).put(`${PARTNERS}/ptn-2`).send({ percent: 60 });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.percent).toBe(60);
  });

  test('PUT with unknown id returns 404', async () => {
    const res = await request(server.app).put(`${PARTNERS}/ptn-999`).send({ percent: 1 });
    expect(res.statusCode).toBe(404);
  });

  test('stats returns count, withPhone and withCapital', async () => {
    const res = await request(server.app).get(`${PARTNERS}/stats`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.count).toBe(2);
    expect(res.body.data.withPhone).toBe(1);
    expect(res.body.data.withCapital).toBe(2);
  });

  test('DELETE removes the partner', async () => {
    const res = await request(server.app).delete(`${PARTNERS}/ptn-2`);
    expect(res.statusCode).toBe(200);
    const after = await request(server.app).get(`${PARTNERS}/ptn-2`);
    expect(after.statusCode).toBe(404);
  });

  test('DELETE with unknown id returns 404', async () => {
    const res = await request(server.app).delete(`${PARTNERS}/ptn-999`);
    expect(res.statusCode).toBe(404);
  });
});

describe('Vouchers CRUD', () => {
  test('POST creates a voucher (201)', async () => {
    const res = await request(server.app).post(VOUCHERS).send({ id: 'vch-3', type: 'receipt', partyName: 'Extra', amount: 100 });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.id).toBe('vch-3');
    expect(res.body.data.createdAt).toBeTruthy();
  });

  test('POST without type returns 400', async () => {
    const res = await request(server.app).post(VOUCHERS).send({ amount: 10 });
    expect(res.statusCode).toBe(400);
  });

  test('POST with non-number amount returns 400', async () => {
    const res = await request(server.app).post(VOUCHERS).send({ type: 'receipt', amount: 'much' });
    expect(res.statusCode).toBe(400);
  });

  test('POST with duplicate id returns 400', async () => {
    const res = await request(server.app).post(VOUCHERS).send({ id: 'vch-1', type: 'receipt' });
    expect(res.statusCode).toBe(400);
  });

  test('GET list returns vouchers', async () => {
    const res = await request(server.app).get(VOUCHERS);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.vouchers.length).toBeGreaterThanOrEqual(3);
    expect(typeof res.body.data.total).toBe('number');
  });

  test('GET by id returns the voucher', async () => {
    const res = await request(server.app).get(`${VOUCHERS}/vch-1`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.amount).toBe(500);
  });

  test('GET by unknown id returns 404', async () => {
    const res = await request(server.app).get(`${VOUCHERS}/vch-999`);
    expect(res.statusCode).toBe(404);
  });

  test('filter by type', async () => {
    const res = await request(server.app).get(`${VOUCHERS}?type=payment`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.vouchers).toHaveLength(1);
    expect(res.body.data.vouchers[0].id).toBe('vch-2');
  });

  test('filter by partyType', async () => {
    const res = await request(server.app).get(`${VOUCHERS}?partyType=supplier`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.vouchers).toHaveLength(1);
    expect(res.body.data.vouchers[0].id).toBe('vch-2');
  });

  test('search matches party names', async () => {
    const res = await request(server.app).get(`${VOUCHERS}?search=cairo`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.vouchers.some(v => v.id === 'vch-2')).toBe(true);
  });

  test('PUT updates the voucher', async () => {
    const res = await request(server.app).put(`${VOUCHERS}/vch-3`).send({ amount: 150 });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.amount).toBe(150);
  });

  test('PUT with unknown id returns 404', async () => {
    const res = await request(server.app).put(`${VOUCHERS}/vch-999`).send({ amount: 1 });
    expect(res.statusCode).toBe(404);
  });

  test('stats returns count and per-type totals', async () => {
    const res = await request(server.app).get(`${VOUCHERS}/stats`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.count).toBe(3);
    expect(res.body.data.types.receipt).toBe(2);
    expect(res.body.data.types.payment).toBe(1);
  });

  test('DELETE removes the voucher', async () => {
    const res = await request(server.app).delete(`${VOUCHERS}/vch-3`);
    expect(res.statusCode).toBe(200);
    const after = await request(server.app).get(`${VOUCHERS}/vch-3`);
    expect(after.statusCode).toBe(404);
  });

  test('DELETE with unknown id returns 404', async () => {
    const res = await request(server.app).delete(`${VOUCHERS}/vch-999`);
    expect(res.statusCode).toBe(404);
  });
});
