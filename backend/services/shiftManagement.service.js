'use strict';

const storageAdapter = require('../repositories/storageAdapter');
const logger = require('../utils/logger');

const STORE_KEY = 'shiftManagement';

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('shiftManagement.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(data) {
  try {
    storageAdapter.write(STORE_KEY, data);
  } catch (err) {
    logger.warn('shiftManagement.service: failed to write store', err.message);
  }
}

function _defaultDoc() {
  return {
    shifts: [],
    userRoles: []
  };
}

function _tenantId(tenantContext) {
  if (!tenantContext) return null;
  const t = tenantContext.tenantId || tenantContext.id;
  return t != null ? String(t) : null;
}

function _now() {
  return new Date().toISOString();
}

function _generateId(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

function _findOpenShift(shifts, tenantId, cashierId) {
  return shifts.find(s =>
    String(s.tenantId || '') === String(tenantId) &&
    String(s.cashierId || '') === String(cashierId) &&
    s.status === 'open'
  ) || null;
}

function openShift(tenantContext, cashierId, cashierName, openingCash, notes) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required');
  if (!cashierId) throw new Error('cashierId is required');
  if (!cashierName) throw new Error('cashierName is required');

  const doc = _readStore();
  const shifts = Array.isArray(doc.shifts) ? doc.shifts : [];

  const existing = _findOpenShift(shifts, tid, cashierId);
  if (existing) throw new Error('Cashier already has an open shift');

  const shift = {
    id: _generateId('shift'),
    shiftRef: _generateId('SFT'),
    tenantId: tid,
    cashierId: String(cashierId),
    cashierName: String(cashierName),
    openingCash: Math.round((parseFloat(openingCash || 0) || 0) * 100) / 100,
    expectedCash: Math.round((parseFloat(openingCash || 0) || 0) * 100) / 100,
    actualCash: null,
    cashVariance: null,
    status: 'open',
    openedAt: _now(),
    closedAt: null,
    notes: String(notes || '').trim() || null
  };

  shifts.unshift(shift);
  doc.shifts = shifts;
  _writeStore(doc);
  return shift;
}

function closeShift(tenantContext, shiftId, actualCash, notes) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required');

  const doc = _readStore();
  const shifts = Array.isArray(doc.shifts) ? doc.shifts : [];
  const idx = shifts.findIndex(s => String(s.id) === String(shiftId) && String(s.tenantId || '') === tid && s.status === 'open');
  if (idx === -1) throw new Error('Open shift not found');

  const actual = Math.round((parseFloat(actualCash || 0) || 0) * 100) / 100;
  const expected = shifts[idx].expectedCash || 0;
  const variance = Math.round((actual - expected) * 100) / 100;

  shifts[idx] = Object.assign({}, shifts[idx], {
    actualCash: actual,
    cashVariance: variance,
    status: 'closed',
    closedAt: _now(),
    notes: String(notes || shifts[idx].notes || '').trim() || null
  });

  doc.shifts = shifts;
  _writeStore(doc);
  return shifts[idx];
}

function addToShift(tenantContext, shiftId, amount) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required');

  const doc = _readStore();
  const shifts = Array.isArray(doc.shifts) ? doc.shifts : [];
  const idx = shifts.findIndex(s => String(s.id) === String(shiftId) && String(s.tenantId || '') === tid && s.status === 'open');
  if (idx === -1) throw new Error('Open shift not found');

  const add = Math.round((parseFloat(amount || 0) || 0) * 100) / 100;
  const currentExpected = shifts[idx].expectedCash || 0;
  shifts[idx].expectedCash = Math.round((currentExpected + add) * 100) / 100;
  shifts[idx].updatedAt = _now();

  doc.shifts = shifts;
  _writeStore(doc);
  return shifts[idx];
}

function getCurrentShift(tenantContext, cashierId) {
  const tid = _tenantId(tenantContext);
  const doc = _readStore();
  const shifts = Array.isArray(doc.shifts) ? doc.shifts : [];
  if (tid && cashierId) {
    return _findOpenShift(shifts, tid, cashierId);
  }
  return null;
}

function listShifts(tenantContext, query = {}) {
  const tid = _tenantId(tenantContext);
  const doc = _readStore();
  let shifts = Array.isArray(doc.shifts) ? doc.shifts : [];

  if (tid) {
    shifts = shifts.filter(s => String(s.tenantId || '') === tid);
  }

  const status = String(query.status || '').trim();
  if (status) {
    shifts = shifts.filter(s => s.status === status);
  }

  const cashierId = String(query.cashierId || '').trim();
  if (cashierId) {
    shifts = shifts.filter(s => String(s.cashierId || '') === cashierId);
  }

  shifts.sort((a, b) => new Date(b.openedAt || 0) - new Date(a.openedAt || 0));

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
  const start = (page - 1) * limit;
  const paginated = shifts.slice(start, start + limit);

  return {
    shifts: paginated,
    total: shifts.length,
    page,
    limit,
    totalPages: Math.ceil(shifts.length / limit) || 1
  };
}

function setUserRole(tenantContext, userId, role, permissions) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required');
  if (!userId) throw new Error('userId is required');

  const allowedRoles = ['admin', 'manager', 'cashier'];
  const safeRole = allowedRoles.includes(role) ? role : 'cashier';

  const defaultPerms = { can_discount: false, can_void: false, can_edit_price: false };
  const mergedPerms = Object.assign({}, defaultPerms, permissions || {});

  const doc = _readStore();
  const roles = Array.isArray(doc.userRoles) ? doc.userRoles : [];
  const idx = roles.findIndex(r => String(r.tenantId || '') === tid && String(r.userId || '') === String(userId));

  const record = {
    id: idx >= 0 ? roles[idx].id : _generateId('role'),
    tenantId: tid,
    userId: String(userId),
    role: safeRole,
    permissions: mergedPerms,
    updatedAt: _now()
  };

  if (idx >= 0) {
    roles[idx] = Object.assign({}, roles[idx], record);
  } else {
    roles.push(record);
  }

  doc.userRoles = roles;
  _writeStore(doc);
  return record;
}

function getUserRole(tenantContext, userId) {
  const tid = _tenantId(tenantContext);
  const doc = _readStore();
  const roles = Array.isArray(doc.userRoles) ? doc.userRoles : [];
  return roles.find(r => String(r.tenantId || '') === tid && String(r.userId || '') === String(userId)) || null;
}

function listUserRoles(tenantContext, query = {}) {
  const tid = _tenantId(tenantContext);
  const doc = _readStore();
  let roles = Array.isArray(doc.userRoles) ? doc.userRoles : [];

  if (tid) {
    roles = roles.filter(r => String(r.tenantId || '') === tid);
  }

  const role = String(query.role || '').trim().toLowerCase();
  if (role) {
    roles = roles.filter(r => String(r.role || '').toLowerCase() === role);
  }

  roles.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
  const start = (page - 1) * limit;
  const paginated = roles.slice(start, start + limit);

  return {
    userRoles: paginated,
    total: roles.length,
    page,
    limit,
    totalPages: Math.ceil(roles.length / limit) || 1
  };
}

function hasPermission(tenantContext, userId, permission) {
  const roleRecord = getUserRole(tenantContext, userId);
  if (!roleRecord) return false;
  const perms = roleRecord.permissions || {};
  if (roleRecord.role === 'admin') return true;
  return !!perms[permission];
}

module.exports = {
  openShift,
  closeShift,
  addToShift,
  getCurrentShift,
  listShifts,
  setUserRole,
  getUserRole,
  listUserRoles,
  hasPermission
};
