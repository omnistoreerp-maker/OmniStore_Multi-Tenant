'use strict';

// Phase E — POST /api/v1/users/:id/disable and POST /api/v1/users/:id/enable.
// Covers authorized/un/cross-tenant flows, tokenVersion invalidation, the
// disabled-login guard (403 ACCOUNT_DISABLED), last-Owner disable protection,
// and phase-scoped audit entries with no secret leakage.

const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { createUser, login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const ORIGINAL_ENV = {
  ROLES: process.env.ENABLE_TENANT_ROLES,
  CARRY: process.env.ENABLE_TENANT_CARRY,
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP
};

const companies = [
  { id: 't1', name: 'Team One', active: true },
  { id: 't2', name: 'Team Two', active: true },
  { id: 't3', name: 'Solo Owner Tenant', active: true }
];

let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  for (const key of ['ENABLE_TENANT_ROLES', 'ENABLE_TENANT_CARRY', 'ENABLE_MULTI_COMPANY_LOGIN', 'ENABLE_TENANT_USER_MEMBERSHIP']) {
    process.env[key] = 'true';
  }
  dataDir = makeTempDataDir('disable-enable');
  server = await startServer(dataDir);
  seed(dataDir, 'companies', companies);

  await createUser(server.app, { username: 'owner1', password: 'Owner#123', fullName: 'Owner One', role: 'Owner', extra: { tenantIds: ['t1'] } });
  await createUser(server.app, { username: 'admin1', password: 'Admin#123', fullName: 'Admin One', role: 'Admin', extra: { tenantIds: ['t1'] } });
  await createUser(server.app, { username: 'cashier1', password: 'Cash#1234', fullName: 'Cashier One', role: 'Cashier', extra: { tenantIds: ['t1'] } });
  await createUser(server.app, { username: 'de_target', password: 'DeTarget#123', fullName: 'DE Target', role: 'Cashier', extra: { tenantIds: ['t1'] } });
  await createUser(server.app, { username: 'de_cross', password: 'DeCross#123', fullName: 'DE Cross', role: 'Cashier', extra: { tenantIds: ['t2'] } });

  // t3 has exactly ONE Owner (de_solo). de_demoted_owner is globally an Owner
  // but tenant-demoted to Manager in t3 with users.disable granted — it passes
  // the route gate and the vertical guard yet is not counted among t3 Owners,
  // so disabling the last Owner is refused with 409.
  await createUser(server.app, { username: 'de_solo', password: 'Solo#1234', fullName: 'DE Solo Owner', role: 'Owner', extra: { tenantIds: ['t3'] } });
  await createUser(server.app, { username: 'de_demoted_owner', password: 'Owner#123', fullName: 'DE Demoted Owner', role: 'Owner', extra: { tenantIds: ['t3'], tenantRoles: { t3: 'Manager' }, permissions: ['users.disable'] } });
});

afterAll(() => {
  for (const [key, original] of Object.entries(ORIGINAL_ENV)) {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

const PW = {
  owner1: 'Owner#123',
  admin1: 'Admin#123',
  cashier1: 'Cash#1234',
  de_target: 'DeTarget#123',
  de_cross: 'DeCross#123',
  de_oldtok: 'OldTok#123',
  de_solo: 'Solo#1234',
  de_demoted_owner: 'Owner#123'
};

async function getToken(app, username, company) {
  const session = await login(app, username, PW[username], company || 't1');
  return session.accessToken;
}

function readUser(id) {
  const store = readStore(dataDir, 'users');
  return store.users.find(u => u.id === id);
}

function readAudit(action, resourceId) {
  const store = readStore(dataDir, 'auditLog');
  return store.entries.find(e => e.action === action && e.resourceId === resourceId);
}

describe('disable — happy path + token invalidation', () => {
  test('authorized actor can disable a target', async () => {
    const targetRec = readStore(dataDir, 'users').users.find(u => u.username === 'de_target');
    const token = await getToken(server.app, 'admin1', 't1');
    const res = await request(server.app).post('/api/v1/users/' + targetRec.id + '/disable').set(authHeader(token));
    expect(res.statusCode).toBe(200);
  });

  test('status becomes disabled and tokenVersion increments', async () => {
    const targetRec = readStore(dataDir, 'users').users.find(u => u.username === 'de_target');
    const rec = readUser(targetRec.id);
    expect(rec.status).toBe('disabled');
    expect(Number(rec.tokenVersion)).toBeGreaterThan(0);
  });

  test('response is sanitized — no password/tokenVersion/apiKey', async () => {
    const targetRec = readStore(dataDir, 'users').users.find(u => u.username === 'de_target');
    const token = await getToken(server.app, 'admin1', 't1');
    const res = await request(server.app).post('/api/v1/users/' + targetRec.id + '/disable').set(authHeader(token));
    // Already disabled -> idempotent 200 with sanitized payload.
    expect(res.statusCode).toBe(200);
    const data = JSON.stringify(res.body.data || {});
    expect(data).not.toMatch(/password/i);
    expect(data).not.toMatch(/tokenVersion/i);
    expect(data).not.toMatch(/apiKey/i);
    expect(res.body).not.toHaveProperty('apiKey');
  });

  test('a token issued before disable becomes invalid (401)', async () => {
    const fresh = await createUser(server.app, { username: 'de_oldtok', password: 'OldTok#123', fullName: 'DE Old Tz', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const beforeTok = await getToken(server.app, 'de_oldtok', 't1');
    const adminTok = await getToken(server.app, 'admin1', 't1');
    await request(server.app).post('/api/v1/users/' + fresh.id + '/disable').set(authHeader(adminTok));
    const res = await request(server.app).get('/api/v1/users/' + fresh.id + '/permissions').set(authHeader(beforeTok));
    expect(res.statusCode).toBe(401);
  });
});

describe('disabled login guard', () => {
  test('fresh login for a disabled user returns 403 ACCOUNT_DISABLED and no token', async () => {
    const res = await request(server.app).post('/api/v1/auth/login').send({ username: 'de_target', password: PW.de_target, company: 't1' });
    expect(res.statusCode).toBe(403);
    expect(res.body.details).toEqual({ code: 'ACCOUNT_DISABLED' });
    expect(res.body).not.toHaveProperty('accessToken');
    expect((res.body.data || {}).accessToken).toBeUndefined();
  });
});

describe('enable — happy path', () => {
  test('authorized actor can enable a disabled user', async () => {
    const targetRec = readStore(dataDir, 'users').users.find(u => u.username === 'de_target');
    const token = await getToken(server.app, 'admin1', 't1');
    const res = await request(server.app).post('/api/v1/users/' + targetRec.id + '/enable').set(authHeader(token));
    expect(res.statusCode).toBe(200);
  });

  test('status returns to active', async () => {
    const targetRec = readStore(dataDir, 'users').users.find(u => u.username === 'de_target');
    const rec = readUser(targetRec.id);
    expect(rec.status).toBe('active');
  });

  test('enabled user can log in again', async () => {
    const res = await request(server.app).post('/api/v1/auth/login').send({ username: 'de_target', password: PW.de_target, company: 't1' });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
  });
});

describe('authorization on disable/enable', () => {
  test('unauthorized actor cannot disable -> 403 PERMISSION_DENIED', async () => {
    const fresh = await createUser(server.app, { username: 'de_unauth_t', password: 'Unauth#123', fullName: 'DE UnAuth Target', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'cashier1', 't1');
    const res = await request(server.app).post('/api/v1/users/' + fresh.id + '/disable').set(authHeader(token));
    expect(res.statusCode).toBe(403);
    expect(res.body.details).toEqual({ code: 'PERMISSION_DENIED' });
  });

  test('unauthorized actor cannot enable -> 403 PERMISSION_DENIED', async () => {
    const fresh = await createUser(server.app, { username: 'de_unauth_e', password: 'Unauth#123', fullName: 'DE UnAuth Enable', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    await request(server.app).post('/api/v1/users/' + fresh.id + '/disable').set(authHeader(await getToken(server.app, 'admin1', 't1')));
    const token = await getToken(server.app, 'cashier1', 't1');
    const res = await request(server.app).post('/api/v1/users/' + fresh.id + '/enable').set(authHeader(token));
    expect(res.statusCode).toBe(403);
    expect(res.body.details).toEqual({ code: 'PERMISSION_DENIED' });
  });

  test('cross-tenant disable -> 403 PERMISSION_DENIED', async () => {
    const crossRec = readStore(dataDir, 'users').users.find(u => u.username === 'de_cross');
    const token = await getToken(server.app, 'admin1', 't1');
    const res = await request(server.app).post('/api/v1/users/' + crossRec.id + '/disable').set(authHeader(token));
    expect(res.statusCode).toBe(403);
    expect(res.body.details).toEqual({ code: 'PERMISSION_DENIED' });
  });

  test('cross-tenant enable -> 403 PERMISSION_DENIED', async () => {
    const crossRec = readStore(dataDir, 'users').users.find(u => u.username === 'de_cross');
    const token = await getToken(server.app, 'admin1', 't1');
    const res = await request(server.app).post('/api/v1/users/' + crossRec.id + '/enable').set(authHeader(token));
    expect(res.statusCode).toBe(403);
  });

  test('forged X-Tenant-Id cannot disable a cross-tenant target', async () => {
    const crossRec = readStore(dataDir, 'users').users.find(u => u.username === 'de_cross');
    const token = await getToken(server.app, 'admin1', 't1');
    const res = await request(server.app).post('/api/v1/users/' + crossRec.id + '/disable').set(authHeader(token)).set('X-Tenant-Id', 't2');
    // Trusted tenant is still t1 (from the token); target is t2 -> 403.
    expect(res.statusCode).toBe(403);
  });

  test('forged X-Company-Id cannot bypass tenant isolation', async () => {
    const crossRec = readStore(dataDir, 'users').users.find(u => u.username === 'de_cross');
    const token = await getToken(server.app, 'admin1', 't1');
    const res = await request(server.app).post('/api/v1/users/' + crossRec.id + '/disable').set(authHeader(token)).set('X-Company-Id', 't2');
    expect(res.statusCode).toBe(403);
  });

  test('forged body tenantId cannot bypass tenant isolation', async () => {
    const crossRec = readStore(dataDir, 'users').users.find(u => u.username === 'de_cross');
    const token = await getToken(server.app, 'admin1', 't1');
    const res = await request(server.app).post('/api/v1/users/' + crossRec.id + '/disable').set(authHeader(token)).send({ tenantId: 't2' });
    expect(res.statusCode).toBe(403);
  });

  test('forged query tenantId cannot bypass tenant isolation', async () => {
    const crossRec = readStore(dataDir, 'users').users.find(u => u.username === 'de_cross');
    const token = await getToken(server.app, 'admin1', 't1');
    const res = await request(server.app).post('/api/v1/users/' + crossRec.id + '/disable?tenantId=t2').set(authHeader(token));
    expect(res.statusCode).toBe(403);
  });
});

describe('last Owner disable protection', () => {
  test('disabling the last Owner of a tenant is refused with 409 LAST_OWNER_PROTECTION', async () => {
    const soloRec = readStore(dataDir, 'users').users.find(u => u.username === 'de_solo');
    const token = await getToken(server.app, 'de_demoted_owner', 't3');
    const res = await request(server.app).post('/api/v1/users/' + soloRec.id + '/disable').set(authHeader(token));
    expect(res.statusCode).toBe(409);
    expect(res.body.details).toEqual({ code: 'LAST_OWNER_PROTECTION' });
    const after = readUser(soloRec.id);
    expect(after.status).not.toBe('disabled');
  });
});

describe('audit events', () => {
  test('USER_DISABLED audit entry exists and is sanitized', async () => {
    const fresh = await createUser(server.app, { username: 'de_aud_d', password: 'Aud#1234', fullName: 'DE Audit Disable', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'admin1', 't1');
    await request(server.app).post('/api/v1/users/' + fresh.id + '/disable').set(authHeader(token));
    const entry = readAudit('USER_DISABLED', fresh.id);
    expect(entry).toBeTruthy();
    const raw = JSON.stringify(entry);
    expect(raw).not.toMatch(/password/i);
    expect(raw).not.toMatch(/"apiKey"\s*:/i);
    expect(raw).not.toContain('Aud#1234');
    expect(raw).not.toContain('Admin#123');
    expect(entry.changes.after.tokenVersion).toBe(1);
  });

  test('USER_ENABLED audit entry exists and is sanitized', async () => {
    const fresh = await createUser(server.app, { username: 'de_aud_e', password: 'Aud#1234', fullName: 'DE Audit Enable', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const adminTok = await getToken(server.app, 'admin1', 't1');
    await request(server.app).post('/api/v1/users/' + fresh.id + '/disable').set(authHeader(adminTok));
    await request(server.app).post('/api/v1/users/' + fresh.id + '/enable').set(authHeader(adminTok));
    const entry = readAudit('USER_ENABLED', fresh.id);
    expect(entry).toBeTruthy();
    const raw = JSON.stringify(entry);
    expect(raw).not.toMatch(/password/i);
    expect(raw).not.toMatch(/"apiKey"\s*:/i);
    expect(raw).not.toContain('Aud#1234');
  });

  test('Phase E audit entries never carry a password value', async () => {
    const store = readStore(dataDir, 'auditLog');
    const phaseE = store.entries.filter(e =>
      ['USER_DISABLED', 'USER_ENABLED', 'USER_PERMISSIONS_CHANGED', 'USER_ROLE_CHANGED'].includes(e.action)
    );
    expect(phaseE.length).toBeGreaterThan(0);
    for (const entry of phaseE) {
      const raw = JSON.stringify(entry);
      expect(raw).not.toMatch(/password/i);
      expect(raw).not.toMatch(/"apiKey"\s*:/i);
    }
  });
});