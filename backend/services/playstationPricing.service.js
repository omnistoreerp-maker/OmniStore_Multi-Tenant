'use strict';

// playstationPricing.service — PlayStation pricing profiles (Batch 1).
//
// Owns:
//   - CRUD over the playstationPricing store
//   - Tenant + branch isolation
//   - Server-authoritative rate lookup for session charge calculation
//
// Does NOT:
//   - Create sales or treasury records
//   - Integrate with the RPI
//   - Emit eventBus events

const { v4: uuidv4 } = require('uuid');
const storageAdapter = require('../repositories/storageAdapter');

const STORE = 'playstationPricing';

function _load() {
  const data = storageAdapter.read(STORE);
  if (!data || typeof data !== 'object') return { pricing: [] };
  if (!Array.isArray(data.pricing)) data.pricing = [];
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

function _visiblePricing(pricing, tenantContext, branchId) {
  const tid = _trustedTenantId(tenantContext);
  const bid = _trustedBranchId(branchId);
  return pricing.filter(p => {
    if (!p || typeof p !== 'object') return true;
    if (tid && String(p.tenant_id || '') !== tid) return false;
    if (bid && String(p.branch_id || '') !== bid) return false;
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
  if (data.rate_per_minute === undefined || data.rate_per_minute === null) {
    errors.push('rate_per_minute is required');
  } else if (typeof data.rate_per_minute !== 'number' || !Number.isFinite(data.rate_per_minute) || data.rate_per_minute < 0) {
    errors.push('rate_per_minute must be a non-negative number');
  }
  if (data.minimum_minutes === undefined || data.minimum_minutes === null) {
    errors.push('minimum_minutes is required');
  } else if (!Number.isInteger(data.minimum_minutes) || data.minimum_minutes < 1) {
    errors.push('minimum_minutes must be a positive integer');
  }
  if (data.rounding_minutes === undefined || data.rounding_minutes === null) {
    errors.push('rounding_minutes is required');
  } else if (!Number.isInteger(data.rounding_minutes) || data.rounding_minutes < 1) {
    errors.push('rounding_minutes must be a positive integer');
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
  if (data.rate_per_minute !== undefined) {
    if (typeof data.rate_per_minute !== 'number' || !Number.isFinite(data.rate_per_minute) || data.rate_per_minute < 0) {
      errors.push('rate_per_minute must be a non-negative number');
    }
  }
  if (data.minimum_minutes !== undefined) {
    if (!Number.isInteger(data.minimum_minutes) || data.minimum_minutes < 1) {
      errors.push('minimum_minutes must be a positive integer');
    }
  }
  if (data.rounding_minutes !== undefined) {
    if (!Number.isInteger(data.rounding_minutes) || data.rounding_minutes < 1) {
      errors.push('rounding_minutes must be a positive integer');
    }
  }
  return errors;
}

// Public API

function list({ tenantContext, branchId } = {}) {
  const db = _load();
  return _visiblePricing(db.pricing, tenantContext, branchId).map(p => Object.assign({}, p));
}

function getById({ id, tenantContext, branchId } = {}) {
  if (id == null || id === '') return null;
  const target = String(id).trim();
  const db = _load();
  const found = (db.pricing || []).find(p => p && (String(p.id) === target || String(p._backendId || '') === target)) || null;
  if (!found) return null;
  if (_ownershipBlocked(found, tenantContext, branchId)) return null;
  return found;
}

function create({ data, tenantContext, branchId } = {}) {
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
  const profile = {
    id: uuidv4(),
    tenant_id: trustedTid || String(data.tenant_id || ''),
    branch_id: trustedBid || String(data.branch_id || ''),
    platform: String(data.platform).trim(),
    rate_per_minute: Number(data.rate_per_minute),
    minimum_minutes: Number(data.minimum_minutes),
    rounding_minutes: Number(data.rounding_minutes),
    createdAt: now,
    updatedAt: now
  };

  const db = _load();
  if (!Array.isArray(db.pricing)) db.pricing = [];
  db.pricing.push(profile);
  if (_save(db)) return { pricing: Object.assign({}, profile) };
  return { error: 'Failed to persist pricing profile' };
}

function update({ id, data, tenantContext, branchId } = {}) {
  if (id == null || id === '') return { error: 'id is required' };
  const errors = _validateForUpdate(data);
  if (errors.length) return { error: errors.join('; ') };

  const trustedTid = _trustedTenantId(tenantContext);
  const trustedBid = _trustedBranchId(branchId);
  const db = _load();
  const idx = (db.pricing || []).findIndex(p => p && (String(p.id) === String(id).trim() || String(p._backendId || '') === String(id).trim()));
  if (idx === -1) return { error: 'Pricing profile not found' };
  if (_ownershipBlocked(db.pricing[idx], tenantContext, branchId)) return { error: 'Pricing profile not found' };

  if (data.platform !== undefined) db.pricing[idx].platform = String(data.platform).trim();
  if (data.rate_per_minute !== undefined) db.pricing[idx].rate_per_minute = Number(data.rate_per_minute);
  if (data.minimum_minutes !== undefined) db.pricing[idx].minimum_minutes = Number(data.minimum_minutes);
  if (data.rounding_minutes !== undefined) db.pricing[idx].rounding_minutes = Number(data.rounding_minutes);
  if (data.tenant_id !== undefined && trustedTid) db.pricing[idx].tenant_id = trustedTid;
  if (data.branch_id !== undefined && trustedBid) db.pricing[idx].branch_id = trustedBid;
  db.pricing[idx].updatedAt = new Date().toISOString();
  if (_save(db)) return { pricing: Object.assign({}, db.pricing[idx]) };
  return { error: 'Failed to persist pricing update' };
}

function remove({ id, tenantContext, branchId } = {}) {
  if (id == null || id === '') return { error: 'id is required' };
  const db = _load();
  const idx = (db.pricing || []).findIndex(p => p && (String(p.id) === String(id).trim() || String(p._backendId || '') === String(id).trim()));
  if (idx === -1) return { error: 'Pricing profile not found' };
  if (_ownershipBlocked(db.pricing[idx], tenantContext, branchId)) return { error: 'Pricing profile not found' };
  db.pricing.splice(idx, 1);
  if (_save(db)) return { success: true };
  return { error: 'Failed to persist pricing delete' };
}

function findEffective({ tenantContext, branchId, platform, at } = {}) {
  const db = _load();
  const candidates = _visiblePricing(db.pricing, tenantContext, branchId).filter(p => {
    if (platform && String(p.platform) !== String(platform)) return false;
    return true;
  });
  if (!candidates.length) return null;
  return candidates.reduce((best, p) => {
    if (!best) return p;
    const bEff = best.createdAt || best.updatedAt;
    const pEff = p.createdAt || p.updatedAt;
    return pEff > bEff ? p : best;
  });
}

function calculateCharges({ durationMinutes, ratePerMinute, minimumMinutes, roundingMinutes }) {
  const duration = Number(durationMinutes) || 0;
  const rate = Number(ratePerMinute) || 0;
  const minDur = Number(minimumMinutes) || 0;
  const roundTo = Number(roundingMinutes) || 1;

  const billable = Math.max(duration, minDur);
  const rounded = Math.ceil(billable / roundTo) * roundTo;
  return {
    durationMinutes: duration,
    billableMinutes: rounded,
    ratePerMinute: rate,
    charges: Math.round(rounded * rate * 100) / 100
  };
}

module.exports = {
  STORE,
  list,
  getById,
  create,
  update,
  remove,
  findEffective,
  calculateCharges,
  _validateForCreate,
  _validateForUpdate,
  _trustedTenantId,
  _trustedBranchId,
  _ownershipBlocked
};
