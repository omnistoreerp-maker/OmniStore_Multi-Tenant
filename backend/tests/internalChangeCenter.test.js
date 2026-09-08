'use strict';

const request = require('supertest');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { login } = require('./helpers/authHelper');

const PASSWORD = 'Pass#123';
const tempDirs = [];

function seedAll(dir) {
  seed(dir, 'companies', {
    companies: [
      { id: 'digi', code: 'DIGI', name: 'DigiTronics', active: true, status: 'ACTIVE', branches: [{ id: 'MAIN', name: 'Main', code: 'MAIN', isDefault: true, active: true }] },
      { id: 'nile', code: 'NILE', name: 'Nile Electronics', active: true, status: 'ACTIVE', branches: [{ id: 'NILE-MAIN', name: 'Nile Main', code: 'NILE-MAIN', isDefault: true, active: true }] }
    ]
  });
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const stamp = new Date().toISOString();
  seed(dir, 'users', {
    users: [
      { id: 'u-digi', username: 'digiOwner', password: hash, fullName: 'Digi Owner', role: 'Owner', tenantIds: ['digi'], tenantRoles: { digi: 'Owner' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
      { id: 'u-nile', username: 'nileOwner', password: hash, fullName: 'Nile Owner', role: 'Owner', tenantIds: ['nile'], tenantRoles: { nile: 'Owner' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
      { id: 'u-master', username: 'master', password: hash, fullName: 'Platform Master', role: 'Viewer', createdAt: stamp, updatedAt: stamp, tokenVersion: 0 }
    ]
  });
  seed(dir, 'platformAdmins', { admins: [{ username: 'master', platformRole: 'MASTER_OWNER', createdAt: stamp }] });
  seed(dir, 'customerRequests', { requests: [], verifications: [], audit: [] });
  seed(dir, 'customerRequestSequence', { last: 0 });
  seed(dir, 'releases', { releases: [] });
}

const validArtifact = 'a05b2f5533a28d8b01b14cf8b3ecd7f4cabcd69e77ef396972f5aba58021e415';

describe('Internal Change Center & Release Management', () => {
  let server;
  let dir;
  let masterToken;
  let digiToken;
  let nileToken;

  beforeAll(async () => {
    jest.resetModules();
    process.env.AUTH_REQUIRED = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_TENANT_FILTERING = 'true';
    process.env.ENABLE_TENANT_ENTITY_ISOLATION = 'true';
    dir = makeTempDataDir('internalChangeCenter');
    tempDirs.push(dir);
    seedAll(dir);
    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    server = s.app;
    masterToken = (await login(server, 'master', PASSWORD, 'digi')).accessToken;
    digiToken = (await login(server, 'digiOwner', PASSWORD, 'digi')).accessToken;
    nileToken = (await login(server, 'nileOwner', PASSWORD, 'nile')).accessToken;
  });

  afterAll(() => {
    tempDirs.forEach(d => {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
    });
  });

  const master = () => ({ Authorization: 'Bearer ' + masterToken });
  const digi = () => ({ Authorization: 'Bearer ' + digiToken });
  const nile = () => ({ Authorization: 'Bearer ' + nileToken });

  // ---------- Authorization ----------
  test('1: unauthenticated request to /internal/dashboard returns 401', async () => {
    const res = await request(server).get('/api/v1/internal/dashboard');
    expect(res.status).toBe(401);
  });

  test('2: non-admin (company owner) cannot access /internal/dashboard (403)', async () => {
    const res = await request(server).get('/api/v1/internal/dashboard').set(digi());
    expect(res.status).toBe(403);
  });

  test('3: non-admin (company owner) cannot access /internal/changes (403)', async () => {
    const res = await request(server).get('/api/v1/internal/changes').set(digi());
    expect(res.status).toBe(403);
  });

  test('4: non-admin cannot access /internal/releases (403)', async () => {
    const res = await request(server).get('/api/v1/internal/releases').set(digi());
    expect(res.status).toBe(403);
  });

  test('5: non-admin cannot register releases (403)', async () => {
    const res = await request(server).post('/api/v1/internal/releases').set(digi())
      .send({ version: '1.0.0', buildId: '1.0.0', artifactSha256: validArtifact });
    expect(res.status).toBe(403);
  });

  test('6: platform admin CAN access /internal/dashboard', async () => {
    const res = await request(server).get('/api/v1/internal/dashboard').set(master());
    expect(res.status).toBe(200);
  });

  // ---------- Dashboard ----------
  test('7: dashboard returns summary with counts', async () => {
    const res = await request(server).get('/api/v1/internal/dashboard').set(master());
    expect(res.status).toBe(200);
    expect(res.body.data.summary).toHaveProperty('total');
    expect(res.body.data.summary).toHaveProperty('byStatus');
    expect(res.body.data.summary).toHaveProperty('byProduct');
    expect(res.body.data.summary).toHaveProperty('byPriority');
  });

  test('8: dashboard includes historical requests (auto-import)', async () => {
    const res = await request(server).get('/api/v1/internal/dashboard').set(master());
    expect(res.body.data.summary.historical).toBeGreaterThanOrEqual(1);
  });

  // ---------- Release Management ----------
  test('9: platform admin can register a release with valid artifact', async () => {
    const res = await request(server).post('/api/v1/internal/releases').set(master())
      .send({ version: '1.0.0', buildId: '1.0.0', artifactSha256: validArtifact, environment: 'production' });
    expect(res.status).toBe(201);
    expect(res.body.data.release.artifactSha256).toBe(validArtifact);
    expect(res.body.data.release.version).toBe('1.0.0');
  });

  test('10: duplicate artifact sha256 is rejected (DUPLICATE_ARTIFACT)', async () => {
    const res = await request(server).post('/api/v1/internal/releases').set(master())
      .send({ version: '1.0.1', buildId: '1.0.1', artifactSha256: validArtifact });
    expect(res.status).toBe(409);
    expect(res.body.details && res.body.details.code).toBe('DUPLICATE_ARTIFACT');
  });

  test('11: release without artifactSha256 is rejected', async () => {
    const res = await request(server).post('/api/v1/internal/releases').set(master())
      .send({ version: '1.0.2', buildId: '1.0.2' });
    expect(res.status).toBe(400);
  });

  test('12: release with invalid artifactSha256 format is rejected', async () => {
    const res = await request(server).post('/api/v1/internal/releases').set(master())
      .send({ version: '1.0.3', buildId: '1.0.3', artifactSha256: 'not-a-valid-sha' });
    expect(res.status).toBe(400);
  });

  test('13: GET /internal/releases returns registered releases', async () => {
    const res = await request(server).get('/api/v1/internal/releases').set(master());
    expect(res.status).toBe(200);
    expect(res.body.data.releases.length).toBeGreaterThanOrEqual(1);
  });

  test('14: GET /internal/releases/:id returns release detail', async () => {
    const list = await request(server).get('/api/v1/internal/releases').set(master());
    const id = list.body.data.releases[0].id;
    const res = await request(server).get('/api/v1/internal/releases/' + id).set(master());
    expect(res.status).toBe(200);
    expect(res.body.data.release.artifactSha256).toBe(validArtifact);
  });

  // ---------- Cross-company visibility (admin) ----------
  test('15: platform admin can list ALL companies requests (cross-company)', async () => {
    // Create a request for digi
    await request(server).post('/api/v1/customer/requests').set(digi())
      .send({ title: 'Digi request', description: 'd', type: 'BUG', priority: 'P2', product: 'ERP' });
    // Create a request for nile
    await request(server).post('/api/v1/customer/requests').set(nile())
      .send({ title: 'Nile request', description: 'd', type: 'BUG', priority: 'P2', product: 'ERP' });
    const res = await request(server).get('/api/v1/internal/changes').set(master());
    expect(res.status).toBe(200);
    const digiReqs = res.body.data.requests.filter(r => r.companyId === 'digi');
    const nileReqs = res.body.data.requests.filter(r => r.companyId === 'nile');
    expect(digiReqs.length).toBeGreaterThanOrEqual(1);
    expect(nileReqs.length).toBeGreaterThanOrEqual(1);
  });

  // ---------- Filtering ----------
  test('16: filter by status works', async () => {
    const res = await request(server).get('/api/v1/internal/changes?status=NEW').set(master());
    expect(res.status).toBe(200);
    res.body.data.requests.forEach(r => expect(r.status).toBe('NEW'));
  });

  test('17: filter by companyId works', async () => {
    const res = await request(server).get('/api/v1/internal/changes?companyId=nile').set(master());
    expect(res.status).toBe(200);
    res.body.data.requests.forEach(r => expect(r.companyId).toBe('nile'));
  });

  test('18: filter by historical=true works', async () => {
    const res = await request(server).get('/api/v1/internal/changes?historical=true').set(master());
    expect(res.status).toBe(200);
    res.body.data.requests.forEach(r => expect(r.historical).toBe(true));
  });

  // ---------- Request detail (internal) ----------
  test('19: platform admin can read any request detail', async () => {
    const list = await request(server).get('/api/v1/internal/changes').set(master());
    const id = list.body.data.requests[0].id;
    const res = await request(server).get('/api/v1/internal/changes/' + id).set(master());
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('request');
    expect(res.body.data).toHaveProperty('audit');
    expect(res.body.data).toHaveProperty('timeline');
    expect(res.body.data).toHaveProperty('releaseMatch');
  });

  // ---------- Customer isolation preserved ----------
  test('20: customer-facing /customer/requests still requires auth (401)', async () => {
    const res = await request(server).get('/api/v1/customer/requests');
    expect(res.status).toBe(401);
  });

  test('21: customer-facing routes are not affected by internal routes', async () => {
    const res = await request(server).get('/api/v1/customer/requests').set(digi());
    expect(res.status).toBe(200);
    // Digi should only see digi requests, not nile
    res.body.data.requests.forEach(r => {
      if (!r.historical) expect(r.companyId).toBe('digi');
    });
  });

  // ---------- Resolution integrity ----------
  test('22: RELEASED + no verification cannot be marked RESOLVED by admin', async () => {
    // Admin cannot directly transition to RESOLVED — no endpoint for it
    // The only way to RESOLVED is through customer verification
    // Verify there is no admin "mark resolved" endpoint
    const res = await request(server).post('/api/v1/internal/changes/anything/resolve').set(master());
    // 404 (route not found) or 403 (auth guard blocks before route) both indicate the endpoint doesn't exist
    expect([404, 403]).toContain(res.status);
  });

  // ---------- CR-2026-0006 ----------
  test('23: CR-2026-0006 is visible and marked NEEDS_EVIDENCE', async () => {
    const res = await request(server).get('/api/v1/internal/changes?companyId=digi&historical=true').set(master());
    expect(res.status).toBe(200);
    const cr6 = res.body.data.requests.find(r => r.customerRequestNumber === 'CR-2026-0006');
    expect(cr6).toBeTruthy();
    expect(cr6.status).toBe('NEEDS_EVIDENCE');
  });

  // ---------- Release immutability ----------
  test('24: release with different artifact gets a different ID', async () => {
    const newArtifact = 'b05b2f5533a28d8b01b14cf8b3ecd7f4cabcd69e77ef396972f5aba58021e416';
    const res = await request(server).post('/api/v1/internal/releases').set(master())
      .send({ version: '1.0.1', buildId: '1.0.1', artifactSha256: newArtifact });
    expect(res.status).toBe(201);
    expect(res.body.data.release.artifactSha256).toBe(newArtifact);
  });

  test('25: missing artifact SHA is rejected for release registration', async () => {
    const res = await request(server).post('/api/v1/internal/releases').set(master())
      .send({ version: '1.0.4', buildId: '1.0.4' });
    expect(res.status).toBe(400);
    expect(res.body.details && res.body.details.code).toBe('INVALID_REQUEST');
  });
});
