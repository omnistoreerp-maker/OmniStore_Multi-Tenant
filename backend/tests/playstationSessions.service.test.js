'use strict';

// playstationSessions.service.test — regression tests for PlayStation session service.
//
// Covers:
//   - start() device lookup uses session.device_id (not session id)
//   - stop()/cancel() use session.pricing_profile_id for historical billing
//   - cross-platform pricing isolation (PS4 vs PS5 profiles)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeTempDataDir } = require('./helpers/testData');

let dataDir;
let devicesService;
let sessionsService;
let pricingService;

beforeAll(() => {
  dataDir = makeTempDataDir('playstation-sessions-service');
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  jest.resetModules();
  devicesService = require('../services/playstationDevices.service');
  sessionsService = require('../services/playstationSessions.service');
  pricingService = require('../services/playstationPricing.service');
});

afterAll(() => {
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DIGITRONICS_DATA_DIR;
});

async function createDevice(overrides = {}) {
  const defaults = {
    platform: 'ps5', model: 'CFI-1015A', display_name: 'Dev',
    network_address: '192.168.1.10', tenant_id: 'tenantA', branch_id: 'branch1'
  };
  const result = await devicesService.create({
    data: Object.assign({}, defaults, overrides),
    tenantContext: { tenantId: 'tenantA' },
    branchId: 'branch1',
    actor: { id: 'op1' }
  });
  return result.device;
}

async function createPricing(overrides = {}) {
  const defaults = {
    platform: 'ps5', rate_per_minute: 10, minimum_minutes: 15, rounding_minutes: 5,
    tenant_id: 'tenantA', branch_id: 'branch1'
  };
  const result = await pricingService.create({
    data: Object.assign({}, defaults, overrides),
    tenantContext: { tenantId: 'tenantA' },
    branchId: 'branch1'
  });
  return result.pricing;
}

// === start() device lookup ===

describe('playstationSessions.service — start()', () => {
  test('starts pending session using session.device_id, not session id', async () => {
    const device = await createDevice({ display_name: 'Start Test Dev' });
    const sessionResult = await sessionsService.create({
      data: { device_id: device.id, customer_id: 'cust1', duration_minutes: 60, tenant_id: 'tenantA', branch_id: 'branch1' },
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });
    const session = sessionResult.session;

    // The session ID is a UUID; ensure device lookup uses device_id, not session id
    const startResult = await sessionsService.start({
      id: session.id,
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });

    expect(startResult.error).toBeUndefined();
    expect(startResult.session.status).toBe('active');
    expect(startResult.device.status).toBe('occupied');
    expect(startResult.session.started_at).not.toBeNull();
  });

  test('returns Device not found when session.device_id does not exist', async () => {
    const sessionResult = await sessionsService.create({
      data: { device_id: 'non-existent-device-id', customer_id: 'cust1', duration_minutes: 60, tenant_id: 'tenantA', branch_id: 'branch1' },
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });
    const session = sessionResult.session;

    const startResult = await sessionsService.start({
      id: session.id,
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });

    expect(startResult.error).toBe('Device not found');
  });

  test('returns error when device is not available', async () => {
    const device = await createDevice({ display_name: 'Busy Dev' });
    // Manually set device to maintenance
    const updateResult = await devicesService.transitionStatus({
      id: device.id,
      to: 'maintenance',
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });
    expect(updateResult.device.status).toBe('maintenance');

    const sessionResult = await sessionsService.create({
      data: { device_id: device.id, customer_id: 'cust1', duration_minutes: 60, tenant_id: 'tenantA', branch_id: 'branch1' },
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });
    const session = sessionResult.session;

    const startResult = await sessionsService.start({
      id: session.id,
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });

    expect(startResult.error).toBe('Device is not available');
    expect(startResult.current).toBe('maintenance');
  });
});

// === Historical pricing ===

describe('playstationSessions.service — historical pricing', () => {
  test('stop() uses session.pricing_profile_id, not arbitrary current profile', async () => {
    // Create PS4 pricing (cheaper)
    const ps4Pricing = await createPricing({
      platform: 'ps4', rate_per_minute: 5, minimum_minutes: 10, rounding_minutes: 5,
      tenant_id: 'tenantA', branch_id: 'branch1'
    });

    // Create PS5 pricing (more expensive) — created AFTER ps4, so findEffective would return this
    const ps5Pricing = await createPricing({
      platform: 'ps5', rate_per_minute: 20, minimum_minutes: 15, rounding_minutes: 5,
      tenant_id: 'tenantA', branch_id: 'branch1'
    });

    const device = await createDevice({ platform: 'ps4', model: 'CUH-2000', display_name: 'PS4 Dev', network_address: '192.168.1.20' });

    // Create session with PS4 pricing profile explicitly
    const sessionResult = await sessionsService.create({
      data: {
        device_id: device.id,
        customer_id: 'cust1',
        duration_minutes: 30,
        pricing_profile_id: ps4Pricing.id,
        tenant_id: 'tenantA',
        branch_id: 'branch1'
      },
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });

    const session = sessionResult.session;
    expect(session.pricing_profile_id).toBe(ps4Pricing.id);

    // Start the session
    const startResult = await sessionsService.start({
      id: session.id,
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });
    expect(startResult.error).toBeUndefined();

    // Wait a tiny bit so duration > 0 (simulate elapsed time)
    await new Promise(r => setTimeout(r, 100));

    // Stop the session
    const stopResult = await sessionsService.stop({
      id: session.id,
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });

    expect(stopResult.error).toBeUndefined();
    expect(stopResult.session.status).toBe('completed');
    // Should use PS4 rate (5/min), not PS5 rate (20/min)
    // Elapsed time is ~0.1s = 0 minutes, so minimum_minutes (10) applies
    // billable = 10, rounded to 10, charges = 10 * 5 = 50
    expect(stopResult.charges.charges).toBe(50);
    expect(stopResult.charges.ratePerMinute).toBe(5);
  });

  test('cancel() uses session.pricing_profile_id for active sessions', async () => {
    // Create PS4 pricing
    const ps4Pricing = await createPricing({
      platform: 'ps4', rate_per_minute: 8, minimum_minutes: 10, rounding_minutes: 5,
      tenant_id: 'tenantA', branch_id: 'branch1'
    });

    // Create PS5 pricing (more expensive, created after)
    const ps5Pricing = await createPricing({
      platform: 'ps5', rate_per_minute: 25, minimum_minutes: 15, rounding_minutes: 5,
      tenant_id: 'tenantA', branch_id: 'branch1'
    });

    const device = await createDevice({ platform: 'ps4', model: 'CUH-2000', display_name: 'PS4 Dev 2', network_address: '192.168.1.21' });

    const sessionResult = await sessionsService.create({
      data: {
        device_id: device.id,
        customer_id: 'cust1',
        duration_minutes: 20,
        pricing_profile_id: ps4Pricing.id,
        tenant_id: 'tenantA',
        branch_id: 'branch1'
      },
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });

    const session = sessionResult.session;
    expect(session.pricing_profile_id).toBe(ps4Pricing.id);

    const startResult = await sessionsService.start({
      id: session.id,
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });
    expect(startResult.error).toBeUndefined();

    await new Promise(r => setTimeout(r, 100));

    const cancelResult = await sessionsService.cancel({
      id: session.id,
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' },
      reason: 'test cancel'
    });

    expect(cancelResult.error).toBeUndefined();
    expect(cancelResult.session.status).toBe('cancelled');
    // Should use PS4 rate (8/min), not PS5 rate (25/min)
    expect(cancelResult.charges.ratePerMinute).toBe(8);
  });

  test('falls back to findEffective when pricing_profile_id is missing', async () => {
    const ps5Pricing = await createPricing({
      platform: 'ps5', rate_per_minute: 12, minimum_minutes: 10, rounding_minutes: 5,
      tenant_id: 'tenantA', branch_id: 'branch1'
    });

    const device = await createDevice({ display_name: 'Fallback Dev' });

    // Create session WITHOUT explicit pricing_profile_id
    const sessionResult = await sessionsService.create({
      data: {
        device_id: device.id,
        customer_id: 'cust1',
        duration_minutes: 30,
        tenant_id: 'tenantA',
        branch_id: 'branch1'
      },
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });

    const session = sessionResult.session;
    expect(session.pricing_profile_id).toBe(ps5Pricing.id);

    const startResult = await sessionsService.start({
      id: session.id,
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });
    expect(startResult.error).toBeUndefined();

    await new Promise(r => setTimeout(r, 100));

    const stopResult = await sessionsService.stop({
      id: session.id,
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });

    expect(stopResult.error).toBeUndefined();
    expect(stopResult.charges.ratePerMinute).toBe(12);
  });
});
