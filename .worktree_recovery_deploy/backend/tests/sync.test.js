// Synchronization contract tests.
// The sync engine lives in the frontend; these tests verify the backend
// behaviors it depends on: client-supplied ids on push, duplicate-push
// rejection on queue retry, _backendId aliasing, refresh merge of
// externally added records, and the updatedAt/createdAt conflict basis.
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  dataDir = makeTempDataDir('sync');
  server = await startServer(dataDir);
});

describe('sync queue push contract', () => {
  test('POST with a client-supplied id stores the record under that id', async () => {
    const res = await request(server.app)
      .post('/api/v1/customers')
      .send({ id: 'local-abc-123', name: 'Queued Customer', phone: '0111' });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.id).toBe('local-abc-123');
    const get = await request(server.app).get('/api/v1/customers/local-abc-123');
    expect(get.statusCode).toBe(200);
    expect(get.body.data.name).toBe('Queued Customer');
  });

  test('re-pushing the same id (queue retry) is rejected as duplicate', async () => {
    const res = await request(server.app)
      .post('/api/v1/customers')
      .send({ id: 'local-abc-123', name: 'Queued Customer Again' });
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('records are resolvable through their _backendId alias', async () => {
    const create = await request(server.app)
      .post('/api/v1/customers')
      .send({ id: 'local-xyz', _backendId: 'backend-xyz', name: 'Aliased Customer' });
    expect(create.statusCode).toBe(201);
    const byLocal = await request(server.app).get('/api/v1/customers/local-xyz');
    const byBackend = await request(server.app).get('/api/v1/customers/backend-xyz');
    expect(byLocal.statusCode).toBe(200);
    expect(byBackend.statusCode).toBe(200);
    expect(byBackend.body.data.id).toBe('local-xyz');
    const upd = await request(server.app)
      .put('/api/v1/customers/backend-xyz')
      .send({ phone: '0222' });
    expect(upd.statusCode).toBe(200);
    expect(upd.body.data.id).toBe('local-xyz');
  });
});

describe('refresh merge contract', () => {
  test('records added externally to the store appear in subsequent list calls', async () => {
    const before = await request(server.app).get('/api/v1/suppliers');
    const countBefore = before.body.data.total;
    seed(dataDir, 'suppliers', {
      suppliers: [
        ...(before.body.data.suppliers || []),
        { id: 'external-1', name: 'External Supplier', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      ]
    });
    const after = await request(server.app).get('/api/v1/suppliers');
    expect(after.body.data.total).toBe(countBefore + 1);
    expect(after.body.data.suppliers.some(s => s.id === 'external-1')).toBe(true);
  });

  test('API-created records and externally seeded records coexist (unsynced preserved)', async () => {
    await request(server.app).post('/api/v1/employees').send({ id: 'api-made', name: 'API Made' });
    const list = await request(server.app).get('/api/v1/employees');
    seed(dataDir, 'employees', {
      employees: [
        ...list.body.data.employees,
        { id: 'seed-made', name: 'Seed Made', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      ]
    });
    const merged = await request(server.app).get('/api/v1/employees');
    const ids = merged.body.data.employees.map(e => e.id);
    expect(ids).toEqual(expect.arrayContaining(['api-made', 'seed-made']));
  });
});

describe('conflict detection basis', () => {
  test('PUT preserves createdAt and advances updatedAt', async () => {
    const create = await request(server.app)
      .post('/api/v1/treasury')
      .send({ type: 'out', amount: 10, desc: 'conflict basis' });
    const created = create.body.data;
    await new Promise(r => setTimeout(r, 1100)); // ensure a distinct timestamp second
    const upd = await request(server.app)
      .put(`/api/v1/treasury/${created.id}`)
      .send({ desc: 'conflict basis updated' });
    expect(upd.statusCode).toBe(200);
    expect(upd.body.data.createdAt).toBe(created.createdAt);
    expect(new Date(upd.body.data.updatedAt).getTime())
      .toBeGreaterThan(new Date(created.updatedAt).getTime());
  });

  test('server applies last-write-wins on conflicting updates', async () => {
    const create = await request(server.app)
      .post('/api/v1/customers')
      .send({ name: 'Conflict Customer', phone: '0333' });
    const id = create.body.data.id;
    await request(server.app).put(`/api/v1/customers/${id}`).send({ phone: '0444' });
    const second = await request(server.app).put(`/api/v1/customers/${id}`).send({ phone: '0555' });
    expect(second.statusCode).toBe(200);
    const final = await request(server.app).get(`/api/v1/customers/${id}`);
    expect(final.body.data.phone).toBe('0555');
  });

  test('timestamps are ISO-8601 strings (the conflict comparison currency)', async () => {
    const res = await request(server.app)
      .post('/api/v1/suppliers')
      .send({ name: 'Timestamp Supplier' });
    expect(res.statusCode).toBe(201);
    expect(Number.isNaN(Date.parse(res.body.data.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(res.body.data.updatedAt))).toBe(false);
  });
});
