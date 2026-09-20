'use strict';

const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const addonService = require('../services/tenantAddons.service');
const feeService = require('../services/tenantTransactionFees.service');
const domainService = require('../services/tenantCustomDomains.service');

function _actor(req) {
  return req.user ? { id: req.user.id, username: req.user.username } : null;
}

// ---------------- add-ons ----------------

async function listAddons(req, res) {
  try {
    const addons = await addonService.listAddonsForTenant(req.params.tenantId);
    success(res, { addons }, 'Add-ons retrieved');
  } catch (err) {
    logger.error('platformAdmin.listAddons error:', err.message);
    error(res, 'Failed to retrieve add-ons', 500);
  }
}

async function upsertAddon(req, res) {
  try {
    const { addon_key, status, expires_at } = req.body || {};
    const record = await addonService.upsertAddonForTenant(req.params.tenantId, addon_key, status, expires_at);
    if (!record) return error(res, 'Invalid tenant or addon key', 400);
    success(res, record, 'Add-on saved');
  } catch (err) {
    logger.error('platformAdmin.upsertAddon error:', err.message);
    error(res, 'Failed to save add-on', 500);
  }
}

async function deleteAddon(req, res) {
  try {
    const removed = await addonService.removeAddonForTenant(req.params.tenantId, req.params.addonKey);
    if (!removed) return error(res, 'Add-on not found', 404);
    success(res, null, 'Add-on removed');
  } catch (err) {
    logger.error('platformAdmin.deleteAddon error:', err.message);
    error(res, 'Failed to remove add-on', 500);
  }
}

// ---------------- transaction fees ----------------

async function listFees(req, res) {
  try {
    const { tenantId, status, startDate, endDate } = req.query || {};
    const fees = await feeService.listFeesForAdmin({
      tenantId: tenantId || undefined,
      status: status || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined
    });
    success(res, { fees }, 'Transaction fees retrieved');
  } catch (err) {
    logger.error('platformAdmin.listFees error:', err.message);
    error(res, 'Failed to retrieve transaction fees', 500);
  }
}

async function markFeesBilled(req, res) {
  try {
    const { feeIds, tenantId } = req.body || {};
    const result = await feeService.markFeesBilled({ feeIds, tenantId });
    if (!result || result.updated === 0) return error(res, 'No matching fees found', 404);
    success(res, result, 'Fees marked as billed');
  } catch (err) {
    logger.error('platformAdmin.markFeesBilled error:', err.message);
    error(res, 'Failed to mark fees as billed', 500);
  }
}

// ---------------- custom domains ----------------

async function listDomains(req, res) {
  try {
    const domains = await domainService.listDomainsForAdmin();
    success(res, { domains }, 'Custom domains retrieved');
  } catch (err) {
    logger.error('platformAdmin.listDomains error:', err.message);
    error(res, 'Failed to retrieve custom domains', 500);
  }
}

async function updateDomainStatus(req, res) {
  try {
    const domainId = req.params.domainId;
    const { status } = req.body || {};
    if (!status) return error(res, 'status is required', 400);
    const updated = await domainService.updateDomainStatusForAdmin(domainId, status);
    if (!updated) return error(res, 'Domain not found or invalid status', 404);
    success(res, { domainId, status }, 'Domain status updated');
  } catch (err) {
    logger.error('platformAdmin.updateDomainStatus error:', err.message);
    error(res, 'Failed to update domain status', 500);
  }
}

module.exports = {
  listAddons,
  upsertAddon,
  deleteAddon,
  listFees,
  markFeesBilled,
  listDomains,
  updateDomainStatus
};
