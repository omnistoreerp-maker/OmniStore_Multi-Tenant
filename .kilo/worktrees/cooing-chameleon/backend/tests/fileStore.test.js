// fileStore behavior and concurrency-safety tests.
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, readStore } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  dataDir = makeTempDataDir('filestore');
  server = await startServer(dataDir);
});

describe('read behavior', () => {
  test('reads of a missing store do NOT create a file (reads are read-only)', async () => {
    const res = await request(server.app).get('/api/v1/partners');
    expect(res.statusCode).toBe(200);
    expect(fs.existsSync(path.join(dataDir, 'partners.json'))).toBe(false);
  });

  test('the first real write creates the store file', async () => {
    await request(server.app).post('/api/v1/partners').send({ id: 'fs-p1', name: 'First' });
    expect(fs.existsSync(path.join(dataDir, 'partners.json'))).toBe(true);
    expect(readStore(dataDir, 'partners').partners).toHaveLength(1);
  });

  test('external changes are picked up (mtime+size invalidation)', async () => {
    const store = readStore(dataDir, 'partners');
    store.partners.push({ id: 'fs-p2', name: 'External', createdAt: new Date().toISOString() });
    fs.writeFileSync(path.join(dataDir, 'partners.json'), JSON.stringify(store, null, 2), 'utf-8');
    const res = await request(server.app).get('/api/v1/partners/fs-p2');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.name).toBe('External');
  });
});

describe('concurrent write safety', () => {
  test('parallel POSTs never corrupt the store and all records persist', async () => {
    const N = 25;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        request(server.app).post('/api/v1/suppliers').send({ id: `conc-${i}`, name: `Concurrent ${i}` })
      )
    );
    expect(results.every(r => r.statusCode === 201)).toBe(true);

    // the file must be valid JSON with every record present
    const raw = fs.readFileSync(path.join(dataDir, 'suppliers.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    const ids = parsed.suppliers.map(s => s.id);
    for (let i = 0; i < N; i++) expect(ids).toContain(`conc-${i}`);

    // and the API agrees
    const list = await request(server.app).get('/api/v1/suppliers?limit=100');
    expect(list.body.data.total).toBe(N);
  });

  test('parallel PUTs to one record leave valid JSON and a consistent final state', async () => {
    await request(server.app).post('/api/v1/treasury').send({ id: 'conc-t', type: 'in', amount: 1 });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        request(server.app).put('/api/v1/treasury/conc-t').send({ desc: 'update ' + i })
      )
    );
    expect(results.every(r => r.statusCode === 200)).toBe(true);
    const parsed = readStore(dataDir, 'treasury');
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].desc).toMatch(/^update \d$/);
  });

  test('no leftover .tmp files after parallel writes', async () => {
    const leftovers = fs.readdirSync(dataDir).filter(f => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });
});
