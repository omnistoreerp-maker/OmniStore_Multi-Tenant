'use strict';

// playstationDevices.service — PlayStation device inventory and lifecycle (Batch 1).
//
// Owns:
//   - CRUD over the playstationDevices store
//   - Device state machine (available / occupied / maintenance / offline / disabled)
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

const STORE = 'playstationDevices';
const deviceLock = new AsyncLock();

const STATES = Object.freeze(['available', 'occupied', 'maintenance', 'offline', 'disabled']);
const INITIAL_STATE = 'available';
const TERMINAL_STATES = Object.freeze(['disabled']);

const ALLOWED_TRANSITIONS = Object.freeze({
  available: Object.freeze(['occupied', 'maintenance', 'offline', 'disabled']),
  occupied: Object.freeze(['available', 'maintenance', 'offline']),
  maintenance: Object.freeze(['available', 'offline', 'disabled']),
  offline: Object.freeze(['available', 'maintenance', 'disabled']),
  disabled: Object.freeze([])
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
  if (!data || typeof data !== 'object') return { devices: [] };
  if (!Array.isArray(data.devices)) data.devices = [];
  return data;
}

function _save(db) {
  return storageAdapter.write(STORE, db);
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

function _visibleDevices(devices, tenantContext, branchId) {
  const tid = _trustedTenantId(tenantContext);
  const bid = _trustedBranchId(branchId);
  return devices.filter(d => {
    if (!d || typeof d !== 'object') return true;
    if (tid && String(d.tenant_id || '') !== tid) return false;
    if (bid && String(d.branch_id || '') !== bid) return false;
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
  if (data.platform === undefined || String(data.platform).trim() === '') {
    errors.push('platform is required');
  } else if (!['ps4', 'ps5'].includes(String(data.platform).trim())) {
    errors.push('platform must be ps4 or ps5');
  }
  if (data.model === undefined || String(data.model).trim() === '') {
    errors.push('model is required');
  } else if (typeof data.model !== 'string') {
    errors.push('model must be a string');
  }
  if (data.display_name === undefined || String(data.display_name).trim() === '') {
    errors.push('display_name is required');
  } else if (typeof data.display_name !== 'string') {
    errors.push('display_name must be a string');
  }
  if (data.serial !== undefined && typeof data.serial !== 'string') {
    errors.push('serial must be a string');
  }
  if (data.network_address === undefined || String(data.network_address).trim() === '') {
    errors.push('network_address is required');
  } else if (typeof data.network_address !== 'string') {
    errors.push('network_address must be a string');
  } else {
    const addr = String(data.network_address).trim();
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(addr) && !/^[0-9a-fA-F:]+$/.test(addr)) {
      errors.push('network_address must be a valid IP address');
    }
  }
  if (data.pricing_profile_id !== undefined && data.pricing_profile_id !== null && typeof data.pricing_profile_id !== 'string') {
    errors.push('pricing_profile_id must be a string');
  }
  return errors;
}

function _validateForUpdate(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }
  if (data.platform !== undefined) {
    if (!['ps4', 'ps5'].includes(String(data.platform).trim())) {
      errors.push('platform must be ps4 or ps5');
    }
  }
  if (data.model !== undefined && (typeof data.model !== 'string' || String(data.model).trim() === '')) {
    errors.push('model must be a non-empty string');
  }
  if (data.display_name !== undefined && (typeof data.display_name !== 'string' || String(data.display_name).trim() === '')) {
    errors.push('display_name must be a non-empty string');
  }
  if (data.serial !== undefined && typeof data.serial !== 'string') {
    errors.push('serial must be a string');
  }
  if (data.network_address !== undefined) {
    if (typeof data.network_address !== 'string' || String(data.network_address).trim() === '') {
      errors.push('network_address must be a non-empty string');
    } else {
      const addr = String(data.network_address).trim();
      if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(addr) && !/^[0-9a-fA-F:]+$/.test(addr)) {
        errors.push('network_address must be a valid IP address');
      }
    }
  }
  if (data.pricing_profile_id !== undefined && data.pricing_profile_id !== null && typeof data.pricing_profile_id !== 'string') {
    errors.push('pricing_profile_id must be a string');
  }
  return errors;
}

function _recordAudit({ action, device, userId, changes }) {
  try {
    auditService.record({
      action,
      resource: 'playstation_devices',
      resourceId: device && device.id || null,
      userId: userId || null,
      changes
    });
  } catch (_) {
    // Audit failures must never break the request
  }
}

// Public API

function list({ tenantContext, branchId, status } = {}) {
  const db = _load();
  let devices = _visibleDevices(db.devices, tenantContext, branchId);
  if (status) devices = devices.filter(d => String(d.status) === String(status));
  return devices.map(d => Object.assign({}, d));
}

function getById({ id, tenantContext, branchId } = {}) {
  if (id == null || id === '') return null;
  const target = String(id).trim();
  const db = _load();
  const found = (db.devices || []).find(d => d && (String(d.id) === target || String(d._backendId || '') === target)) || null;
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

  const now = new Date().toISOString();
  const device = {
    id: uuidv4(),
    tenant_id: trustedTid || String(data.tenant_id || ''),
    branch_id: trustedBid || String(data.branch_id || ''),
    platform: String(data.platform).trim(),
    model: String(data.model).trim(),
    serial: data.serial ? String(data.serial).trim() : null,
    display_name: String(data.display_name).trim(),
    network_address: String(data.network_address).trim(),
    status: INITIAL_STATE,
    pricing_profile_id: data.pricing_profile_id ? String(data.pricing_profile_id).trim() : null,
    createdAt: now,
    updatedAt: now
  };

  const db = _load();
  if (!Array.isArray(db.devices)) db.devices = [];
  db.devices.push(device);
  if (_save(db)) {
    _recordAudit({ action: 'device.created', device, userId: actor && actor.id, changes: { after: _sanitize(device) } });
    return { device: Object.assign({}, device) };
  }
  return { error: 'Failed to persist device' };
}

async function update({ id, data, tenantContext, branchId, actor } = {}) {
  if (id == null || id === '') return { error: 'id is required' };
  const errors = _validateForUpdate(data);
  if (errors.length) return { error: errors.join('; ') };

  const trustedTid = _trustedTenantId(tenantContext);
  const trustedBid = _trustedBranchId(branchId);
  const db = _load();
  const idx = (db.devices || []).findIndex(d => d && (String(d.id) === String(id).trim() || String(d._backendId || '') === String(id).trim()));
  if (idx === -1) return { error: 'Device not found' };
  if (_ownershipBlocked(db.devices[idx], tenantContext, branchId)) return { error: 'Device not found' };

  const before = Object.assign({}, db.devices[idx]);

  if (data.platform !== undefined) db.devices[idx].platform = String(data.platform).trim();
  if (data.model !== undefined) db.devices[idx].model = String(data.model).trim();
  if (data.serial !== undefined) db.devices[idx].serial = String(data.serial).trim() || null;
  if (data.display_name !== undefined) db.devices[idx].display_name = String(data.display_name).trim();
  if (data.network_address !== undefined) db.devices[idx].network_address = String(data.network_address).trim();
  if (data.pricing_profile_id !== undefined) db.devices[idx].pricing_profile_id = data.pricing_profile_id ? String(data.pricing_profile_id).trim() : null;
  if (data.tenant_id !== undefined && trustedTid) db.devices[idx].tenant_id = trustedTid;
  if (data.branch_id !== undefined && trustedBid) db.devices[idx].branch_id = trustedBid;
  db.devices[idx].updatedAt = new Date().toISOString();
  if (_save(db)) {
    _recordAudit({ action: 'device.updated', device: db.devices[idx], userId: actor && actor.id, changes: { before: _sanitize(before), after: _sanitize(db.devices[idx]) } });
    return { device: Object.assign({}, db.devices[idx]) };
  }
  return { error: 'Failed to persist device update' };
}

async function transitionStatus({ id, to, tenantContext, branchId, actor } = {}) {
  if (id == null || id === '') return { error: 'id is required' };
  if (!isValidState(to)) return { error: 'Invalid target state: ' + to };

  const release = await deviceLock.acquire();
  try {
    const trustedTid = _trustedTenantId(tenantContext);
    const trustedBid = _trustedBranchId(branchId);
    const db = _load();
    const idx = (db.devices || []).findIndex(d => d && (String(d.id) === String(id).trim() || String(d._backendId || '') === String(id).trim()));
    if (idx === -1) return { error: 'Device not found' };
    if (_ownershipBlocked(db.devices[idx], tenantContext, branchId)) return { error: 'Device not found' };

    const from = db.devices[idx].status;
    const check = validateTransition(from, to);
    if (check.error) return { error: check.error, current: from, allowed: check.allowed || [] };

    const before = Object.assign({}, db.devices[idx]);
    db.devices[idx].status = to;
    db.devices[idx].updatedAt = new Date().toISOString();
    if (_save(db)) {
      _recordAudit({
        action: 'device.status_changed',
        device: db.devices[idx],
        userId: actor && actor.id,
        changes: { before: _sanitize(before), after: _sanitize(db.devices[idx]), transition: { from, to } }
      });
      return { device: Object.assign({}, db.devices[idx]) };
    }
    return { error: 'Failed to persist device status change' };
  } finally {
    release();
  }
}

async function remove({ id, tenantContext, branchId, actor } = {}) {
  if (id == null || id === '') return { error: 'id is required' };
  const db = _load();
  const idx = (db.devices || []).findIndex(d => d && (String(d.id) === String(id).trim() || String(d._backendId || '') === String(id).trim()));
  if (idx === -1) return { error: 'Device not found' };
  if (_ownershipBlocked(db.devices[idx], tenantContext, branchId)) return { error: 'Device not found' };
  const device = db.devices[idx];
  db.devices.splice(idx, 1);
  if (_save(db)) {
    _recordAudit({ action: 'device.deleted', device, userId: actor && actor.id, changes: { before: _sanitize(device) } });
    return { success: true };
  }
  return { error: 'Failed to persist device delete' };
}

function _sanitize(device) {
  if (!device || typeof device !== 'object') return device;
  const out = Object.assign({}, device);
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
  update,
  transitionStatus,
  remove,
  _validateForCreate,
  _validateForUpdate,
  _trustedTenantId,
  _trustedBranchId,
  _ownershipBlocked
};
