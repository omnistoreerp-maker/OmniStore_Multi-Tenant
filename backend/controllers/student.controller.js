'use strict';

// student.controller — STU-2 Student records (Device 2).
//
// Mirrors educationPack.controller exactly: tenant identity is resolved
// EXCLUSIVELY through the canonical `trustedTenantId(req)` helper from the
// authorization middleware. It prefers the reconstructed `req.tenantContext`
// and falls back to the server-signed token claim, and it NEVER reads query,
// body, or any request header. There is no second tenant resolver here.
//
// A missing trusted tenant is a hard 400 "Tenant context required", never a
// default tenant and never a fallback.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const studentService = require('../services/student.service');
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

function listStudents(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Only status and search are honoured; any other query key is ignored.
    const filters = {
      status: req.query ? req.query.status : undefined,
      search: req.query ? req.query.search : undefined
    };
    success(res, studentService.listStudents({ tenantId }, filters), 'Students retrieved');
  } catch (err) {
    logger.error('student.listStudents error:', err.message);
    error(res, 'Failed to retrieve students', 500);
  }
}

function getStudent(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const found = studentService.getStudent({ tenantId }, req.params.id);
    // A record owned by another tenant is reported as absent, never as
    // forbidden, so existence is not leaked across tenants.
    if (!found) return error(res, 'Student not found', 404);
    success(res, found, 'Student retrieved');
  } catch (err) {
    logger.error('student.getStudent error:', err.message);
    error(res, 'Failed to retrieve student', 500);
  }
}

function createStudent(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // The body is passed through untouched; the service whitelists writable
    // fields, rejects server-owned fields and stamps the trusted tenantId.
    const created = studentService.createStudent({ tenantId }, req.body || {});
    success(res, created, 'Student created', 201);
  } catch (err) {
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('student.createStudent error:', err.message);
    error(res, 'Failed to create student', 500);
  }
}

function updateStudent(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const updated = studentService.updateStudent({ tenantId }, req.params.id, req.body || {});
    if (!updated) return error(res, 'Student not found', 404);
    success(res, updated, 'Student updated');
  } catch (err) {
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('student.updateStudent error:', err.message);
    error(res, 'Failed to update student', 500);
  }
}

function archiveStudent(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const archived = studentService.archiveStudent({ tenantId }, req.params.id);
    if (!archived) return error(res, 'Student not found', 404);
    success(res, archived, 'Student archived');
  } catch (err) {
    logger.error('student.archiveStudent error:', err.message);
    error(res, 'Failed to archive student', 500);
  }
}

module.exports = { listStudents, getStudent, createStudent, updateStudent, archiveStudent };