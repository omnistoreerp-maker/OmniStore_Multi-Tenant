'use strict';

// playstation.controller.test — unit tests for the PlayStation controller layer.
//
// Tests the controller functions in isolation by injecting mock req/res
// objects. No HTTP server is started. No Master-owned files are touched.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeTempDataDir } = require('./helpers/testData');

let dataDir;
let devicesService;
let sessionsService;
let pricingService;
let ctrl;

beforeAll(() => {
  dataDir = makeTempDataDir('playstation-controller');
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  jest.resetModules();
  devicesService = require('../services/playstationDevices.service');
  sessionsService = require('../services/playstationSessions.service');
  pricingService = require('../services/playstationPricing.service');
  ctrl = require('../controllers/playstation.controller');
});

afterAll(() => {
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DIGITRONICS_DATA_DIR;
});

function mockReq(overrides = {}) {
  return Object.assign({
    marketTenant: 'tenantA',
    query: {},
    body: {},
    customer: { id: 'cust1', tenantId: 'tenantA', email: 'a@test.com', name: 'Alice', role: 'operator' }
  }, overrides);
}

function mockRes() {
  const calls = [];
  const res = {
    status: function(code) { calls.push(['status', code]); return res; },
    json: function(body) { calls.push(['json', body]); return res; },
    send: function(body) { calls.push(['send', body]); return res; },
    _calls: calls,
    get lastJson() {
      const jsonCalls = calls.filter(c => c[0] === 'json');
      return jsonCalls.length ? jsonCalls[jsonCalls.length - 1][1] : undefined;
    },
    get lastStatus() {
      const statusCalls = calls.filter(c => c[0] === 'status');
      return statusCalls.length ? statusCalls[statusCalls.length - 1][1] : undefined;
    }
  };
  return res;
}

// === Devices ===

describe('playstation.controller — Devices', () => {
  let deviceId;

  beforeEach(async () => {
    const result = await devicesService.create({ data: {
      platform: 'ps5', model: 'CFI-1015A', display_name: 'Dev 1',
      network_address: '192.168.1.10', tenant_id: 'tenantA', branch_id: 'branch1'
    }, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });
    deviceId = result.device.id;
  });

  test('listDevices returns visible devices for tenant', async () => {
    const req = mockReq({ query: {} });
    const res = mockRes();
    await ctrl.listDevices(req, res);
    expect(res.lastStatus).toBe(200);
    const body = res.lastJson;
    expect(body.success).toBe(true);
    expect(body.data.devices.length).toBeGreaterThanOrEqual(1);
  });

  test('getDevice returns 404 when device is missing', async () => {
    const req = mockReq({ params: { id: 'missing' } });
    const res = mockRes();
    await ctrl.getDevice(req, res);
    expect(res.lastStatus).toBe(404);
  });

  test('createDevice creates a new device', async () => {
    const req = mockReq({ body: {
      platform: 'ps4', model: 'CUH-2000', display_name: 'Dev 2',
      network_address: '192.168.1.20'
    }});
    const res = mockRes();
    await ctrl.createDevice(req, res);
    expect(res.lastStatus).toBe(201);
    const body = res.lastJson;
    expect(body.success).toBe(true);
    expect(body.data.platform).toBe('ps4');
  });

  test('updateDevice returns 404 for missing device', async () => {
    const req = mockReq({ params: { id: 'missing' }, body: { display_name: 'New Name' } });
    const res = mockRes();
    await ctrl.updateDevice(req, res);
    expect(res.lastStatus).toBe(404);
  });

  test('transitionDevice returns 404 for missing device', async () => {
    const req = mockReq({ params: { id: 'missing' }, body: { status: 'maintenance' } });
    const res = mockRes();
    await ctrl.transitionDevice(req, res);
    expect(res.lastStatus).toBe(404);
  });

  test('transitionDevice updates status for valid transition', async () => {
    const req = mockReq({ params: { id: deviceId }, body: { status: 'maintenance' } });
    const res = mockRes();
    await ctrl.transitionDevice(req, res);
    expect(res.lastStatus).toBe(200);
    const body = res.lastJson;
    expect(body.data.status).toBe('maintenance');
  });

  test('deleteDevice returns 404 for missing device', async () => {
    const req = mockReq({ params: { id: 'missing' } });
    const res = mockRes();
    await ctrl.deleteDevice(req, res);
    expect(res.lastStatus).toBe(404);
  });
});

// === Pricing ===

describe('playstation.controller — Pricing', () => {
  let pricingId;

  beforeEach(async () => {
    const result = await pricingService.create({ data: {
      platform: 'ps5', rate_per_minute: 10, minimum_minutes: 15, rounding_minutes: 5,
      tenant_id: 'tenantA', branch_id: 'branch1'
    }, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1' });
    pricingId = result.pricing.id;
  });

  test('listPricing returns visible profiles', async () => {
    const req = mockReq({ query: {} });
    const res = mockRes();
    await ctrl.listPricing(req, res);
    expect(res.lastStatus).toBe(200);
    const body = res.lastJson;
    expect(body.data.pricing.length).toBeGreaterThanOrEqual(1);
  });

  test('getPricing returns 404 for missing profile', async () => {
    const req = mockReq({ params: { id: 'missing' } });
    const res = mockRes();
    await ctrl.getPricing(req, res);
    expect(res.lastStatus).toBe(404);
  });

  test('createPricing creates a new profile', async () => {
    const req = mockReq({ body: {
      platform: 'ps4', rate_per_minute: 8, minimum_minutes: 30, rounding_minutes: 10
    }});
    const res = mockRes();
    await ctrl.createPricing(req, res);
    expect(res.lastStatus).toBe(201);
    const body = res.lastJson;
    expect(body.data.platform).toBe('ps4');
  });

  test('updatePricing returns 404 for missing profile', async () => {
    const req = mockReq({ params: { id: 'missing' }, body: { rate_per_minute: 12 } });
    const res = mockRes();
    await ctrl.updatePricing(req, res);
    expect(res.lastStatus).toBe(404);
  });

  test('deletePricing returns 404 for missing profile', async () => {
    const req = mockReq({ params: { id: 'missing' } });
    const res = mockRes();
    await ctrl.deletePricing(req, res);
    expect(res.lastStatus).toBe(404);
  });
});

// === Sessions ===

describe('playstation.controller — Sessions', () => {
  let deviceId;
  let sessionId;

  beforeEach(async () => {
    const dev = await devicesService.create({ data: {
      platform: 'ps5', model: 'CFI-1015A', display_name: 'Session Dev',
      network_address: '192.168.1.30', tenant_id: 'tenantA', branch_id: 'branch1'
    }, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });
    deviceId = dev.device.id;
    const sess = await sessionsService.create({ data: {
      device_id: deviceId, customer_id: 'cust1', duration_minutes: 60,
      tenant_id: 'tenantA', branch_id: 'branch1'
    }, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });
    sessionId = sess.session.id;
  });

  test('listSessions returns visible sessions', async () => {
    const req = mockReq({ query: {} });
    const res = mockRes();
    await ctrl.listSessions(req, res);
    expect(res.lastStatus).toBe(200);
    const body = res.lastJson;
    expect(body.data.sessions.length).toBeGreaterThanOrEqual(1);
  });

  test('non-operator customer cannot enumerate another customer sessions via query customerId', async () => {
    await sessionsService.create({ data: {
      device_id: deviceId, customer_id: 'cust2', duration_minutes: 30,
      tenant_id: 'tenantA', branch_id: 'branch1'
    }, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });

    const req = mockReq({ query: { customerId: 'cust2' }, customer: { id: 'cust1', tenantId: 'tenantA', email: 'a@test.com', name: 'Alice', role: 'customer' } });
    const res = mockRes();
    await ctrl.listSessions(req, res);
    expect(res.lastStatus).toBe(200);
    const body = res.lastJson;
    expect(body.data.sessions.every(s => s.customer_id === 'cust1')).toBe(true);
  });

  test('operator can filter sessions by customerId query param', async () => {
    await sessionsService.create({ data: {
      device_id: deviceId, customer_id: 'cust2', duration_minutes: 30,
      tenant_id: 'tenantA', branch_id: 'branch1'
    }, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });

    const req = mockReq({ query: { customerId: 'cust2' } });
    const res = mockRes();
    await ctrl.listSessions(req, res);
    expect(res.lastStatus).toBe(200);
    const body = res.lastJson;
    expect(body.data.sessions.every(s => s.customer_id === 'cust2')).toBe(true);
  });

  test('getSession returns 404 for missing session', async () => {
    const req = mockReq({ params: { id: 'missing' } });
    const res = mockRes();
    await ctrl.getSession(req, res);
    expect(res.lastStatus).toBe(404);
  });

  test('createSession creates a new session', async () => {
    const dev = await devicesService.create({ data: {
      platform: 'ps4', model: 'CUH-2000', display_name: 'Another Dev',
      network_address: '192.168.1.40', tenant_id: 'tenantA', branch_id: 'branch1'
    }, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });
    const req = mockReq({ body: { device_id: dev.device.id, customer_id: 'cust1', duration_minutes: 45 } });
    const res = mockRes();
    await ctrl.createSession(req, res);
    expect(res.lastStatus).toBe(201);
    const body = res.lastJson;
    expect(body.data.status).toBe('pending');
  });

  test('startSession returns 404 for missing session', async () => {
    const req = mockReq({ params: { id: 'missing' } });
    const res = mockRes();
    await ctrl.startSession(req, res);
    expect(res.lastStatus).toBe(404);
  });

  test('startSession starts pending session and marks device occupied', async () => {
    const req = mockReq({ params: { id: sessionId } });
    const res = mockRes();
    await ctrl.startSession(req, res);
    expect(res.lastStatus).toBe(200);
    const body = res.lastJson;
    expect(body.success).toBe(true);
    expect(body.data.session.status).toBe('active');
    expect(body.data.device.status).toBe('occupied');
  });

  test('stopSession returns 404 for missing session', async () => {
    const req = mockReq({ params: { id: 'missing' } });
    const res = mockRes();
    await ctrl.stopSession(req, res);
    expect(res.lastStatus).toBe(404);
  });

  test('cancelSession returns 404 for missing session', async () => {
    const req = mockReq({ params: { id: 'missing' }, body: {} });
    const res = mockRes();
    await ctrl.cancelSession(req, res);
    expect(res.lastStatus).toBe(404);
  });
});

// === Payment finalization ===

describe('playstation.controller — finalizeSessionPayment', () => {
  test('requires idempotencyKey in body', async () => {
    const req = mockReq({ params: { id: 's1' }, body: {} });
    const res = mockRes();
    await ctrl.finalizeSessionPayment(req, res);
    expect(res.lastStatus).toBe(400);
  });

  test('returns 404 for missing session', async () => {
    const req = mockReq({ params: { id: 'missing' }, body: { idempotencyKey: 'key-1' } });
    const res = mockRes();
    await ctrl.finalizeSessionPayment(req, res);
    expect(res.lastStatus).toBe(404);
  });

  test('returns 409 for already finalized with different key', async () => {
    const pricing = await pricingService.create({
      data: { platform: 'ps5', rate_per_minute: 10, minimum_minutes: 1, rounding_minutes: 1, tenant_id: 'tenantA', branch_id: 'branch1' },
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1'
    });
    const device = await devicesService.create({
      data: { platform: 'ps5', model: 'CFI-1015A', display_name: 'Finalize Dev 1', network_address: '192.168.1.10', tenant_id: 'tenantA', branch_id: 'branch1' },
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });
    const sessionResult = await sessionsService.create({
      data: { device_id: device.device.id, customer_id: 'cust1', duration_minutes: 60, pricing_profile_id: pricing.pricing.id, tenant_id: 'tenantA', branch_id: 'branch1' },
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });
    const session = sessionResult.session;
    await sessionsService.start({ id: session.id, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });
    await sessionsService.stop({ id: session.id, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });
    await sessionsService.finalizePayment({
      id: session.id,
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' },
      idempotencyKey: 'key-first'
    });

    const req = mockReq({ params: { id: session.id }, body: { idempotencyKey: 'key-second' } });
    const res = mockRes();
    await ctrl.finalizeSessionPayment(req, res);
    expect(res.lastStatus).toBe(409);
  });

  test('returns 202 with recovery_required when Treasury fails', async () => {
    const pricing = await pricingService.create({
      data: { platform: 'ps5', rate_per_minute: 10, minimum_minutes: 1, rounding_minutes: 1, tenant_id: 'tenantA', branch_id: 'branch1' },
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1'
    });
    const device = await devicesService.create({
      data: { platform: 'ps5', model: 'CFI-1015A', display_name: 'Finalize Dev 2', network_address: '192.168.1.11', tenant_id: 'tenantA', branch_id: 'branch1' },
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });
    const sessionResult = await sessionsService.create({
      data: { device_id: device.device.id, customer_id: 'cust1', duration_minutes: 60, pricing_profile_id: pricing.pricing.id, tenant_id: 'tenantA', branch_id: 'branch1' },
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });
    const session = sessionResult.session;
    await sessionsService.start({ id: session.id, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });
    const stopResult = await sessionsService.stop({ id: session.id, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });

    const spy = jest.spyOn(require('../services/treasury.service'), 'create').mockResolvedValue({ error: 'Treasury failure' });
    const req = mockReq({ params: { id: session.id }, body: { idempotencyKey: 'key-recovery' } });
    const res = mockRes();
    await ctrl.finalizeSessionPayment(req, res);
    expect(res.lastStatus).toBe(202);
    const body = res.lastJson;
    expect(body.success).toBe(false);
    expect(body.details.recovery_required).toBe(true);
    expect(body.details.saleId).toBeTruthy();
    spy.mockRestore();
  });
});

// === Branch isolation ===

describe('playstation.controller — branch isolation', () => {
  test('omitted branchId uses trusted branch from branchStore', async () => {
    const branchStore = require('../middleware/branchStore');
    const originalGet = branchStore.get;
    branchStore.get = () => 'branchA';

    const devA = await devicesService.create({ data: {
      platform: 'ps5', model: 'CFI-1015A', display_name: 'Branch A Dev',
      network_address: '192.168.1.10', tenant_id: 'tenantA', branch_id: 'branchA'
    }, tenantContext: { tenantId: 'tenantA' }, branchId: 'branchA', actor: { id: 'op1' } });

    const req = mockReq({ query: {} });
    const res = mockRes();
    await ctrl.listDevices(req, res);
    expect(res.lastStatus).toBe(200);
    const body = res.lastJson;
    expect(body.success).toBe(true);
    expect(body.data.devices.length).toBeGreaterThanOrEqual(1);
    expect(body.data.devices.every(d => d.branch_id === 'branchA' || d.branch_id === '')).toBe(true);

    branchStore.get = originalGet;
  });

  test('client-supplied query branchId is ignored', async () => {
    const branchStore = require('../middleware/branchStore');
    const originalGet = branchStore.get;
    branchStore.get = () => 'branchA';

    const devA = await devicesService.create({ data: {
      platform: 'ps5', model: 'CFI-1015A', display_name: 'Branch A Dev',
      network_address: '192.168.1.10', tenant_id: 'tenantA', branch_id: 'branchA'
    }, tenantContext: { tenantId: 'tenantA' }, branchId: 'branchA', actor: { id: 'op1' } });

    const req = mockReq({ query: { branchId: 'branchB' } });
    const res = mockRes();
    await ctrl.listDevices(req, res);
    expect(res.lastStatus).toBe(200);
    const body = res.lastJson;
    expect(body.success).toBe(true);
    expect(body.data.devices.every(d => d.branch_id === 'branchA' || d.branch_id === '')).toBe(true);

    branchStore.get = originalGet;
  });

  test('cross-branch records are not exposed', async () => {
    const branchStore = require('../middleware/branchStore');
    const originalGet = branchStore.get;
    branchStore.get = () => 'branchA';

    const devA = await devicesService.create({ data: {
      platform: 'ps5', model: 'CFI-1015A', display_name: 'Branch A Dev',
      network_address: '192.168.1.10', tenant_id: 'tenantA', branch_id: 'branchA'
    }, tenantContext: { tenantId: 'tenantA' }, branchId: 'branchA', actor: { id: 'op1' } });
    const devB = await devicesService.create({ data: {
      platform: 'ps5', model: 'CFI-1015B', display_name: 'Branch B Dev',
      network_address: '192.168.1.11', tenant_id: 'tenantA', branch_id: 'branchB'
    }, tenantContext: { tenantId: 'tenantA' }, branchId: 'branchB', actor: { id: 'op1' } });

    const req = mockReq({ query: {} });
    const res = mockRes();
    await ctrl.listDevices(req, res);
    expect(res.lastStatus).toBe(200);
    const body = res.lastJson;
    expect(body.data.devices.every(d => d.branch_id !== 'branchB')).toBe(true);

    branchStore.get = originalGet;
  });
});

// === Error handling ===

describe('playstation.controller — error handling', () => {
  test('unhandled errors return 500', async () => {
    const brokenService = { list: () => { throw new Error('boom'); } };
    jest.resetModules();
    jest.doMock('../services/playstationDevices.service', () => brokenService);
    const brokenCtrl = require('../controllers/playstation.controller');
    const req = mockReq({ query: {} });
    const res = mockRes();
    await brokenCtrl.listDevices(req, res);
    expect(res.lastStatus).toBe(500);
    jest.dontMock('../services/playstationDevices.service');
  });
});
