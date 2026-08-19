'use strict';

// Branch Isolation Test Suite (Phase F)
// Enforces ENABLE_BRANCH_ISOLATION server-side behaviour:
//   - the trusted branch comes from the STORED user record, never from the
//     client (body/query/headers);
//   - branch-scoped users are confined to their own branch for reads, creates
//     and cross-branch access attempts;
//   - client branchId/branch override attempts are rejected 403
//     BRANCH_SCOPE_DENIED;
//   - users WITHOUT a branch scope (Owner/Admin/...) are never restricted.
//
// ENABLE_TENANT_* isolation is intentionally OFF here so the tests exercise
// the legacy single-store read-modify-write path.

const fs = require('fs');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

function hash(pw) { return bcrypt.hashSync(pw, 10); }

const now = new Date().toISOString();
const USERS = { users: [
  { id: 'u-owner', username: 'owner1', password: hash('Owner#123'), role: 'Owner', fullName: 'Owner One', createdAt: now, updatedAt: now },
  { id: 'u-bm-main', username: 'bmmain', password: hash('Main#1234'), role: 'BranchManager', fullName: 'Main Branch Manager', branchId: 'MAIN', createdAt: now, updatedAt: now },
  { id: 'u-bm-other', username: 'bmother', password: hash('Other#123'), role: 'BranchManager', fullName: 'Other Branch Manager', branchId: 'OTHER', createdAt: now, updatedAt: now }
]};

let server;
let dataDir;
let ownerToken, mainToken, otherToken;

registerCleanup(() => [server], () => [dataDir]);

async function loginAs(app, username, password) {
  const res = await request(app).post('/api/v1/auth/login').send({ username, password });
  if (res.statusCode !== 200) throw new Error(`login(${username}) failed: ${res.statusCode} ${JSON.stringify(res.body)}`);
  return res.body.data.accessToken;
}

function salePayload(id) {
  return { id, items: [{ productId: 'p1', qty: 1, price: 10 }], total: 10, customer: 'Test', payment: 'cash' };
}

function purchasePayload(id) {
  return { id, items: [{ productId: 'p1', qty: 1, price: 10 }], total: 10, supplier: 'Test', payment: 'cash' };
}

beforeAll(async () => {
  process.env.AUTH_REQUIRED = 'true';
  process.env.ENABLE_BRANCH_ISOLATION = 'true';
  dataDir = makeTempDataDir('branch-isolation');
  seed(dataDir, 'users', USERS);
  server = await startServer(dataDir, { AUTH_REQUIRED: 'true' });

  ownerToken = await loginAs(server.app, 'owner1', 'Owner#123');
  mainToken = await loginAs(server.app, 'bmmain', 'Main#1234');
  otherToken = await loginAs(server.app, 'bmother', 'Other#123');
});

afterAll(() => {
  if (dataDir) { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {} }
  delete process.env.AUTH_REQUIRED;
  delete process.env.ENABLE_BRANCH_ISOLATION;
});

describe('Branch isolation — server-authoritative stamping, no client branch choice', () => {
  test('BranchManager (MAIN) creates a sale with NO branch input and is server-stamped MAIN', async () => {
    const res = await request(server.app).post('/api/v1/sales')
      .set('Authorization', 'Bearer ' + mainToken)
      .send(salePayload('MAIN-OWN-SALE'));
    expect(res.statusCode).toBe(201);
    expect(res.body.data.branchId).toBe('MAIN');
  });

  test('BranchManager (MAIN) creating a sale claiming branchId OTHER is rejected 403', async () => {
    const res = await request(server.app).post('/api/v1/sales')
      .set('Authorization', 'Bearer ' + mainToken)
      .send({ ...salePayload('X-SALE-1'), branchId: 'OTHER' });
    expect(res.statusCode).toBe(403);
    expect(res.body.details).toBe('BRANCH_SCOPE_DENIED');
  });

  test('BranchManager (MAIN) creating a sale claiming branch OTHER (alias field) is rejected 403', async () => {
    const res = await request(server.app).post('/api/v1/sales')
      .set('Authorization', 'Bearer ' + mainToken)
      .send({ ...salePayload('X-SALE-2'), branch: 'OTHER' });
    expect(res.statusCode).toBe(403);
  });

  test('BranchManager (MAIN) creates a purchase and is server-stamped MAIN', async () => {
    const res = await request(server.app).post('/api/v1/purchases')
      .set('Authorization', 'Bearer ' + mainToken)
      .send(purchasePayload('MAIN-OWN-PUR'));
    expect(res.statusCode).toBe(201);
    expect(res.body.data.branchId).toBe('MAIN');
  });

  test('BranchManager (MAIN) creating a purchase claiming branchId OTHER is rejected 403', async () => {
    const res = await request(server.app).post('/api/v1/purchases')
      .set('Authorization', 'Bearer ' + mainToken)
      .send({ ...purchasePayload('X-PUR-1'), branchId: 'OTHER' });
    expect(res.statusCode).toBe(403);
    expect(res.body.details).toBe('BRANCH_SCOPE_DENIED');
  });
});

describe('Branch isolation — read-scoping and cross-branch reads', () => {
  test('BranchManager (MAIN) list read is scoped server-side (no cross-branch leakage)', async () => {
    const createdMain = await request(server.app).post('/api/v1/sales')
      .set('Authorization', 'Bearer ' + mainToken)
      .send(salePayload('MAIN-1'));
    expect(createdMain.statusCode).toBe(201);

    const createdOther = await request(server.app).post('/api/v1/sales')
      .set('Authorization', 'Bearer ' + otherToken)
      .send(salePayload('OTHER-1'));
    expect(createdOther.statusCode).toBe(201);

    const asOther = await request(server.app).get('/api/v1/sales').set('Authorization', 'Bearer ' + otherToken);
    expect(asOther.statusCode).toBe(200);
    const otherIds = (asOther.body.data.invoices || []).map(i => String(i.id));
    expect(otherIds).toContain('OTHER-1');
    expect(otherIds).not.toContain('MAIN-1');

    const asMain = await request(server.app).get('/api/v1/sales').set('Authorization', 'Bearer ' + mainToken);
    expect(asMain.statusCode).toBe(200);
    const mainIds = (asMain.body.data.invoices || []).map(i => String(i.id));
    expect(mainIds).toContain('MAIN-1');
    expect(mainIds).not.toContain('OTHER-1');
  });

  test('BranchManager (MAIN) CANNOT read a sale by ID from branch OTHER (404)', async () => {
    const res = await request(server.app).get('/api/v1/sales/OTHER-1').set('Authorization', 'Bearer ' + mainToken);
    expect(res.statusCode).toBe(404);
  });

  test('BranchManager (OTHER) CAN read its own sale by ID (200)', async () => {
    const res = await request(server.app).get('/api/v1/sales/OTHER-1').set('Authorization', 'Bearer ' + otherToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.branchId).toBe('OTHER');
  });

  test('BranchManager (MAIN) CANNOT update a sale from branch OTHER (404)', async () => {
    const res = await request(server.app).put('/api/v1/sales/OTHER-1')
      .set('Authorization', 'Bearer ' + mainToken)
      .send({ total: 999 });
    expect(res.statusCode).toBe(404);
  });

  test('BranchManager (MAIN) CAN update its own sale (200)', async () => {
    const res = await request(server.app).put('/api/v1/sales/MAIN-1')
      .set('Authorization', 'Bearer ' + mainToken)
      .send({ total: 20 });
    expect(res.statusCode).toBe(200);
  });

  test('BranchManager (MAIN) cannot DELETE a sale (no sales.delete)', async () => {
    const res = await request(server.app).delete('/api/v1/sales/OTHER-1').set('Authorization', 'Bearer ' + mainToken);
    expect(res.statusCode).toBe(403);
  });
});

describe('Branch isolation — purchase cross-branch reads and updates', () => {
  test('BranchManager (OTHER) creates a purchase and is server-stamped OTHER', async () => {
    const res = await request(server.app).post('/api/v1/purchases')
      .set('Authorization', 'Bearer ' + otherToken)
      .send(purchasePayload('OTHER-PUR-1'));
    expect(res.statusCode).toBe(201);
    expect(res.body.data.branchId).toBe('OTHER');
  });

  test('BranchManager (MAIN) CANNOT read a purchase by ID from branch OTHER (404)', async () => {
    const res = await request(server.app).get('/api/v1/purchases/OTHER-PUR-1').set('Authorization', 'Bearer ' + mainToken);
    expect(res.statusCode).toBe(404);
  });

  test('BranchManager (OTHER) CAN read its own purchase by ID (200)', async () => {
    const res = await request(server.app).get('/api/v1/purchases/OTHER-PUR-1').set('Authorization', 'Bearer ' + otherToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.branchId).toBe('OTHER');
  });

  test('BranchManager (MAIN) CANNOT update a purchase from branch OTHER (404) and the record is untouched', async () => {
    const res = await request(server.app).put('/api/v1/purchases/OTHER-PUR-1')
      .set('Authorization', 'Bearer ' + mainToken)
      .send({ total: 999 });
    expect(res.statusCode).toBe(404);

    const after = await request(server.app).get('/api/v1/purchases/OTHER-PUR-1').set('Authorization', 'Bearer ' + otherToken);
    expect(after.statusCode).toBe(200);
    expect(after.body.data.total).toBe(10);
  });
});

describe('Branch isolation — client branch override on reads is rejected', () => {
  test('GET /sales?branch=OTHER as MAIN is rejected 403', async () => {
    const res = await request(server.app).get('/api/v1/sales?branch=OTHER').set('Authorization', 'Bearer ' + mainToken);
    expect(res.statusCode).toBe(403);
  });

  test('GET /sales?branchId=OTHER as MAIN is rejected 403', async () => {
    const res = await request(server.app).get('/api/v1/sales?branchId=OTHER').set('Authorization', 'Bearer ' + mainToken);
    expect(res.statusCode).toBe(403);
  });

  test('GET /purchases?branch=OTHER as MAIN is rejected 403', async () => {
    const res = await request(server.app).get('/api/v1/purchases?branch=OTHER').set('Authorization', 'Bearer ' + mainToken);
    expect(res.statusCode).toBe(403);
  });
});

describe('Branch isolation — unscoped users (Owner) are never restricted', () => {
  test('Owner creates a sale unrooted to a branch (no stamp)', async () => {
    const res = await request(server.app).post('/api/v1/sales')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send(salePayload('OWNER-1'));
    expect(res.statusCode).toBe(201);
    expect(res.body.data.branchId).toBeUndefined();
  });

  test('Owner can read sales across ALL branches (no scope, no filter)', async () => {
    const res = await request(server.app).get('/api/v1/sales').set('Authorization', 'Bearer ' + ownerToken);
    expect(res.statusCode).toBe(200);
    const ids = (res.body.data.invoices || []).map(i => String(i.id));
    expect(ids).toContain('MAIN-1');
    expect(ids).toContain('OTHER-1');
  });

  test('Owner is allowed to use the branch query filter (unscoped)', async () => {
    const res = await request(server.app).get('/api/v1/sales?branch=OTHER').set('Authorization', 'Bearer ' + ownerToken);
    expect(res.statusCode).toBe(200);
  });
});