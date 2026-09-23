'use strict';

// platformAdminApi.test.js — O5 Platform Admin API + O3 custom domains.
//
// The RC build mounted /api/v1/platform/admin and /api/v1/tenant but the main
// integration dropped both mounts, leaving the entire Platform Admin API
// (add-ons, transaction fees, custom domains) and tenant extensions as
// unreachable dead code. These tests pin the restored surface:
//   - platform scope enforced by requirePlatformAdmin (tenant roles never pass)
//   - handlers really await the async services (no serialized Promise bodies)
//   - tenant extensions are tenant-isolated and never accept client tenant ids
//   - custom domain resolver stays a no-op unless the feature flag is on

const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { login } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const PASSWORD = 'Pass#123';
const tempDirs = [];

const companies = [
  { id: 'digi', name: 'DigiTronics', code: 'DIGI', active: true },
  { id: 'cairo', name: 'CairoTech', code: 'CAIRO', active: true }
];

const stamp = new Date().toISOString();
const users = { users: [
  {
    id: 'u-master', username: 'master', password: require('bcryptjs').hashSync(PASSWORD, 10), role: 'Viewer',
    fullName: 'Platform Master', createdAt: stamp, updatedAt: stamp, tokenVersion: 0
  },
  {
    id: 'u-digi', username: 'digiOwner', password: require('bcryptjs').hashSync(PASSWORD, 10), role: 'Owner',
    fullName: 'Digi Owner', tenantIds: ['digi'], tenantRoles: { digi: 'Owner' },
    createdAt: stamp, updatedAt: stamp
  },
  {
    id: 'u-cairo', username: 'cairoOwner', password: require('bcryptjs').hashSync(PASSWORD, 10), role: 'Owner',
    fullName: 'Cairo Owner', tenantIds: ['cairo'], tenantRoles: { cairo: 'Owner' },
    createdAt: stamp, updatedAt: stamp
  }
] };

function seedAll(dir) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', users);
  seed(dir, 'platformAdmins', { admins: [{ username: 'master', platformRole: 'MASTER_OWNER', createdAt: stamp }] });
}

describe('O5 Platform Admin API — restored surface', () => {
  let server;
  let dataDir;
  let masterToken;
  let digiToken;
  let ORIGINAL_FLAGS;

  beforeAll(async () => {
    ORIGINAL_FLAGS = {
      CARRY: process.env.ENABLE_TENANT_CARRY,
      MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
      ROLES: process.env.ENABLE_TENANT_ROLES
    };
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';
    dataDir = makeTempDataDir('platform-admin-api');
    tempDirs.push(dataDir);
    seedAll(dataDir);
    server = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
    masterToken = (await login(server.app, 'master', PASSWORD)).accessToken;
    digiToken = (await login(server.app, 'digiOwner', PASSWORD, 'digi')).accessToken;
  });

  afterAll(() => {
    if (ORIGINAL_FLAGS.CARRY === undefined) delete process.env.ENABLE_TENANT_CARRY; else process.env.ENABLE_TENANT_CARRY = ORIGINAL_FLAGS.CARRY;
    if (ORIGINAL_FLAGS.MC === undefined) delete process.env.ENABLE_MULTI_COMPANY_LOGIN; else process.env.ENABLE_MULTI_COMPANY_LOGIN = ORIGINAL_FLAGS.MC;
    if (ORIGINAL_FLAGS.ROLES === undefined) delete process.env.ENABLE_TENANT_ROLES; else process.env.ENABLE_TENANT_ROLES = ORIGINAL_FLAGS.ROLES;
  });

  test('mount exists: anonymous gets 401, not 404', async () => {
    const res = await request(server.app).get('/api/v1/platform/admin/custom-domains');
    expect(res.status).toBe(401);
  });

  test('tenant Owner is NOT a platform admin (403, platform scope separate)', async () => {
    const res = await request(server.app)
      .get('/api/v1/platform/admin/custom-domains')
      .set('Authorization', 'Bearer ' + digiToken);
    expect(res.status).toBe(403);
  });

  test('platform admin lists custom domains with real data (awaited service)', async () => {
    seed(dataDir, 'tenantCustomDomains', {
      tenantCustomDomains: [
        { id: 1, tenant_id: 'digi', custom_domain: 'shop.digitronics.example', status: 'active', ssl_status: 'active', created_at: stamp },
        { id: 2, tenant_id: 'cairo', custom_domain: 'cairo.example', status: 'pending_verification', ssl_status: 'pending', created_at: stamp }
      ]
    });
    const res = await request(server.app)
      .get('/api/v1/platform/admin/custom-domains')
      .set('Authorization', 'Bearer ' + masterToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.domains)).toBe(true);
    expect(res.body.data.domains).toHaveLength(2);
    expect(res.body.data.domains[0].tenantId).toBe('digi');
    expect(res.body.data.domains[0].customDomain).toBe('shop.digitronics.example');
  });

  test('platform admin updates a domain status by id (awaited service)', async () => {
    const res = await request(server.app)
      .patch('/api/v1/platform/admin/custom-domains/2/status')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ status: 'active' });
    expect(res.status).toBe(200);
    const store = readStore(dataDir, 'tenantCustomDomains');
    const rec = (store.tenantCustomDomains || []).find((d) => Number(d.id) === 2);
    expect(rec.status).toBe('active');
  });

  test('update with invalid status returns 404/400 and never persists', async () => {
    const res = await request(server.app)
      .patch('/api/v1/platform/admin/custom-domains/2/status')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ status: 'SHIPPED' });
    expect([404]).toContain(res.status);
    const store = readStore(dataDir, 'tenantCustomDomains');
    const rec = (store.tenantCustomDomains || []).find((d) => Number(d.id) === 2);
    expect(rec.status).toBe('active');
  });

  test('platform admin can upsert and list add-ons for a tenant (awaited service)', async () => {
    const up = await request(server.app)
      .post('/api/v1/platform/admin/tenants/digi/addons')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ addon_key: 'starter', status: 'active' });
    expect(up.status).toBe(200);
    expect(up.body.data.tenantId).toBe('digi');
    expect(up.body.data.addonKey).toBe('starter');

    const list = await request(server.app)
      .get('/api/v1/platform/admin/tenants/digi/addons')
      .set('Authorization', 'Bearer ' + masterToken);
    expect(list.status).toBe(200);
    expect(list.body.data.addons.some((a) => a.addonKey === 'starter')).toBe(true);
  });

  test('platform admin can remove an add-on; missing removal is a real 404', async () => {
    const del = await request(server.app)
      .delete('/api/v1/platform/admin/tenants/digi/addons/starter')
      .set('Authorization', 'Bearer ' + masterToken);
    expect(del.status).toBe(200);

    const delAgain = await request(server.app)
      .delete('/api/v1/platform/admin/tenants/digi/addons/starter')
      .set('Authorization', 'Bearer ' + masterToken);
    expect(delAgain.status).toBe(404);
  });
});

describe('O3/O5 Tenant Extensions — tenant-scoped add-ons and custom domains', () => {
  let server;
  let dataDir;
  let digiToken;
  let cairoToken;

  beforeAll(async () => {
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';
    dataDir = makeTempDataDir('tenant-extensions');
    tempDirs.push(dataDir);
    seedAll(dataDir);
    server = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
    digiToken = (await login(server.app, 'digiOwner', PASSWORD, 'digi')).accessToken;
    cairoToken = (await login(server.app, 'cairoOwner', PASSWORD, 'cairo')).accessToken;
  });

  test('tenant endpoints require authentication', async () => {
    const res = await request(server.app).get('/api/v1/tenant/custom-domains');
    expect([401, 403]).toContain(res.status);
  });

  test('tenant registers a custom domain and only sees its own records', async () => {
    const reg = await request(server.app)
      .post('/api/v1/tenant/custom-domains')
      .set('Authorization', 'Bearer ' + digiToken)
      .send({ custom_domain: 'store.digitronics.example' });
    expect(reg.status).toBe(200);
    expect(reg.body.data.tenantId).toBe('digi');
    expect(reg.body.data.customDomain).toBe('store.digitronics.example');
    expect(reg.body.data.status).toBe('pending_verification');

    const mine = await request(server.app)
      .get('/api/v1/tenant/custom-domains')
      .set('Authorization', 'Bearer ' + digiToken);
    expect(mine.status).toBe(200);
    expect(mine.body.data.domains).toHaveLength(1);
    expect(mine.body.data.domains[0].tenantId).toBe('digi');

    // Other tenant sees an empty list — no cross-tenant leakage.
    const theirs = await request(server.app)
      .get('/api/v1/tenant/custom-domains')
      .set('Authorization', 'Bearer ' + cairoToken);
    expect(theirs.status).toBe(200);
    expect(theirs.body.data.domains).toHaveLength(0);
  });

  test('client-supplied tenant identifiers cannot hijack another tenant store', async () => {
    const hijack = await request(server.app)
      .post('/api/v1/tenant/custom-domains')
      .set('Authorization', 'Bearer ' + cairoToken)
      .send({ custom_domain: 'cairo-hijack.example', tenantId: 'digi', tenant_id: 'digi' });
    expect(hijack.status).toBe(200);
    expect(hijack.body.data.tenantId).toBe('cairo');

    const store = readStore(dataDir, 'tenantCustomDomains');
    const rec = (store.tenantCustomDomains || []).find((d) => d.custom_domain === 'cairo-hijack.example');
    expect(String(rec.tenant_id)).toBe('cairo');
  });

  test('tenant add-ons: upsert, list, delete, then real 404 on repeat delete', async () => {
    const up = await request(server.app)
      .post('/api/v1/tenant/addons')
      .set('Authorization', 'Bearer ' + digiToken)
      .send({ addon_key: 'starter', status: 'active' });
    expect(up.status).toBe(200);
    expect(up.body.data.tenantId).toBe('digi');

    const list = await request(server.app)
      .get('/api/v1/tenant/addons')
      .set('Authorization', 'Bearer ' + digiToken);
    expect(list.body.data.addons.some((a) => a.addonKey === 'starter')).toBe(true);

    const del = await request(server.app)
      .delete('/api/v1/tenant/addons/starter')
      .set('Authorization', 'Bearer ' + digiToken);
    expect(del.status).toBe(200);

    const delAgain = await request(server.app)
      .delete('/api/v1/tenant/addons/starter')
      .set('Authorization', 'Bearer ' + digiToken);
    expect(delAgain.status).toBe(404);
  });
});

describe('O3 custom domain resolver — safe by default', () => {
  test('is a no-op when ENABLE_CUSTOM_DOMAIN_RESOLUTION is off (default)', async () => {
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';
    delete process.env.ENABLE_CUSTOM_DOMAIN_RESOLUTION;
    const dataDir2 = makeTempDataDir('domain-resolver-off');
    tempDirs.push(dataDir2);
    seedAll(dataDir2);
    seed(dataDir2, 'tenantCustomDomains', {
      tenantCustomDomains: [
        { id: 1, tenant_id: 'digi', custom_domain: 'evil.example', status: 'active', ssl_status: 'active', created_at: stamp }
      ]
    });
    const { app } = await startServer(dataDir2, { RATE_LIMIT_MAX: '10000' });
    const res = await request(app).get('/api/v1/platform-public/catalog').set('Host', 'evil.example');
    expect(res.status).toBe(200);
  });
});

registerCleanup(() => [], () => tempDirs);
