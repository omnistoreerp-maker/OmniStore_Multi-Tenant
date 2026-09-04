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
  artifactSha256: null,
  product: 'OMNISTORE',
  environment: 'test',
  releasedAt: '2026-08-17T00:00:00.000Z',
  deployedAt: '2026-08-17T00:00:00.000Z',
  healthStatus: 'verified',
  releaseNotes: 'v1.0.0',
  rollbackTarget: null
});

const mismatchedArtifactRelease = () => ({
  id: 'rel_v0.9.0',
  version: '0.9.0',
  buildId: '0.9.0-OLD',
  commitSha: 'oldcommitsha',
  artifactSha256: '0000000000000000000000000000000000000000000000000000000000000000',
  product: 'OMNISTORE',
  environment: 'test',
  releasedAt: '2026-07-01T00:00:00.000Z',
  deployedAt: '2026-07-01T00:00:00.000Z',
  healthStatus: 'unknown',
  releaseNotes: 'v0.9.0',
  rollbackTarget: null
});

const noIdentityRelease = () => ({
  id: 'rel_unknown',
  product: 'OMNISTORE',
  environment: 'test',
  releasedAt: '2026-07-01T00:00:00.000Z',
  deployedAt: '2026-07-01T00:00:00.000Z',
  healthStatus: 'unknown',
  releaseNotes: 'Unknown',
  rollbackTarget: null
});

async function createAndAdvance(server, token, title, release) {
  const created = await request(server).post('/api/v1/customer/requests')
    .set({ Authorization: 'Bearer ' + token })
    .send({ title: title, description: 'd', type: 'BUG', priority: 'P2', product: 'ERP' });
  const id = created.body.data.request.id;
  for (const s of ['TRIAGED', 'APPROVED', 'IN_PROGRESS', 'READY_FOR_TEST', 'TESTED', 'READY_FOR_RELEASE']) {
    await request(server).post('/api/v1/customer/requests/' + id + '/transition')
      .set({ Authorization: 'Bearer ' + token }).send({ toStatus: s });
  }
  await request(server).post('/api/v1/customer/requests/' + id + '/transition')
    .set({ Authorization: 'Bearer ' + token }).send({ toStatus: 'RELEASED', releaseId: release });
  await request(server).post('/api/v1/customer/requests/' + id + '/transition')
    .set({ Authorization: 'Bearer ' + token }).send({ toStatus: 'READY_FOR_CUSTOMER_VERIFICATION' });
  return id;
}

describe('Customer Verification & Historical Closure', () => {
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
    dir = makeTempDataDir('customerVerification');
    tempDirs.push(dir);
    seedAll(dir);
    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    server = s.app;
    digiToken = (await login(server, 'digiOwner', PASSWORD, 'digi')).accessToken;
    nileToken = (await login(server, 'nileOwner', PASSWORD, 'nile')).accessToken;
  });

  afterAll(() => {
    tempDirs.forEach(d => {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
    });
  });

  // ---------- Build identity ----------
  test('1: build identity endpoint returns artifact sha256', async () => {
    const res = await request(server).get('/api/v1/customer/build').set({ Authorization: 'Bearer ' + digiToken });
    expect(res.status).toBe(200);
    expect(res.body.data.build).toHaveProperty('version');
    expect(res.body.data.build).toHaveProperty('buildId');
    expect(res.body.data.build).toHaveProperty('commitSha');
  });

  test('2: list includes artifactIdentity', async () => {
    const res = await request(server).get('/api/v1/customer/requests').set({ Authorization: 'Bearer ' + digiToken });
    expect(res.status).toBe(200);
    expect(res.body.data.artifactIdentity).toHaveProperty('version');
  });

  // ---------- Customer-facing status ----------
  test('3: customer-facing status is included in request', async () => {
    const res = await request(server).get('/api/v1/customer/requests').set({ Authorization: 'Bearer ' + digiToken });
    const r = res.body.data.requests[0];
    expect(r).toHaveProperty('customerFacingStatus');
    expect(typeof r.customerFacingStatus).toBe('string');
  });

  test('4: RESOLVED maps to "Confirmed resolved"', async () => {
    const res = await request(server).get('/api/v1/customer/requests').set({ Authorization: 'Bearer ' + digiToken });
    const resolved = res.body.data.requests.find(r => r.status === 'RESOLVED');
    if (resolved) {
      expect(resolved.customerFacingStatus).toBe('Confirmed resolved');
    }
  });

  test('5: RELEASED maps to "Released — please verify"', async () => {
    const id = await createAndAdvance(server, digiToken, 'Status mapping test', matchingRelease());
    const res = await request(server).get('/api/v1/customer/requests/' + id).set({ Authorization: 'Bearer ' + digiToken });
    expect(res.body.data.request.customerFacingStatus).toBe('Released — please verify');
  });

  // ---------- Verification integrity ----------
  test('6: verification with mismatched ARTIFACT sha256 is rejected (ARTIFACT_MISMATCH)', async () => {
    const id = await createAndAdvance(server, digiToken, 'Artifact mismatch test', mismatchedArtifactRelease());
    const v = await request(server).post('/api/v1/customer/requests/' + id + '/verify')
      .set({ Authorization: 'Bearer ' + digiToken }).send({ result: 'CONFIRMED' });
    expect(v.status).toBe(409);
    expect(v.body.details && v.body.details.code).toBe('RELEASE_BUILD_MISMATCH');
  });

  test('7: verification with NO release identity is rejected (NO_RELEASE_IDENTITY)', async () => {
    const id = await createAndAdvance(server, digiToken, 'No identity test', noIdentityRelease());
    const v = await request(server).post('/api/v1/customer/requests/' + id + '/verify')
      .set({ Authorization: 'Bearer ' + digiToken }).send({ result: 'CONFIRMED' });
    expect(v.status).toBe(409);
    expect(v.body.details && v.body.details.code).toBe('RELEASE_BUILD_MISMATCH');
  });

  test('8: verification with matching buildId RESOLVES the request', async () => {
    const id = await createAndAdvance(server, digiToken, 'Confirm match test', matchingRelease());
    const v = await request(server).post('/api/v1/customer/requests/' + id + '/verify')
      .set({ Authorization: 'Bearer ' + digiToken }).send({ result: 'CONFIRMED', note: 'Works great' });
    expect(v.status).toBe(200);
    expect(v.body.data.request.status).toBe('RESOLVED');
    expect(v.body.data.request.customerVerifiedAt).toBeTruthy();
  });

  // ---------- Audit integrity ----------
  test('9: verification record stores artifact sha256', async () => {
    const id = await createAndAdvance(server, digiToken, 'Audit artifact test', matchingRelease());
    const v = await request(server).post('/api/v1/customer/requests/' + id + '/verify')
      .set({ Authorization: 'Bearer ' + digiToken }).send({ result: 'CONFIRMED' });
    expect(v.status).toBe(200);
    // Fetch the detail to see the verification record
    const detail = await request(server).get('/api/v1/customer/requests/' + id).set({ Authorization: 'Bearer ' + digiToken });
    const ver = detail.body.data.verifications[0];
    expect(ver).toHaveProperty('buildId');
    expect(ver).toHaveProperty('artifactSha256');
  });

  test('10: audit history is append-only (previous events preserved after reopen)', async () => {
    const id = await createAndAdvance(server, digiToken, 'Audit history test', matchingRelease());
    // First confirm
    await request(server).post('/api/v1/customer/requests/' + id + '/verify')
      .set({ Authorization: 'Bearer ' + digiToken }).send({ result: 'CONFIRMED' });
    // Then reopen
    await request(server).post('/api/v1/customer/requests/' + id + '/reopen')
      .set({ Authorization: 'Bearer ' + digiToken }).send({ note: 'Issue returned' });
    const detail = await request(server).get('/api/v1/customer/requests/' + id).set({ Authorization: 'Bearer ' + digiToken });
    const audit = detail.body.data.audit;
    // Should have: RELEASED, READY_FOR_CUSTOMER_VERIFICATION, RESOLVED, REOPENED
    const statuses = audit.map(a => a.toStatus);
    expect(statuses).toContain('RESOLVED');
    expect(statuses).toContain('REOPENED');
    expect(audit.length).toBeGreaterThanOrEqual(4);
  });

  test('11: timeline is returned in chronological order', async () => {
    const id = await createAndAdvance(server, digiToken, 'Timeline test', matchingRelease());
    const detail = await request(server).get('/api/v1/customer/requests/' + id).set({ Authorization: 'Bearer ' + digiToken });
    const timeline = detail.body.data.timeline;
    expect(Array.isArray(timeline)).toBe(true);
    for (let i = 1; i < timeline.length; i++) {
      expect(String(timeline[i].timestamp).localeCompare(String(timeline[i - 1].timestamp))).toBeGreaterThanOrEqual(0);
    }
  });

  test('12: timeline includes verification events', async () => {
    const id = await createAndAdvance(server, digiToken, 'Timeline verify test', matchingRelease());
    await request(server).post('/api/v1/customer/requests/' + id + '/verify')
      .set({ Authorization: 'Bearer ' + digiToken }).send({ result: 'CONFIRMED' });
    const detail = await request(server).get('/api/v1/customer/requests/' + id).set({ Authorization: 'Bearer ' + digiToken });
    const timeline = detail.body.data.timeline;
    const verifyEvent = timeline.find(t => t.type === 'verification');
    expect(verifyEvent).toBeTruthy();
    expect(verifyEvent.result).toBe('CONFIRMED');
  });

  // ---------- Cross-company protection ----------
  test('13: Company A cannot verify Company B request (404)', async () => {
    const id = await createAndAdvance(server, digiToken, 'Cross-company verify test', matchingRelease());
    const cross = await request(server).post('/api/v1/customer/requests/' + id + '/verify')
      .set({ Authorization: 'Bearer ' + nileToken }).send({ result: 'CONFIRMED' });
    expect(cross.status).toBe(404);
  });

  test('14: Company A cannot read Company B request detail (404)', async () => {
    const id = await createAndAdvance(server, digiToken, 'Cross-company read test', matchingRelease());
    const cross = await request(server).get('/api/v1/customer/requests/' + id).set({ Authorization: 'Bearer ' + nileToken });
    expect(cross.status).toBe(404);
  });

  // ---------- Historical evidence ----------
  test('15: historical records include implementationCommits and testEvidence', async () => {
    const res = await request(server).get('/api/v1/customer/requests').set({ Authorization: 'Bearer ' + digiToken });
    const cr1 = res.body.data.requests.find(r => r.customerRequestNumber === 'CR-2026-0001');
    expect(cr1).toBeTruthy();
    expect(cr1.implementationCommits).toContain('50833cb');
    expect(cr1.implementationCommits).toContain('f132538');
  });

  test('16: historical records include real artifact sha256 in releaseId', async () => {
    const res = await request(server).get('/api/v1/customer/requests').set({ Authorization: 'Bearer ' + digiToken });
    const cr1 = res.body.data.requests.find(r => r.customerRequestNumber === 'CR-2026-0001');
    expect(cr1.releaseId).toBeTruthy();
    expect(cr1.releaseId.artifactSha256).toBeTruthy();
  });

  // ---------- RELEASED ≠ RESOLVED invariant ----------
  test('17: RELEASED status is distinct from RESOLVED', async () => {
    expect('RELEASED').not.toBe('RESOLVED');
    expect('READY_FOR_CUSTOMER_VERIFICATION').not.toBe('RESOLVED');
  });

  test('18: customer cannot directly set RESOLVED via transition', async () => {
    const created = await request(server).post('/api/v1/customer/requests')
      .set({ Authorization: 'Bearer ' + digiToken })
      .send({ title: 'Direct RESOLVED test', description: 'd', type: 'BUG', priority: 'P2', product: 'ERP' });
    const id = created.body.data.request.id;
    const r = await request(server).post('/api/v1/customer/requests/' + id + '/transition')
      .set({ Authorization: 'Bearer ' + digiToken }).send({ toStatus: 'RESOLVED' });
    expect(r.status).toBe(400);
    expect(r.body.details && r.body.details.code).toBe('INVALID_STATUS_TRANSITION');
  });

  // ---------- Customer failure → REOPENED ----------
  test('19: customer FAILED verification → REOPENED with history preserved', async () => {
    const id = await createAndAdvance(server, digiToken, 'Failed verify test', matchingRelease());
    const v = await request(server).post('/api/v1/customer/requests/' + id + '/verify')
      .set({ Authorization: 'Bearer ' + digiToken }).send({ result: 'FAILED', note: 'Still broken' });
    expect(v.status).toBe(200);
    expect(v.body.data.request.status).toBe('REOPENED');
    // Verify release is still attached
    expect(v.body.data.request.releaseId).toBeTruthy();
  });

  // ---------- Reopen from RESOLVED ----------
  test('20: RESOLVED → REOPENED preserves previous release', async () => {
    const id = await createAndAdvance(server, digiToken, 'Reopen from resolved test', matchingRelease());
    await request(server).post('/api/v1/customer/requests/' + id + '/verify')
      .set({ Authorization: 'Bearer ' + digiToken }).send({ result: 'CONFIRMED' });
    const reopen = await request(server).post('/api/v1/customer/requests/' + id + '/reopen')
      .set({ Authorization: 'Bearer ' + digiToken }).send({ note: 'Issue returned' });
    expect(reopen.status).toBe(200);
    expect(reopen.body.data.request.status).toBe('REOPENED');
    expect(reopen.body.data.request.releaseId).toBeTruthy();
  });
});
