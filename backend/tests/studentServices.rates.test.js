'use strict';

// studentServices.rates.test.js — print rate CRUD + tenant-scoped pricing.
//
// The student services backend exposes a full rates CRUD
// (GET/POST /rates, DELETE /rates/:id) and a calculate endpoint, but the
// module had zero functional coverage on main. These tests pin:
//   - upsert is keyed on (paperSize, printType, duplexType) per tenant —
//     posting the same combination updates instead of duplicating
//   - every tenant sees ONLY its own rates (no cross-tenant leakage)
//   - /calculate prices with the calling tenant's rate exclusively
//   - validation: pricePerPage must be > 0; unknown combos fail cleanly
//
// Tenant model: context reaches the controller via authenticated login +
// tenantCarry (same harness as onlineStore.orders.test.js).

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { login } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const now = new Date().toISOString();
const TENANT_A = 'default';
const TENANT_B = 'rival';

let server;
let dataDir;
let tokenA;
let tokenB;

const api = (token) => ({
  get: (p) => request(server).get(p).set('Authorization', 'Bearer ' + token),
  post: (p, body) => request(server).post(p).set('Authorization', 'Bearer ' + token).send(body),
  del: (p) => request(server).delete(p).set('Authorization', 'Bearer ' + token)
});

function readStoreFile() {
  const file = path.join(dataDir, 'studentServicesPack.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

beforeAll(async () => {
  process.env.AUTH_REQUIRED = 'false';
  process.env.ENABLE_TENANT_CARRY = 'true';
  dataDir = makeTempDataDir('student-services-rates');

  seed(dataDir, 'companies', { companies: [
    { id: TENANT_A, code: 'DFT', name: 'Print Shop A', active: true },
    { id: TENANT_B, code: 'RIVAL', name: 'Print Shop B', active: true }
  ]});
  seed(dataDir, 'users', { users: [
    { id: 'u-a', username: 'admina', password: bcrypt.hashSync('Passw0rd!', 10), role: 'Owner', fullName: 'Admin A', tenantId: TENANT_A, createdAt: now, updatedAt: now },
    { id: 'u-b', username: 'adminb', password: bcrypt.hashSync('Passw0rd!', 10), role: 'Owner', fullName: 'Admin B', tenantId: TENANT_B, createdAt: now, updatedAt: now }
  ]});
  seed(dataDir, 'studentServicesPack', {
    printRates: [
      // Pre-existing rate belonging to the RIVAL tenant only — tenant A must
      // never see or price with it.
      { id: 'rate-rival-seed', tenantId: TENANT_B, paperSize: 'A4', printType: 'bw', duplexType: 'single', pricePerPage: 9, bindingPrice: 0, updatedAt: now }
    ],
    printOrders: [],
    studentPasses: [],
    settings: { whatsappNumber: '', currency: 'EGP' }
  });

  server = startServer(dataDir, { AUTH_REQUIRED: 'false' }).app;
  tokenA = (await login(server, 'admina', 'Passw0rd!', TENANT_A)).accessToken;
  tokenB = (await login(server, 'adminb', 'Passw0rd!', TENANT_B)).accessToken;
});

registerCleanup(() => [server], () => [dataDir]);

describe('rates CRUD', () => {
  test('creates a new rate and returns it', async () => {
    const res = await api(tokenA).post('/api/v1/tenant/student-services/rates')
      .send({ paperSize: 'A4', printType: 'bw', duplexType: 'single', pricePerPage: 0.25, bindingPrice: 1.5 });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.paperSize).toBe('A4');
    expect(res.body.data.pricePerPage).toBe(0.25);
    expect(res.body.data.tenantId).toBe(TENANT_A);
  });

  test('upserts on the same combination instead of duplicating', async () => {
    const first = await api(tokenA).post('/api/v1/tenant/student-services/rates')
      .send({ paperSize: 'A3', printType: 'color', duplexType: 'double', pricePerPage: 2, bindingPrice: 0 });
    const id = first.body.data.id;
    const second = await api(tokenA).post('/api/v1/tenant/student-services/rates')
      .send({ paperSize: 'A3', printType: 'color', duplexType: 'double', pricePerPage: 3, bindingPrice: 0 });
    expect(second.statusCode).toBe(200);
    expect(second.body.data.id).toBe(id);
    const doc = readStoreFile();
    const dupes = doc.printRates.filter((r) => r.tenantId === TENANT_A && r.paperSize === 'A3');
    expect(dupes.length).toBe(1);
    expect(dupes[0].pricePerPage).toBe(3);
  });

  test('rejects non-positive pricePerPage', async () => {
    const res = await api(tokenA).post('/api/v1/tenant/student-services/rates')
      .send({ paperSize: 'A4', printType: 'bw', duplexType: 'double', pricePerPage: 0 });
    expect(res.statusCode).toBe(400);
  });

  test('lists rates for the calling tenant only', async () => {
    const res = await api(tokenA).get('/api/v1/tenant/student-services/rates');
    expect(res.statusCode).toBe(200);
    const ids = res.body.data.map((r) => r.id);
    expect(ids).not.toContain('rate-rival-seed');
    const rivalRate = res.body.data.find((r) => r.id === 'rate-rival-seed');
    expect(rivalRate).toBeUndefined();
  });

  test('deletes a rate, then 404 on the second delete', async () => {
    const created = await api(tokenA).post('/api/v1/tenant/student-services/rates')
      .send({ paperSize: 'A5', printType: 'bw', duplexType: 'single', pricePerPage: 0.1, bindingPrice: 0 });
    const id = created.body.data.id;
    const ok = await api(tokenA).del('/api/v1/tenant/student-services/rates/' + encodeURIComponent(id));
    expect(ok.statusCode).toBe(200);
    const again = await api(tokenA).del('/api/v1/tenant/student-services/rates/' + encodeURIComponent(id));
    expect(again.statusCode).toBe(404);
  });
});

describe('tenant isolation of rates', () => {
  test('rival tenant starts with only its seeded rate', async () => {
    const res = await api(tokenB).get('/api/v1/tenant/student-services/rates');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe('rate-rival-seed');
  });

  test('same combination can coexist across tenants with different prices', async () => {
    const rivalRate = await api(tokenB).post('/api/v1/tenant/student-services/rates')
      .send({ paperSize: 'A4', printType: 'bw', duplexType: 'single', pricePerPage: 2, bindingPrice: 0 });
    expect(rivalRate.statusCode).toBe(200);
    expect(rivalRate.body.data.id).not.toBeUndefined();

    const listA = await api(tokenA).get('/api/v1/tenant/student-services/rates');
    const aRates = listA.body.data.filter((r) => r.paperSize === 'A4' && r.printType === 'bw' && r.duplexType === 'single');
    expect(aRates.length).toBe(1);
    expect(aRates[0].pricePerPage).toBe(0.25);

    const listB = await api(tokenB).get('/api/v1/tenant/student-services/rates');
    const bRates = listB.body.data.filter((r) => r.paperSize === 'A4' && r.printType === 'bw' && r.duplexType === 'single');
    expect(bRates.length).toBe(1);
    expect(bRates[0].pricePerPage).toBe(2);
  });

  test('tenant cannot delete another tenant rate', async () => {
    const res = await api(tokenA).del('/api/v1/tenant/student-services/rates/' + encodeURIComponent('rate-rival-seed'));
    expect(res.statusCode).toBe(404);
    const doc = readStoreFile();
    expect(doc.printRates.some((r) => r.id === 'rate-rival-seed')).toBe(true);
  });
});

describe('calculate endpoint pricing scope', () => {
  test('prices with the calling tenant rate (A: 0.25/page)', async () => {
    const res = await api(tokenA).post('/api/v1/tenant/student-services/calculate')
      .send({ totalPages: 10, copies: 1, paperSize: 'A4', printType: 'bw', duplexType: 'single', hasBinding: false });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.totalAmount).toBe(2.5);
    expect(res.body.data.breakdown.pricePerPage).toBe(0.25);
  });

  test('same request for tenant B prices with B rate (2/page)', async () => {
    const res = await api(tokenB).post('/api/v1/tenant/student-services/calculate')
      .send({ totalPages: 10, copies: 1, paperSize: 'A4', printType: 'bw', duplexType: 'single', hasBinding: false });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.totalAmount).toBe(20);
  });

  test('binding cost uses the tenant rate', async () => {
    const res = await api(tokenA).post('/api/v1/tenant/student-services/calculate')
      .send({ totalPages: 10, copies: 1, paperSize: 'A4', printType: 'bw', duplexType: 'single', hasBinding: true });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.totalAmount).toBe(4);
  });

  test('unconfigured combination fails cleanly with 400', async () => {
    const res = await api(tokenA).post('/api/v1/tenant/student-services/calculate')
      .send({ totalPages: 10, copies: 1, paperSize: 'A3', printType: 'bw', duplexType: 'single', hasBinding: false });
    expect(res.statusCode).toBe(400);
  });

  test('rate payload never leaks foreign-tenant records through calculate', async () => {
    const res = await api(tokenA).post('/api/v1/tenant/student-services/calculate')
      .send({ totalPages: 1, copies: 1, paperSize: 'A4', printType: 'bw', duplexType: 'single', hasBinding: false });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('rate-rival-seed');
  });
});
