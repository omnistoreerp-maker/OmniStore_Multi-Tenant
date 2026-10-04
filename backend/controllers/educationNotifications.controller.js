'use strict';

// educationNotifications.controller — Phase 0 student-scoped notifications.
//
// Read-only. Two entry points, both resolving identity from a SERVER-OWNED
// link rather than from anything the browser supplies:
//
//   GET /education-notifications/me
//       Notifications for the student linked to the signed-in account. The
//       link IS the authorization (401 anonymous, 404 STUDENT_NOT_LINKED), the
//       same shape as /students/me and /teachers/me. No permission grant is
//       required or accepted, because there is nothing to delegate: an account
//       can only ever read its own student's notifications.
//
//   GET /education-notifications/children/:studentId/notifications
//       Notifications for ONE of the caller's own children. A linked guardian
//       is refused 403 OWNERSHIP_DENIED for any student that is not on their
//       own server-owned child list, checked against the path before any
//       lookup — so the answer cannot be influenced by guessing an id.
//
// Tenant identity is resolved EXCLUSIVELY through trustedTenantId(req); a
// missing trusted tenant is a hard 400, never a default tenant.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const studentService = require('../services/student.service');
const guardianService = require('../services/guardian.service');
const notificationsService = require('../services/educationNotifications.service');
const logger = require('../utils/logger');

function _tenantIdOr400(req, res) {
  const tenantId = trustedTenantId(req);
  if (!tenantId) {
    error(res, 'Tenant context required', 400);
    return null;
  }
  return String(tenantId);
}

function getMyNotifications(req, res) {
  try {
    if (!req.user) return error(res, 'Authentication required', 401);
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const student = studentService.getStudentByUserId({ tenantId }, req.user.id);
    if (!student) {
      return error(res, 'No student is linked to this account', 404, { code: 'STUDENT_NOT_LINKED' });
    }
    const items = notificationsService.buildStudentNotifications({ tenantId }, student.id);
    success(res, { studentId: String(student.id), items }, 'Notifications retrieved');
  } catch (err) {
    logger.error('educationNotifications.getMyNotifications error:', err.message);
    error(res, 'Failed to retrieve notifications', 500);
  }
}

function getChildNotifications(req, res) {
  try {
    if (!req.user) return error(res, 'Authentication required', 401);
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const studentId = String(req.params.studentId || '').trim();

    const guardian = req.guardianActor ||
      guardianService.getGuardianByUserId({ tenantId }, req.user.id);
    if (!guardian) {
      return error(res, 'No guardian is linked to this account', 404, { code: 'GUARDIAN_NOT_LINKED' });
    }
    const mine = Array.isArray(guardian.childStudentIds)
      ? guardian.childStudentIds.map(String)
      : [];
    if (mine.indexOf(studentId) === -1) {
      return error(res, 'Guardians may only access their own children', 403, { code: 'OWNERSHIP_DENIED' });
    }
    // The student must still resolve inside the trusted tenant; an id on the
    // list that no longer resolves answers 404, never an empty success.
    const student = studentService.getStudent({ tenantId }, studentId);
    if (!student) return error(res, 'Student not found', 404);

    const items = notificationsService.buildStudentNotifications({ tenantId }, student.id);
    success(res, { studentId: String(student.id), items }, 'Notifications retrieved');
  } catch (err) {
    logger.error('educationNotifications.getChildNotifications error:', err.message);
    error(res, 'Failed to retrieve notifications', 500);
  }
}

module.exports = { getMyNotifications, getChildNotifications };