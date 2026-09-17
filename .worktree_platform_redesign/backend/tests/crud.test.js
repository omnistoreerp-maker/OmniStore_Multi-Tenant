// Parameterized CRUD tests: GET/POST/PUT/DELETE, 400, 404, stats
// for Users, Customers, Suppliers, Treasury, Employees.
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const MODULES = [
  {
    name: 'users',
    path: '/api/v1/users',
    listKey: 'users',
    create: { username: 'crud-user', password: 'Crud#1234', fullName: 'Crud User', role: 'Manager' },
    invalid: { fullName: 'no username here' },
    update: { fullName: 'Crud User Updated' },
    updatedField: ['fullName', 'Crud User Updated']
  },
  {
    name: 'customers',
    path: '/api/v1/customers',
    listKey: 'customers',
    create: { name: 'Crud Customer', phone: '0100000001', balance: 50 },
    invalid: { phone: '0100000002' },
    update: { phone: '0199999999' },
    updatedField: ['phone', '0199999999']
  },
  {
    name: 'suppliers',
    path: '/api/v1/suppliers',
    listKey: 'suppliers',
    create: { name: 'Crud Supplier', phone: '0100000003', email: 'sup@example.com' },
    invalid: { phone: '0100000004' },
    update: { email: 'updated@example.com' },
    updatedField: ['email', 'updated@example.com']
  },
  {
    name: 'treasury',
    path: '/api/v1/treasury',
    listKey: 'entries',
    create: { type: 'in', amount: 250, method: 'cash', desc: 'CRUD in' },
    invalid: { amount: 100 },
    update: { desc: 'CRUD in updated' },
    updatedField: ['desc', 'CRUD in updated']
  },
  {
    name: 'employees',
    path: '/api/v1/employees',
    listKey: 'employees',
    create: { name: 'Crud Employee', position: 'Technician', salary: 5000 },
    invalid: { position: 'Technician' },
    update: { salary: 6500 },
    updatedField: ['salary', 6500]
  }
];

let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  dataDir = makeTempDataDir('crud');
  server = await startServer(dataDir);
});

MODULES.forEach(mod => {
  describe(`CRUD ${mod.name}`, () => {
    let createdId;

    test('POST creates a record (201) with id and timestamps', async () => {
      const res = await request(server.app).post(mod.path).send(mod.create);
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeTruthy();
      expect(res.body.data.createdAt).toBeTruthy();
      expect(res.body.data.updatedAt).toBeTruthy();
      createdId = res.body.data.id;
    });

    test('POST with missing required field returns 400', async () => {
      const res = await request(server.app).post(mod.path).send(mod.invalid);
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('GET list returns the created record', async () => {
      const res = await request(server.app).get(mod.path);
      expect(res.statusCode).toBe(200);
      const items = res.body.data[mod.listKey];
      expect(Array.isArray(items)).toBe(true);
      expect(items.some(x => String(x.id) === String(createdId))).toBe(true);
      expect(typeof res.body.data.total).toBe('number');
    });

    test('GET by id returns the record', async () => {
      const res = await request(server.app).get(`${mod.path}/${createdId}`);
      expect(res.statusCode).toBe(200);
      expect(String(res.body.data.id)).toBe(String(createdId));
    });

    test('GET by unknown id returns 404', async () => {
      const res = await request(server.app).get(`${mod.path}/does-not-exist-12345`);
      expect(res.statusCode).toBe(404);
    });

    test('PUT updates the record', async () => {
      const res = await request(server.app).put(`${mod.path}/${createdId}`).send(mod.update);
      expect(res.statusCode).toBe(200);
      const [field, value] = mod.updatedField;
      expect(res.body.data[field]).toBe(value);
    });

    test('PUT with unknown id returns 404', async () => {
      const res = await request(server.app).put(`${mod.path}/does-not-exist-12345`).send(mod.update);
      expect(res.statusCode).toBe(404);
    });

    test('GET stats returns success payload', async () => {
      const res = await request(server.app).get(`${mod.path}/stats`);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).not.toBeNull();
    });

    test('DELETE removes the record', async () => {
      const res = await request(server.app).delete(`${mod.path}/${createdId}`);
      expect(res.statusCode).toBe(200);
    });

    test('GET after DELETE returns 404', async () => {
      const res = await request(server.app).get(`${mod.path}/${createdId}`);
      expect(res.statusCode).toBe(404);
    });

    test('DELETE with unknown id returns 404', async () => {
      const res = await request(server.app).delete(`${mod.path}/does-not-exist-12345`);
      expect(res.statusCode).toBe(404);
    });
  });
});
