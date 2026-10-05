'use strict';

// educationPack.controller — STU-1 Education foundation (Device 2).
//
// Tenant identity is resolved EXCLUSIVELY through the canonical
// `trustedTenantId(req)` helper from the authorization middleware — the same
// resolver used by users/webhooks/api-keys controllers. It prefers the
// reconstructed `req.tenantContext` and falls back to the signed token claim,
// and it never reads query, body, or any request header.
//
// This controller deliberately does NOT define its own tenant resolver. A
// missing trusted tenant is a hard 400 "Tenant context required" (the
// established convention in this repository), never a default tenant.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const educationPack = require('../services/educationPack.service');
const logger = require('../utils/logger');

// Returns the trusted tenant id, or null after having already answered 400.
function _tenantIdOr400(req, res) {
  const tenantId = trustedTenantId(req);
  if (!tenantId) {
    error(res, 'Tenant context required', 400);
    return null;
  }
  return String(tenantId);
}

function _centerId(req) {
  return req && req.centerActor && req.centerActor.id ? String(req.centerActor.id) : '';
}

function _refuseCenterWrite(req, res) {
  if (_centerId(req)) {
    // Tenant-wide settings are an operator action: a linked center may read
    // the pack but may not rewrite tenant settings that govern every center.
    error(res, 'Centers may not change tenant education settings; this is an operator action', 403, { code: 'OWNERSHIP_DENIED' });
    return true;
  }
  return false;
}

function getPack(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    success(res, educationPack.getPack({ tenantId }), 'Education pack retrieved');
  } catch (err) {
    logger.error('educationPack.getPack error:', err.message);
    error(res, 'Failed to retrieve education pack', 500);
  }
}

function updatePack(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    if (_refuseCenterWrite(req, res)) return;
    // The body is passed through untouched to the service, which whitelists
    // writable fields and re-asserts the server-owned tenantId. A body
    // `tenantId` is ignored there.
    const pack = educationPack.updatePack({ tenantId }, req.body || {});
    success(res, pack, 'Education pack saved');
  } catch (err) {
    logger.error('educationPack.updatePack error:', err.message);
    error(res, err.message || 'Failed to save education pack', 400);
  }
}

function resetPack(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    if (_refuseCenterWrite(req, res)) return;
    const ok = educationPack.resetPack({ tenantId });
    if (!ok) return error(res, 'Education pack not found', 404);
    success(res, { ok: true }, 'Education pack reset');
  } catch (err) {
    logger.error('educationPack.resetPack error:', err.message);
    error(res, err.message || 'Failed to reset education pack', 400);
  }
}

function listCapabilities(req, res) {
  try {
    // The capability list is static, but the endpoint still answers only
    // inside a trusted tenant like every other education read: without a
    // tenant context there is nothing to scope capabilities against.
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    success(res, educationPack.listCapabilities(), 'Education capabilities retrieved');
  } catch (err) {
    logger.error('educationPack.listCapabilities error:', err.message);
    error(res, 'Failed to retrieve education capabilities', 500);
  }
}

module.exports = { getPack, updatePack, resetPack, listCapabilities };
