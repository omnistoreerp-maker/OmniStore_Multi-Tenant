'use strict';

// class.controller — STU-6 Education Class records (Device 2).
//
// Mirrors the student/teacher/center/program/course controllers exactly: tenant
// identity is resolved EXCLUSIVELY through the canonical `trustedTenantId(req)`
// helper. It prefers the reconstructed `req.tenantContext` and falls back to
// the server-signed token claim, and it NEVER reads query, body, or any
// request header. There is no second tenant resolver here.
//
// HTTP mapping: 400 validation / missing tenant / unresolvable Course or Teacher
// reference, 404 not found or cross-tenant, 409 duplicate classCode, 500
// unexpected only. Stack traces, tenant identifiers, storage details and
// secrets are never returned.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const classService = require('../services/class.service');
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

function listClasses(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Only the declared filters are honoured; any other query key is ignored.
    // `programId` is a derived filter resolved through the Course by the
    // service - it is never stored on a Class.
    const filters = {
      status: req.query ? req.query.status : undefined,
      courseId: req.query ? req.query.courseId : undefined,
      teacherId: req.query ? req.query.teacherId : undefined,
      programId: req.query ? req.query.programId : undefined,
      search: req.query ? req.query.search : undefined
    };
    success(res, classService.listClasses({ tenantId }, filters), 'Classes retrieved');
  } catch (err) {
    logger.error('class.listClasses error:', err.message);
    error(res, 'Failed to retrieve classes', 500);
  }
}

function getClass(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const found = classService.getClass({ tenantId }, req.params.id);
    // A record owned by another tenant is reported as absent, never as
    // forbidden, so existence is not leaked across tenants.
    if (!found) return error(res, 'Class not found', 404);
    success(res, found, 'Class retrieved');
  } catch (err) {
    logger.error('class.getClass error:', err.message);
    error(res, 'Failed to retrieve class', 500);
  }
}

function createClass(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // The body is passed through untouched; the service whitelists writable
    // fields, rejects server-owned and later-phase fields, resolves the
    // required Course and Teacher references inside the trusted tenant and
    // stamps the trusted tenantId.
    const created = classService.createClass({ tenantId }, req.body || {});
    success(res, created, 'Class created', 201);
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('class.createClass error:', err.message);
    error(res, 'Failed to create class', 500);
  }
}

function updateClass(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const updated = classService.updateClass({ tenantId }, req.params.id, req.body || {});
    if (!updated) return error(res, 'Class not found', 404);
    success(res, updated, 'Class updated');
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('class.updateClass error:', err.message);
    error(res, 'Failed to update class', 500);
  }
}

function archiveClass(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const archived = classService.archiveClass({ tenantId }, req.params.id);
    if (!archived) return error(res, 'Class not found', 404);
    success(res, archived, 'Class archived');
  } catch (err) {
    logger.error('class.archiveClass error:', err.message);
    error(res, 'Failed to archive class', 500);
  }
}

module.exports = { listClasses, getClass, createClass, updateClass, archiveClass };
