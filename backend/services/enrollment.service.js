'use strict';

// enrollment.service.js - STU-7 Education Enrollment records (Device 2).
//
// Follows the STU-2 student / STU-3 teacher / STU-4 center / STU-5 program and
// course / STU-6 class service pattern deliberately rather than introducing a
// shared Education repository helper.
//
// DOMAIN SHAPE.
//   Tenant -> Student, Tenant -> Center -> Program -> Course -> Class -> Enrollment,
//   plus Teacher participating in Class.
//
//   Enrollment is the RELATIONSHIP between a Student and a Class. It owns that
//   edge and nothing else: no student array on Student, no class array on Class.
//   Storing the two sides on their parents is exactly the fan-out this entity
//   exists to prevent, and it is why none of the other Education services grows
//   a `studentIds` / `classIds` field.
//
//   The relationship is a HISTORICAL FACT and is therefore IMMUTABLE after
//   creation. `studentId` and `classId` can never be reassigned and can never be
//   cleared — not even to another same-tenant pair. Moving a student to another
//   class is two events, never an edit: withdraw this Enrollment and create a
//   new one. The old row survives with its original `enrolledAt` and
//   `withdrawnAt`, so the store becomes an enrollment HISTORY that a future
//   Attendance or grading entity can reference by a stable `enrollmentId`
//   without any risk of that reference being silently invalidated.
//
//   Nothing is denormalized. `courseId`, `programId`, `teacherId`, `centerId`
//   and `academicYear` are all DERIVED through `classId` and are refused on
//   write. A second reference could silently disagree with the Class, so
//   contradictory relationship state is made structurally impossible.
//
//   The Class is the authoritative parent for eligibility and it is the ONLY
//   thing checked. Course, Program, Center and Teacher behind the Class are
//   deliberately NEVER re-walked: STU-6 established that a Class stays readable
//   after any of them is archived, and an existing Enrollment must survive
//   exactly that. Re-validating the chain would retroactively invalidate
//   Enrollments already attached to a readable Class, and `class.service.js`
//   exposes no public primitive for it (its Course/Program guard is module
//   private). Eligibility is therefore exactly: the parent exists, belongs to
//   the trusted tenant, and is not `archived`.
//
//   LIFECYCLE. Exactly two states: `active` and `withdrawn`. Unlike the five
//   directory entities, which are long-lived rows with a general-purpose retire
//   verb, an Enrollment's whole life is "established, then ended" — so there is
//   one terminal state and one rule for releasing the (student, class) slot.
//   `inactive` and `archived` are deliberately absent: they would give the
//   domain two different ways to release that slot with no rule to choose
//   between them. Financial, grading, attendance and scheduling states (paid,
//   unpaid, completed, cancelled, scheduled, attended, graduated) are absent
//   because no repository evidence requires them; they belong to later phases.
//
//   There is NO delete and NO un-withdraw. `status` and `withdrawnAt` are
//   written together in exactly two code paths — create (`active`/null) and
//   withdraw (`withdrawn`/now) — so the two can never disagree, and neither is
//   client-writable. `enrolledAt` is likewise server-owned: no back-dating.
//
//   UNIQUENESS. At most one ACTIVE Enrollment per (tenantId, studentId,
//   classId). A withdrawn row releases the pair, so re-enrollment creates a NEW
//   row with a new id and a new `enrolledAt` while the withdrawn row remains.
//   There is no generated enrollmentCode: the pair already identifies the
//   record, and a synthetic code would add a second uniqueness mechanism with
//   no business meaning.
//
// Tenant isolation is structural, not incidental:
//   - The tenant comes ONLY from the trusted server-side context the
//     controller passes in (built by the canonical `trustedTenantId(req)`).
//     It is NEVER read from req.query.tenantId, req.body.tenantId, a
//     `tenantId` header, a `companyId` header, or a `branchId` header.
//   - With no trusted tenant every public method throws 'Tenant context is
//     required'.
//   - tenantId is SERVER-OWNED and IMMUTABLE: stamped on create and
//     re-asserted on every update and withdrawal.
//   - BOTH parents are resolved with that same trusted tenant, so a foreign
//     Student or Class can never be used to create or mutate an Enrollment.
//   - A parent belonging to another tenant is indistinguishable from one that
//     does not exist, so cross-tenant relationships fail closed without leaking
//     existence.
//   - EXPLICIT FIELD WHITELIST. Client payloads are never spread into a
//     persisted record.
//
// SCOPE — the Student/Class membership edge ONLY. No attendance, grading, exam,
// scheduling, guardian, certificate, payment, tuition, billing, salary or
// payroll field. Archiving or withdrawing an Enrollment never cascades:
// Students, Classes, Courses, Programs, Teachers and Centers are only ever
// READ here, never written.

const storageAdapter = require('../repositories/storageAdapter');
const studentService = require('./student.service');
const classService = require('./class.service');
const courseService = require('./course.service');
const logger = require('../utils/logger');

const STORE_KEY = 'educationEnrollments';

// The complete lifecycle. `withdrawn` is the ONLY terminal state; there is
// deliberately no `inactive`, no `archived` and no scheduling, grading or
// financial state.
const ENROLLMENT_STATUSES = Object.freeze(['active', 'withdrawn']);

// EXPLICIT WRITE WHITELIST. `studentId` and `classId` are accepted ONLY on
// create: they are immutable thereafter, which `_validateEnrollment` enforces
// with an own-property check so an omitted field is never confused with a
// falsy one. `notes` is the single field `updateEnrollment` will persist.
const WRITABLE_FIELDS = Object.freeze({
  studentId: 'string',
  classId: 'string',
  notes: 'string'
});

// Server-owned fields a client may never set. `status` joins the usual eight
// because the lifecycle is server-owned: an Enrollment is never reactivated or
// retired by a client write.
const FORBIDDEN_FIELDS = Object.freeze([
  'id',
  'tenantId',
  'companyId',
  'branchId',
  'userId',
  'ownerUserId',
  'createdAt',
  'updatedAt',
  'status',
  'enrolledAt',
  'withdrawnAt'
]);

// Fields owned by later phases, or that would duplicate a DERIVED relationship.
// `courseId` / `programId` / `teacherId` / `centerId` / `academicYear` are
// included on purpose: everything behind the Class is derived through classId,
// and a second reference could silently disagree with it.
const LATER_PHASE_FIELDS = Object.freeze([
  'courseId',
  'programId',
  'teacherId',
  'centerId',
  'academicYear',
  'studentIds',
  'classIds',
  'attendance',
  'attendanceId',
  'attendanceIds',
  'grade',
  'grades',
  'score',
  'exam',
  'exams',
  'result',
  'mark',
  'payment',
  'tuition',
  'billing',
  'invoice',
  'salary',
  'payroll',
  'schedule',
  'scheduling',
  'dayOfWeek',
  'startTime',
  'endTime',
  'room',
  'recurrence',
  'capacity',
  'certificate',
  'guardianId',
  'guardianIds'
]);

// Maximum length applied to every string field.
const MAX_STRING_LEN = 160;

// Raised when an ACTIVE enrollment already exists for the same
// (tenant, student, class) triple. The controller maps this to 409 with the
// repository's `{ code }` details convention.
class EnrollmentConflictError extends Error {
  constructor(studentId, classId) {
    super('an active enrollment already exists for this student and class');
    this.name = 'EnrollmentConflictError';
    this.code = 'ENROLLMENT_CONFLICT';
    this.studentId = studentId;
    this.classId = classId;
    this.conflict = true;
  }
}

// Raised when a relationship reference cannot be resolved inside the trusted
// tenant. The controller maps this to 400 with a `details` list.
class ReferenceValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReferenceValidationError';
    this.validation = [message];
  }
}

function _defaultDoc() {
  return { enrollments: [] };
}

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('enrollment.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(doc) {
  try {
    storageAdapter.write(STORE_KEY, doc);
  } catch (err) {
    logger.warn('enrollment.service: failed to write store', err.message);
  }
}

// The ONLY tenant source in this file: the trusted context object handed in
// by the controller. Returns null when absent - never a default, never a
// fallback.
function _tenantId(tenantContext) {
  if (!tenantContext) return null;
  const t = tenantContext.tenantId || tenantContext.id;
  if (t === undefined || t === null || String(t) === '') return null;
  return String(t);
}

function _requireTenantId(tenantContext) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required');
  return tid;
}

let _lastNowMs = 0;

function _now() {
  const nowMs = Date.now();
  _lastNowMs = Math.max(nowMs, _lastNowMs + 1);
  return new Date(_lastNowMs).toISOString();
}

function _generateId(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

function _enrollments(doc) {
  return Array.isArray(doc.enrollments) ? doc.enrollments : [];
}

// Returns a fresh object built only from whitelisted keys.
function _sanitizeWritable(payload) {
  const src = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
  const clean = {};
  for (const key of Object.keys(WRITABLE_FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    const value = src[key];
    if (value === null) {
      clean[key] = '';
      continue;
    }
    if (typeof value !== 'string') throw new Error(key + ' must be a string');
    clean[key] = value.trim().slice(0, MAX_STRING_LEN);
  }
  return clean;
}

// Returns an array of human-readable errors, or an empty array when valid.
// `forCreate` is true for create and false for the notes-only update.
function _validateEnrollment(data, forCreate) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }

  if (forCreate) {
    if (data.studentId === undefined || data.studentId === null || String(data.studentId).trim() === '') {
      errors.push('studentId is required');
    }
    if (data.classId === undefined || data.classId === null || String(data.classId).trim() === '') {
      errors.push('classId is required');
    }
  }

  // IMMUTABILITY. Once the relationship exists it is a historical fact: it is
  // never reassigned and never cleared. This is an OWN-PROPERTY check on the
  // raw payload, not a truthiness test, so null, undefined, '' and '   ' are
  // all caught as attempts to change the relationship rather than being
  // mistaken for an omission. A genuinely omitted studentId/classId never
  // reaches this branch and the stored relationship is untouched.
  if (!forCreate) {
    for (const key of ['studentId', 'classId']) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        errors.push(key + ' cannot be changed');
      }
    }
  }

  if (data.notes !== undefined && data.notes !== null) {
    if (typeof data.notes !== 'string') {
      errors.push('notes must be a string');
    } else if (data.notes.length > MAX_STRING_LEN) {
      errors.push('notes must be at most ' + MAX_STRING_LEN + ' characters');
    }
  }

  // Reject prototype-pollution payloads.
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      errors.push(key + ' is not allowed');
    }
  }

  // Server-owned fields must never be writable from client input.
  for (const forbidden of FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, forbidden)) {
      errors.push(forbidden + ' is not writable');
    }
  }

  // Later-phase and duplicate-ownership relationships are refused outright.
  for (const later of LATER_PHASE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, later)) {
      errors.push(later + ' is not writable');
    }
  }

  return errors;
}

// Look up an enrollment by id AND trusted tenant. Returns -1 when absent, never
// leaking cross-tenant existence.
function _findIndexByTenant(enrollments, id, tenantId) {
  return enrollments.findIndex(
    e => String(e.id || '') === String(id) && String(e.tenantId || '') === tenantId
  );
}

// The REQUIRED Student reference, resolved through the existing public
// student.service API. It must exist inside the trusted tenant and must not be
// archived. An `inactive` Student is still eligible. A foreign Student is
// indistinguishable from a missing one. Students are only ever read.
function _assertStudentInTenant(tenantId, studentId) {
  const id = String(studentId || '').trim();
  if (!id) return;
  const found = studentService.getStudent({ tenantId }, id);
  if (!found) throw new ReferenceValidationError('studentId does not reference a Student in this tenant');
  if (found.status === 'archived') {
    throw new ReferenceValidationError('studentId must reference a non-archived Student');
  }
}

// The REQUIRED Class reference, resolved through the existing public
// class.service API. It must exist inside the trusted tenant and must not be
// archived. An `inactive` Class is still eligible.
//
// The Class is the authoritative parent, and NOTHING behind it is consulted:
// no courseService, no programService, no teacherService, no centerService. A
// Class that stays readable after its Course, Program, Center or Teacher is
// archived keeps its existing Enrollments valid, so this check is exactly
// "exists, same tenant, not archived".
function _assertClassInTenant(tenantId, classId) {
  const id = String(classId || '').trim();
  if (!id) return;
  const found = classService.getClass({ tenantId }, id);
  if (!found) throw new ReferenceValidationError('classId does not reference a Class in this tenant');
  if (found.status === 'archived') {
    throw new ReferenceValidationError('classId must reference a non-archived Class');
  }
}

// At most one ACTIVE enrollment per (tenant, student, class). Withdrawn rows are
// excluded, which is what releases the pair for re-enrollment. There is no
// global constraint and no generated code.
function _assertPairAvailable(enrollments, tenantId, studentId, classId) {
  const sid = String(studentId || '').trim();
  const cid = String(classId || '').trim();
  const clash = enrollments.find(e =>
    String(e.tenantId || '') === tenantId &&
    String(e.studentId || '') === sid &&
    String(e.classId || '') === cid &&
    e.status === 'active'
  );
  if (clash) throw new EnrollmentConflictError(sid, cid);
}

function _searchMatch(record, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  // Enrollment has no textual identity (no name, no code): `notes` is the only
  // free-text field it legitimately owns.
  return String(record.notes || '').toLowerCase().includes(q);
}

function _validationError(errors) {
  const err = new Error(errors.join('; '));
  err.validation = errors;
  return err;
}

function _present(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

// Resolves the DERIVED filters `courseId`, `teacherId` and `programId` WITHOUT
// storing any of them: the tenant's Classes are read ONCE, the Program's
// Courses are read ONCE, and the result is the Set of Class ids the caller may
// see. An unknown or foreign value yields an empty Set, hence an empty list,
// which is also the correct non-leaking answer. `getClass()` / `getCourse()`
// are never called per enrollment.
function _classIdFilter(tenantId, f) {
  const wantsCourse = _present(f.courseId);
  const wantsTeacher = _present(f.teacherId);
  const wantsProgram = _present(f.programId);
  if (!wantsCourse && !wantsTeacher && !wantsProgram) return null;

  const cid = wantsCourse ? String(f.courseId).trim() : null;
  const teacherId = wantsTeacher ? String(f.teacherId).trim() : null;
  const programId = wantsProgram ? String(f.programId).trim() : null;

  let programCourseIds = null;
  if (programId) {
    const courseList = courseService.listCourses({ tenantId }) || [];
    programCourseIds = new Set(
      courseList
        .filter(c => String(c.programId || '').trim() === programId)
        .map(c => String(c.id || ''))
    );
  }

  const classes = classService.listClasses({ tenantId }) || [];
  const allowed = new Set();
  for (const c of classes) {
    if (cid && String(c.courseId || '').trim() !== cid) continue;
    if (teacherId && String(c.teacherId || '').trim() !== teacherId) continue;
    if (programCourseIds && !programCourseIds.has(String(c.courseId || '').trim())) continue;
    allowed.add(String(c.id || ''));
  }
  return allowed;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function listEnrollments(tenantContext, filters) {
  const tid = _requireTenantId(tenantContext);
  const f = (filters && typeof filters === 'object') ? filters : {};
  let enrollments = _enrollments(_readStore()).filter(e => String(e.tenantId || '') === tid);

  if (_present(f.status)) {
    const st = String(f.status).trim();
    if (ENROLLMENT_STATUSES.includes(st)) {
      enrollments = enrollments.filter(e => e.status === st);
    }
  }
  if (_present(f.studentId)) {
    const sid = String(f.studentId).trim();
    enrollments = enrollments.filter(e => String(e.studentId || '') === sid);
  }
  if (_present(f.classId)) {
    const cid = String(f.classId).trim();
    enrollments = enrollments.filter(e => String(e.classId || '') === cid);
  }
  if (_present(f.search)) {
    const q = String(f.search).trim();
    enrollments = enrollments.filter(e => _searchMatch(e, q));
  }
  const allowedClasses = _classIdFilter(tid, f);
  if (allowedClasses) {
    enrollments = enrollments.filter(e => allowedClasses.has(String(e.classId || '')));
  }

  // Enrollment has no name to sort by, so it is ordered chronologically — the
  // order an enrollment history is read in — with id as a deterministic
  // tie-breaker for rows created in the same millisecond.
  enrollments.sort((x, y) => {
    const a = String(x.enrolledAt || '');
    const b = String(y.enrolledAt || '');
    if (a !== b) return a < b ? -1 : 1;
    return String(x.id || '').localeCompare(String(y.id || ''));
  });
  return enrollments.map(e => ({ ...e }));
}

function getEnrollment(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const enrollments = _enrollments(_readStore());
  const idx = _findIndexByTenant(enrollments, id, tid);
  if (idx < 0) return null;
  return { ...enrollments[idx] };
}

function createEnrollment(tenantContext, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateEnrollment(input, true);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const enrollments = _enrollments(doc);

  // Parents first, then uniqueness, then the write. A rejected Student or Class
  // therefore never reaches the store and never leaves a row behind.
  const studentId = String(clean.studentId).trim();
  const classId = String(clean.classId).trim();
  _assertStudentInTenant(tid, studentId);
  _assertClassInTenant(tid, classId);
  _assertPairAvailable(enrollments, tid, studentId, classId);

  const now = _now();
  const record = {
    id: _generateId('enr'),
    tenantId: tid,
    studentId,
    classId,
    status: 'active',
    enrolledAt: now,
    withdrawnAt: null,
    notes: clean.notes || '',
    createdAt: now,
    updatedAt: now
  };
  enrollments.push(record);
  _writeStore({ ...doc, enrollments });
  return { ...record };
}

// Updates `notes` and nothing else. The relationship is immutable, so there is
// no parent re-validation to run here and no way for this call to move a row
// between students or classes. A rejected payload never reaches the store.
function updateEnrollment(tenantContext, id, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateEnrollment(input, false);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const enrollments = _enrollments(doc);
  const idx = _findIndexByTenant(enrollments, id, tid);
  if (idx < 0) return null;

  const base = { ...enrollments[idx] };
  const next = {
    ...base,
    id: base.id,
    tenantId: tid,
    studentId: base.studentId,
    classId: base.classId,
    status: base.status,
    enrolledAt: base.enrolledAt,
    withdrawnAt: base.withdrawnAt,
    notes: Object.prototype.hasOwnProperty.call(clean, 'notes') ? clean.notes : base.notes,
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  enrollments[idx] = next;
  _writeStore({ ...doc, enrollments });
  return { ...next };
}

// Withdraw is the ONLY terminal operation. The row is PRESERVED, never deleted,
// so a future Attendance or grading record can keep referencing it. It never
// cascades: Students, Classes, Courses, Programs, Teachers and Centers are
// untouched.
//
// Idempotent, following the STU-2..STU-6 archive convention: a repeated
// withdrawal leaves the record withdrawn and — critically — preserves the
// ORIGINAL `withdrawnAt`, so the end of the enrollment window is never moved
// by a retried request. `enrolledAt` is likewise never rewritten, which is what
// keeps the historical window intact. A withdrawn Enrollment stays readable and
// its `notes` remain editable; it can never be reactivated.
function withdrawEnrollment(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const doc = _readStore();
  const enrollments = _enrollments(doc);
  const idx = _findIndexByTenant(enrollments, id, tid);
  if (idx < 0) return null;

  const base = { ...enrollments[idx] };
  const now = _now();
  const next = {
    ...base,
    id: base.id,
    tenantId: tid,
    studentId: base.studentId,
    classId: base.classId,
    status: 'withdrawn',
    enrolledAt: base.enrolledAt,
    withdrawnAt: base.withdrawnAt || now,
    createdAt: base.createdAt,
    updatedAt: now
  };
  enrollments[idx] = next;
  _writeStore({ ...doc, enrollments });
  return { ...next };
}

module.exports = {
  listEnrollments,
  getEnrollment,
  createEnrollment,
  updateEnrollment,
  withdrawEnrollment,
  ENROLLMENT_STATUSES,
  WRITABLE_FIELDS,
  FORBIDDEN_FIELDS,
  LATER_PHASE_FIELDS,
  EnrollmentConflictError,
  ReferenceValidationError,
  STORE_KEY
};
