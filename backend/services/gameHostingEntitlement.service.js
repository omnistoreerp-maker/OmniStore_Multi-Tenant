'use strict';

const { v4: uuidv4 } = require('uuid');
const BaseRepository = require('../repositories/BaseRepository');

const entitlementRepository = new BaseRepository('gameHostingEntitlements');

function _trustedTenantId(tenantContext) {
  if (!tenantContext) return null;
  const t = tenantContext.tenantId;
  if (t == null || t === '') return null;
  return String(t);
}

function _validateEntitlementForCreate(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }
  if (data.customerId === undefined || String(data.customerId).trim() === '') errors.push('customerId is required');
  if (data.planId === undefined || String(data.planId).trim() === '') errors.push('planId is required');
  if (data.status !== undefined && !['active', 'expired', 'cancelled'].includes(data.status)) {
    errors.push('status must be one of active, expired, cancelled');
  }
  if (data.startsAt === undefined || String(data.startsAt).trim() === '') errors.push('startsAt is required');
  if (data.expiresAt === undefined || String(data.expiresAt).trim() === '') errors.push('expiresAt is required');
  return errors;
}

function _validateEntitlementForUpdate(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }
  if (data.status !== undefined && !['active', 'expired', 'cancelled'].includes(data.status)) {
    errors.push('status must be one of active, expired, cancelled');
  }
  if (data.startsAt !== undefined && String(data.startsAt).trim() === '') errors.push('startsAt is required');
  if (data.expiresAt !== undefined && String(data.expiresAt).trim() === '') errors.push('expiresAt is required');
  return errors;
}

function _isActive(entitlement, referenceDate) {
  if (!entitlement) return false;
  if (entitlement.status !== 'active') return false;
  const now = referenceDate ? new Date(referenceDate) : new Date();
  const startsAt = new Date(entitlement.startsAt);
  const expiresAt = new Date(entitlement.expiresAt);
  return now >= startsAt && now <= expiresAt;
}

async function listEntitlements({ tenantContext, customerId, planId } = {}) {
  const trustedTid = _trustedTenantId(tenantContext);
  const db = await entitlementRepository.readAsync();
  let entitlements = Array.isArray(db.entitlements) ? db.entitlements : [];
  if (trustedTid) entitlements = entitlements.filter((e) => e && String(e.tenantId) === trustedTid);
  if (customerId) entitlements = entitlements.filter((e) => String(e.customerId) === String(customerId));
  if (planId) entitlements = entitlements.filter((e) => String(e.planId) === String(planId));
  return entitlements;
}

async function getEntitlementById({ id, tenantContext } = {}) {
  if (id == null || id === '') return null;
  const target = String(id).trim();
  const trustedTid = _trustedTenantId(tenantContext);
  const db = await entitlementRepository.readAsync();
  const found = (Array.isArray(db.entitlements) ? db.entitlements : []).find((e) => e && (String(e.id) === target || String(e._backendId || '') === target));
  if (!found) return null;
  if (trustedTid && String(found.tenantId) !== trustedTid) return null;
  return found;
}

async function createEntitlement({ data, tenantContext } = {}) {
  const errors = _validateEntitlementForCreate(data);
  if (errors.length) return { error: errors.join('; ') };
  const trustedTid = _trustedTenantId(tenantContext);
  const now = new Date().toISOString();
  const entitlement = {
    id: uuidv4(),
    tenantId: trustedTid || null,
    customerId: String(data.customerId).trim(),
    planId: String(data.planId).trim(),
    status: data.status || 'active',
    startsAt: String(data.startsAt).trim(),
    expiresAt: String(data.expiresAt).trim(),
    createdAt: now,
    updatedAt: now
  };
  const db = await entitlementRepository._rawStoreAsync();
  if (!db.entitlements) db.entitlements = [];
  db.entitlements.push(entitlement);
  if (await entitlementRepository.writeAsync(db)) return { entitlement: Object.assign({}, entitlement) };
  return { error: 'Failed to persist entitlement' };
}

async function updateEntitlement({ id, data, tenantContext } = {}) {
  if (id == null || id === '') return { error: 'id is required' };
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { error: 'request body must be a JSON object' };
  }
  const errors = _validateEntitlementForUpdate(data);
  if (errors.length) return { error: errors.join('; ') };
  const target = String(id).trim();
  const trustedTid = _trustedTenantId(tenantContext);
  const db = await entitlementRepository._rawStoreAsync();
  const idx = (db.entitlements || []).findIndex((e) => e && (String(e.id) === target || String(e._backendId || '') === target));
  if (idx === -1) return { error: 'Entitlement not found' };
  if (trustedTid && String(db.entitlements[idx].tenantId) !== trustedTid) return { error: 'Entitlement not found' };
  if (data.status !== undefined) db.entitlements[idx].status = data.status;
  if (data.startsAt !== undefined) db.entitlements[idx].startsAt = String(data.startsAt).trim();
  if (data.expiresAt !== undefined) db.entitlements[idx].expiresAt = String(data.expiresAt).trim();
  db.entitlements[idx].updatedAt = new Date().toISOString();
  if (await entitlementRepository.writeAsync(db)) return { entitlement: Object.assign({}, db.entitlements[idx]) };
  return { error: 'Failed to persist entitlement update' };
}

async function deleteEntitlement({ id, tenantContext } = {}) {
  if (id == null || id === '') return { error: 'id is required' };
  const target = String(id).trim();
  const trustedTid = _trustedTenantId(tenantContext);
  const db = await entitlementRepository._rawStoreAsync();
  const idx = (db.entitlements || []).findIndex((e) => e && (String(e.id) === target || String(e._backendId || '') === target));
  if (idx === -1) return { error: 'Entitlement not found' };
  if (trustedTid && String(db.entitlements[idx].tenantId) !== trustedTid) return { error: 'Entitlement not found' };
  db.entitlements.splice(idx, 1);
  if (await entitlementRepository.writeAsync(db)) return { success: true };
  return { error: 'Failed to persist entitlement delete' };
}

async function findActiveEntitlement({ customerId, planId, tenantContext, referenceDate } = {}) {
  if (!customerId || !planId) return null;
  const trustedTid = _trustedTenantId(tenantContext);
  const db = await entitlementRepository.readAsync();
  let entitlements = Array.isArray(db.entitlements) ? db.entitlements : [];
  entitlements = entitlements.filter((e) => {
    if (!e) return false;
    if (trustedTid && String(e.tenantId) !== trustedTid) return false;
    if (String(e.customerId) !== String(customerId)) return false;
    if (String(e.planId) !== String(planId)) return false;
    return true;
  });
  return entitlements.find((e) => _isActive(e, referenceDate)) || null;
}

module.exports = {
  listEntitlements,
  getEntitlementById,
  createEntitlement,
  updateEntitlement,
  deleteEntitlement,
  findActiveEntitlement,
  _isActive
};
