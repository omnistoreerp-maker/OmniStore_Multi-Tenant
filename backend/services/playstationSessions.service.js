'use strict';

// playstationSessions.service — PlayStation session lifecycle (Batch 1).
//
// Owns:
//   - CRUD over the playstationSessions store
//   - Session state machine (pending / active / completed / cancelled / interrupted / expired / unpaid / refunded)
//   - Device state coordination (start -> occupied, stop -> available)
//   - Server-authoritative pricing via playstationPricing.service
//   - Tenant + branch isolation
//   - Concurrency protection via AsyncLock
//   - Audit integration via auditService
//
// Does NOT:
//   - Create sales or treasury records
//   - Integrate with the RPI
//   - Emit eventBus events

const { v4: uuidv4 } = require('uuid');
const storageAdapter = require('../repositories/storageAdapter');
const { AsyncLock } = require('../utils/asyncLock');
const auditService = require('../services/audit.service');
const pricingService = require('./playstationPricing.service');

const STORE = 'playstationSessions';
const sessionLock = new AsyncLock();

const STATES = Object.freeze(['pending', 'active', 'completed', 'cancelled', 'interrupted', 'expired', 'unpaid', 'refunded']);
const INITIAL_STATE = 'pending';
const TERMINAL_STATES = Object.freeze(['cancelled', 'completed', 'refunded']);

const ALLOWED_TRANSITIONS = Object.freeze({
  pending: Object.freeze(['active', 'cancelled']),
  active: Object.freeze(['completed', 'cancelled', 'interrupted', 'expired']),
  completed: Object.freeze(['unpaid', 'refunded']),
  unpaid: Object.freeze(['completed', 'refunded']),
  cancelled: Object.freeze([]),
  interrupted: Object.freeze(['completed', 'cancelled']),
  expired: Object.freeze([]),
  refunded: Object.freeze([])
});

function isValidState(s) {
  return STATES.indexOf(s) !== -1;
}

function isTerminalState(s) {
  return TERMINAL_STATES.indexOf(s) !== -1;
}

function canTransition(from, to) {
  if (!isValidState(from) || !isValidState(to)) return false;
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.indexOf(to) !== -1;
}

function validateTransition(from, to) {
  if (from == null || to == null) return { error: 'from and to are required' };
  if (!isValidState(from)) return { error: 'Unknown source state: ' + from };
  if (!isValidState(to)) return { error: 'Unknown target state: ' + to };
  if (isTerminalState(from)) return { error: 'Cannot transition from terminal state: ' + from };
  if (!canTransition(from, to)) {
    return { error: 'Invalid transition: ' + from + ' -> ' + to, allowed: ALLOWED_TRANSITIONS[from] };
  }
  return { ok: true };
}

function _load() {
  const data = storageAdapter.read(STORE);
  if (!data || typeof data !== 'object') return { sessions: [] };
  if (!Array.isArray(data.sessions)) data.sessions = [];
  return data;
}

function _save(db) {
  return storageAdapter.write(STORE, db);
}

function _loadDevices() {
  const data = storageAdapter.read('playstationDevices');
  if (!data || typeof data !== 'object') return { devices: [] };
  if (!Array.isArray(data.devices)) data.devices = [];
  return data;
}

function _saveDevices(db) {
  return storageAdapter.write('playstationDevices', db);
}

function _trustedTenantId(tenantContext) {
  if (!tenantContext) return null;
  const t = tenantContext.tenantId;
  if (t == null || t === '') return null;
  return String(t);
}

function _trustedBranchId(branchId) {
  if (branchId == null || branchId === '') return null;
  return String(branchId);
}

function _visibleSessions(sessions, tenantContext, branchId) {
  const tid = _trustedTenantId(tenantContext);
  const bid = _trustedBranchId(branchId);
  return sessions.filter(s => {
    if (!s || typeof s !== 'object') return true;
    if (tid && String(s.tenant_id || '') !== tid) return false;
    if (bid && String(s.branch_id || '') !== bid) return false;
    return true;
  });
}

function _ownershipBlocked(record, tenantContext, branchId) {
  const tid = _trustedTenantId(tenantContext);
  const bid = _trustedBranchId(branchId);
  if (!record || typeof record !== 'object') return true;
  if (tid && String(record.tenant_id || '') !== tid) return true;
  if (bid && String(record.branch_id || '') !== bid) return true;
  return false;
}

function _validateForCreate(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }
  if (data.device_id === undefined || String(data.device_id).trim() === '') {
    errors.push('device_id is required');
  }
  if (data.customer_id === undefined || String(data.customer_id).trim() === '') {
    errors.push('customer_id is required');
  }
  if (data.duration_minutes === undefined || data.duration_minutes === null) {
    errors.push('duration_minutes is required');
  } else if (!Number.isInteger(data.duration_minutes) || data.duration_minutes < 1) {
    errors.push('duration_minutes must be a positive integer');
  }
  if (data.pricing_profile_id !== undefined && data.pricing_profile_id !== null && typeof data.pricing_profile_id !== 'string') {
    errors.push('pricing_profile_id must be a string');
  }
  return errors;
}

function _recordAudit({ action, session, userId, changes }) {
  try {
    auditService.record({
      action,
      resource: 'playstation_sessions',
      resourceId: session && session.id || null,
      userId: userId || null,
      changes
    });
  } catch (_) {
    // Audit failures must never break the request
  }
}

// Public API

function list({ tenantContext, branchId, deviceId, customerId, status } = {}) {
  const db = _load();
  let sessions = _visibleSessions(db.sessions, tenantContext, branchId);
  if (deviceId) sessions = sessions.filter(s => String(s.device_id) === String(deviceId));
  if (customerId) sessions = sessions.filter(s => String(s.customer_id) === String(customerId));
  if (status) sessions = sessions.filter(s => String(s.status) === String(status));
  return sessions.map(s => Object.assign({}, s));
}

function getById({ id, tenantContext, branchId } = {}) {
  if (id == null || id === '') return null;
  const target = String(id).trim();
  const db = _load();
  const found = (db.sessions || []).find(s => s && (String(s.id) === target || String(s._backendId || '') === target)) || null;
  if (!found) return null;
  if (_ownershipBlocked(found, tenantContext, branchId)) return null;
  return found;
}

async function create({ data, tenantContext, branchId, actor } = {}) {
  const errors = _validateForCreate(data);
  if (errors.length) return { error: errors.join('; ') };

  const trustedTid = _trustedTenantId(tenantContext);
  const trustedBid = _trustedBranchId(branchId);

  if (trustedTid && String(data.tenant_id || '') !== trustedTid) {
    return { error: 'tenant_id claim does not match the trusted tenant' };
  }
  if (trustedBid && String(data.branch_id || '') !== trustedBid) {
    return { error: 'branch_id claim does not match the trusted branch' };
  }

  const pricing = pricingService.findEffective({
    tenantContext,
    branchId,
    platform: data.platform || null
  });

  const now = new Date().toISOString();
  const session = {
    id: uuidv4(),
    tenant_id: trustedTid || String(data.tenant_id || ''),
    branch_id: trustedBid || String(data.branch_id || ''),
    device_id: String(data.device_id).trim(),
    customer_id: String(data.customer_id).trim(),
    operator_id: actor ? String(actor.id) : null,
    status: INITIAL_STATE,
    started_at: null,
    ended_at: null,
    duration_minutes: Number(data.duration_minutes) || 0,
    charges: null,
    payment_status: 'pending',
    pricing_profile_id: data.pricing_profile_id || (pricing && pricing.id) || null,
    createdAt: now,
    updatedAt: now
  };

  const db = _load();
  if (!Array.isArray(db.sessions)) db.sessions = [];
  db.sessions.push(session);
  if (_save(db)) {
    _recordAudit({ action: 'session.created', session, userId: actor && actor.id, changes: { after: _sanitize(session) } });
    return { session: Object.assign({}, session) };
  }
  return { error: 'Failed to persist session' };
}

async function start({ id, tenantContext, branchId, actor } = {}) {
  if (id == null || id === '') return { error: 'id is required' };

  const release = await sessionLock.acquire();
  try {
    const trustedTid = _trustedTenantId(tenantContext);
    const trustedBid = _trustedBranchId(branchId);

    const sessionDb = _load();
    const sessionIdx = (sessionDb.sessions || []).findIndex(s => s && String(s.id) === String(id).trim());
    if (sessionIdx === -1) return { error: 'Session not found' };
    if (_ownershipBlocked(sessionDb.sessions[sessionIdx], tenantContext, branchId)) return { error: 'Session not found' };

    const session = sessionDb.sessions[sessionIdx];
    if (session.status !== 'pending') {
      return { error: 'Invalid session state', current: session.status };
    }

    const deviceDb = _loadDevices();
    const deviceIdx = (deviceDb.devices || []).findIndex(d => d && String(d.id) === String(session.device_id).trim());
    if (deviceIdx === -1) return { error: 'Device not found' };
    if (_ownershipBlocked(deviceDb.devices[deviceIdx], tenantContext, branchId)) return { error: 'Device not found' };

    const device = deviceDb.devices[deviceIdx];
    if (device.status !== 'available') {
      return { error: 'Device is not available', current: device.status };
    }

    const activeOnDevice = (sessionDb.sessions || []).some(s => String(s.device_id) === String(device.id) && s.status === 'active');
    if (activeOnDevice) {
      return { error: 'Device already has an active session', code: 'DEVICE_BUSY' };
    }

    const now = new Date().toISOString();
    const beforeDevice = Object.assign({}, device);
    device.status = 'occupied';
    device.updatedAt = now;

    const beforeSession = Object.assign({}, session);
    session.status = 'active';
    session.started_at = now;
    session.updatedAt = now;

    const dOk = _saveDevices(deviceDb);
    const sOk = _save(sessionDb);
    if (dOk && sOk) {
      _recordAudit({ action: 'session.started', session, userId: actor && actor.id, changes: { before: _sanitize(beforeSession), after: _sanitize(session), deviceTransition: { from: beforeDevice.status, to: device.status } } });
      return { session: Object.assign({}, session), device: Object.assign({}, device) };
    }
    return { error: 'Failed to persist session start' };
  } finally {
    release();
  }
}

async function stop({ id, tenantContext, branchId, actor } = {}) {
  if (id == null || id === '') return { error: 'id is required' };

  const release = await sessionLock.acquire();
  try {
    const trustedTid = _trustedTenantId(tenantContext);
    const trustedBid = _trustedBranchId(branchId);

    const sessionDb = _load();
    const sessionIdx = (sessionDb.sessions || []).findIndex(s => s && String(s.id) === String(id).trim());
    if (sessionIdx === -1) return { error: 'Session not found' };
    if (_ownershipBlocked(sessionDb.sessions[sessionIdx], tenantContext, branchId)) return { error: 'Session not found' };

    const session = sessionDb.sessions[sessionIdx];
    if (session.status !== 'active') {
      return { error: 'Invalid session state', current: session.status };
    }

    const now = new Date().toISOString();
    const startedAt = session.started_at ? new Date(session.started_at).getTime() : Date.now();
    const endedAt = new Date(now).getTime();
    const durationMinutes = Math.max(1, Math.round((endedAt - startedAt) / 60000));

    const pricing = session.pricing_profile_id
      ? (pricingService.getById({ id: session.pricing_profile_id, tenantContext, branchId }) || pricingService.findEffective({ tenantContext, branchId, platform: null }))
      : pricingService.findEffective({ tenantContext, branchId, platform: null });

    const ratePerMinute = pricing ? pricing.rate_per_minute : 0;
    const minimumMinutes = pricing ? pricing.minimum_minutes : 0;
    const roundingMinutes = pricing ? pricing.rounding_minutes : 1;

    const charges = pricingService.calculateCharges({
      durationMinutes,
      ratePerMinute,
      minimumMinutes,
      roundingMinutes
    });

    const beforeSession = Object.assign({}, session);
    session.status = 'completed';
    session.ended_at = now;
    session.duration_minutes = durationMinutes;
    session.charges = charges.charges;
    session.payment_status = 'pending';
    session.updatedAt = now;

    const deviceDb = _loadDevices();
    const deviceIdx = (deviceDb.devices || []).findIndex(d => d && String(d.id) === String(session.device_id));
    const beforeDevice = deviceIdx !== -1 ? Object.assign({}, deviceDb.devices[deviceIdx]) : null;
    if (deviceIdx !== -1 && deviceDb.devices[deviceIdx]) {
      deviceDb.devices[deviceIdx].status = 'available';
      deviceDb.devices[deviceIdx].updatedAt = now;
    }

    const dOk = deviceIdx !== -1 ? _saveDevices(deviceDb) : true;
    const sOk = _save(sessionDb);
    if (dOk && sOk) {
      _recordAudit({
        action: 'session.stopped',
        session,
        userId: actor && actor.id,
        changes: {
          before: _sanitize(beforeSession),
          after: _sanitize(session),
          charges,
          deviceTransition: beforeDevice ? { from: beforeDevice.status, to: 'available' } : null
        }
      });
      return { session: Object.assign({}, session), charges };
    }
    return { error: 'Failed to persist session stop' };
  } finally {
    release();
  }
}

async function cancel({ id, tenantContext, branchId, actor, reason } = {}) {
  if (id == null || id === '') return { error: 'id is required' };

  const release = await sessionLock.acquire();
  try {
    const trustedTid = _trustedTenantId(tenantContext);
    const trustedBid = _trustedBranchId(branchId);

    const sessionDb = _load();
    const sessionIdx = (sessionDb.sessions || []).findIndex(s => s && String(s.id) === String(id).trim());
    if (sessionIdx === -1) return { error: 'Session not found' };
    if (_ownershipBlocked(sessionDb.sessions[sessionIdx], tenantContext, branchId)) return { error: 'Session not found' };

    const session = sessionDb.sessions[sessionIdx];
    if (!isValidState(session.status)) {
      return { error: 'Unknown session state', current: session.status };
    }

    const beforeSession = Object.assign({}, session);
    const now = new Date().toISOString();

    if (session.status === 'pending') {
      session.status = 'cancelled';
      session.payment_status = 'cancelled';
      session.cancelled_at = now;
      session.cancellation_reason = typeof reason === 'string' ? reason.slice(0, 500) : null;
    } else if (session.status === 'active') {
      const startedAt = session.started_at ? new Date(session.started_at).getTime() : Date.now();
      const cancelledAt = new Date(now).getTime();
      const durationMinutes = Math.max(1, Math.round((cancelledAt - startedAt) / 60000));

      const pricing = session.pricing_profile_id
        ? (pricingService.getById({ id: session.pricing_profile_id, tenantContext, branchId }) || pricingService.findEffective({ tenantContext, branchId, platform: null }))
        : pricingService.findEffective({ tenantContext, branchId, platform: null });

      const ratePerMinute = pricing ? pricing.rate_per_minute : 0;
      const minimumMinutes = pricing ? pricing.minimum_minutes : 0;
      const roundingMinutes = pricing ? pricing.rounding_minutes : 1;

      const charges = pricingService.calculateCharges({
        durationMinutes,
        ratePerMinute,
        minimumMinutes,
        roundingMinutes
      });

      session.status = 'cancelled';
      session.ended_at = now;
      session.duration_minutes = durationMinutes;
      session.charges = charges.charges;
      session.payment_status = 'cancelled';
      session.cancelled_at = now;
      session.cancellation_reason = typeof reason === 'string' ? reason.slice(0, 500) : null;

      const deviceDb = _loadDevices();
      const deviceIdx = (deviceDb.devices || []).findIndex(d => d && String(d.id) === String(session.device_id));
      const beforeDevice = deviceIdx !== -1 ? Object.assign({}, deviceDb.devices[deviceIdx]) : null;
      if (deviceIdx !== -1 && deviceDb.devices[deviceIdx]) {
        deviceDb.devices[deviceIdx].status = 'available';
        deviceDb.devices[deviceIdx].updatedAt = now;
        const dOk = _saveDevices(deviceDb);
        if (!dOk) {
          return { error: 'Failed to persist device state during cancellation' };
        }
      }
      session.updatedAt = now;
      const sOk = _save(sessionDb);
      if (sOk) {
        _recordAudit({
          action: 'session.cancelled',
          session,
          userId: actor && actor.id,
          changes: {
            before: _sanitize(beforeSession),
            after: _sanitize(session),
            charges,
            deviceTransition: beforeDevice ? { from: beforeDevice.status, to: 'available' } : null
          }
        });
        return { session: Object.assign({}, session), charges };
      }
      return { error: 'Failed to persist session cancellation' };
    } else {
      return { error: 'Invalid transition', current: session.status, allowed: ALLOWED_TRANSITIONS[session.status] };
    }
  } finally {
    release();
  }
}

function _sanitize(session) {
  if (!session || typeof session !== 'object') return session;
  const out = Object.assign({}, session);
  return out;
}

module.exports = {
  STORE,
  STATES,
  INITIAL_STATE,
  TERMINAL_STATES,
  ALLOWED_TRANSITIONS,
  isValidState,
  isTerminalState,
  canTransition,
  validateTransition,
  list,
  getById,
  create,
  start,
  stop,
  cancel,
  _validateForCreate,
  _trustedTenantId,
  _trustedBranchId,
  _ownershipBlocked
};
