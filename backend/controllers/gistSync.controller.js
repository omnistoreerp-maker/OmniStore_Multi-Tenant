'use strict';

// gistSync.controller.js — thin HTTP layer over gistSync.service.
//
// Tenant handlers never accept a tenant id from the request; they call
// trustedTenantId(req) (JWT-signed claim / reconstructed context only).
// Master handlers are gated by requirePlatformAdmin on the router.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const sync = require('../services/gistSync.service');

function _send(res, result, okMessage) {
  if (result.error) {
    // Safe error codes are SCREAMING_SNAKE_CASE strings; human-readable
    // messages (master configure validation) never match and stay code-less.
    const code = result.code
      || (/^[A-Z][A-Z0-9_]*$/.test(String(result.error)) ? result.error : null);
    const details = Object.assign({}, result.details || null, code ? { code } : null);
    return error(res, result.error, result.status || 500, Object.keys(details).length ? details : null);
  }
  return success(res, result, okMessage || 'OK');
}

// ---- Master (requirePlatformAdmin already ran) ----

function listConfigs(req, res) {
  try {
    return success(res, { configs: sync.listConfigs() }, 'Sync configurations retrieved');
  } catch (err) {
    return error(res, 'Failed to retrieve sync configurations', 500);
  }
}

function configure(req, res) {
  try {
    const actor = req.platformAdmin || null;
    const result = sync.configure(actor, req.params.tenantId, req.body || {});
    return _send(res, result, 'Sync configuration saved');
  } catch (err) {
    return error(res, 'Failed to save sync configuration', 500);
  }
}

function disconnect(req, res) {
  try {
    const actor = req.platformAdmin || null;
    const result = sync.disconnect(actor, req.params.tenantId);
    return _send(res, result, 'Sync disconnected');
  } catch (err) {
    return error(res, 'Failed to disconnect sync', 500);
  }
}

// ---- Tenant (ordinary company users; secrets never returned) ----

function status(req, res) {
  try {
    const tenantId = trustedTenantId(req);
    if (!tenantId) return error(res, 'No active company on this session', 400, { code: 'NO_TENANT' });
    const result = sync.tenantStatus(tenantId);
    return _send(res, result, 'Sync status retrieved');
  } catch (err) {
    return error(res, 'Failed to retrieve sync status', 500);
  }
}

async function pull(req, res) {
  try {
    const tenantId = trustedTenantId(req);
    if (!tenantId) return error(res, 'No active company on this session', 400, { code: 'NO_TENANT' });
    const result = await sync.tenantPull(tenantId);
    return _send(res, result, 'Sync pull complete');
  } catch (err) {
    return error(res, 'Sync pull failed', 500);
  }
}

async function push(req, res) {
  try {
    const tenantId = trustedTenantId(req);
    if (!tenantId) return error(res, 'No active company on this session', 400, { code: 'NO_TENANT' });
    const result = await sync.tenantPush(tenantId, req.body || {});
    return _send(res, result, 'Sync push complete');
  } catch (err) {
    return error(res, 'Sync push failed', 500);
  }
}

module.exports = { listConfigs, configure, disconnect, status, pull, push };
