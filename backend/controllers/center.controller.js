'use strict';

// center.controller — STU-4 Education Center records (Device 2).
//
// Mirrors the student/teacher controllers exactly: tenant identity is resolved
// EXCLUSIVELY through the canonical `trustedTenantId(req)` helper from the
// authorization middleware. It prefers the reconstructed `req.tenantContext`
// and falls back to the server-signed token claim, and it NEVER reads query,
// body, or any request header. There is no second tenant resolver here.
//
// A Center is an entity INSIDE the trusted tenant. Nothing in this controller
// creates, selects, or implies a different tenant.
//
// A missing trusted tenant is a hard 400 "Tenant context required", never a
// default tenant and never a fallback.
//
// HTTP mapping: 400 validation / missing tenant, 404 not found or cross-tenant,
// 409 duplicate centerCode inside the tenant, 500 unexpected only. Stack
// traces, tenant identifiers, file paths and secrets are never returned.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const centerService = require('../services/center.service');
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

function listCenters(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Only the declared filters are honoured; any other query key is ignored.
    const filters = {
      status: req.query ? req.query.status : undefined,
      search: req.query ? req.query.search : undefined
    };
    success(res, centerService.listCenters({ tenantId }, filters), 'Centers retrieved');
  } catch (err) {
    logger.error('center.listCenters error:', err.message);
    error(res, 'Failed to retrieve centers', 500);
  }
}

function getCenter(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const found = centerService.getCenter({ tenantId }, req.params.id);
    // A record owned by another tenant is reported as absent, never as
    // forbidden, so existence is not leaked across tenants.
    if (!found) return error(res, 'Center not found', 404);
    success(res, found, 'Center retrieved');
  } catch (err) {
    logger.error('center.getCenter error:', err.message);
    error(res, 'Failed to retrieve center', 500);
  }
}

function createCenter(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // The body is passed through untouched; the service whitelists writable
    // fields, rejects server-owned fields and stamps the trusted tenantId.
    const created = centerService.createCenter({ tenantId }, req.body || {});
    success(res, created, 'Center created', 201);
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('center.createCenter error:', err.message);
    error(res, 'Failed to create center', 500);
  }
}

function updateCenter(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const updated = centerService.updateCenter({ tenantId }, req.params.id, req.body || {});
    if (!updated) return error(res, 'Center not found', 404);
    success(res, updated, 'Center updated');
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('center.updateCenter error:', err.message);
    error(res, 'Failed to update center', 500);
  }
}

function archiveCenter(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const archived = centerService.archiveCenter({ tenantId }, req.params.id);
    if (!archived) return error(res, 'Center not found', 404);
    success(res, archived, 'Center archived');
  } catch (err) {
    logger.error('center.archiveCenter error:', err.message);
    error(res, 'Failed to archive center', 500);
  }
}

module.exports = { listCenters, getCenter, createCenter, updateCenter, archiveCenter };