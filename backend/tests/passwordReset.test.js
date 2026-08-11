'use strict';

// Phase D — admin reset-password endpoint. Part 1 runs with tenant features OFF
// (legacy space): authorization, self-reset, 404, policy on the new password.
// Part 2 runs with the full tenant stack ON and proves cross-tenant resets are
// rejected with PERMISSION_DENIED no matter how the attacker supplies a tenant.

const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { readStore, seed } = require('./helpers/testData');
const { createUser, login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const PW = 'Reset#123';

function storedUser(dataDir, id) {
  return readStore(dataDir, 'users').users.find((u) => u.id === id);
}

async function expectDead(server, accessToken) {
  const gate = await request(server).get('/api/v1/permissions').set(authHeader(accessToken));
  expect(gate.statusCode).toBe(401);
  const me = await request(server).get('/api/v1/auth/me').set(authHeader(accessToken));
  expect(me.statusCode).toBe(400);
}

// ---------------------------------------------------------------------------
// Part 1 — legacy space (tenancy off)
// ---------------------------------------------------------------------------
describe('Phase D — reset-password (tenant features OFF)', () => {
  let server;
  let dataDir;

  registerCleanup(() => [server], () => [dataDir]);

  beforeAll(async () => {
    const s = await startServer();
    server = s.app;
    dataDir = s.dataDir;
  });

  async function mk(username, role, extra) {
    return createUser(server, { username, password: PW, fullName: username, role: role || 'Cashier', extra });
  }

  test('Owner resets another user: 200, bcrypt, tokenVersion bumped, old tokens invalid', async () => {
    const sub = await mk('subbie', 'Cashier');
    const root = await mk('root', 'Owner');
    const subSession = await login(server, 'subbie', PW);
    const rootSession = await login(server, 'root', PW);
    const oldHash = storedUser(dataDir, sub.id).password;

    const res = await request(server)
      .post(`/api/v1/users/${sub.id}/reset-password`)
      .set(authHeader(rootSession.accessToken))
      .send({ newPassword: 'NewReset#789' });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeNull();

    const stored = storedUser(dataDir, sub.id);
    expect(stored.password).not.toBe(oldHash);
    expect(stored.password.startsWith('$2')).toBe(true);
    expect(stored.tokenVersion).toBe(1);

    await expectDead(server, subSession.accessToken);
    const refOld = await request(server).post('/api/v1/auth/refresh').send({ refreshToken: subSession.refreshToken });
    expect(refOld.statusCode).toBe(401);

    const s2 = await login(server, 'subbie', 'NewReset#789');
    expect(s2.user.password).toBeUndefined();
  });

  test('manager without users.password.reset → 403 PERMISSION_DENIED', async () => {
    const sub = await mk('subbie2', 'Cashier');
    const manager = await mk('man', 'Manager');
    const m = await login(server, 'man', PW);
    const res = await request(server)
      .post(`/api/v1/users/${sub.id}/reset-password`)
      .set(authHeader(m.accessToken))
      .send({ newPassword: 'X#9999999' });
    expect(res.statusCode).toBe(403);
    expect(res.body.details && res.body.details.code).toBe('PERMISSION_DENIED');
    expect(storedUser(dataDir, sub.id).password).not.toContain('X#9999999');
  });

  test('unauthenticated → 401', async () => {
    const sub = await mk('subbie3', 'Cashier');
    const res = await request(server)
      .post(`/api/v1/users/${sub.id}/reset-password`)
      .send({ newPassword: 'X#9999999' });
    expect(res.statusCode).toBe(401);
  });

  test('self-reset → 400 (use change-password instead)', async () => {
    const root = await mk('root2', 'Owner');
    const r = await login(server, 'root2', PW);
    const res = await request(server)
      .post(`/api/v1/users/${r.user.id}/reset-password`)
      .set(authHeader(r.accessToken))
      .send({ newPassword: 'X#9999999' });
    expect(res.statusCode).toBe(400);
  });

  test('unknown target → 404', async () => {
    const root = await mk('root3', 'Owner');
    const r = await login(server, 'root3', PW);
    const res = await request(server)
      .post('/api/v1/users/ghost-user-123/reset-password')
      .set(authHeader(r.accessToken))
      .send({ newPassword: 'X#9999999' });
    expect(res.statusCode).toBe(404);
  });

  test('weak new password → 400 PASSWORD_POLICY_VIOLATION; nothing written', async () => {
    const sub = await mk('subbie4', 'Cashier');
    const root = await mk('root4', 'Owner');
    const r = await login(server, 'root4', PW);
    const before = storedUser(dataDir, sub.id).password;
    const res = await request(server)
      .post(`/api/v1/users/${sub.id}/reset-password`)
      .set(authHeader(r.accessToken))
      .send({ newPassword: 'abc' });
    expect(res.statusCode).toBe(400);
    expect(res.body.details && res.body.details.code).toBe('PASSWORD_POLICY_VIOLATION');
    expect(storedUser(dataDir, sub.id).password).toBe(before);
    expect(storedUser(dataDir, sub.id).tokenVersion).toBe(0);
  });

  test('missing newPassword → 400', async () => {
    const sub = await mk('subbie5', 'Cashier');
    const root = await mk('root5', 'Owner');
    const r = await login(server, 'root5', PW);
    const res = await request(server)
      .post(`/api/v1/users/${sub.id}/reset-password`)
      .set(authHeader(r.accessToken))
      .send({});
    expect(res.statusCode).toBe(400);
  });

  test('records USER_PASSWORD_RESET events without plaintext passwords', async () => {
    const raw = JSON.stringify(readStore(dataDir, 'auditLog').entries);
    const events = readStore(dataDir, 'auditLog').entries.filter((e) => e.action === 'USER_PASSWORD_RESET');
    expect(events.length).toBeGreaterThan(0);
    expect(raw).not.toContain('NewReset#789');
    expect(raw).not.toContain('X#9999999');
  });
});

// ---------------------------------------------------------------------------
// Part 2 — tenant stack ON: cross-tenant isolation (the security test)
// ---------------------------------------------------------------------------
describe('Phase D — reset-password cross-tenant isolation (features ON)', () => {
  const TENANT_FLAGS = ['ENABLE_TENANT_ROLES', 'ENABLE_TENANT_CARRY', 'ENABLE_MULTI_COMPANY_LOGIN', 'ENABLE_TENANT_USER_MEMBERSHIP'];
  const ORIGINAL_ENV = {};
  for (const key of TENANT_FLAGS) ORIGINAL_ENV[key] = process.env[key];

  let server;
  let dataDir;

  registerCleanup(() => [server], () => [dataDir]);

  beforeAll(async () => {
    for (const key of TENANT_FLAGS) process.env[key] = 'true';
    const s = await startServer();
    server = s.app;
    dataDir = s.dataDir;
    seed(dataDir, 'companies', [
      { id: 'at', name: 'A Corp', active: true },
      { id: 'bt', name: 'B Corp', active: true }
    ]);
    const mkUser = async (payload) => {
      const res = await request(server).post('/api/v1/users').send(payload);
      if (res.statusCode !== 201) throw new Error(`mk ${payload.username}: ${res.statusCode} ${JSON.stringify(res.body)}`);
    };
    await mkUser({ id: 'u-adm', username: 'adm', password: 'Adm#12345', fullName: 'Admin', role: 'Admin', tenantIds: ['at', 'bt'], tenantRoles: { at: 'Admin', bt: 'Admin' } });
    await mkUser({ id: 'u-a', username: 'tA', password: 'Ten#12345', fullName: 'Tenant A', role: 'Cashier', tenantIds: ['at'], tenantRoles: { at: 'Cashier' } });
    await mkUser({ id: 'u-b', username: 'tB', password: 'Ten#12345', fullName: 'Tenant B', role: 'Cashier', tenantIds: ['bt'], tenantRoles: { bt: 'Cashier' } });
  });

  afterAll(() => {
    for (const key of TENANT_FLAGS) {
      if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
      else process.env[key] = ORIGINAL_ENV[key];
    }
  });

  async function loginOn(username, password, company) {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send(company ? { username, password, company } : { username, password });
    if (res.statusCode !== 200) throw new Error(`loginOn(${username}) failed: ${res.statusCode} ${JSON.stringify(res.body)}`);
    return res.body.data;
  }

  test('Admin acting in tenant A resets a user of tenant A', async () => {
    const adm = await loginOn('adm', 'Adm#12345', 'at');
    const res = await request(server)
      .post('/api/v1/users/u-a/reset-password')
      .set(authHeader(adm.accessToken))
      .send({ newPassword: 'Forced#111' });
    expect(res.statusCode).toBe(200);
    const stored = storedUser(dataDir, 'u-a');
    expect(stored.password.startsWith('$2')).toBe(true);
    expect(stored.tokenVersion).toBe(1);
    const s2 = await loginOn('tA', 'Forced#111', 'at');
    expect(s2.user.username).toBe('tA');
  });

  test('the same Admin can NEVER reset a user of tenant B from tenant A (403 PERMISSION_DENIED)', async () => {
    const adm = await loginOn('adm', 'Adm#12345', 'at');
    const before = storedUser(dataDir, 'u-b').password;
    const beforeVersion = storedUser(dataDir, 'u-b').tokenVersion;

    const res = await request(server)
      .post('/api/v1/users/u-b/reset-password')
      .set(authHeader(adm.accessToken))
      .send({ newPassword: 'Forced#999' });
    expect(res.statusCode).toBe(403);
    expect(res.body.details && res.body.details.code).toBe('PERMISSION_DENIED');
    // Nothing written to the victim.
    expect(storedUser(dataDir, 'u-b').password).toBe(before);
    expect(storedUser(dataDir, 'u-b').tokenVersion).toBe(beforeVersion);
  });

  test('tenant cannot be smuggled via header, query, or body', async () => {
    const adm = await loginOn('adm', 'Adm#12345', 'at');
    const base = () => request(server)
      .post('/api/v1/users/u-b/reset-password')
      .set(authHeader(adm.accessToken))
      .send({ newPassword: 'Forced#999' });
    const attempts = [
      ['header', (req) => req.set('X-Tenant-Id', 'bt').set('X-Company-Id', 'bt')],
      ['query', (req) => req.query({ tenantId: 'bt' }).query({ company: 'bt' })],
      ['body', (req) => req.send({ tenantId: 'bt', company: 'bt' })]
    ];
    for (const [label, tamper] of attempts) {
      const res = await tamper(base());
      expect(res.statusCode).toBe(403);
      expect(res.body.details && res.body.details.code).toBe('PERMISSION_DENIED');
    }
  });

  test('control: acting in tenant B (a tenant the Admin belongs to) DOES allow resetting B users', async () => {
    const admB = await loginOn('adm', 'Adm#12345', 'bt');
    expect(admB.effectiveRole).toBe('Admin');
    const res = await request(server)
      .post('/api/v1/users/u-b/reset-password')
      .set(authHeader(admB.accessToken))
      .send({ newPassword: 'Forced#222' });
    expect(res.statusCode).toBe(200);
    const stored = storedUser(dataDir, 'u-b');
    expect(stored.password.startsWith('$2')).toBe(true);
    expect(stored.tokenVersion).toBe(1);
  });

  test('a tenant-B victim\'s tokens die after the reset; fresh login works', async () => {
    const victimSession = await loginOn('tB', 'Forced#222', 'bt');
    const admB = await loginOn('adm', 'Adm#12345', 'bt');
    await request(server)
      .post('/api/v1/users/u-b/reset-password')
      .set(authHeader(admB.accessToken))
      .send({ newPassword: 'Forced#333' });
    const meOld = await expectDead(server, victimSession.accessToken);
    const s2 = await loginOn('tB', 'Forced#333', 'bt');
    expect(s2.user.username).toBe('tB');
  });
});