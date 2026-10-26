'use strict';

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const assignmentService = require('../services/assignment.service');
const assignmentSubmissionService = require('../services/assignmentSubmission.service');
const teacherOwnership = require('../middleware/teacherOwnership');
const centerOwnership = require('../middleware/centerOwnership');
const studentOwnership = require('../middleware/studentOwnership');
const logger = require('../utils/logger');

function _tenantIdOr400(req, res) {
  const tenantId = trustedTenantId(req);
  if (!tenantId) {
    error(res, 'Tenant context required', 400);
    return null;
  }
  return String(tenantId);
}

function _ownership403(res, message) {
  error(res, message, 403, { code: 'OWNERSHIP_DENIED' });
}

function _teacherId(req) {
  return req && req.teacherActor && req.teacherActor.id ? String(req.teacherActor.id) : '';
}

function _centerId(req) {
  return req && req.centerActor && req.centerActor.id ? String(req.centerActor.id) : '';
}

function _studentId(req) {
  return req && req.educationStudent && req.educationStudent.id ? String(req.educationStudent.id) : '';
}

function _teacherClassIds(tenantId, req) {
  const teacherId = _teacherId(req);
  if (!teacherId) return new Set();
  return new Set(teacherOwnership.teacherClassIds(tenantId, teacherId));
}

function _centerClassIds(tenantId, req) {
  const centerId = _centerId(req);
  if (!centerId) return new Set();
  return centerOwnership.centerClassIds(tenantId, centerId);
}

function _studentClassIds(tenantId, req) {
  const studentId = _studentId(req);
  if (!studentId) return new Set();
  return studentOwnership.studentClassIds(tenantId, studentId);
}

function _loadScopedAssignment(req, res, tenantId, assignmentId) {
  const found = assignmentService.getAssignment({ tenantId }, assignmentId);
  // A corrupt/unreadable assignments store is a read failure - never a 404
  // (hiding it) and never a fall-through 403 for linked actors (the error
  // object carries no classId).
  if (found && typeof found === 'object' && !Array.isArray(found) && found.error === 'READ_ERROR') {
    error(res, 'Failed to retrieve assignment', 500, { code: 'READ_ERROR' });
    return null;
  }
  if (!found) {
    error(res, 'Assignment not found', 404);
    return null;
  }
  if (_teacherId(req) && !_teacherClassIds(tenantId, req).has(String(found.classId || ''))) {
    _ownership403(res, 'Teachers may only access submissions for their own classes');
    return null;
  }
  if (_centerId(req) && !_centerClassIds(tenantId, req).has(String(found.classId || ''))) {
    _ownership403(res, 'Centers may only access submissions for their own center');
    return null;
  }
  if (_studentId(req) && !_studentClassIds(tenantId, req).has(String(found.classId || ''))) {
    _ownership403(res, 'Students may only access submissions for their own classes');
    return null;
  }
  return found;
}

function _handleWriteError(res, err, message) {
  // The assignment store itself could not be read (corrupt/unreadable data):
  // that is a 500 read failure, not the generic write failure below.
  if (err && err.code === 'READ_ERROR') {
    return error(res, message, 500, { code: 'READ_ERROR' });
  }
  if (err && err.conflict === true) {
    return error(res, err.message, 409, { code: err.code, conflict: true });
  }
  if (err && Array.isArray(err.validation)) {
    return error(res, err.message, 400, { details: err.validation });
  }
  logger.error('assignmentSubmission controller error:', err.message);
  error(res, message, 500);
}

function listSubmissions(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const assignment = _loadScopedAssignment(req, res, tenantId, req.params.id);
    if (!assignment) return;

    const filters = {
      assignmentId: assignment.id,
      studentId: _studentId(req) || undefined,
      status: req.query ? req.query.status : undefined
    };
    const rows = assignmentSubmissionService.listSubmissions({ tenantId }, filters);
    success(res, rows, 'Submissions retrieved');
  } catch (err) {
    logger.error('assignmentSubmission.listSubmissions error:', err.message);
    error(res, 'Failed to retrieve submissions', 500);
  }
}

function saveSubmission(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const studentId = _studentId(req);
    if (!studentId) return _ownership403(res, 'A linked student is required');
    const assignment = _loadScopedAssignment(req, res, tenantId, req.params.id);
    if (!assignment) return;
    const saved = assignmentSubmissionService.saveStudentSubmission(
      { tenantId },
      assignment.id,
      studentId,
      req.body || {}
    );
    success(res, saved, 'Submission saved');
  } catch (err) {
    _handleWriteError(res, err, 'Failed to save submission');
  }
}

function reviewSubmission(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const existing = assignmentSubmissionService.getSubmission({ tenantId }, req.params.submissionId);
    if (!existing) return error(res, 'Submission not found', 404);
    if (String(existing.assignmentId || '') !== String(req.params.id || '')) {
      return error(res, 'Submission not found', 404);
    }
    const assignment = _loadScopedAssignment(req, res, tenantId, existing.assignmentId);
    if (!assignment) return;
    const reviewed = assignmentSubmissionService.reviewSubmission(
      { tenantId },
      existing.id,
      req.body || {}
    );
    if (!reviewed) return error(res, 'Submission not found', 404);
    success(res, reviewed, 'Submission reviewed');
  } catch (err) {
    _handleWriteError(res, err, 'Failed to review submission');
  }
}

module.exports = {
  listSubmissions,
  saveSubmission,
  reviewSubmission
};
