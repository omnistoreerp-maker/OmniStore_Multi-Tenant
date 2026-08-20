'use strict';

// v1.0.1 — CROSS-TENANT WRITE-SAFETY REGRESSION SUITES.
//
// Reproduces the Production Security Regression Audit CRITICAL-HIGH finding:
//  - the legacy read()-filtered / write()-full services (employees, partners,
//    vouchers, suppliers, users, reports, dashboard, auditLog) could DROP
//    another tenant's records when the FIRST tenant to mutate a shared store
//    persisted its own (tenantly filtered) view over the full document.
//
// Enabled posture: ENABLE_TENANT_CARRY + ENABLE_MULTI_COMPANY_LOGIN (bind the
// chosen company into the signed token), ENABLE_TENANT_METADATA (stamp new
// records with tenantId on CREATE) and ENABLE_TENANT_FILTERING (reads are
// scoped to the carrying tenant). This is exactly the combination that
// activated the vulnerability.
//
// Assertions:
//  - Tenant A and Tennant B records COEXIST on disk after interleaved writes.
//  - A tenant can only mutate/delete its OWN records (ownership guard).
//  - Read isolation stays intact (each tenant only sees its own records).
//  - A tenant DELETE of its own record never erases the other tenant's data.

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const ORIGINAL_ENV = {
  CARRY: process.env.ENABLE_TENANT_CARRY,
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  METADATA: process.env.ENABLE_TENANT_METADATA,
  FILTER: process.env.ENABLE_TENANT_FILTERING,
  AUTH: process.env.AUTH_REQUIRED,
  DATA: process.env.DIGITRONICS_DATA_DIR
};

const companies = [
  { id: 'acme', name: 'Acme Trading', code: 'ACME', active: true },
  { id: 'zeta', name: 'Zeta Goods', code: 'ZETA', active: true }
];

const PASSWORD = 'Pass#123';
let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  for (const key of ['ENABLE_TENANT_CARRY', 'ENABLE_MULTI_COMPANY_LOGIN', 'ENABLE_TENANT_METADATA', 'ENABLE_TENANT_FILTERING']) {
    process.env[key] = 'true';
  }
  dataDir = makeTempDataDir('v101-write-safety');
  seed(dataDir, 'companies', companies);
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const stamp = new Date().toISOString();
  seed(dataDir, 'users', {
    users: [
      { id: 'u-acme', username: 'acmeOwner', password: hash, fullName: 'Acme Owner', role: 'Owner', tenantId: 'acme', tenantIds: ['acme'], createdAt: stamp, updatedAt: stamp },
      { id: 'u-zeta', username: 'zetaOwner', password: hash, fullName: 'Zeta Owner', role: 'Owner', tenantId: 'zeta', tenantIds: ['zeta'], createdAt: stamp, updatedAt: stamp }
    ]
  });
  server = await startServer(dataDir, { AUTH_REQUIRED: 'true' });
});

afterAll(() => {
  for (const [key, original] of Object.entries(ORIGINAL_ENV)) {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

async function tokenFor(tenant) {
  const session = await login(server.app, tenant === 'acme' ? 'acmeOwner' : 'zetaOwner', PASSWORD, tenant);
  return session.accessToken;
}

// CRUD-shaped stores exercised end-to-end over the shared document.
const TENANT_STORES = [
  { store: 'employees', listKey: 'employees', make: (t, n) => ({ name: `${t} Employee ${n}`, position: 'Technician', salary: 2000 }) },
  { store: 'partners', listKey: 'partners', make: (t, n) => ({ name: `${t} Partner ${n}`, capital: 1000 }) },
  { store: 'vouchers', listKey: 'vouchers', make: (t, n) => ({ type: 'receipt', partyName: `${t} Voucher ${n}`, amount: 500 }) },
  { store: 'suppliers', listKey: 'suppliers', make: (t, n) => ({ name: `${t} Supplier ${n}`, email: 'sup@example.com' }) }
];

describe('v1.0.1 — interleaved cross-tenant writes never drop the other tenant', () => {
  for (const { store, listKey, make } of TENANT_STORES) {
    const base = `/api/v1/${store}`;

    test(`${store}: Tenant A create, Tenant B create, then alternating updates/deletes keep BOTH on disk`, async () => {
      const aToken = await tokenFor('acme');
      const bToken = await tokenFor('zeta');

      const a1 = await request(server.app).post(base).set(authHeader(aToken)).send(make('acme', '1'));
      expect(a1.statusCode).toBe(201);
      const aId = a1.body.data.id;

      const b1 = await request(server.app).post(base).set(authHeader(bToken)).send(make('zeta', '1'));
      expect(b1.statusCode).toBe(201);
      const bId = b1.body.data.id;

      // Both records must be present on disk right after two tenants wrote.
      const afterCreate = readStore(dataDir, store)[listKey];
      expect(afterCreate.length).toBe(2);
      const idsAfterCreate = afterCreate.map(r => String(r.id));
      expect(idsAfterCreate).toEqual(expect.arrayContaining([String(aId), String(bId)]));

      // Tenant A updates its own record — Tenant B's record must survive.
      const upd = await request(server.app).put(`${base}/${aId}`).set(authHeader(aToken)).send({ name: 'Acme Renamed' });
      expect(upd.statusCode).toBe(200);
      const afterUpdate = readStore(dataDir, store)[listKey];
      expect(afterUpdate.length).toBe(2);
      expect(afterUpdate.some(r => String(r.id) === String(bId))).toBe(true);

      // Tenant A cannot update or delete Tenant B's record (ownership guard).
      const foreignUpd = await request(server.app).put(`${base}/${bId}`).set(authHeader(aToken)).send({ name: 'Hijacked' });
      expect(foreignUpd.statusCode).toBe(404);
      const foreignDel = await request(server.app).delete(`${base}/${bId}`).set(authHeader(aToken));
      expect(foreignDel.statusCode).toBe(404);
      const afterBlocked = readStore(dataDir, store)[listKey];
      expect(afterBlocked.length).toBe(2);
      expect(afterBlocked.some(r => String(r.id) === String(bId))).toBe(true);

      // Read isolation: Tenant A sees only its own record.
      const aList = await request(server.app).get(base).set(authHeader(aToken));
      expect(aList.statusCode).toBe(200);
      expect(aList.body.data[listKey].length).toBe(1);
      expect(String(aList.body.data[listKey][0].id)).toBe(String(aId));

      // Tenant A deletes its own record — Tenant B's record must survive.
      const del = await request(server.app).delete(`${base}/${aId}`).set(authHeader(aToken));
      expect(del.statusCode).toBe(200);
      const afterDelete = readStore(dataDir, store)[listKey];
      expect(afterDelete.length).toBe(1);
      expect(String(afterDelete[0].id)).toBe(String(bId));
    });
  }
});

describe('v1.0.1 — users store write safety', () => {
  test('Tenant A update/delete of its own user never drops Tenant B user records', async () => {
    const aToken = await tokenFor('acme');
    const bToken = await tokenFor('zeta');

    // Sanity: both seeded users exist on disk.
    expect(readStore(dataDir, 'users').users.length).toBe(2);

    // Tenant A updates its own user.
    const upd = await request(server.app).put('/api/v1/users/u-acme').set(authHeader(aToken)).send({ fullName: 'Acme Owner Renamed' });
    expect(upd.statusCode).toBe(200);
    const afterUpdate = readStore(dataDir, 'users').users;
    expect(afterUpdate.length).toBe(2);
    expect(afterUpdate.some(u => u.id === 'u-zeta')).toBe(true);

    // Tenant A cannot delete Tenant B's user (ownership guard).
    const foreignDel = await request(server.app).delete('/api/v1/users/u-zeta').set(authHeader(aToken));
    expect(foreignDel.statusCode).toBe(404);
    expect(readStore(dataDir, 'users').users.some(u => u.id === 'u-zeta')).toBe(true);

    // Read isolation for the users directory.
    const aList = await request(server.app).get('/api/v1/users').set(authHeader(aToken));
    expect(aList.statusCode).toBe(200);
    const names = aList.body.data.users.map(u => u.username);
    expect(names).toContain('acmeOwner');
    expect(names).not.toContain('zetaOwner');

    // Tenant B sees its own user and nothing else.
    const bList = await request(server.app).get('/api/v1/users').set(authHeader(bToken));
    expect(bList.statusCode).toBe(200);
    const bNames = bList.body.data.users.map(u => u.username);
    expect(bNames).toContain('zetaOwner');
    expect(bNames).not.toContain('acmeOwner');
  });
});

describe('v1.0.1 — CREATE cannot claim a foreign tenant (server-side enforcement)', () => {
  // Every store that received the service-level "Invalid tenant claim" guard.
  const CREATE_STORES = [
    { store: 'partners', listKey: 'partners', make: () => ({ name: 'Foreign Partner', capital: 500 }) },
    { store: 'vouchers', listKey: 'vouchers', make: () => ({ type: 'receipt', partyName: 'Foreign Voucher', amount: 100 }) },
    { store: 'employees', listKey: 'employees', make: () => ({ name: 'Foreign Employee', position: 'Technician', salary: 1000 }) },
    { store: 'suppliers', listKey: 'suppliers', make: () => ({ name: 'Foreign Supplier', email: 'sup@example.com' }) },
    { store: 'reports', listKey: 'reports', make: () => ({ type: 'summary', title: 'Foreign Report' }) },
    { store: 'dashboard', listKey: 'dashboard', make: () => ({ key: 'foreign_kpi', value: 1 }) }
  ];

  for (const { store, listKey, make } of CREATE_STORES) {
    test(`${store}: POST with a foreign tenantId is rejected and leaves no record or side effect`, async () => {
      const aToken = await tokenFor('acme');
      // Byte-exact baseline BEFORE the attempt: proves no mutation of any kind.
      // The store file may not exist yet (reports/dashboard) — treat as empty.
      const snapDoc = readStore(dataDir, store) || {};
      const snapshot = JSON.stringify(snapDoc[listKey] || []);

      const res = await request(server.app)
        .post(`/api/v1/${store}`)
        .set(authHeader(aToken))
        .send({ ...make(), tenantId: 'zeta' });
      expect(res.statusCode).toBe(400);

      const after = (readStore(dataDir, store) || {})[listKey] || [];
      expect(after.length).toBe(JSON.parse(snapshot).length);
      // The foreign claim created NOTHING under Tenant B and mutated nothing
      // outside Tenant A: the collection is byte-identical to before.
      expect(JSON.stringify(after)).toBe(snapshot);
    });

    if (['partners', 'vouchers', 'employees', 'suppliers'].includes(store)) {
      test(`${store}: a matching own-tenant claim is accepted and bound to Tenant A`, async () => {
        const aToken = await tokenFor('acme');
        const before = readStore(dataDir, store)[listKey].length;
        const res = await request(server.app)
          .post(`/api/v1/${store}`)
          .set(authHeader(aToken))
          .send({ ...make(), tenantId: 'acme' });
        expect(res.statusCode).toBe(201);

        const stored = readStore(dataDir, store)[listKey];
        expect(stored.length).toBe(before + 1);
        const rec = stored.find(r => String(r.id) === String(res.body.data.id));
        expect(String(rec.tenantId)).toBe('acme');

        // Cleanup: Tenant A owns this record, so it can delete it again.
        const del = await request(server.app).delete(`/api/v1/${store}/${res.body.data.id}`).set(authHeader(aToken));
        expect(del.statusCode).toBe(200);
      });
    }
  }
});

describe('v1.0.1 — users.createTenantScoped enforces the server-side tenant', () => {
  test('client tenantId/tenantIds/tenantRoles cannot move a new user into Tenant B', async () => {
    const aToken = await tokenFor('acme');
    const base = { username: 'intruder', password: 'Pass#123', fullName: 'Intruder', role: 'Manager' };

    for (const claimer of [
      (b) => ({ ...b, tenantId: 'zeta' }),
      (b) => ({ ...b, tenantIds: ['zeta'] }),
      (b) => ({ ...b, tenantRoles: { zeta: 'Owner' } })
    ]) {
      const res = await request(server.app).post('/api/v1/users').set(authHeader(aToken)).send(claimer(base));
      expect(res.statusCode).toBe(403);
    }

    const disk = readStore(dataDir, 'users').users;
    expect(disk.some(u => u.username === 'intruder')).toBe(false);
    expect(disk.filter(u => u.username === 'acmeOwner')).toHaveLength(1);
    expect(disk.filter(u => u.username === 'zetaOwner')).toHaveLength(1);
  });

  test('a user created inside Tenant A is stamped server-side with Tenant A membership', async () => {
    const aToken = await tokenFor('acme');
    const res = await request(server.app)
      .post('/api/v1/users')
      .set(authHeader(aToken))
      .send({ username: 'acmeNewMgr', password: 'Pass#123', fullName: 'New Mgr', role: 'Manager' });
    expect(res.statusCode).toBe(201);
    const userId = res.body.data.id;

    const rec = readStore(dataDir, 'users').users.find(u => u.username === 'acmeNewMgr');
    expect(rec).toBeDefined();
    expect(rec.tenantIds).toEqual(['acme']);
    expect(rec.tenantRoles.acme).toBe('Manager');
    // The tenant identity is enforced server-side: the metadata stamp bound the
    // record to Tenant A (the current trusted tenant), never to Tenant B.
    expect(rec.tenantId).toBe('acme');

    const del = await request(server.app).delete(`/api/v1/users/${userId}`).set(authHeader(aToken));
    expect(del.statusCode).toBe(200);
    expect(readStore(dataDir, 'users').users.some(u => u.username === 'acmeNewMgr')).toBe(false);
  });
});