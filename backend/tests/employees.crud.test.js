'use strict';

// employees.crud.test.js — HR CRUD + tenant isolation for /api/v1/employees.
//
// The employees routes had zero coverage on main while the frontend
// (index.html) syncs its employee page against them (list/create/update/
// delete + _backendId bookkeeping). These tests pin the exact contract the
// UI depends on:
//   - list/getById/create/update/delete with auth + tenantCarry
//   - create returns 201 with the record (UI stores _backendId from data.id)
//   - update by id (uuid) works — the UI updates via _backendId
//   - delete by id removes the record and a second delete 404s
//   - stats endpoint (count/active/withPhone)
//   - tenant isolation: tenant B never sees/edits/deletes tenant A records,
//     foreign tenantId claims are rejected, legacy records (no tenantId)
//     remain writable (Phase 13 read rule)

const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { login } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const now = new Date().toISOString();
const TENANT_A = 'default';
const TENANT_B = 'rival';

// Isolation flags are opt-in (same harness as cairoTechIsolation.test.js):
// tenantCarry reconstructs the trusted tenant from the JWT and tenant
// filtering enforces read scoping in BaseRepository. Originals restored in
// afterAll so unrelated suites are unaffected.
const ORIGINAL_ENV = {
  CARRY: process.env.ENABLE_TENANT_CARRY,
  FILTER: process.env.ENABLE_TENANT_FILTERING,
  MD: process.env.ENABLE_TENANT_METADATA,
  AUTH: process.env.AUTH_REQUIRED
};

let server;
let dataDir;
let tokenA;
let tokenB;

const api = (token) => ({
  get: (p) => request(server).get(p).set('Authorization', 'Bearer ' + token),
  post: (p, body) => request(server).post(p).set('Authorization', 'Bearer ' + token).send(body),
  put: (p, body) => request(server).put(p).set('Authorization', 'Bearer ' + token).send(body),
  del: (p) => request(server).delete(p).set('Authorization', 'Bearer ' + token)
});

const VALID_EMPLOYEE = {
  name: 'Ahmed Hassan',
  position: 'Technician',
  phone: '01000000000',
  salary: 5000,
  commission: 100,
  bonus: 50,
  advance: 0,
  vacationDays: 2,
  status: 'active'
};

beforeAll(async () => {
  process.env.ENABLE_TENANT_CARRY = 'true';
  process.env.ENABLE_TENANT_FILTERING = 'true';
  process.env.ENABLE_TENANT_METADATA = 'true';
  process.env.AUTH_REQUIRED = 'false';
  dataDir = makeTempDataDir('employees-crud');

  seed(dataDir, 'companies', { companies: [
    { id: TENANT_A, code: 'DFT', name: 'HR Shop A', active: true },
    { id: TENANT_B, code: 'RIVAL', name: 'HR Shop B', active: true }
  ]});
  seed(dataDir, 'users', { users: [
    { id: 'u-a', username: 'admina', password: bcrypt.hashSync('Passw0rd!', 10), role: 'Owner', fullName: 'Admin A', tenantId: TENANT_A, createdAt: now, updatedAt: now },
    { id: 'u-b', username: 'adminb', password: bcrypt.hashSync('Passw0rd!', 10), role: 'Owner', fullName: 'Admin B', tenantId: TENANT_B, createdAt: now, updatedAt: now }
  ]});
  seed(dataDir, 'employees', { employees: [
    // Legacy record without tenantId — must stay visible/writable per the
    // Phase 13 read rule.
    { id: 'emp-legacy', name: 'Legacy Employee', position: 'Keeper', salary: 1000 }
  ]});

  server = startServer(dataDir, { AUTH_REQUIRED: 'false' }).app;
  tokenA = (await login(server, 'admina', 'Passw0rd!', TENANT_A)).accessToken;
  tokenB = (await login(server, 'adminb', 'Passw0rd!', TENANT_B)).accessToken;
});

afterAll(() => {
  const map = [
    ['CARRY', 'ENABLE_TENANT_CARRY'],
    ['FILTER', 'ENABLE_TENANT_FILTERING'],
    ['MD', 'ENABLE_TENANT_METADATA'],
    ['AUTH', 'AUTH_REQUIRED']
  ];
  for (const [key, envKey] of map) {
    const orig = ORIGINAL_ENV[key];
    if (orig === undefined) delete process.env[envKey];
    else process.env[envKey] = orig;
  }
});

registerCleanup(() => [server], () => [dataDir]);

describe('employees CRUD (contract the UI syncs against)', () => {
  test('create returns 201 with the record; persisted record is tenant-stamped', async () => {
    const res = await api(tokenA).post('/api/v1/employees').send(VALID_EMPLOYEE);
    expect(res.statusCode).toBe(201);
    expect(res.body.data.name).toBe('Ahmed Hassan');
    expect(res.body.data.id).toBeTruthy();
    // The create response does not echo tenantId (stamping happens at the
    // repository write), so verify scoping on the read-back record instead.
    const list = await api(tokenA).get('/api/v1/employees?search=Ahmed%20Hassan');
    const stored = list.body.data.employees.find((e) => e.name === 'Ahmed Hassan');
    expect(stored).toBeTruthy();
    expect(String(stored.tenantId)).toBe(TENANT_A);
  });

  test('create rejects invalid payload (no name) with 400', async () => {
    const res = await api(tokenA).post('/api/v1/employees').send({ position: 'x' });
    expect(res.statusCode).toBe(400);
  });

  test('rejects a foreign tenantId claim on create', async () => {
    const res = await api(tokenA).post('/api/v1/employees').send({ ...VALID_EMPLOYEE, name: 'Claim Jumper', tenantId: TENANT_B });
    expect(res.statusCode).toBe(400);
    const list = await api(tokenA).get('/api/v1/employees?limit=100');
    expect(JSON.stringify(list.body)).not.toContain('Claim Jumper');
  });

  test('lists employees for the calling tenant (legacy records included)', async () => {
    const res = await api(tokenA).get('/api/v1/employees?limit=100');
    expect(res.statusCode).toBe(200);
    const names = res.body.data.employees.map((e) => e.name);
    expect(names).toContain('Ahmed Hassan');
    expect(names).toContain('Legacy Employee');
  });

  test('updates by id and the change is persisted', async () => {
    const created = await api(tokenA).post('/api/v1/employees').send({ ...VALID_EMPLOYEE, name: 'Update Target' });
    const id = created.body.data.id;
    const upd = await api(tokenA).put('/api/v1/employees/' + encodeURIComponent(id)).send({ position: 'Senior Technician' });
    expect(upd.statusCode).toBe(200);
    expect(upd.body.data.position).toBe('Senior Technician');
    expect(upd.body.data.name).toBe('Update Target');
  });

  test('delete removes the record; second delete 404s (no resurrection)', async () => {
    const created = await api(tokenA).post('/api/v1/employees').send({ ...VALID_EMPLOYEE, name: 'Delete Target' });
    const id = created.body.data.id;
    const del = await api(tokenA).del('/api/v1/employees/' + encodeURIComponent(id));
    expect(del.statusCode).toBe(200);
    const again = await api(tokenA).del('/api/v1/employees/' + encodeURIComponent(id));
    expect(again.statusCode).toBe(404);
    const list = await api(tokenA).get('/api/v1/employees?limit=100');
    expect(list.body.data.employees.map((e) => e.name)).not.toContain('Delete Target');
  });

  test('stats returns count/active/withPhone', async () => {
    const res = await api(tokenA).get('/api/v1/employees/stats');
    expect(res.statusCode).toBe(200);
    expect(typeof res.body.data.count).toBe('number');
    expect(typeof res.body.data.active).toBe('number');
    expect(typeof res.body.data.withPhone).toBe('number');
    expect(res.body.data.count).toBeGreaterThanOrEqual(3);
  });
});

describe('employees tenant isolation', () => {
  test('tenant B never sees tenant A records', async () => {
    const resB = await api(tokenB).get('/api/v1/employees?limit=100');
    expect(resB.statusCode).toBe(200);
    const names = resB.body.data.employees.map((e) => e.name);
    expect(names).not.toContain('Ahmed Hassan');
    expect(names).not.toContain('Update Target');
    expect(names).not.toContain('Delete Target');
  });

  test('tenant B cannot update or delete a tenant A record (404 semantics)', async () => {
    const created = await api(tokenA).post('/api/v1/employees').send({ ...VALID_EMPLOYEE, name: 'A Only' });
    const id = created.body.data.id;
    const upd = await api(tokenB).put('/api/v1/employees/' + encodeURIComponent(id)).send({ position: 'Hacked' });
    expect(upd.statusCode).toBe(404);
    const del = await api(tokenB).del('/api/v1/employees/' + encodeURIComponent(id));
    expect(del.statusCode).toBe(404);
    const listA = await api(tokenA).get('/api/v1/employees?limit=100');
    const emp = listA.body.data.employees.find((e) => e.name === 'A Only');
    expect(emp.position).toBe('Technician');
  });

  test('duplicate id create is rejected', async () => {
    const first = await api(tokenA).post('/api/v1/employees').send({ ...VALID_EMPLOYEE, name: 'Dup One', id: 'dup-check-1' });
    expect(first.statusCode).toBe(201);
    const second = await api(tokenA).post('/api/v1/employees').send({ ...VALID_EMPLOYEE, name: 'Dup Two', id: 'dup-check-1' });
    expect(second.statusCode).toBe(400);
  });
});
