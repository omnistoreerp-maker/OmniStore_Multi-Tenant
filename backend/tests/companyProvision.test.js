'use strict';

// COMPANY PROVISIONING — تهيئة شركة جديدة
//
// Exercises the backend provisioning endpoint (POST /api/v1/companies/provision)
// with full multi-tenant security invariants:
//   - only users with `company.create` (Owner/Admin bypass) may provision
//   - duplicate tenantId / duplicate code are rejected
//   - the new tenant gets its own company record, branch, owner user with
//     company-scoped membership, and optional opening treasury balance
//   - NO data is copied from the current tenant; the current tenant's stores
//     stay byte-identical
//   - the new owner can log in and the JWT carries the new tenantId
//   - cross-tenant reads/mutations stay blocked (isolation flags on)
//   - a failed provision leaves NO half-created tenant (compensating rollback)
//   - the password is never returned and never lands in the audit log

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');

const PASSWORD = 'Prov#1234';
const tempDirs = [];

const companies = {
  companies: [
    { id: 'cairotech', code: 'CAIROTECH', name: 'CairoTech', active: true },
    { id: 'digi', code: 'DIGI', name: 'DigiTronics', active: true }
  ]
};

function userRecords() {
  const stamp = new Date().toISOString();
  return [
    {
      id: 'u-owner', username: 'owner', password: PASSWORD, fullName: 'Owner',
      role: 'Owner', tenantIds: ['cairotech'], tenantRoles: { cairotech: 'Owner' },
      createdAt: stamp, updatedAt: stamp, tokenVersion: 0
    },
    {
      id: 'u-mgr', username: 'manager', password: PASSWORD, fullName: 'Manager',
      role: 'Manager', tenantIds: ['cairotech'], tenantRoles: { cairotech: 'Manager' },
      createdAt: stamp, updatedAt: stamp, tokenVersion: 0
    }
  ];
}

function seedAll(dir) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', { users: userRecords() });
  seed(dir, 'treasury', {
    entries: [
      { id: 't-1', type: 'in', amount: 500, balance: 500, desc: 'CairoTech cash', tenantId: 'cairotech', createdAt: new Date().toISOString() }
    ]
  });
}

describe('Company provisioning — تهيئة شركة جديدة', () => {
  let server;
  let dir;
  let ownerToken;   // Owner on cairotech
  let managerToken; // Manager on cairotech (no company.create)

  beforeAll(async () => {
    jest.resetModules();
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_TENANT_FILTERING = 'true';
    process.env.ENABLE_TENANT_ENTITY_ISOLATION = 'true';
    process.env.AUTH_REQUIRED = 'true';
    dir = makeTempDataDir('cprov');
    tempDirs.push(dir);
    seedAll(dir);
    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    server = s.app;

    const owner = await request(server).post('/api/v1/auth/login').send({ username: 'owner', password: PASSWORD, company: 'cairotech' });
    ownerToken = owner.body && owner.body.data ? owner.body.data.accessToken : null;
    const mgr = await request(server).post('/api/v1/auth/login').send({ username: 'manager', password: PASSWORD, company: 'cairotech' });
    managerToken = mgr.body && mgr.body.data ? mgr.body.data.accessToken : null;
    expect(ownerToken).toBeTruthy();
    expect(managerToken).toBeTruthy();
  });

  afterAll(() => {
    tempDirs.forEach(d => {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
    });
  });

  const validPayload = (overrides = {}) => ({
    companyName: 'TestCompany',
    companyId: 'testcompany',
    tenantId: 'testcompany',
    branchName: 'Main Branch',
    branchCode: 'MAIN',
    phone: '0111111111',
    email: 'tc@test.local',
    address: 'Cairo',
    currency: 'EGP',
    language: 'ar',
    adminUsername: 'tcadmin',
    adminDisplayName: 'TestCompany Admin',
    adminPassword: 'Tc#Pass123',
    openingBalance: 1000,
    ...overrides
  });

  test('unauthenticated provisioning is rejected (401)', async () => {
    const res = await request(server).post('/api/v1/companies/provision').send(validPayload());
    expect(res.status).toBe(401);
  });

  test('a user WITHOUT company.create permission is rejected (403)', async () => {
    const res = await request(server)
      .post('/api/v1/companies/provision')
      .set('Authorization', 'Bearer ' + managerToken)
      .send(validPayload());
    expect(res.status).toBe(403);
  });

  test('Owner can provision a new company (201)', async () => {
    const before = readStore(dir, 'companies');
    const res = await request(server)
      .post('/api/v1/companies/provision')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send(validPayload());
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(d.company.id).toBe('testcompany');
    expect(d.company.name).toBe('TestCompany');
    expect(d.company.active).toBe(true);
    expect(d.branch.id).toBe('MAIN');
    expect(d.admin.username).toBe('tcadmin');
    expect(d.admin.role).toBe('Owner');
    expect(d.openingBalance).toBe(1000);

    // The password must NEVER be returned (neither as a field nor as a value).
    expect(JSON.stringify(res.body)).not.toContain('Tc#Pass123');
    expect('password' in d.admin).toBe(false);

    // companies catalog got the new record; the old ones are untouched.
    const after = readStore(dir, 'companies');
    const arr = after.companies || after;
    expect(arr.some(c => c.id === 'testcompany')).toBe(true);
    expect(arr.filter(c => c.id === 'cairotech' || c.id === 'digi').length).toBe(2);
    const b = before.companies || before;
    expect(JSON.stringify(b.filter(c => c.id !== 'testcompany'))).toBe(
      JSON.stringify((after.companies || after).filter(c => c.id !== 'testcompany'))
    );
  });

  test('duplicate tenantId is rejected (400) and nothing changes', async () => {
    const before = readStore(dir, 'companies');
    const res = await request(server)
      .post('/api/v1/companies/provision')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send(validPayload({ adminUsername: 'tcadmin2' })); // same tenantId
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    const after = readStore(dir, 'companies');
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  test('duplicate username is rejected (400) and nothing changes', async () => {
    const before = readStore(dir, 'users');
    const res = await request(server)
      .post('/api/v1/companies/provision')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send(validPayload({ companyId: 'tc2', tenantId: 'tc2', adminUsername: 'tcadmin' }));
    expect(res.status).toBe(400);
    const after = readStore(dir, 'users');
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    // And the company was rolled back (no half-created tenant).
    const comps = readStore(dir, 'companies');
    const arr = comps.companies || comps;
    expect(arr.some(c => c.id === 'tc2')).toBe(false);
  });

  test('invalid tenantId / short password are rejected', async () => {
    const bad1 = await request(server)
      .post('/api/v1/companies/provision')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send(validPayload({ companyId: 'a b c!', tenantId: 'a b c!', adminUsername: 'tcadmin3' }));
    expect(bad1.status).toBe(400);

    const bad2 = await request(server)
      .post('/api/v1/companies/provision')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send(validPayload({ companyId: 'tc3', tenantId: 'tc3', adminUsername: 'tcadmin3', adminPassword: 'short' }));
    expect(bad2.status).toBe(400);
  });

  test('new tenant gets independent stores; no current-tenant data copied', async () => {
    // tcadmin (testcompany) must see ONLY its own opening entry.
    const login = await request(server).post('/api/v1/auth/login').send({
      username: 'tcadmin', password: 'Tc#Pass123', company: 'testcompany'
    });
    expect(login.status).toBe(200);
    const token = login.body.data.accessToken;

    // JWT carries the new tenantId.
    const payload = JSON.parse(Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    expect(payload.tenantId).toBe('testcompany');

    // New tenant sees its own treasury (opening balance 1000) only.
    const list = await request(server)
      .get('/api/v1/treasury')
      .set('Authorization', 'Bearer ' + token);
    expect(list.status).toBe(200);
    const entries = list.body.data.entries || [];
    expect(entries.length).toBe(1);
    expect(entries[0].amount).toBe(1000);
    expect(entries[0].tenantId).toBe('testcompany');
    expect(entries[0].desc).toContain('افتتاحي');
  });

  test('current tenant data is unchanged and invisible to the new tenant', async () => {
    // CairoTech's treasury still has its original single entry.
    const ct = await request(server)
      .get('/api/v1/treasury')
      .set('Authorization', 'Bearer ' + ownerToken);
    expect(ct.status).toBe(200);
    const ctEntries = ct.body.data.entries || [];
    expect(ctEntries.length).toBe(1);
    expect(ctEntries[0].desc).toBe('CairoTech cash');

    // The new tenant's login sees only its own entries (no CairoTech entry).
    const login = await request(server).post('/api/v1/auth/login').send({
      username: 'tcadmin', password: 'Tc#Pass123', company: 'testcompany'
    });
    const list = await request(server)
      .get('/api/v1/treasury')
      .set('Authorization', 'Bearer ' + login.body.data.accessToken);
    const entries = list.body.data.entries || [];
    expect(entries.some(e => e.desc === 'CairoTech cash')).toBe(false);
  });

  test('cross-tenant mutation is blocked; the other tenant survives', async () => {
    // New-tenant token tries to create a treasury entry stamped with cairotech.
    const login = await request(server).post('/api/v1/auth/login').send({
      username: 'tcadmin', password: 'Tc#Pass123', company: 'testcompany'
    });
    const token = login.body.data.accessToken;
    const res = await request(server)
      .post('/api/v1/treasury')
      .set('Authorization', 'Bearer ' + token)
      .send({ type: 'in', amount: 99, tenantId: 'cairotech', desc: 'foreign claim' });
    expect([400, 403, 404]).toContain(res.status);

    // CairoTech treasury untouched.
    const ct = await request(server)
      .get('/api/v1/treasury')
      .set('Authorization', 'Bearer ' + ownerToken);
    const ctEntries = ct.body.data.entries || [];
    expect(ctEntries.length).toBe(1);
    expect(ctEntries[0].desc).toBe('CairoTech cash');
  });

  test('new company appears in the login company catalog', async () => {
    const res = await request(server).get('/api/v1/companies/active');
    expect(res.status).toBe(200);
    const arr = res.body.data.companies || [];
    expect(arr.some(c => c.id === 'testcompany')).toBe(true);
    expect(arr.some(c => c.id === 'cairotech')).toBe(true);
  });

  test('audit log records COMPANY_CREATED without any password/secret', async () => {
    const store = readStore(dir, 'auditLog');
    const entries = (store && store.entries) || [];
    const created = entries.filter(e => e.action === 'COMPANY_CREATED');
    expect(created.length).toBeGreaterThan(0);
    const raw = JSON.stringify(created);
    expect(raw).toContain('testcompany');
    expect(raw).not.toContain('Tc#Pass123');
    expect(raw).not.toContain('password');
  });

  test('opening balance of 0 creates no treasury entry for the new tenant', async () => {
    const res = await request(server)
      .post('/api/v1/companies/provision')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send(validPayload({
        companyId: 'zeroco', tenantId: 'zeroco', adminUsername: 'zeroadmin', adminPassword: 'Zero#Pass123', openingBalance: 0
      }));
    expect(res.status).toBe(201);
    expect(res.body.data.openingBalance).toBe(0);

    const login = await request(server).post('/api/v1/auth/login').send({
      username: 'zeroadmin', password: 'Zero#Pass123', company: 'zeroco'
    });
    const list = await request(server)
      .get('/api/v1/treasury')
      .set('Authorization', 'Bearer ' + login.body.data.accessToken);
    const entries = list.body.data.entries || [];
    expect(entries.length).toBe(0);
  });
});
