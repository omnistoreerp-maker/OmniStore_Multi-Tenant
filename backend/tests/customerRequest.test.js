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
      { id: 'u-nile', username: 'nileOwner', password: hash, fullName: 'Nile Owner', role: 'Owner', tenantIds: ['nile'], tenantRoles: { nile: 'Owner' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 }
    ]
  });
  seed(dir, 'platformAdmins', { admins: [] });
  seed(dir, 'customerRequests', { requests: [], verifications: [], audit: [] });
  seed(dir, 'customerRequestSequence', { last: 0 });
}

const matchingRelease = () => ({
  id: 'rel_v1.0.0',
  version: '1.0.0',
  buildId: '1.0.0',
  commitSha: null,
  product: 'OMNISTORE',
  environment: 'test',
  releasedAt: '2026-08-17T00:00:00.000Z',
  deployedAt: '2026-08-17T00:00:00.000Z',
  healthStatus: 'verified',
  releaseNotes: 'v1.0.0',
  rollbackTarget: null
});

const mismatchedRelease = () => ({
  id: 'rel_v0.9.0',
  version: '0.9.0',
  buildId: '0.9.0-OLD',
  commitSha: 'oldcommitsha',
  product: 'OMNISTORE',
  environment: 'test',
  releasedAt: '2026-07-01T00:00:00.000Z',
  deployedAt: '2026-07-01T00:00:00.000Z',
  healthStatus: 'unknown',
  releaseNotes: 'v0.9.0',
  rollbackTarget: null
});

describe('Customer Change & Resolution Foundation', () => {
  let server;
  let dir;
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
    dir = makeTempDataDir('customerRequest');
    tempDirs.push(dir);
    seedAll(dir);
    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    server = s.app;
    digiToken = (await login(server, 'digiOwner', PASSWORD, 'digi')).accessToken;
    nileToken = (await login(server, 'nileOwner', PASSWORD, 'nile')).accessToken;
    expect(digiToken).toBeTruthy();
    expect(nileToken).toBeTruthy();
  });

  afterAll(() => {
    tempDirs.forEach(d => {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
    });
  });

  const digi = () => ({ Authorization: 'Bearer ' + digiToken });
  const nile = () => ({ Authorization: 'Bearer ' + nileToken });

  // ---------- historical migration ----------
  test('1: historical requests are imported on first list', async () => {
    const res = await request(server).get('/api/v1/customer/requests').set(digi());
    expect(res.status).toBe(200);
    const requests = res.body.data.requests;
    const historical = requests.filter(r => r.historical);
    expect(historical.length).toBeGreaterThanOrEqual(1);
  });

  test('2: historical request IDs are stable (CR-2026-0001 etc.)', async () => {
    const res = await request(server).get('/api/v1/customer/requests').set(digi());
    const cr1 = res.body.data.requests.find(r => r.customerRequestNumber === 'CR-2026-0001');
    expect(cr1).toBeTruthy();
    expect(cr1.title).toContain('tenant');
  });

  test('3: historical import is idempotent (no duplicates)', async () => {
    const res1 = await request(server).get('/api/v1/customer/requests').set(digi());
    const count1 = res1.body.data.requests.filter(r => r.historical).length;
    const res2 = await request(server).get('/api/v1/customer/requests').set(digi());
    const count2 = res2.body.data.requests.filter(r => r.historical).length;
    expect(count1).toBe(count2);
  });

  test('4: NEEDS_EVIDENCE historical item is visible', async () => {
    const res = await request(server).get('/api/v1/customer/requests').set(digi());
    const needs = res.body.data.requests.find(r => r.status === 'NEEDS_EVIDENCE');
    expect(needs).toBeTruthy();
  });

  // ---------- request creation ----------
  test('5: customer can create a new request', async () => {
    const res = await request(server).post('/api/v1/customer/requests')
      .set(digi())
      .send({ title: 'Test bug', description: 'Test description', type: 'BUG', priority: 'P1', product: 'ERP' });
    expect(res.status).toBe(201);
    expect(res.body.data.request.customerRequestNumber).toMatch(/^CR-\d{4}-\d{4}$/);
    expect(res.body.data.request.status).toBe('NEW');
  });

  test('6: invalid request is rejected (INVALID_REQUEST)', async () => {
    const res = await request(server).post('/api/v1/customer/requests')
      .set(digi())
      .send({ title: '', description: '', type: 'INVALID', priority: 'P9', product: 'NOPE' });
    expect(res.status).toBe(400);
    expect(res.body.details && res.body.details.code).toBe('INVALID_REQUEST');
  });

  test('7: X-Tenant-Id header does not affect companyId', async () => {
    const res = await request(server).post('/api/v1/customer/requests')
      .set(digi())
      .set('X-Tenant-Id', 'nile')
      .set('X-Company-Id', 'nile')
      .send({ title: 'Forged tenant', description: 'Should stay on digi', type: 'BUG', priority: 'P2', product: 'ERP' });
    expect(res.status).toBe(201);
    expect(res.body.data.request.companyId).toBe('digi');
  });

  test('8: body companyId is ignored', async () => {
    const res = await request(server).post('/api/v1/customer/requests')
      .set(digi())
      .send({ title: 'Body override', description: 'desc', type: 'BUG', priority: 'P2', product: 'ERP', companyId: 'nile', tenantId: 'nile' });
    expect(res.status).toBe(201);
    expect(res.body.data.request.companyId).toBe('digi');
  });

  // ---------- tenant isolation ----------
  test('9: Company A cannot read Company B request', async () => {
    const created = await request(server).post('/api/v1/customer/requests')
      .set(digi())
      .send({ title: 'Digi only', description: 'd', type: 'BUG', priority: 'P2', product: 'ERP' });
    const id = created.body.data.request.id;
    const cross = await request(server).get('/api/v1/customer/requests/' + id).set(nile());
    expect(cross.status).toBe(404);
  });

  test('10: Company A cannot verify Company B request', async () => {
    const created = await request(server).post('/api/v1/customer/requests')
      .set(digi())
      .send({ title: 'Digi verify test', description: 'd', type: 'BUG', priority: 'P2', product: 'ERP' });
    const id = created.body.data.request.id;
    const cross = await request(server).post('/api/v1/customer/requests/' + id + '/verify')
      .set(nile())
      .send({ result: 'CONFIRMED' });
    expect(cross.status).toBe(404);
  });

  test('11: Company A cannot reopen Company B request', async () => {
    const created = await request(server).post('/api/v1/customer/requests')
      .set(digi())
      .send({ title: 'Digi reopen test', description: 'd', type: 'BUG', priority: 'P2', product: 'ERP' });
    const id = created.body.data.request.id;
    const cross = await request(server).post('/api/v1/customer/requests/' + id + '/reopen')
      .set(nile())
      .send({});
    expect(cross.status).toBe(404);
  });

  // ---------- lifecycle ----------
  test('12: NEW -> TRIAGED -> APPROVED -> IN_PROGRESS -> READY_FOR_TEST -> TESTED -> READY_FOR_RELEASE -> RELEASED', async () => {
    const created = await request(server).post('/api/v1/customer/requests')
      .set(digi())
      .send({ title: 'Lifecycle test', description: 'd', type: 'BUG', priority: 'P2', product: 'ERP' });
    const id = created.body.data.request.id;
    const steps = ['TRIAGED', 'APPROVED', 'IN_PROGRESS', 'READY_FOR_TEST', 'TESTED', 'READY_FOR_RELEASE'];
    for (const s of steps) {
      const r = await request(server).post('/api/v1/customer/requests/' + id + '/transition')
        .set(digi())
        .send({ toStatus: s, actor: 'tester' });
      if (r.status !== 200) console.log('Transition failed:', s, r.body);
      expect(r.status).toBe(200);
      expect(r.body.data.request.status).toBe(s);
    }
    // RELEASED requires release evidence
    const rel = await request(server).post('/api/v1/customer/requests/' + id + '/transition')
      .set(digi())
      .send({ toStatus: 'RELEASED', releaseId: matchingRelease() });
    if (rel.status !== 200) console.log('RELEASED transition failed:', rel.body);
    expect(rel.status).toBe(200);
    expect(rel.body.data.request.status).toBe('RELEASED');
    const r2 = await request(server).post('/api/v1/customer/requests/' + id + '/transition')
      .set(digi())
      .send({ toStatus: 'READY_FOR_CUSTOMER_VERIFICATION' });
    expect(r2.status).toBe(200);
    expect(r2.body.data.request.status).toBe('READY_FOR_CUSTOMER_VERIFICATION');
  });

  test('13: NEW -> RESOLVED is rejected (INVALID_STATUS_TRANSITION)', async () => {
    const created = await request(server).post('/api/v1/customer/requests')
      .set(digi())
      .send({ title: 'Skip test', description: 'd', type: 'BUG', priority: 'P2', product: 'ERP' });
    const id = created.body.data.request.id;
    const r = await request(server).post('/api/v1/customer/requests/' + id + '/transition')
      .set(digi())
      .send({ toStatus: 'RESOLVED' });
    expect(r.status).toBe(400);
    expect(r.body.details && r.body.details.code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('14: IN_PROGRESS -> RESOLVED is rejected', async () => {
    const created = await request(server).post('/api/v1/customer/requests')
      .set(digi())
      .send({ title: 'In progress to resolved', description: 'd', type: 'BUG', priority: 'P2', product: 'ERP' });
    const id = created.body.data.request.id;
    for (const s of ['TRIAGED', 'APPROVED', 'IN_PROGRESS']) {
      await request(server).post('/api/v1/customer/requests/' + id + '/transition')
        .set(digi()).send({ toStatus: s });
    }
    const r = await request(server).post('/api/v1/customer/requests/' + id + '/transition')
      .set(digi()).send({ toStatus: 'RESOLVED' });
    expect(r.status).toBe(400);
  });

  // ---------- release integrity ----------
  test('15: RELEASED requires release evidence (RELEASE_REQUIRED)', async () => {
    const created = await request(server).post('/api/v1/customer/requests')
      .set(digi())
      .send({ title: 'Release evidence test', description: 'd', type: 'BUG', priority: 'P2', product: 'ERP' });
    const id = created.body.data.request.id;
    for (const s of ['TRIAGED', 'APPROVED', 'IN_PROGRESS', 'READY_FOR_TEST', 'TESTED', 'READY_FOR_RELEASE']) {
      await request(server).post('/api/v1/customer/requests/' + id + '/transition')
        .set(digi()).send({ toStatus: s });
    }
    const r = await request(server).post('/api/v1/customer/requests/' + id + '/transition')
      .set(digi()).send({ toStatus: 'RELEASED' });
    expect(r.status).toBe(400);
    expect(r.body.details && r.body.details.code).toBe('RELEASE_REQUIRED');
  });

  test('16: verification with mismatched build is rejected (RELEASE_BUILD_MISMATCH)', async () => {
    const created = await request(server).post('/api/v1/customer/requests')
      .set(digi())
      .send({ title: 'Mismatch test', description: 'd', type: 'BUG', priority: 'P2', product: 'ERP' });
    const id = created.body.data.request.id;
    for (const s of ['TRIAGED', 'APPROVED', 'IN_PROGRESS', 'READY_FOR_TEST', 'TESTED', 'READY_FOR_RELEASE']) {
      await request(server).post('/api/v1/customer/requests/' + id + '/transition')
        .set(digi()).send({ toStatus: s });
    }
    await request(server).post('/api/v1/customer/requests/' + id + '/transition')
      .set(digi()).send({ toStatus: 'RELEASED', releaseId: mismatchedRelease() });
    await request(server).post('/api/v1/customer/requests/' + id + '/transition')
      .set(digi()).send({ toStatus: 'READY_FOR_CUSTOMER_VERIFICATION' });
    const v = await request(server).post('/api/v1/customer/requests/' + id + '/verify')
      .set(digi()).send({ result: 'CONFIRMED' });
    expect(v.status).toBe(409);
    expect(v.body.details && v.body.details.code).toBe('RELEASE_BUILD_MISMATCH');
  });

  test('17: customer confirmation with matching build RESOLVES the request', async () => {
    const created = await request(server).post('/api/v1/customer/requests')
      .set(digi())
      .send({ title: 'Confirm test', description: 'd', type: 'BUG', priority: 'P2', product: 'ERP' });
    const id = created.body.data.request.id;
    for (const s of ['TRIAGED', 'APPROVED', 'IN_PROGRESS', 'READY_FOR_TEST', 'TESTED', 'READY_FOR_RELEASE']) {
      await request(server).post('/api/v1/customer/requests/' + id + '/transition')
        .set(digi()).send({ toStatus: s });
    }
    await request(server).post('/api/v1/customer/requests/' + id + '/transition')
      .set(digi()).send({ toStatus: 'RELEASED', releaseId: matchingRelease() });
    await request(server).post('/api/v1/customer/requests/' + id + '/transition')
      .set(digi()).send({ toStatus: 'READY_FOR_CUSTOMER_VERIFICATION' });
    const v = await request(server).post('/api/v1/customer/requests/' + id + '/verify')
      .set(digi()).send({ result: 'CONFIRMED', note: 'Working great' });
    expect(v.status).toBe(200);
    expect(v.body.data.request.status).toBe('RESOLVED');
    expect(v.body.data.request.customerVerifiedAt).toBeTruthy();
  });

  test('18: customer rejection REOPENS the request', async () => {
    const created = await request(server).post('/api/v1/customer/requests')
      .set(digi())
      .send({ title: 'Reject test', description: 'd', type: 'BUG', priority: 'P2', product: 'ERP' });
    const id = created.body.data.request.id;
    for (const s of ['TRIAGED', 'APPROVED', 'IN_PROGRESS', 'READY_FOR_TEST', 'TESTED', 'READY_FOR_RELEASE']) {
      await request(server).post('/api/v1/customer/requests/' + id + '/transition')
        .set(digi()).send({ toStatus: s });
    }
    await request(server).post('/api/v1/customer/requests/' + id + '/transition')
      .set(digi()).send({ toStatus: 'RELEASED', releaseId: matchingRelease() });
    await request(server).post('/api/v1/customer/requests/' + id + '/transition')
      .set(digi()).send({ toStatus: 'READY_FOR_CUSTOMER_VERIFICATION' });
    const v = await request(server).post('/api/v1/customer/requests/' + id + '/verify')
      .set(digi()).send({ result: 'FAILED', note: 'Still broken' });
    expect(v.status).toBe(200);
    expect(v.body.data.request.status).toBe('REOPENED');
  });

  // ---------- audit history ----------
  test('19: audit history records all transitions', async () => {
    const created = await request(server).post('/api/v1/customer/requests')
      .set(digi())
      .send({ title: 'Audit test', description: 'd', type: 'BUG', priority: 'P2', product: 'ERP' });
    const id = created.body.data.request.id;
    await request(server).post('/api/v1/customer/requests/' + id + '/transition')
      .set(digi()).send({ toStatus: 'TRIAGED' });
    const detail = await request(server).get('/api/v1/customer/requests/' + id).set(digi());
    expect(detail.status).toBe(200);
    expect(detail.body.data.audit.length).toBeGreaterThanOrEqual(2);
  });

  // ---------- no auth ----------
  test('20: unauthenticated request to /customer/requests returns 401', async () => {
    const res = await request(server).get('/api/v1/customer/requests');
    expect(res.status).toBe(401);
  });

  // ---------- build identity endpoint ----------
  test('21: GET /customer/build returns build identity', async () => {
    const res = await request(server).get('/api/v1/customer/build').set(digi());
    expect(res.status).toBe(200);
    expect(res.body.data.build.version).toBeTruthy();
    expect(res.body.data.build.buildId).toBeTruthy();
  });

  // ---------- XSS safety in response ----------
  test('22: XSS payload in title is stored as string and not interpreted as HTML by JSON transport', async () => {
    const xss = '<script>alert(1)</script>';
    const res = await request(server).post('/api/v1/customer/requests')
      .set(digi())
      .send({ title: xss, description: 'd', type: 'BUG', priority: 'P2', product: 'ERP' });
    expect(res.status).toBe(201);
    expect(res.body.data.request.title).toBe(xss);
    const raw = JSON.stringify(res.body);
    // JSON transport preserves the string as-is (no HTML interpretation at transport layer).
    // The frontend uses textContent for rendering, which prevents script execution.
    // The critical security property: the API does NOT return the payload inside a
    // script tag or as executable HTML — it returns it as a plain JSON string.
    expect(raw).toContain('"title":"<script>alert(1)</script>"');
    // Verify the response Content-Type is JSON (not HTML)
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  // ---------- reopen from RESOLVED ----------
  test('23: RESOLVED -> REOPENED is allowed', async () => {
    const created = await request(server).post('/api/v1/customer/requests')
      .set(digi())
      .send({ title: 'Reopen from resolved', description: 'd', type: 'BUG', priority: 'P2', product: 'ERP' });
    const id = created.body.data.request.id;
    for (const s of ['TRIAGED', 'APPROVED', 'IN_PROGRESS', 'READY_FOR_TEST', 'TESTED', 'READY_FOR_RELEASE']) {
      await request(server).post('/api/v1/customer/requests/' + id + '/transition')
        .set(digi()).send({ toStatus: s });
    }
    await request(server).post('/api/v1/customer/requests/' + id + '/transition')
      .set(digi()).send({ toStatus: 'RELEASED', releaseId: matchingRelease() });
    await request(server).post('/api/v1/customer/requests/' + id + '/transition')
      .set(digi()).send({ toStatus: 'READY_FOR_CUSTOMER_VERIFICATION' });
    await request(server).post('/api/v1/customer/requests/' + id + '/verify')
      .set(digi()).send({ result: 'CONFIRMED' });
    const reopen = await request(server).post('/api/v1/customer/requests/' + id + '/reopen')
      .set(digi()).send({ note: 'Issue returned' });
    expect(reopen.status).toBe(200);
    expect(reopen.body.data.request.status).toBe('REOPENED');
  });

  // ---------- query injection ----------
  test('24: query tenant injection does not affect company', async () => {
    const res = await request(server).get('/api/v1/customer/requests?tenant=nile&companyId=nile').set(digi());
    expect(res.status).toBe(200);
    res.body.data.requests.forEach(r => {
      expect(r.companyId).toBe('digi');
    });
  });
});
