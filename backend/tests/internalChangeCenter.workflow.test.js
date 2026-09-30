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
  seed(dir, 'customerRequests', {
    requests: [
      {
        id: 'req-new-nile', customerRequestNumber: 'CR-2026-8001', companyId: 'nile', branchId: null,
        product: 'ERP', type: 'BUG', priority: 'P2', title: 'Nile new request', description: 'd',
        status: 'NEW', resolution: '', createdAt: stamp, updatedAt: stamp, createdBy: 'nileOwner',
        assignedTo: null, releaseId: null, implementationCommits: [], testEvidence: [],
        customerVerifiedAt: null, customerVerifiedBy: null, historical: false, historicalSource: null
      },
      {
        id: 'req-rfcv-digi', customerRequestNumber: 'CR-2026-8002', companyId: 'digi', branchId: null,
        product: 'ERP', type: 'BUG', priority: 'P2', title: 'Awaiting verification', description: 'd',
        status: 'READY_FOR_CUSTOMER_VERIFICATION', resolution: '', createdAt: stamp, updatedAt: stamp, createdBy: 'digiOwner',
        assignedTo: null, releaseId: null, implementationCommits: [], testEvidence: [],
        customerVerifiedAt: null, customerVerifiedBy: null, historical: false, historicalSource: null
      },
      {
        id: 'req-ready-release-digi', customerRequestNumber: 'CR-2026-8003', companyId: 'digi', branchId: null,
        product: 'ERP', type: 'CHANGE', priority: 'P3', title: 'Ready for release', description: 'd',
        status: 'READY_FOR_RELEASE', resolution: '', createdAt: stamp, updatedAt: stamp, createdBy: 'digiOwner',
        assignedTo: null, releaseId: null, implementationCommits: [], testEvidence: [],
        customerVerifiedAt: null, customerVerifiedBy: null, historical: false, historicalSource: null
      }
    ],
    verifications: [],
    audit: []
  });
  seed(dir, 'customerRequestSequence', { last: 8000 });
  seed(dir, 'releases', { releases: [] });
}

describe('Internal Change Center operator workflow (notes + guarded transitions)', () => {
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
    dir = makeTempDataDir('internalChangeCenterWorkflow');
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
  test('1: unauthenticated transition returns 401', async () => {
    const res = await request(server).post('/api/v1/internal/changes/req-new-nile/transition')
      .send({ toStatus: 'TRIAGED' });
    expect(res.status).toBe(401);
  });

  test('2: unauthenticated note returns 401', async () => {
    const res = await request(server).post('/api/v1/internal/changes/req-new-nile/notes')
      .send({ note: 'hello' });
    expect(res.status).toBe(401);
  });

  test('3: non-admin company owner cannot transition (403)', async () => {
    const res = await request(server).post('/api/v1/internal/changes/req-new-nile/transition')
      .set(digi()).send({ toStatus: 'TRIAGED' });
    expect(res.status).toBe(403);
    expect(res.body.details && res.body.details.code).toBe('PLATFORM_ADMIN_REQUIRED');
  });

  test('4: non-admin company owner cannot add a note (403)', async () => {
    const res = await request(server).post('/api/v1/internal/changes/req-new-nile/notes')
      .set(nile()).send({ note: 'sneaky note' });
    expect(res.status).toBe(403);
  });

  // ---------- Operator reply (note) ----------
  test('5: platform admin can reply with a note; status unchanged; audit records actor + operator type', async () => {
    const before = await request(server).get('/api/v1/internal/changes/req-new-nile').set(master());
    const auditBefore = before.body.data.audit.length;

    const res = await request(server).post('/api/v1/internal/changes/req-new-nile/notes')
      .set(master()).send({ note: 'We are investigating this report.' });
    expect(res.status).toBe(200);
    expect(res.body.data.request.status).toBe('NEW');

    const after = await request(server).get('/api/v1/internal/changes/req-new-nile').set(master());
    expect(after.body.data.audit.length).toBe(auditBefore + 1);
    const entry = after.body.data.audit[after.body.data.audit.length - 1];
    expect(entry.actor).toBe('master');
    expect(entry.actorType).toBe('operator');
    expect(entry.note).toBe('We are investigating this report.');
    expect(entry.fromStatus).toBe('NEW');
    expect(entry.toStatus).toBe('NEW');
  });

  test('6: empty note is rejected (NOTE_REQUIRED)', async () => {
    const res = await request(server).post('/api/v1/internal/changes/req-new-nile/notes')
      .set(master()).send({ note: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.details && res.body.details.code).toBe('NOTE_REQUIRED');
  });

  test('7: note with non-string body field is rejected (NOTE_REQUIRED)', async () => {
    const res = await request(server).post('/api/v1/internal/changes/req-new-nile/notes')
      .set(master()).send({ note: { evil: true } });
    expect(res.status).toBe(400);
    expect(res.body.details && res.body.details.code).toBe('NOTE_REQUIRED');
  });

  test('8: note on unknown change id returns 404', async () => {
    const res = await request(server).post('/api/v1/internal/changes/req_does_not_exist/notes')
      .set(master()).send({ note: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.details && res.body.details.code).toBe('REQUEST_NOT_FOUND');
  });

  // ---------- Admin status transitions ----------
  test('9: admin can transition a request of ANY company (cross-company by design)', async () => {
    const res = await request(server).post('/api/v1/internal/changes/req-new-nile/transition')
      .set(master()).send({ toStatus: 'TRIAGED', note: 'Triage started by operator' });
    expect(res.status).toBe(200);
    expect(res.body.data.request.status).toBe('TRIAGED');

    const detail = await request(server).get('/api/v1/internal/changes/req-new-nile').set(master());
    const entry = detail.body.data.audit[detail.body.data.audit.length - 1];
    expect(entry.actor).toBe('master');
    expect(entry.actorType).toBe('operator');
    expect(entry.toStatus).toBe('TRIAGED');
  });

  test('10: invalid status value is rejected (INVALID_STATUS)', async () => {
    const res = await request(server).post('/api/v1/internal/changes/req-new-nile/transition')
      .set(master()).send({ toStatus: 'TELEPORTED' });
    expect(res.status).toBe(400);
    expect(res.body.details && res.body.details.code).toBe('INVALID_STATUS');
  });

  test('11: state-machine violation is rejected (INVALID_STATUS_TRANSITION)', async () => {
    const res = await request(server).post('/api/v1/internal/changes/req-new-nile/transition')
      .set(master()).send({ toStatus: 'IN_PROGRESS' });
    expect(res.status).toBe(400);
    expect(res.body.details && res.body.details.code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('12: transition on unknown change id returns 404', async () => {
    const res = await request(server).post('/api/v1/internal/changes/req_missing/transition')
      .set(master()).send({ toStatus: 'TRIAGED' });
    expect(res.status).toBe(404);
    expect(res.body.details && res.body.details.code).toBe('REQUEST_NOT_FOUND');
  });

  test('13: admin CANNOT mark RESOLVED — verification-only guard holds', async () => {
    const res = await request(server).post('/api/v1/internal/changes/req-rfcv-digi/transition')
      .set(master()).send({ toStatus: 'RESOLVED', note: 'force close' });
    expect(res.status).toBe(400);
    expect(res.body.details && res.body.details.code).toBe('RESOLVED_VERIFICATION_ONLY');

    const detail = await request(server).get('/api/v1/internal/changes/req-rfcv-digi').set(master());
    expect(detail.body.data.request.status).toBe('READY_FOR_CUSTOMER_VERIFICATION');
  });

  test('14: RELEASED without release evidence is rejected (RELEASE_REQUIRED)', async () => {
    const res = await request(server).post('/api/v1/internal/changes/req-ready-release-digi/transition')
      .set(master()).send({ toStatus: 'RELEASED' });
    expect(res.status).toBe(400);
    expect(res.body.details && res.body.details.code).toBe('RELEASE_REQUIRED');
  });

  test('15: RELEASED with release evidence succeeds and records it', async () => {
    const res = await request(server).post('/api/v1/internal/changes/req-ready-release-digi/transition')
      .set(master()).send({ toStatus: 'RELEASED', releaseId: 'rel_operator_1', note: 'Shipped with build' });
    expect(res.status).toBe(200);
    expect(res.body.data.request.status).toBe('RELEASED');
    expect(res.body.data.request.releaseId).toBe('rel_operator_1');
  });

  test('16: customer-facing transition path is unaffected (regression smoke)', async () => {
    const created = await request(server).post('/api/v1/customer/requests')
      .set(digi())
      .send({ title: 'Customer path smoke', description: 'd', type: 'BUG', priority: 'P2', product: 'ERP' });
    expect(created.status).toBe(201);
    const id = created.body.data.request.id;
    const res = await request(server).post('/api/v1/customer/requests/' + id + '/transition')
      .set(digi()).send({ toStatus: 'TRIAGED' });
    expect(res.status).toBe(200);
    expect(res.body.data.request.status).toBe('TRIAGED');
  });

  test('17: customer still cannot touch another company request through internal routes gating', async () => {
    const res = await request(server).post('/api/v1/internal/changes/req-new-nile/notes')
      .set(digi()).send({ note: 'cross tenant attempt' });
    expect(res.status).toBe(403);
  });
});
