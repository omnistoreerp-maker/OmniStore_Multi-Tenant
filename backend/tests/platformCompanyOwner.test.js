'use strict';

// Platform-scoped creation of an additional company Owner.
//
// Production posture is single-tenant (tenant feature flags OFF). This suite
// proves that a Platform Master session with no tenant claim can create an
// Owner ONLY in the company named in the URL, with a server-stamped membership,
// a USER_CREATED audit event, no secrets, and no platform-admin rights.

const fs = require('fs');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { login } = require('./helpers/authHelper');

const PASSWORD = 'Pass#123';
const OWNER_EMAIL = 'company.owner@example.com';
const OWNER_USERNAME = 'companyOwner';

function decodeClaims(token) {
  return JSON.parse(Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

describe('Platform company Owner creation', () => {
  let server;
  let dir;
  let masterToken;
  let newOwnerToken;

  beforeAll(async () => {
    jest.resetModules();
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'false';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'false';
    process.env.ENABLE_TENANT_ROLES = 'false';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.AUTH_REQUIRED = 'true';

    dir = makeTempDataDir('platform-owner');
    const hash = bcrypt.hashSync(PASSWORD, 10);
    const stamp = new Date().toISOString();

    seed(dir, 'companies', {
      companies: [
        {
          id: 'digitronics', code: 'DIGI', name: 'DigiTronics', active: true,
          branches: [{ id: 'MAIN', name: 'Main Branch', code: 'MAIN', isDefault: true, active: true }]
        },
        {
          id: 'nile', code: 'NILE', name: 'Nile Electronics', active: true,
          branches: [{ id: 'NILE-MAIN', name: 'Nile Main', code: 'NILE-MAIN', isDefault: true, active: true }]
        },
        {
          id: 'suspended', code: 'SUS', name: 'Suspended Co', active: false, status: 'SUSPENDED',
          branches: []
        }
      ]
    });

    seed(dir, 'users', {
      users: [
        { id: 'u-master', username: 'master', password: hash, fullName: 'Platform Master', role: 'Owner', createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
        { id: 'u-digi-owner', username: 'digiOwner', password: hash, fullName: 'Digi Owner', role: 'Owner', tenantIds: ['digitronics'], tenantRoles: { digitronics: 'Owner' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
        { id: 'u-nile-owner', username: 'nileOwner', password: hash, fullName: 'Nile Owner', role: 'Owner', tenantIds: ['nile'], tenantRoles: { nile: 'Owner' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 }
      ]
    });

    seed(dir, 'platformAdmins', {
      admins: [{ username: 'master', platformRole: 'MASTER_OWNER', status: 'active', createdAt: stamp }]
    });
    seed(dir, 'auditLog', { entries: [] });

    const started = await startServer(dir, { AUTH_REQUIRED: 'true' });
    server = started.app;

    const session = await login(server, 'master', PASSWORD);
    masterToken = session.accessToken;
    expect(decodeClaims(masterToken).tenantId).toBeUndefined();
  });

  afterAll(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  const createOwner = (token, companyId, body) => request(server)
    .post('/api/v1/platform/companies/' + companyId + '/owners')
    .set('Authorization', 'Bearer ' + token)
    .send(body || {});

  test('Platform Master creates a second Owner bound only to the URL company', async () => {
    const res = await createOwner(masterToken, 'digitronics', {
      username: OWNER_USERNAME,
      fullName: 'OmniStore ERP Owner',
      email: OWNER_EMAIL,
      role: 'Owner',
      password: PASSWORD
    });

    expect(res.status).toBe(201);
    expect(res.body.data.username).toBe(OWNER_USERNAME);
    expect(res.body.data.email).toBe(OWNER_EMAIL);
    expect(res.body.data.role).toBe('Owner');
    expect(res.body.data.tenantIds).toEqual(['digitronics']);
    expect(res.body.data.tenantRoles).toEqual({ digitronics: 'Owner' });
    expect(res.body.data).not.toHaveProperty('password');

    const stored = readStore(dir, 'users').users.find(u => u.username === OWNER_USERNAME);
    expect(stored).toBeTruthy();
    expect(stored.role).toBe('Owner');
    expect(stored.tenantIds).toEqual(['digitronics']);
    expect(stored.tenantRoles).toEqual({ digitronics: 'Owner' });
    expect(stored.tenantId).toBeUndefined();
    expect(stored.email).toBe(OWNER_EMAIL);
    expect(stored.password).not.toBe(PASSWORD);
    expect(bcrypt.compareSync(PASSWORD, stored.password)).toBe(true);
    expect(stored.tokenVersion).toBe(0);

    const existing = readStore(dir, 'users').users.find(u => u.username === 'digiOwner');
    expect(existing).toBeTruthy();
    expect(existing.role).toBe('Owner');
    expect(existing.tenantIds).toEqual(['digitronics']);
  });

  test('the new Owner logs into digitronics and receives no platform-admin rights', async () => {
    const session = await login(server, OWNER_USERNAME, PASSWORD);
    newOwnerToken = session.accessToken;
    expect(session.user.role).toBe('Owner');
    expect(session.user.tenantIds).toEqual(['digitronics']);
    expect(decodeClaims(newOwnerToken).tenantId).toBe('digitronics');

    const users = await request(server).get('/api/v1/users').set('Authorization', 'Bearer ' + newOwnerToken);
    expect(users.status).toBe(200);
    const usernames = users.body.data.users.map(u => u.username);
    expect(usernames).toContain(OWNER_USERNAME);
    expect(usernames).not.toContain('nileOwner');

    const platformMe = await request(server).get('/api/v1/platform/me').set('Authorization', 'Bearer ' + newOwnerToken);
    expect(platformMe.status).toBe(404);

    const platformCreate = await createOwner(newOwnerToken, 'nile', {
      username: 'evilOwner',
      email: 'evil@example.com',
      role: 'Owner',
      password: PASSWORD
    });
    expect(platformCreate.status).toBe(403);
  });

  test('a tenant Owner cannot call the platform owner-creation route', async () => {
    const session = await login(server, 'digiOwner', PASSWORD);
    const res = await createOwner(session.accessToken, 'digitronics', {
      username: 'anotherOwner',
      email: 'another@example.com',
      role: 'Owner',
      password: PASSWORD
    });
    expect(res.status).toBe(403);
    expect(res.body.details && res.body.details.code).toBe('PLATFORM_ADMIN_REQUIRED');
  });

  test('client tenant claims for another company are rejected', async () => {
    const res = await createOwner(masterToken, 'digitronics', {
      username: 'evilTenant',
      email: 'evil-tenant@example.com',
      role: 'Owner',
      password: PASSWORD,
      tenantIds: ['nile']
    });
    expect(res.status).toBe(403);
    expect(res.body.details && res.body.details.code).toBe('PERMISSION_DENIED');

    const res2 = await createOwner(masterToken, 'digitronics', {
      username: 'evilTenant2',
      email: 'evil-tenant2@example.com',
      role: 'Owner',
      password: PASSWORD,
      tenantId: 'nile'
    });
    expect(res2.status).toBe(403);
  });

  test('only the Owner role and an active existing company are accepted', async () => {
    const role = await createOwner(masterToken, 'digitronics', {
      username: 'notOwner',
      email: 'not-owner@example.com',
      role: 'Manager',
      password: PASSWORD
    });
    expect(role.status).toBe(400);
    expect(role.body.details && role.body.details.code).toBe('INVALID_ROLE');

    const missing = await createOwner(masterToken, 'missing', {
      username: 'missingOwner',
      email: 'missing-owner@example.com',
      role: 'Owner',
      password: PASSWORD
    });
    expect(missing.status).toBe(404);

    const suspended = await createOwner(masterToken, 'suspended', {
      username: 'suspendedOwner',
      email: 'suspended-owner@example.com',
      role: 'Owner',
      password: PASSWORD
    });
    expect(suspended.status).toBe(409);
    expect(suspended.body.details && suspended.body.details.code).toBe('COMPANY_INACTIVE');
  });

  test('duplicate email is rejected without creating a second identity', async () => {
    const before = readStore(dir, 'users').users.length;
    const res = await createOwner(masterToken, 'digitronics', {
      username: 'duplicateEmail',
      email: OWNER_EMAIL,
      role: 'Owner',
      password: PASSWORD
    });
    expect(res.status).toBe(409);
    expect(readStore(dir, 'users').users.length).toBe(before);
  });

  test('legacy POST /users cannot bind tenant membership without a trusted tenant', async () => {
    const before = readStore(dir, 'users').users.length;
    const res = await request(server)
      .post('/api/v1/users')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({
        username: 'legacyBound',
        email: 'legacy-bound@example.com',
        role: 'Owner',
        password: PASSWORD,
        tenantIds: ['nile'],
        tenantRoles: { nile: 'Owner' }
      });
    expect(res.status).toBe(403);
    expect(res.body.details && res.body.details.code).toBe('PERMISSION_DENIED');
    expect(readStore(dir, 'users').users.length).toBe(before);
  });

  test('USER_CREATED audit names the platform actor and leaks no secret', async () => {
    const entries = (readStore(dir, 'auditLog') || {}).entries || [];
    const created = entries.filter(e => e.action === 'USER_CREATED');
    expect(created.length).toBe(1);
    expect(created[0].userId).toBe('u-master');
    expect(created[0].resourceId).toBeTruthy();
    expect(created[0].changes.tenantId).toBe('digitronics');
    expect(created[0].changes.role).toBe('Owner');
    expect(created[0].changes.targetUsername).toBe(OWNER_USERNAME);
    const raw = JSON.stringify(created[0]);
    expect(raw).not.toContain(PASSWORD);
    expect(raw).not.toContain('password');
  });

  test('a bound global Owner cannot act in another tenant', async () => {
    const authorize = require('../middleware/authorize');
    const req = {
      method: 'GET',
      path: '/api/v1/users',
      user: { role: 'Owner', tenantIds: ['digitronics'] },
      tenantContext: { tenantId: 'nile' }
    };
    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };
    let nextCalled = false;
    await authorize.requirePermission('users.view')(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });
});
