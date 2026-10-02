'use strict';

// teacher.controller — STU-3 Teacher records (Device 2).
//
// Mirrors student.controller exactly: tenant identity is resolved EXCLUSIVELY
// through the canonical `trustedTenantId(req)` helper from the authorization
// middleware. It prefers the reconstructed `req.tenantContext` and falls back
// to the server-signed token claim, and it NEVER reads query, body, or any
// request header. There is no second tenant resolver here.
//
// A missing trusted tenant is a hard 400 "Tenant context required", never a
// default tenant and never a fallback.
//
// HTTP mapping: 400 validation / missing tenant, 404 not found or cross-tenant,
// 409 duplicate teacherCode inside the tenant, 500 unexpected only. Stack
// traces and internal messages are never returned to the client.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const teacherService = require('../services/teacher.service');
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

function listTeachers(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Only the declared filters are honoured; any other query key is ignored.
    const filters = {
      status: req.query ? req.query.status : undefined,
      employmentType: req.query ? req.query.employmentType : undefined,
      search: req.query ? req.query.search : undefined
    };
    success(res, teacherService.listTeachers({ tenantId }, filters), 'Teachers retrieved');
  } catch (err) {
    logger.error('teacher.listTeachers error:', err.message);
    error(res, 'Failed to retrieve teachers', 500);
  }
}

function getTeacher(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const found = teacherService.getTeacher({ tenantId }, req.params.id);
    // A record owned by another tenant is reported as absent, never as
    // forbidden, so existence is not leaked across tenants.
    if (!found) return error(res, 'Teacher not found', 404);
    success(res, found, 'Teacher retrieved');
  } catch (err) {
    logger.error('teacher.getTeacher error:', err.message);
    error(res, 'Failed to retrieve teacher', 500);
  }
}

function createTeacher(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // The body is passed through untouched; the service whitelists writable
    // fields, rejects server-owned fields and stamps the trusted tenantId.
    const created = teacherService.createTeacher({ tenantId }, req.body || {});
    success(res, created, 'Teacher created', 201);
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('teacher.createTeacher error:', err.message);
    error(res, 'Failed to create teacher', 500);
  }
}

function updateTeacher(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const updated = teacherService.updateTeacher({ tenantId }, req.params.id, req.body || {});
    if (!updated) return error(res, 'Teacher not found', 404);
    success(res, updated, 'Teacher updated');
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('teacher.updateTeacher error:', err.message);
    error(res, 'Failed to update teacher', 500);
  }
}

function archiveTeacher(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const archived = teacherService.archiveTeacher({ tenantId }, req.params.id);
    if (!archived) return error(res, 'Teacher not found', 404);
    success(res, archived, 'Teacher archived');
  } catch (err) {
    logger.error('teacher.archiveTeacher error:', err.message);
    error(res, 'Failed to archive teacher', 500);
  }
}

module.exports = { listTeachers, getTeacher, createTeacher, updateTeacher, archiveTeacher };