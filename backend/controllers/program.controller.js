'use strict';

// program.controller — STU-5 Education Program records (Device 2).
//
// Mirrors the student/teacher/center controllers exactly: tenant identity is
// resolved EXCLUSIVELY through the canonical `trustedTenantId(req)` helper.
// It prefers the reconstructed `req.tenantContext` and falls back to the
// server-signed token claim, and it NEVER reads query, body, or any request
// header. There is no second tenant resolver here.
//
// A Program is an entity INSIDE the trusted tenant. Nothing in this controller
// creates, selects, or implies a different tenant.
//
// HTTP mapping: 400 validation / missing tenant / unresolvable reference,
// 404 not found or cross-tenant, 409 duplicate programCode, 500 unexpected
// only. Stack traces, tenant identifiers, storage details and secrets are
// never returned.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const programService = require('../services/program.service');
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

function listPrograms(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Only the declared filters are honoured; any other query key is ignored.
    const filters = {
      status: req.query ? req.query.status : undefined,
      centerId: req.query ? req.query.centerId : undefined,
      search: req.query ? req.query.search : undefined
    };
    success(res, programService.listPrograms({ tenantId }, filters), 'Programs retrieved');
  } catch (err) {
    logger.error('program.listPrograms error:', err.message);
    error(res, 'Failed to retrieve programs', 500);
  }
}

function getProgram(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const found = programService.getProgram({ tenantId }, req.params.id);
    // A record owned by another tenant is reported as absent, never as
    // forbidden, so existence is not leaked across tenants.
    if (!found) return error(res, 'Program not found', 404);
    success(res, found, 'Program retrieved');
  } catch (err) {
    logger.error('program.getProgram error:', err.message);
    error(res, 'Failed to retrieve program', 500);
  }
}

function createProgram(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // The body is passed through untouched; the service whitelists writable
    // fields, rejects server-owned fields, resolves the Center reference
    // inside the trusted tenant and stamps the trusted tenantId.
    const created = programService.createProgram({ tenantId }, req.body || {});
    success(res, created, 'Program created', 201);
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('program.createProgram error:', err.message);
    error(res, 'Failed to create program', 500);
  }
}

function updateProgram(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const updated = programService.updateProgram({ tenantId }, req.params.id, req.body || {});
    if (!updated) return error(res, 'Program not found', 404);
    success(res, updated, 'Program updated');
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('program.updateProgram error:', err.message);
    error(res, 'Failed to update program', 500);
  }
}

function archiveProgram(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Archives the Program only. There is no cascade: existing Courses are
    // preserved and keep their programId.
    const archived = programService.archiveProgram({ tenantId }, req.params.id);
    if (!archived) return error(res, 'Program not found', 404);
    success(res, archived, 'Program archived');
  } catch (err) {
    logger.error('program.archiveProgram error:', err.message);
    error(res, 'Failed to archive program', 500);
  }
}

module.exports = { listPrograms, getProgram, createProgram, updateProgram, archiveProgram };