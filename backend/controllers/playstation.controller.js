'use strict';

// playstation.controller — PlayStation HTTP layer (Batch 1).
//
// Architecture:
//   Frontend
//      ↓
//   Controller (this file)
//      ↓
//   Service (playstationDevices / playstationSessions / playstationPricing)
//      ↓
//   Persistence (storageAdapter)
//
// The controller NEVER reads tenantId from the request body. Tenant comes
// from req.marketTenant (set by the requireMarketTenant middleware).
// Customer context comes from req.customer (set by requireCustomer).
//
// Provider integration is BLOCKED in Batch 1. The controller only manages
// devices, sessions, and pricing for the PlayStation shop.

const { success, error } = require('../utils/apiResponse');
const devicesService = require('../services/playstationDevices.service');
const sessionsService = require('../services/playstationSessions.service');
const pricingService = require('../services/playstationPricing.service');
const branchStore = require('../middleware/branchStore');

function _tenantContext(req) {
  return { tenantId: req.marketTenant || null };
}

function _branchId() {
  return branchStore.get();
}

// === Devices ===

async function listDevices(req, res) {
  try {
    const devices = devicesService.list({
      tenantContext: _tenantContext(req),
      branchId: _branchId(),
      status: req.query.status || null
    });
    return success(res, { devices }, 'Devices retrieved');
  } catch (err) {
    return error(res, 'Failed to list devices', 500);
  }
}

async function getDevice(req, res) {
  try {
    const device = devicesService.getById({ id: req.params.id, tenantContext: _tenantContext(req), branchId: _branchId() });
    if (!device) return error(res, 'Device not found', 404);
    return success(res, device, 'Device retrieved');
  } catch (err) {
    return error(res, 'Failed to get device', 500);
  }
}

async function createDevice(req, res) {
  try {
    const data = Object.assign({}, req.body || {});
    data.tenant_id = _tenantContext(req).tenantId;
    data.branch_id = _branchId();
    const result = await devicesService.create({ data, tenantContext: _tenantContext(req), branchId: _branchId(), actor: req.customer || null });
    if (result.error) return error(res, result.error, 400);
    return success(res, result.device, 'Device created', 201);
  } catch (err) {
    return error(res, 'Failed to create device', 500);
  }
}

async function updateDevice(req, res) {
  try {
    const existing = devicesService.getById({ id: req.params.id, tenantContext: _tenantContext(req), branchId: _branchId() });
    if (!existing) return error(res, 'Device not found', 404);
    const result = await devicesService.update({ id: req.params.id, data: req.body, tenantContext: _tenantContext(req), branchId: _branchId(), actor: req.customer || null });
    if (result.error === 'Device not found') return error(res, 'Device not found', 404);
    if (result.error) return error(res, result.error, 400);
    return success(res, result.device, 'Device updated');
  } catch (err) {
    return error(res, 'Failed to update device', 500);
  }
}

async function transitionDevice(req, res) {
  try {
    const existing = devicesService.getById({ id: req.params.id, tenantContext: _tenantContext(req), branchId: _branchId() });
    if (!existing) return error(res, 'Device not found', 404);
    const targetStatus = req.body && req.body.status ? String(req.body.status) : null;
    if (!targetStatus) return error(res, 'status is required in body', 400);
    const result = await devicesService.transitionStatus({ id: req.params.id, to: targetStatus, tenantContext: _tenantContext(req), branchId: _branchId(), actor: req.customer || null });
    if (result.error) {
      const code = result.error === 'Device not found' ? 404 : (result.allowed ? 409 : 400);
      return error(res, result.error, code);
    }
    return success(res, result.device, 'Device status updated');
  } catch (err) {
    return error(res, 'Failed to transition device', 500);
  }
}

async function deleteDevice(req, res) {
  try {
    const existing = devicesService.getById({ id: req.params.id, tenantContext: _tenantContext(req), branchId: _branchId() });
    if (!existing) return error(res, 'Device not found', 404);
    const result = await devicesService.remove({ id: req.params.id, tenantContext: _tenantContext(req), branchId: _branchId(), actor: req.customer || null });
    if (result.error === 'Device not found') return error(res, 'Device not found', 404);
    if (result.error) return error(res, result.error, 500);
    return success(res, { deleted: true }, 'Device deleted');
  } catch (err) {
    return error(res, 'Failed to delete device', 500);
  }
}

// === Pricing ===

async function listPricing(req, res) {
  try {
    const profiles = pricingService.list({ tenantContext: _tenantContext(req), branchId: _branchId() });
    return success(res, { pricing: profiles }, 'Pricing profiles retrieved');
  } catch (err) {
    return error(res, 'Failed to list pricing profiles', 500);
  }
}

async function getPricing(req, res) {
  try {
    const profile = pricingService.getById({ id: req.params.id, tenantContext: _tenantContext(req), branchId: _branchId() });
    if (!profile) return error(res, 'Pricing profile not found', 404);
    return success(res, profile, 'Pricing profile retrieved');
  } catch (err) {
    return error(res, 'Failed to get pricing profile', 500);
  }
}

async function createPricing(req, res) {
  try {
    const data = Object.assign({}, req.body || {});
    data.tenant_id = _tenantContext(req).tenantId;
    data.branch_id = _branchId();
    const result = await pricingService.create({ data, tenantContext: _tenantContext(req), branchId: _branchId() });
    if (result.error) return error(res, result.error, 400);
    return success(res, result.pricing, 'Pricing profile created', 201);
  } catch (err) {
    return error(res, 'Failed to create pricing profile', 500);
  }
}

async function updatePricing(req, res) {
  try {
    const existing = pricingService.getById({ id: req.params.id, tenantContext: _tenantContext(req), branchId: _branchId() });
    if (!existing) return error(res, 'Pricing profile not found', 404);
    const result = await pricingService.update({ id: req.params.id, data: req.body, tenantContext: _tenantContext(req), branchId: _branchId() });
    if (result.error === 'Pricing profile not found') return error(res, 'Pricing profile not found', 404);
    if (result.error) return error(res, result.error, 400);
    return success(res, result.pricing, 'Pricing profile updated');
  } catch (err) {
    return error(res, 'Failed to update pricing profile', 500);
  }
}

async function deletePricing(req, res) {
  try {
    const existing = pricingService.getById({ id: req.params.id, tenantContext: _tenantContext(req), branchId: _branchId() });
    if (!existing) return error(res, 'Pricing profile not found', 404);
    const result = pricingService.remove({ id: req.params.id, tenantContext: _tenantContext(req), branchId: _branchId() });
    if (result.error === 'Pricing profile not found') return error(res, 'Pricing profile not found', 404);
    if (result.error) return error(res, result.error, 500);
    return success(res, { deleted: true }, 'Pricing profile deleted');
  } catch (err) {
    return error(res, 'Failed to delete pricing profile', 500);
  }
}

// === Sessions ===

async function listSessions(req, res) {
  try {
    const sessions = sessionsService.list({
      tenantContext: _tenantContext(req),
      branchId: _branchId(),
      deviceId: req.query.deviceId || null,
      customerId: req.query.customerId || null,
      status: req.query.status || null
    });
    return success(res, { sessions }, 'Sessions retrieved');
  } catch (err) {
    return error(res, 'Failed to list sessions', 500);
  }
}

async function getSession(req, res) {
  try {
    const session = sessionsService.getById({ id: req.params.id, tenantContext: _tenantContext(req), branchId: _branchId() });
    if (!session) return error(res, 'Session not found', 404);
    return success(res, session, 'Session retrieved');
  } catch (err) {
    return error(res, 'Failed to get session', 500);
  }
}

async function createSession(req, res) {
  try {
    const data = Object.assign({}, req.body || {});
    data.tenant_id = _tenantContext(req).tenantId;
    data.branch_id = _branchId();
    if (req.customer) data.customer_id = req.customer.id;
    const result = await sessionsService.create({ data, tenantContext: _tenantContext(req), branchId: _branchId(), actor: req.customer || null });
    if (result.error) return error(res, result.error, 400);
    return success(res, result.session, 'Session created', 201);
  } catch (err) {
    return error(res, 'Failed to create session', 500);
  }
}

async function startSession(req, res) {
  try {
    const existing = sessionsService.getById({ id: req.params.id, tenantContext: _tenantContext(req), branchId: _branchId() });
    if (!existing) return error(res, 'Session not found', 404);
    const result = await sessionsService.start({ id: req.params.id, tenantContext: _tenantContext(req), branchId: _branchId(), actor: req.customer || null });
    if (result.error) {
      const code = result.error === 'Session not found' ? 404 : (result.code === 'DEVICE_BUSY' ? 409 : 400);
      return error(res, result.error, code);
    }
    return success(res, { session: result.session, device: result.device }, 'Session started');
  } catch (err) {
    return error(res, 'Failed to start session', 500);
  }
}

async function stopSession(req, res) {
  try {
    const existing = sessionsService.getById({ id: req.params.id, tenantContext: _tenantContext(req), branchId: _branchId() });
    if (!existing) return error(res, 'Session not found', 404);
    const result = await sessionsService.stop({ id: req.params.id, tenantContext: _tenantContext(req), branchId: _branchId(), actor: req.customer || null });
    if (result.error === 'Session not found') return error(res, 'Session not found', 404);
    if (result.error) return error(res, result.error, 400);
    return success(res, { session: result.session, charges: result.charges }, 'Session stopped');
  } catch (err) {
    return error(res, 'Failed to stop session', 500);
  }
}

async function cancelSession(req, res) {
  try {
    const existing = sessionsService.getById({ id: req.params.id, tenantContext: _tenantContext(req), branchId: _branchId() });
    if (!existing) return error(res, 'Session not found', 404);
    const reason = req.body && req.body.reason ? String(req.body.reason) : null;
    const result = await sessionsService.cancel({ id: req.params.id, tenantContext: _tenantContext(req), branchId: _branchId(), actor: req.customer || null, reason });
    if (result.error === 'Session not found') return error(res, 'Session not found', 404);
    if (result.error) {
      const code = result.allowed ? 409 : 400;
      return error(res, result.error, code);
    }
    return success(res, { session: result.session, charges: result.charges }, 'Session cancelled');
  } catch (err) {
    return error(res, 'Failed to cancel session', 500);
  }
}

async function finalizeSessionPayment(req, res) {
  try {
    const idempotencyKey = req.body && req.body.idempotencyKey ? String(req.body.idempotencyKey) : null;
    if (!idempotencyKey) return error(res, 'idempotencyKey is required in body', 400);

    const result = await sessionsService.finalizePayment({
      id: req.params.id,
      tenantContext: _tenantContext(req),
      branchId: _branchId(),
      actor: req.customer || null,
      idempotencyKey
    });

    if (result.error === 'Session not found') return error(res, 'Session not found', 404);
    if (result.error === 'idempotencyKey is required') return error(res, 'idempotencyKey is required in body', 400);
    if (result.error === 'Session already finalized with a different idempotency key') return error(res, result.error, 409);
    if (result.error === 'Invalid session state for finalization') return error(res, result.error, 400);
    if (result.error === 'Session has no computed charges') return error(res, result.error, 400);
    if (result.recovery_required) {
      return error(res, 'Financial finalization requires recovery. Please contact support.', 202, {
        session: result.session,
        saleId: result.saleId || null,
        treasuryEntryId: result.treasuryEntryId || null,
        recovery_required: true,
        error: result.error || null,
        detail: result.detail || null
      });
    }
    if (result.error) return error(res, result.error || 'Financial finalization failed', 500);
    return success(res, { session: result.session, saleId: result.saleId, treasuryEntryId: result.treasuryEntryId, recovery_required: false }, 'Payment finalized');
  } catch (err) {
    return error(res, 'Failed to finalize payment', 500);
  }
}

module.exports = {
  // Devices
  listDevices,
  getDevice,
  createDevice,
  updateDevice,
  transitionDevice,
  deleteDevice,
  // Pricing
  listPricing,
  getPricing,
  createPricing,
  updatePricing,
  deletePricing,
  // Sessions
  listSessions,
  getSession,
  createSession,
  startSession,
  stopSession,
  cancelSession,
  finalizeSessionPayment
};
