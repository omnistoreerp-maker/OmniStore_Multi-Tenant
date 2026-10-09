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
// reference, 404 not found or cross-tenant, 409 duplicate classCode, 403
// OWNERSHIP_DENIED when a LINKED teacher touches a Class they do not teach, 500
// unexpected only. Stack traces, tenant identifiers, storage details and
// secrets are never returned.
//
// TEACHER OWNERSHIP - `req.teacherActor` is the teacher record linked to the
// signed-in account (attached server-side by middleware/teacherActor). When it
// is set:
//   - listClasses is force-scoped to that teacher (the query `teacherId` is
//     overridden, never trusted);
//   - getClass / updateClass / archiveClass refuse anyone else's Class with
//     403 OWNERSHIP_DENIED;
//   - createClass stamps the linked teacher as `teacherId`, whatever the body
//     asked for — the server decides who teaches a class a teacher creates.
// Unlinked callers (Owner/Admin/Manager role gate, operators) are unchanged.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const classService = require('../services/class.service');
const courseService = require('../services/course.service');
const centerOwnership = require('../middleware/centerOwnership');
const studentOwnership = require('../middleware/studentOwnership');
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

function _ownership403(res, message) {
  error(res, message, 403, { code: 'OWNERSHIP_DENIED' });
}

// CENTER OWNERSHIP — the server-resolved `req.centerActor.id` (never a
// query/body value). A Class carries no center of its own: it resolves
// through its required Course (Class -> Course -> Program.centerId). A linked
// center sees only its own classes. Unlinked callers (operators) are
// unchanged, and any teacher narrowing composes by intersection.
function _centerId(req) {
  return req && req.centerActor && req.centerActor.id ? String(req.centerActor.id) : '';
}

// STUDENT SELF-SCOPE — the server-resolved `req.educationStudent.id` (never a
// query/body value). A Class belongs to a student only THROUGH an Enrollment,
// so a LINKED student sees only the classes they are enrolled in. The
// post-filter runs after the query filters and after any teacher/center
// narrowing (intersection), so no query key can widen past the self scope.
// Unlinked callers (operators) are unchanged.
function _studentId(req) {
  return req && req.educationStudent && req.educationStudent.id ? String(req.educationStudent.id) : '';
}

function _studentOwnsClass(req, tenantId, classId) {
  const studentId = _studentId(req);
  if (!studentId) return false;
  return studentOwnership.studentOwnsClass(tenantId, classId, studentId);
}

function listClasses(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Only the declared filters are honoured; any other query key is ignored.
    // `programId` is a derived filter resolved through the Course by the
    // service - it is never stored on a Class. A LINKED teacher's list is
    // force-scoped: the query `teacherId` is overridden by the linked record.
    const filters = {
      status: req.query ? req.query.status : undefined,
      courseId: req.query ? req.query.courseId : undefined,
      teacherId: req.query ? req.query.teacherId : undefined,
      programId: req.query ? req.query.programId : undefined,
      search: req.query ? req.query.search : undefined
    };
    if (req.teacherActor) filters.teacherId = String(req.teacherActor.id);
    let rows = classService.listClasses({ tenantId }, filters);
    // A LINKED center's list is narrowed to its own classes. The post-filter
    // composes with the teacher override above (intersection).
    if (_centerId(req)) {
      const allowed = centerOwnership.centerClassIds(tenantId, _centerId(req));
      rows = rows.filter((c) => c && allowed.has(String(c.id)));
    }
    // A LINKED student's list is narrowed to their OWN classes. The
    // post-filter runs LAST, so no filter above can widen past the self scope.
    if (_studentId(req)) {
      const allowed = studentOwnership.studentClassIds(tenantId, _studentId(req));
      rows = rows.filter((c) => c && allowed.has(String(c.id)));
    }
    success(res, rows, 'Classes retrieved');
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
    // Same-tenant, other-teacher Class: refused as forbidden — a linked
    // teacher only ever reads the rows they teach.
    if (req.teacherActor && String(found.teacherId) !== String(req.teacherActor.id)) {
      return _ownership403(res, 'Teachers may only access their own classes');
    }
    // Same-tenant Class of another center: refused as forbidden — a linked
    // center only ever reads its own classes.
    if (_centerId(req) && !centerOwnership.centerOwnsClass(tenantId, found.id, _centerId(req))) {
      return _ownership403(res, 'Centers may only access their own classes');
    }
    // Same-tenant Class the linked student is NOT enrolled in: refused as
    // forbidden (404 already won across tenants).
    if (_studentId(req) && !_studentOwnsClass(req, tenantId, found.id)) {
      return _ownership403(res, 'Students may only access classes they are enrolled in');
    }
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
    // stamps the trusted tenantId. A LINKED teacher creating a class has the
    // `teacherId` stamped by the server: whoever they tried to name is
    // overridden — a teacher creates their own classes, not someone else's.
    const body = { ...(req.body || {}) };
    if (req.teacherActor) body.teacherId = String(req.teacherActor.id);
    // A LINKED center schedules only INTO its own center: a courseId that
    // resolves to a known other-center course is refused here with 403, while
    // an unresolvable courseId falls through to the service's 400 so this
    // check never becomes an existence oracle.
    if (_centerId(req) && body.courseId !== undefined && body.courseId !== null &&
        String(body.courseId).trim() !== '') {
      const target = courseService.getCourse({ tenantId }, body.courseId);
      if (target && centerOwnership.courseCenterId(tenantId, target.id) !== _centerId(req)) {
        return _ownership403(res, 'Centers may only create classes in their own center');
      }
    }
    const created = classService.createClass({ tenantId }, body);
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
    // A LINKED teacher may only correct their own Class: the row is loaded
    // first so a foreign same-tenant Class is refused BEFORE anything runs.
    if (req.teacherActor) {
      const existing = classService.getClass({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Class not found', 404);
      if (String(existing.teacherId) !== String(req.teacherActor.id)) {
        return _ownership403(res, 'Teachers may only edit their own classes');
      }
    }
    // A LINKED center edits only its own classes (load-first 404/403), and
    // may not move a class under another center's course via the body.
    if (_centerId(req)) {
      const existing = classService.getClass({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Class not found', 404);
      if (!centerOwnership.centerOwnsClass(tenantId, existing.id, _centerId(req))) {
        return _ownership403(res, 'Centers may only edit their own classes');
      }
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      if (body.courseId !== undefined && body.courseId !== null && String(body.courseId).trim() !== '') {
        const target = courseService.getCourse({ tenantId }, body.courseId);
        if (target && centerOwnership.courseCenterId(tenantId, target.id) !== _centerId(req)) {
          return _ownership403(res, 'Centers may not move classes to another center');
        }
      }
    }
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
    // Archiving is a write on a row: a LINKED teacher archives only their own
    // Class, with the same load-first 404/403 ordering as the update path.
    if (req.teacherActor) {
      const existing = classService.getClass({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Class not found', 404);
      if (String(existing.teacherId) !== String(req.teacherActor.id)) {
        return _ownership403(res, 'Teachers may only archive their own classes');
      }
    }
    // A LINKED center archives only its own classes (load-first 404/403).
    if (_centerId(req)) {
      const existing = classService.getClass({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Class not found', 404);
      if (!centerOwnership.centerOwnsClass(tenantId, existing.id, _centerId(req))) {
        return _ownership403(res, 'Centers may only archive their own classes');
      }
    }
    const archived = classService.archiveClass({ tenantId }, req.params.id);
    if (!archived) return error(res, 'Class not found', 404);
    success(res, archived, 'Class archived');
  } catch (err) {
    logger.error('class.archiveClass error:', err.message);
    error(res, 'Failed to archive class', 500);
  }
}

module.exports = { listClasses, getClass, createClass, updateClass, archiveClass };
