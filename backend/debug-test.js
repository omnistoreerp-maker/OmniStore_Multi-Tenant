const { makeTempDataDir, seed, readStore } = require('./tests/helpers/testData');
const { startServer } = require('./tests/helpers/testServer');
const request = require('supertest');
const bcrypt = require('bcryptjs');

function hash(pw) { return bcrypt.hashSync(pw, 10); }

const users = { users: [
  { id: 'u-a', username: 'adminA', password: hash('Pass#123'), role: 'Owner', fullName: 'Admin A', tenantIds: ['corp-a'], tenantRoles: { 'corp-a': 'Owner' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
]};

const customers = {
  customers: [
    { id: 'cust-a1', name: 'Alice A', phone: '0100000001', balance: 10, tenantId: 'corp-a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'cust-b1', name: 'Bob B', phone: '0100000002', balance: 20, tenantId: 'corp-b', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  ]
};

async function main() {
  process.env.ENABLE_TENANT_ROLES = 'true';
  process.env.ENABLE_TENANT_CARRY = 'true';
  process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
  process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
  process.env.ENABLE_TENANT_FILTERING = 'true';
  process.env.ENABLE_TENANT_METADATA = 'true';
  process.env.ENABLE_TENANT_SALES_ISOLATION = 'true';
  process.env.AUTH_REQUIRED = 'true';

  const dir = makeTempDataDir('debug-test');
  seed(dir, 'users', users);
  seed(dir, 'customers', customers);

  const s = startServer(dir, { AUTH_REQUIRED: 'true' });
  const app = s.app;

  const loginRes = await request(app).post('/api/v1/auth/login').send({ username: 'adminA', password: 'Pass#123', company: 'corp-a' });
  const token = loginRes.body.data.accessToken;

  console.log('Token obtained:', !!token);

  const res = await request(app).post('/api/v1/sales').send({
    id: 'INV-DEBUG',
    items: [{ productId: 'p1', qty: 1, price: 100, total: 100 }],
    total: 100,
    customerId: 'cust-b1'
  }).set('Authorization', `Bearer ${token}`);

  console.log('Status:', res.statusCode);
  console.log('Body:', JSON.stringify(res.body, null, 2));
}

main().catch(console.error);
