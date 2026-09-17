'use strict';

const BaseRepository = require('../repositories/BaseRepository');
const storageAdapter = require('../repositories/storageAdapter');
const logger = require('../utils/logger');

const addonRepository = new BaseRepository('tenantAddons');

function _trustedTenantId(tenantContext) {
  if (!tenantContext) return null;
  const t = tenantContext.tenantId;
  if (t == null || t === '') return null;
  return String(t);
}

function _normalizeStatus(status) {
  if (status === undefined || status === null || status === '') return 'active';
  return String(status);
}

function _isActive(addon, referenceDate) {
  if (!addon) return false;
  if (addon.status !== 'active') return false;
  if (addon.expiresAt) {
    const now = referenceDate ? new Date(referenceDate) : new Date();
    const expires = new Date(addon.expiresAt);
    return now <= expires;
  }
  return true;
}

async function listAddons({ tenantContext } = {}) {
  const trustedTid = _trustedTenantId(tenantContext);
  const db = await addonRepository.readAsync();
  let addons = Array.isArray(db.tenantAddons) ? db.tenantAddons : [];
  if (trustedTid) addons = addons.filter((a) => a && String(a.tenantId) === trustedTid);
  return addons;
}

async function getActiveAddonKeys({ tenantContext } = {}) {
  const trustedTid = _trustedTenantId(tenantContext);
  const addons = await listAddons({ tenantContext });
  return addons.filter((a) => _isActive(a)).map((a) => String(a.addonKey));
}

async function hasAddon(tenantContext, addonKey) {
  const trustedTid = _trustedTenantId(tenantContext);
  if (!trustedTid || !addonKey) return false;
  const db = await addonRepository.readAsync();
  const addons = Array.isArray(db.tenantAddons) ? db.tenantAddons : [];
  const match = addons.find((a) => String(a.tenantId) === trustedTid && String(a.addonKey) === String(addonKey));
  return !!match && _isActive(match);
}

async function upsertAddon({ tenantContext, addonKey, status, expiresAt } = {}) {
  const trustedTid = _trustedTenantId(tenantContext);
  if (!trustedTid) throw new Error('Tenant context is required');
  if (!addonKey) throw new Error('addonKey is required');

  const db = await addonRepository.readAsync();
  const addons = Array.isArray(db.tenantAddons) ? db.tenantAddons : [];
  const idx = addons.findIndex((a) => String(a.tenantId) === trustedTid && String(a.addonKey) === String(addonKey));

  const record = {
    tenantId: trustedTid,
    addonKey: String(addonKey),
    status: _normalizeStatus(status),
    expiresAt: expiresAt || null
  };

  if (idx >= 0) {
    addons[idx] = Object.assign({}, addons[idx], record);
  } else {
    addons.push(record);
  }

  db.tenantAddons = addons;
  await addonRepository.writeAsync(db);
  return record;
}

async function removeAddon(tenantContext, addonKey) {
  const trustedTid = _trustedTenantId(tenantContext);
  if (!trustedTid || !addonKey) return false;

  const db = await addonRepository.readAsync();
  const addons = Array.isArray(db.tenantAddons) ? db.tenantAddons : [];
  const filtered = addons.filter((a) => !(String(a.tenantId) === trustedTid && String(a.addonKey) === String(addonKey)));
  if (filtered.length === addons.length) return false;

  db.tenantAddons = filtered;
  await addonRepository.writeAsync(db);
  return true;
}

// ---------------- platform admin helpers ----------------

async function listAddonsForTenant(tenantId) {
  const tid = String(tenantId || '').trim();
  if (!tid) return [];
  const db = await addonRepository.readAsync();
  const addons = Array.isArray(db.tenantAddons) ? db.tenantAddons : [];
  return addons.filter((a) => a && String(a.tenantId) === tid);
}

async function upsertAddonForTenant(tenantId, addonKey, status, expiresAt) {
  const tid = String(tenantId || '').trim();
  const key = String(addonKey || '').trim();
  if (!tid || !key) return null;

  const db = await addonRepository.readAsync();
  const addons = Array.isArray(db.tenantAddons) ? db.tenantAddons : [];
  const idx = addons.findIndex((a) => String(a.tenantId) === tid && String(a.addonKey) === key);

  const record = {
    tenantId: tid,
    addonKey: key,
    status: _normalizeStatus(status),
    expiresAt: expiresAt || null
  };

  if (idx >= 0) {
    addons[idx] = Object.assign({}, addons[idx], record);
  } else {
    addons.push(record);
  }

  db.tenantAddons = addons;
  await addonRepository.writeAsync(db);
  return record;
}

async function removeAddonForTenant(tenantId, addonKey) {
  const tid = String(tenantId || '').trim();
  const key = String(addonKey || '').trim();
  if (!tid || !key) return false;

  const db = await addonRepository.readAsync();
  const addons = Array.isArray(db.tenantAddons) ? db.tenantAddons : [];
  const filtered = addons.filter((a) => !(String(a.tenantId) === tid && String(a.addonKey) === key));
  if (filtered.length === addons.length) return false;

  db.tenantAddons = filtered;
  await addonRepository.writeAsync(db);
  return true;
}

module.exports = {
  listAddons,
  getActiveAddonKeys,
  hasAddon,
  upsertAddon,
  removeAddon,
  listAddonsForTenant,
  upsertAddonForTenant,
  removeAddonForTenant
};
