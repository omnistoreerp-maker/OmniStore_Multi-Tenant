'use strict';

// course.controller — STU-5 Education Course records (Device 2).
//
// Mirrors the student/teacher/center/program controllers exactly: tenant
// identity is resolved EXCLUSIVELY through the canonical `trustedTenantId(req)`
// helper. It prefers the reconstructed `req.tenantContext` and falls back to
// the server-signed token claim, and it NEVER reads query, body, or any
// request header. There is no second tenant resolver here.
//
// HTTP mapping: 400 validation / missing tenant / unresolvable Program
// reference, 404 not found or cross-tenant, 409 duplicate courseCode, 500
// unexpected only. Stack traces, tenant identifiers, storage details and
// secrets are never returned.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const courseService = require('../services/course.service');
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

function listCourses(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Only the declared filters are honoured; any other query key is ignored.
    const filters = {
      status: req.query ? req.query.status : undefined,
      programId: req.query ? req.query.programId : undefined,
      search: req.query ? req.query.search : undefined
    };
    success(res, courseService.listCourses({ tenantId }, filters), 'Courses retrieved');
  } catch (err) {
    logger.error('course.listCourses error:', err.message);
    error(res, 'Failed to retrieve courses', 500);
  }
}

function getCourse(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const found = courseService.getCourse({ tenantId }, req.params.id);
    // A record owned by another tenant is reported as absent, never as
    // forbidden, so existence is not leaked across tenants.
    if (!found) return error(res, 'Course not found', 404);
    success(res, found, 'Course retrieved');
  } catch (err) {
    logger.error('course.getCourse error:', err.message);
    error(res, 'Failed to retrieve course', 500);
  }
}

function createCourse(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // The body is passed through untouched; the service whitelists writable
    // fields, rejects server-owned fields, resolves the required Program
    // reference inside the trusted tenant and stamps the trusted tenantId.
    const created = courseService.createCourse({ tenantId }, req.body || {});
    success(res, created, 'Course created', 201);
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('course.createCourse error:', err.message);
    error(res, 'Failed to create course', 500);
  }
}

function updateCourse(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const updated = courseService.updateCourse({ tenantId }, req.params.id, req.body || {});
    if (!updated) return error(res, 'Course not found', 404);
    success(res, updated, 'Course updated');
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('course.updateCourse error:', err.message);
    error(res, 'Failed to update course', 500);
  }
}

function archiveCourse(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const archived = courseService.archiveCourse({ tenantId }, req.params.id);
    if (!archived) return error(res, 'Course not found', 404);
    success(res, archived, 'Course archived');
  } catch (err) {
    logger.error('course.archiveCourse error:', err.message);
    error(res, 'Failed to archive course', 500);
  }
}

module.exports = { listCourses, getCourse, createCourse, updateCourse, archiveCourse };