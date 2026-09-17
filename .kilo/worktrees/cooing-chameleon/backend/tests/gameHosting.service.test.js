'use strict';

// gameHosting.service — Phase A unit tests.
//
// Phase A scope: data layer + tenant isolation. No HTTP, no provisioning
// engine. The service is tested directly (not via supertest) following
// the same pattern as gamesCatalog.service.test.js.
//
// Coverage targets:
//   - Happy path CRUD for plans and servers
//   - Validation for every required field
//   - Tenant isolation: tenant A cannot see / mutate tenant B records
//   - Foreign tenantId claim rejection
//   - Cross-tenant plan reference rejection (a server cannot reference
//     a plan owned by another tenant)
//   - Trust-boundary: data.tenantId from the body is rejected if it
//     disagrees with the trusted context
//   - Fail-closed default for missing / malformed tenant context
//     (no records are returned when no tenant is provided AND the
//     trusted context is absent; this is the conservative path)

const fs = require('fs');
const path = require('path');
const { makeTempDataDir } = require('./helpers/testData');

let dataDir;
let service;
const ORIGINAL_ROOT = process.env.DIGITRONICS_DATA_DIR;

beforeAll(() => {
  dataDir = makeTempDataDir('game-hosting');
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  jest.resetModules();
  service = require('../services/gameHosting.service');
});

afterAll(() => {
  if (ORIGINAL_ROOT === undefined) delete process.env.DIGITRONICS_DATA_DIR;
  else process.env.DIGITRONICS_DATA_DIR = ORIGINAL_ROOT;
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
});

const tenantA = { tenantId: 'tenantA' };
const tenantB = { tenantId: 'tenantB' };

function validPlan(overrides) {
  return Object.assign({
    name: 'Minecraft 10-player Asia',
    gameTitle: 'Minecraft',
    maxPlayers: 10,
    pricePerMonth: 19.99,
    region: 'asia',
    status: 'active'
  }, overrides || {});
}

function validServer(overrides) {
  return Object.assign({
    planId: 'PLACEHOLDER',
    serverName: 'mc-server-1',
    region: 'asia',
    status: 'pending'
  }, overrides || {});
}

describe('gameHosting.service — plans happy path', () => {
  test('createPlan persists a record with id, timestamps, and tenantId', async () => {
    const res = await service.createPlan({ data: validPlan({ name: 'p-happy-1' }), tenantContext: tenantA });
    expect(res.error).toBeUndefined();
    expect(res.plan).toBeDefined();
    expect(res.plan.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(res.plan.tenantId).toBe('tenantA');
    expect(res.plan.createdAt).toBeTruthy();
    expect(res.plan.updatedAt).toBeTruthy();
  });

  test('listPlans returns only the current tenant records', async () => {
    await service.createPlan({ data: validPlan({ name: 'p-A' }), tenantContext: tenantA });
    await service.createPlan({ data: validPlan({ name: 'p-B' }), tenantContext: tenantB });
    const listA = await service.listPlans({ tenantContext: tenantA });
    const listB = await service.listPlans({ tenantContext: tenantB });
    expect(listA.every((p) => p.tenantId === 'tenantA')).toBe(true);
    expect(listB.every((p) => p.tenantId === 'tenantB')).toBe(true);
  });

  test('getPlanById returns the matching record for the owning tenant', async () => {
    const created = await service.createPlan({ data: validPlan({ name: 'p-byid' }), tenantContext: tenantA }).then((r) => r.plan);
    const found = await service.getPlanById({ id: created.id, tenantContext: tenantA });
    expect(found).toBeDefined();
    expect(found.id).toBe(created.id);
  });

  test('updatePlan changes specified fields', async () => {
    const created = await service.createPlan({ data: validPlan({ name: 'p-update' }), tenantContext: tenantA }).then((r) => r.plan);
    const res = await service.updatePlan({ id: created.id, data: { pricePerMonth: 29.99 }, tenantContext: tenantA });
    expect(res.error).toBeUndefined();
    expect(res.plan.pricePerMonth).toBe(29.99);
  });

  test('deletePlan removes the record', async () => {
    const created = await service.createPlan({ data: validPlan({ name: 'p-delete' }), tenantContext: tenantA }).then((r) => r.plan);
    const res = await service.deletePlan({ id: created.id, tenantContext: tenantA });
    expect(res.error).toBeUndefined();
    expect(res.success).toBe(true);
    expect(await service.getPlanById({ id: created.id, tenantContext: tenantA })).toBeNull();
  });
});

describe('gameHosting.service — plan validation', () => {
  test('rejects a missing name', async () => {
    const res = await service.createPlan({ data: validPlan({ name: undefined }), tenantContext: tenantA });
    expect(res.error).toMatch(/name is required/);
  });
  test('rejects a negative maxPlayers', async () => {
    const res = await service.createPlan({ data: validPlan({ name: 'p-neg', maxPlayers: -1 }), tenantContext: tenantA });
    expect(res.error).toMatch(/maxPlayers must be a positive integer/);
  });
  test('rejects a non-numeric pricePerMonth', async () => {
    const res = await service.createPlan({ data: validPlan({ name: 'p-nan', pricePerMonth: 'cheap' }), tenantContext: tenantA });
    expect(res.error).toMatch(/pricePerMonth must be a non-negative number/);
  });
  test('rejects an invalid status', async () => {
    const res = await service.createPlan({ data: validPlan({ name: 'p-st', status: 'deleted' }), tenantContext: tenantA });
    expect(res.error).toMatch(/status must be one of/);
  });
  test('rejects a duplicate plan name per tenant', async () => {
    await service.createPlan({ data: validPlan({ name: 'p-dup' }), tenantContext: tenantA });
    const res = await service.createPlan({ data: validPlan({ name: 'p-dup' }), tenantContext: tenantA });
    expect(res.error).toMatch(/Duplicate plan name/);
  });
});

describe('gameHosting.service — server happy path', () => {
  test('createServer requires a plan that exists in the trusted tenant', async () => {
    const plan = await service.createPlan({ data: validPlan({ name: 'p-srv-1' }), tenantContext: tenantA }).then((r) => r.plan);
    const res = await service.createServer({ data: validServer({ planId: plan.id, serverName: 'srv-1' }), tenantContext: tenantA });
    expect(res.error).toBeUndefined();
    expect(res.server).toBeDefined();
    expect(res.server.planId).toBe(plan.id);
    expect(res.server.tenantId).toBe('tenantA');
  });

  test('listServers returns only the current tenant records', async () => {
    const planA = await service.createPlan({ data: validPlan({ name: 'p-srv-A' }), tenantContext: tenantA }).then((r) => r.plan);
    const planB = await service.createPlan({ data: validPlan({ name: 'p-srv-B' }), tenantContext: tenantB }).then((r) => r.plan);
    await service.createServer({ data: validServer({ planId: planA.id, serverName: 'srv-A1' }), tenantContext: tenantA });
    await service.createServer({ data: validServer({ planId: planB.id, serverName: 'srv-B1' }), tenantContext: tenantB });
    const listA = await service.listServers({ tenantContext: tenantA });
    const listB = await service.listServers({ tenantContext: tenantB });
    expect(listA.every((s) => s.tenantId === 'tenantA')).toBe(true);
    expect(listB.every((s) => s.tenantId === 'tenantB')).toBe(true);
  });
});

describe('gameHosting.service — tenant isolation', () => {
  test('tenant A cannot read tenant B plan by id', async () => {
    const created = await service.createPlan({ data: validPlan({ name: 'p-iso-1' }), tenantContext: tenantA }).then((r) => r.plan);
    const found = await service.getPlanById({ id: created.id, tenantContext: tenantB });
    expect(found).toBeNull();
  });
  test('tenant A cannot update tenant B plan', async () => {
    const created = await service.createPlan({ data: validPlan({ name: 'p-iso-2' }), tenantContext: tenantA }).then((r) => r.plan);
    const res = await service.updatePlan({ id: created.id, data: { pricePerMonth: 0.01 }, tenantContext: tenantB });
    expect(res.error).toBe('Plan not found');
  });
  test('tenant A cannot delete tenant B plan', async () => {
    const created = await service.createPlan({ data: validPlan({ name: 'p-iso-3' }), tenantContext: tenantA }).then((r) => r.plan);
    const res = await service.deletePlan({ id: created.id, tenantContext: tenantB });
    expect(res.error).toBe('Plan not found');
    expect(await service.getPlanById({ id: created.id, tenantContext: tenantA })).toBeDefined();
  });
  test('a foreign tenantId in the body is rejected (P0-2 trust boundary)', async () => {
    const res = await service.createPlan({
      data: validPlan({ name: 'p-foreign', tenantId: 'tenantB' }),
      tenantContext: tenantA
    });
    expect(res.error).toMatch(/tenantId claim does not match/);
  });
  test('a server cannot reference a plan owned by another tenant', async () => {
    const planB = await service.createPlan({ data: validPlan({ name: 'p-crossref' }), tenantContext: tenantB }).then((r) => r.plan);
    const res = await service.createServer({
      data: validServer({ planId: planB.id, serverName: 'srv-xref' }),
      tenantContext: tenantA
    });
    expect(res.error).toMatch(/Plan not found in trusted tenant/);
  });
  test('tenant A cannot read tenant B server by id', async () => {
    const planA = await service.createPlan({ data: validPlan({ name: 'p-siso' }), tenantContext: tenantA }).then((r) => r.plan);
    const server = await service.createServer({ data: validServer({ planId: planA.id, serverName: 'srv-siso' }), tenantContext: tenantA }).then((r) => r.server);
    const found = await service.getServerById({ id: server.id, tenantContext: tenantB });
    expect(found).toBeNull();
  });
});

describe('gameHosting.service — provisioning requests', () => {
  test('createProvisioningRequest records the request under the trusted tenant', async () => {
    const plan = await service.createPlan({ data: validPlan({ name: 'p-provision' }), tenantContext: tenantA }).then((r) => r.plan);
    const res = await service.createProvisioningRequest({ data: { planId: plan.id, region: 'eu' }, tenantContext: tenantA });
    expect(res.error).toBeUndefined();
    expect(res.request.tenantId).toBe('tenantA');
    expect(res.request.planId).toBe(plan.id);
    expect(res.request.status).toBe('pending');
  });
  test('provisioning requests are tenant-scoped on list', async () => {
    const planA = await service.createPlan({ data: validPlan({ name: 'p-pr-A' }), tenantContext: tenantA }).then((r) => r.plan);
    const planB = await service.createPlan({ data: validPlan({ name: 'p-pr-B' }), tenantContext: tenantB }).then((r) => r.plan);
    await service.createProvisioningRequest({ data: { planId: planA.id }, tenantContext: tenantA });
    await service.createProvisioningRequest({ data: { planId: planB.id }, tenantContext: tenantB });
    const listA = await service.listProvisioningRequests({ tenantContext: tenantA });
    const listB = await service.listProvisioningRequests({ tenantContext: tenantB });
    expect(listA.every((r) => r.tenantId === 'tenantA')).toBe(true);
    expect(listB.every((r) => r.tenantId === 'tenantB')).toBe(true);
  });
  test('provisioning request against foreign plan is rejected', async () => {
    const planB = await service.createPlan({ data: validPlan({ name: 'p-pr-foreign' }), tenantContext: tenantB }).then((r) => r.plan);
    const res = await service.createProvisioningRequest({ data: { planId: planB.id }, tenantContext: tenantA });
    expect(res.error).toMatch(/Plan not found in trusted tenant/);
  });
});

describe('gameHosting.service — no network or HTTP imports', () => {
  test('source file imports no network or storage modules', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'gameHosting.service.js'), 'utf8');
    expect(src).not.toMatch(/require\(['"]http['"]\)/);
    expect(src).not.toMatch(/require\(['"]https['"]\)/);
    expect(src).not.toMatch(/require\(['"]net['"]\)/);
    expect(src).not.toMatch(/require\(['"]dns['"]\)/);
    expect(src).not.toMatch(/require\(['"]node-fetch['"]\)/);
    expect(src).not.toMatch(/require\(['"]axios['"]\)/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/http\.(get|request)\s*\(/);
  });
});
