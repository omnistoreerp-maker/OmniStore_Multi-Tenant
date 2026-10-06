'use strict';

const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const addonService = require('../services/tenantAddons.service');
const domainService = require('../services/tenantCustomDomains.service');
const TenantContext = require('../tenant/TenantContext');
const tenantStore = require('../middleware/tenantStore');

function _trustedTenantId(req) {
  const ctx = req.tenantContext;
  if (ctx && ctx.tenantId) return String(ctx.tenantId);
  const store = tenantStore.get();
  if (store && store.tenantId) return String(store.tenantId);
  return null;
}

// ---------------- add-ons ----------------

function listMyAddons(req, res) {
  try {
    const tenantId = _trustedTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const addons = addonService.listAddonsForTenant(tenantId);
    success(res, { addons }, 'Add-ons retrieved');
  } catch (err) {
    logger.error('tenantExtensions.listMyAddons error:', err.message);
    error(res, 'Failed to retrieve add-ons', 500);
  }
}

function upsertMyAddon(req, res) {
  try {
    const tenantId = _trustedTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const { addon_key, status, expires_at } = req.body || {};
    const record = addonService.upsertAddonForTenant(tenantId, addon_key, status, expires_at);
    if (!record) return error(res, 'Invalid addon key', 400);
    success(res, record, 'Add-on saved');
  } catch (err) {
    logger.error('tenantExtensions.upsertMyAddon error:', err.message);
    error(res, 'Failed to save add-on', 500);
  }
}

function deleteMyAddon(req, res) {
  try {
    const tenantId = _trustedTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const removed = addonService.removeAddonForTenant(tenantId, req.params.addonKey);
    if (!removed) return error(res, 'Add-on not found', 404);
    success(res, null, 'Add-on removed');
  } catch (err) {
    logger.error('tenantExtensions.deleteMyAddon error:', err.message);
    error(res, 'Failed to remove add-on', 500);
  }
}

// ---------------- custom domains ----------------

function listMyCustomDomains(req, res) {
  try {
    const tenantId = _trustedTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const all = domainService.listDomainsForAdmin();
    const mine = all.filter(d => String(d.tenantId) === tenantId);
    success(res, { domains: mine }, 'Custom domains retrieved');
  } catch (err) {
    logger.error('tenantExtensions.listMyCustomDomains error:', err.message);
    error(res, 'Failed to retrieve custom domains', 500);
  }
}

function registerMyCustomDomain(req, res) {
  try {
    const tenantId = _trustedTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const { custom_domain } = req.body || {};
    const domain = String(custom_domain || '').trim();
    if (!domain) return error(res, 'custom_domain is required', 400);
    const record = domainService.addCustomDomain({ tenantId, customDomain: domain });
    if (!record) return error(res, 'Failed to register domain', 500);
    success(res, record, 'Custom domain registered');
  } catch (err) {
    logger.error('tenantExtensions.registerMyCustomDomain error:', err.message);
    error(res, 'Failed to register custom domain', 500);
  }
}

module.exports = {
  listMyAddons,
  upsertMyAddon,
  deleteMyAddon,
  listMyCustomDomains,
  registerMyCustomDomain
};
