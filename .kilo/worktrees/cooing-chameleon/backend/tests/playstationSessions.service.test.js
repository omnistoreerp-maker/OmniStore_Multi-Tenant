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
let salesService;
let treasuryService;

beforeAll(() => {
  dataDir = makeTempDataDir('playstation-sessions-service');
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  jest.resetModules();
  devicesService = require('../services/playstationDevices.service');
  sessionsService = require('../services/playstationSessions.service');
  pricingService = require('../services/playstationPricing.service');
  salesService = require('../services/sales.service');
  treasuryService = require('../services/treasury.service');
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

// === Financial finalization ===

describe('playstationSessions.service — finalizePayment', () => {
  test('successful finalization creates Sale and Treasury', async () => {
    const device = await createDevice({ display_name: 'Finalize Dev' });
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
    expect(startResult.error).toBeUndefined();

    const stopResult = await sessionsService.stop({
      id: session.id,
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });
    expect(stopResult.error).toBeUndefined();

    const finalizeResult = await sessionsService.finalizePayment({
      id: session.id,
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' },
      idempotencyKey: 'key-1'
    });

    expect(finalizeResult.error).toBeUndefined();
    expect(finalizeResult.recovery_required).toBe(false);
    expect(finalizeResult.saleId).toBeTruthy();
    expect(finalizeResult.treasuryEntryId).toBeTruthy();
    expect(finalizeResult.session.payment_status).toBe('paid');
    expect(finalizeResult.session.saleId).toBe(finalizeResult.saleId);
    expect(finalizeResult.session.treasuryEntryId).toBe(finalizeResult.treasuryEntryId);
  });

  test('Sale uses invoiceType playstation and correct total', async () => {
    const device = await createDevice({ display_name: 'Invoice Type Dev' });
    const sessionResult = await sessionsService.create({
      data: { device_id: device.id, customer_id: 'cust1', duration_minutes: 30, tenant_id: 'tenantA', branch_id: 'branch1' },
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });
    const session = sessionResult.session;

    await sessionsService.start({ id: session.id, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });
    await sessionsService.stop({ id: session.id, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });

    const finalizeResult = await sessionsService.finalizePayment({
      id: session.id,
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' },
      idempotencyKey: 'key-inv-type'
    });

    expect(finalizeResult.error).toBeUndefined();
    // Verify via sales service directly
    const sale = await salesService.getById(finalizeResult.saleId, { tenantId: 'tenantA' });
    expect(sale).not.toBeNull();
    expect(sale.invoiceType).toBe('playstation');
    expect(sale.total).toBe(finalizeResult.session.charges);
    expect(sale.items.length).toBe(1);
    expect(sale.items[0].productId).toBe('PS-SESSION');
    expect(sale.items[0].qty).toBe(finalizeResult.session.duration_minutes);
  });

  test('Treasury entry has correct type amount and branch', async () => {
    const device = await createDevice({ display_name: 'Treasury Check Dev' });
    const sessionResult = await sessionsService.create({
      data: { device_id: device.id, customer_id: 'cust1', duration_minutes: 20, tenant_id: 'tenantA', branch_id: 'branch1' },
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });
    const session = sessionResult.session;

    await sessionsService.start({ id: session.id, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });
    await sessionsService.stop({ id: session.id, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });

    const finalizeResult = await sessionsService.finalizePayment({
      id: session.id,
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' },
      idempotencyKey: 'key-treasury'
    });

    expect(finalizeResult.error).toBeUndefined();
    const entry = await treasuryService.getById(finalizeResult.treasuryEntryId);
    expect(entry).not.toBeNull();
    expect(entry.type).toBe('in');
    expect(entry.amount).toBe(finalizeResult.session.charges);
    expect(entry.branchId).toBe('branch1');
    expect(entry.saleId).toBe(finalizeResult.saleId);
    expect(entry.sessionId).toBe(session.id);
  });

  test('cross-tenant finalization is rejected', async () => {
    const device = await createDevice({ display_name: 'Cross Tenant Dev' });
    const sessionResult = await sessionsService.create({
      data: { device_id: device.id, customer_id: 'cust1', duration_minutes: 60, tenant_id: 'tenantA', branch_id: 'branch1' },
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });
    const session = sessionResult.session;

    await sessionsService.start({ id: session.id, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });
    await sessionsService.stop({ id: session.id, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });

    const result = await sessionsService.finalizePayment({
      id: session.id,
      tenantContext: { tenantId: 'tenantB' },
      branchId: 'branch1',
      actor: { id: 'op1' },
      idempotencyKey: 'key-cross-tenant'
    });

    expect(result.error).toBe('Session not found');
  });

  test('cross-branch finalization is rejected', async () => {
    const device = await createDevice({ display_name: 'Cross Branch Dev' });
    const sessionResult = await sessionsService.create({
      data: { device_id: device.id, customer_id: 'cust1', duration_minutes: 60, tenant_id: 'tenantA', branch_id: 'branch1' },
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });
    const session = sessionResult.session;

    await sessionsService.start({ id: session.id, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });
    await sessionsService.stop({ id: session.id, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });

    const result = await sessionsService.finalizePayment({
      id: session.id,
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch2',
      actor: { id: 'op1' },
      idempotencyKey: 'key-cross-branch'
    });

    expect(result.error).toBe('Session not found');
  });

  test('idempotency: repeating finalization does not create another Sale', async () => {
    const device = await createDevice({ display_name: 'Idempotent Dev' });
    const sessionResult = await sessionsService.create({
      data: { device_id: device.id, customer_id: 'cust1', duration_minutes: 60, tenant_id: 'tenantA', branch_id: 'branch1' },
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });
    const session = sessionResult.session;

    await sessionsService.start({ id: session.id, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });
    await sessionsService.stop({ id: session.id, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });

    const first = await sessionsService.finalizePayment({
      id: session.id,
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' },
      idempotencyKey: 'key-idem'
    });
    expect(first.error).toBeUndefined();
    expect(first.idempotent).toBeUndefined();

    const second = await sessionsService.finalizePayment({
      id: session.id,
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' },
      idempotencyKey: 'key-idem'
    });
    expect(second.error).toBeUndefined();
    expect(second.idempotent).toBe(true);
    expect(second.saleId).toBe(first.saleId);
    expect(second.treasuryEntryId).toBe(first.treasuryEntryId);
  });

  test('idempotency: repeating finalization does not create another Treasury entry', async () => {
    const device = await createDevice({ display_name: 'Idempotent Treasury Dev' });
    const sessionResult = await sessionsService.create({
      data: { device_id: device.id, customer_id: 'cust1', duration_minutes: 60, tenant_id: 'tenantA', branch_id: 'branch1' },
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });
    const session = sessionResult.session;

    await sessionsService.start({ id: session.id, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });
    await sessionsService.stop({ id: session.id, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });

    const first = await sessionsService.finalizePayment({
      id: session.id,
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' },
      idempotencyKey: 'key-idem-treasury'
    });

    // Count treasury entries before second call
    const dbBefore = require('../repositories/storageAdapter').read('treasury');
    const countBefore = (dbBefore.entries || []).length;

    const second = await sessionsService.finalizePayment({
      id: session.id,
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' },
      idempotencyKey: 'key-idem-treasury'
    });

    const dbAfter = require('../repositories/storageAdapter').read('treasury');
    const countAfter = (dbAfter.entries || []).length;
    expect(countAfter).toBe(countBefore);
    expect(second.treasuryEntryId).toBe(first.treasuryEntryId);
  });

  test('different idempotency key is rejected once key is set', async () => {
    const device = await createDevice({ display_name: 'Key Reject Dev' });
    const sessionResult = await sessionsService.create({
      data: { device_id: device.id, customer_id: 'cust1', duration_minutes: 60, tenant_id: 'tenantA', branch_id: 'branch1' },
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

    const result = await sessionsService.finalizePayment({
      id: session.id,
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' },
      idempotencyKey: 'key-second'
    });

    expect(result.error).toBe('Session already finalized with a different idempotency key');
  });

  test('Sale success + Treasury failure results in recovery_required', async () => {
    const device = await createDevice({ display_name: 'Recovery Dev' });
    const sessionResult = await sessionsService.create({
      data: { device_id: device.id, customer_id: 'cust1', duration_minutes: 60, tenant_id: 'tenantA', branch_id: 'branch1' },
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });
    const session = sessionResult.session;

    await sessionsService.start({ id: session.id, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });
    await sessionsService.stop({ id: session.id, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });

    const spy = jest.spyOn(treasuryService, 'create').mockResolvedValue({ error: 'Treasury failure' });

    const result = await sessionsService.finalizePayment({
      id: session.id,
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' },
      idempotencyKey: 'key-recovery'
    });

    spy.mockRestore();

    expect(result.error).toBe('treasury_creation_failed');
    expect(result.recovery_required).toBe(true);
    expect(result.saleId).toBeTruthy();
    expect(result.treasuryEntryId).toBeNull();
    expect(result.session.recovery_required).toBe(true);
    expect(result.session.saleId).toBe(result.saleId);

    // Verify Sale still exists
    const sale = await salesService.getById(result.saleId, { tenantId: 'tenantA' });
    expect(sale).not.toBeNull();
  });

  test('Sale is NOT deleted on Treasury failure', async () => {
    const device = await createDevice({ display_name: 'Sale Preserve Dev' });
    const sessionResult = await sessionsService.create({
      data: { device_id: device.id, customer_id: 'cust1', duration_minutes: 60, tenant_id: 'tenantA', branch_id: 'branch1' },
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });
    const session = sessionResult.session;

    await sessionsService.start({ id: session.id, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });
    await sessionsService.stop({ id: session.id, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });

    const spy = jest.spyOn(treasuryService, 'create').mockResolvedValue({ error: 'Treasury failure' });

    const result = await sessionsService.finalizePayment({
      id: session.id,
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' },
      idempotencyKey: 'key-preserve'
    });

    spy.mockRestore();

    expect(result.error).toBe('treasury_creation_failed');
    expect(result.saleId).toBeTruthy();
    const sale = await salesService.getById(result.saleId, { tenantId: 'tenantA' });
    expect(sale).not.toBeNull();
  });

  test('idempotency preserves existing references on retry after recovery', async () => {
    const device = await createDevice({ display_name: 'Recovery Idempotent Dev' });
    const sessionResult = await sessionsService.create({
      data: { device_id: device.id, customer_id: 'cust1', duration_minutes: 60, tenant_id: 'tenantA', branch_id: 'branch1' },
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' }
    });
    const session = sessionResult.session;

    await sessionsService.start({ id: session.id, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });
    await sessionsService.stop({ id: session.id, tenantContext: { tenantId: 'tenantA' }, branchId: 'branch1', actor: { id: 'op1' } });

    const spy = jest.spyOn(treasuryService, 'create').mockResolvedValue({ error: 'Treasury failure' });

    const first = await sessionsService.finalizePayment({
      id: session.id,
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' },
      idempotencyKey: 'key-recovery-idem'
    });

    spy.mockRestore();

    expect(first.recovery_required).toBe(true);
    const saleId = first.saleId;

    // Retry with same key should return recovery state, not create duplicates
    const retry = await sessionsService.finalizePayment({
      id: session.id,
      tenantContext: { tenantId: 'tenantA' },
      branchId: 'branch1',
      actor: { id: 'op1' },
      idempotencyKey: 'key-recovery-idem'
    });

    expect(retry.recovery_required).toBe(true);
    expect(retry.saleId).toBe(saleId);
    expect(retry.error).toBeUndefined();
  });
});
