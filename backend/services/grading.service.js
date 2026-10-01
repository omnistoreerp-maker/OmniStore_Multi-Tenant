'use strict';

// grading.service.js - STU-10 Education Grading records (Device 2).
//
// Follows the STU-2 student / STU-3 teacher / STU-4 center / STU-5 program and
// course / STU-6 class / STU-7 enrollment / STU-8 attendance / STU-9 scheduling
// service pattern deliberately rather than introducing a shared Education
// repository helper.
//
// DOMAIN SHAPE.
//   Enrollment is the authoritative historical relationship between a Student
//   and a Class. A grade is the outcome recorded for ONE Enrollment, and it
//   therefore stores exactly ONE reference: `enrollmentId`.
//
//   Nothing else is stored. `studentId` and `classId` are read off the
//   Enrollment when they are needed and are never copied here; `courseId`,
//   `programId`, `teacherId` and `centerId` are not even reachable, because the
//   Class chain behind an Enrollment is deliberately never walked - the same
//   rule STU-7 established and STU-8 kept.
//
//   `enrollmentId` is the right handle for the same reason STU-8 chose it: it is
//   immutable, so a grade can never be re-pointed at another student or class,
//   and it is the ONLY handle that survives a withdraw + re-enroll cycle. The
//   two stints are two enrollment ids, so each term keeps its own grade.
//
// GRADING VALUE - ONE CANONICAL FIELD, NO SCALE.
//   The repository contains NO grading scale of any kind: no percentage, no
//   letter grade, no GPA, no point total, no pass/fail threshold, no weighted
//   average and no conversion helper anywhere (verified repo-wide). STU-8's
//   attendance enum is a set of descriptive OUTCOME states, not marks, and the
//   only other grading-adjacent field in the codebase is Class `level`
//   ('B2'), which names a course level and is not a mark.
//
//   So STU-10 stores exactly ONE canonical value, `grade`: a bounded,
//   trimmed, non-empty string, recorded verbatim as the institution writes it.
//   It is deliberately descriptive-only, exactly like `teacher.employmentType`
//   and `center.timezone`. It carries NO unit, NO scale, NO threshold, NO
//   pass/fail meaning, NO aggregation and NO arithmetic: this service never
//   compares, converts, averages or ranks grades, because the repository
//   defines no scale against which such an operation would be meaningful.
//   Inventing one here would silently create a grading engine that no tenant
//   contract asked for.
//
//   `score`, `mark`, `result`, `grades`, `exam` and `exams` therefore REMAIN
//   refused. They are not synonyms of `grade`: they are the vocabulary of a
//   per-assessment result model, which needs an assessment identity the
//   repository does not have. Accepting them here would create a second,
//   disagreeable opinion about the same outcome.
//
// GRANULARITY - ONE GRADE PER ENROLLMENT.
//   At most one row per (tenantId, enrollmentId), surfaced as a typed
//   GRADING_CONFLICT the controller maps to 409.
//
//   This is the smallest deterministic rule the repository supports. There is
//   no assessment, exam, assignment or coursework entity, so there is nothing
//   that could identify a SECOND grade for the same enrollment: a date is not
//   an identity, and allowing several rows per enrollment would silently invent
//   a per-assessment list keyed by a date. Where a tenant genuinely needs a
//   second mark for the same enrollment (a resit, a term split, a re-mark),
//   STU-7 already provides the honest model - withdraw and re-enroll, which
//   yields a second enrollment id and therefore a second independent grade.
//
// DATE - client-supplied, date-only, strict `YYYY-MM-DD`.
//   Identical in discipline to STU-8: a timestamp, a localized format or an
//   impossible calendar date is rejected outright, nothing is normalized, and
//   the date is never derived from the server clock. No timezone is stored and
//   none is interpreted - `gradingDate` is an opaque calendar day compared as a
//   string.
//
//   A grade records an evaluation that has ALREADY happened, so a future date is
//   refused - the same rule and the same reason as STU-8's `attendanceDate`.
//   There is no exam scheduling anywhere in the repository (STU-9 deliberately
//   refuses it), so there is no planned assessment a future date could name.
//
//   The ENROLLMENT WINDOW is deliberately NOT applied, which is the one
//   intentional divergence from STU-8. A term grade is routinely awarded AFTER
//   the enrollment is closed - withdrawal is often recorded once the final
//   result is known - and a historical term is frequently backfilled after the
//   fact. STU-8 can bound a daily register because a register genuinely cannot
//   precede the enrollment record; a grade has no such property, and
//   `enrolledAt` is the creation time of the ENROLLMENT ROW, not the first day
//   teaching actually happened. Bounding here would retroactively destroy real
//   academic history. The enrollment must EXIST in the trusted tenant; its
//   `status` and timestamps are never consulted, exactly as STU-8 never
//   cascades on an archived Student, Class, Course, Program, Teacher or Center.
//
// GRADING IS INDEPENDENT OF ATTENDANCE AND SCHEDULING.
//   No `sessionId`, no `scheduleId`, no attendance reference. A grade is a fact
//   about the enrollment; a session is a fact about the class. Coupling them
//   would require STU-9 to expose a grade-bearing session and STU-8 to expose a
//   grade-bearing register, and neither contract asks for it.
//
// LIFECYCLE - correction, not lifecycle.
//   A re-mark is the single most common real operation on a grade, so `grade`,
//   `gradingDate` AND `notes` are all mutable through PUT. There is no DELETE,
//   no /archive and no /withdraw, so a refused correction is the only failure
//   mode that has to leave the row byte-for-byte unchanged.
//
// IMMUTABILITY - only `enrollmentId`.
//   It is rejected with an OWN-PROPERTY check, so null, undefined, '' and
//   whitespace are all caught as attempts to change the relationship rather
//   than mistaken for an omission.
//
// Tenant isolation is structural, not incidental:
//   - The tenant comes ONLY from the trusted server-side context the controller
//     passes in (built by the canonical `trustedTenantId(req)`). It is NEVER
//     read from req.query.tenantId, req.body.tenantId, a `tenantId` header, a
//     `companyId` header, or a `branchId` header.
//   - With no trusted tenant every public method throws 'Tenant context is
//     required'.
//   - The Enrollment is resolved with that SAME trusted tenant, so a foreign
//     enrollment is indistinguishable from a missing one.
//   - tenantId is SERVER-OWNED and IMMUTABLE: stamped on create and
//     re-asserted on every update.
//   - EXPLICIT FIELD WHITELIST. Client payloads are never spread into a
//     persisted record.
//
// SCOPE - the recorded grade only. No assessment, exam, coursework, question
// bank, LMS, certificate, transcript, GPA, ranking, analytics, notification,
// guardian, financial, tuition, payroll or timezone field.

const storageAdapter = require('../repositories/storageAdapter');
const enrollmentService = require('./enrollment.service');
const logger = require('../utils/logger');

const STORE_KEY = 'educationGrading';

// Maximum length applied to the grade and notes fields.
const MAX_STRING_LEN = 160;

// EXPLICIT WRITE WHITELIST. `enrollmentId` is accepted ONLY on create; it is
// immutable thereafter, which `_validateGrading` enforces with an own-property
// check. `grade`, `gradingDate` and `notes` are correctable.
const WRITABLE_FIELDS = Object.freeze({
  enrollmentId: 'string',
  gradingDate: 'string',
  grade: 'string',
  notes: 'string'
});

// Strict calendar-date pattern. A timestamp, a localized format or a padded
// variant is rejected rather than coerced.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Server-owned fields a client may never set.
const FORBIDDEN_FIELDS = Object.freeze([
  'id',
  'tenantId',
  'companyId',
  'branchId',
  'userId',
  'ownerUserId',
  'createdAt',
  'updatedAt',
  'gradingId'
]);

// Derived ownership of another record, and fields owned by later phases.
//
// `grade` is deliberately ABSENT: STU-10 is that phase, and `grade` is the
// canonical stored value in WRITABLE_FIELDS above.
//
// The grading vocabulary that REMAINS here is not a synonym problem. `score`,
// `mark`, `result`, `grades`, `exam` and `exams` belong to a per-assessment
// result model that needs an assessment identity this repository does not have,
// so they stay refused rather than becoming a second opinion about the same
// outcome.
//
// `studentId` and `classId` are included deliberately: they are readable from
// the Enrollment on demand, and a stored copy could disagree with it.
const LATER_PHASE_FIELDS = Object.freeze([
  'studentId',
  'classId',
  'courseId',
  'programId',
  'teacherId',
  'centerId',
  'academicYear',
  'enrollmentIds',
  'gradingIds',
  'gradeId',
  'grades',
  'score',
  'scores',
  'marks',
  'exam',
  'exams',
  'result',
  'results',
  'mark',
  'assessment',
  'assessments',
  'assessmentId',
  'assignment',
  'assignments',
  'coursework',
  'questionBank',
  'gpa',
  'cgpa',
  'rank',
  'ranking',
  'percentile',
  'weight',
  'weighted',
  'total',
  'maximum',
  'maxScore',
  'pass',
  'passed',
  'fail',
  'failed',
  'percentage',
  'letterGrade',
  'gradePoint',
  'transcript',
  'certificate',
  'certificates',
  'attendance',
  'attendanceId',
  'attendanceIds',
  'sessionId',
  'scheduleId',
  'schedule',
  'scheduling',
  'dayOfWeek',
  'startTime',
  'endTime',
  'room',
  'recurrence',
  'guardianId',
  'guardianIds',
  'payment',
  'tuition',
  'billing',
  'invoice',
  'salary',
  'payroll',
  'lms',
  'zoom',
  'meetingUrl',
  'videoUrl',
  'notification',
  'notifications',
  'calendarSync',
  'timezone',
  'enrollmentStatus',
  'recordedBy',
  'gradedBy'
]);

// Raised when an enrollment already holds a grade. The controller maps this to
// 409 with the repository's `{ code }` details convention.
class GradingConflictError extends Error {
  constructor(enrollmentId) {
    super('grade already recorded for this enrollment');
    this.name = 'GradingConflictError';
    this.code = 'GRADING_CONFLICT';
    this.enrollmentId = enrollmentId;
    this.conflict = true;
  }
}

// Raised when the Enrollment reference cannot be resolved inside the trusted
// tenant, or when a date is not recordable. The controller maps this to 400 with
// a `details` list.
class ReferenceValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReferenceValidationError';
    this.validation = [message];
  }
}

function _defaultDoc() {
  return { grades: [] };
}

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('grading.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(doc) {
  try {
    storageAdapter.write(STORE_KEY, doc);
  } catch (err) {
    logger.warn('grading.service: failed to write store', err.message);
  }
}

// The ONLY tenant source in this file: the trusted context object handed in by
// the controller. Returns null when absent - never a default, never a
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

function _now() {
  return new Date().toISOString();
}

function _today() {
  return _now().slice(0, 10);
}

function _generateId(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

function _grades(doc) {
  return Array.isArray(doc.grades) ? doc.grades : [];
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
    // Typed as a VALIDATION error, not a bare Error: a non-string field is
    // malformed input and must map to 400, never to an opaque 500.
    if (typeof value !== 'string') throw _validationError([key + ' must be a string']);
    clean[key] = value.trim().slice(0, MAX_STRING_LEN);
  }
  return clean;
}

// A well-FORMATTED date is not automatically a real one: `2023-02-29` parses
// happily and silently rolls over to March 1. The round-trip through ISO is the
// only check that catches it without a calendar table. Identical to STU-8.
function _isRealCalendarDate(value) {
  const ms = Date.parse(value + 'T00:00:00.000Z');
  if (Number.isNaN(ms)) return false;
  return new Date(ms).toISOString().slice(0, 10) === value;
}

function _validationError(errors) {
  const err = new Error(errors.join('; '));
  err.validation = errors;
  return err;
}

// Returns an array of human-readable errors, or an empty array when valid.
// `forCreate` is true for create and false for the correction update.
function _validateGrading(data, forCreate) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }

  if (forCreate) {
    if (data.enrollmentId === undefined || data.enrollmentId === null || String(data.enrollmentId).trim() === '') {
      errors.push('enrollmentId is required');
    }
    if (data.gradingDate === undefined || data.gradingDate === null || String(data.gradingDate).trim() === '') {
      errors.push('gradingDate is required');
    }
    if (data.grade === undefined || data.grade === null || String(data.grade).trim() === '') {
      errors.push('grade is required');
    }
  }

  // IMMUTABILITY. Only the enrollment relationship is frozen. `grade`,
  // `gradingDate` and `notes` are correctable and are deliberately NOT checked
  // here.
  //
  // This is an OWN-PROPERTY check on the raw payload, not a truthiness test, so
  // null, undefined, '' and '   ' are all caught as attempts to change the
  // relationship rather than being mistaken for an omission.
  if (!forCreate && Object.prototype.hasOwnProperty.call(data, 'enrollmentId')) {
    errors.push('enrollmentId cannot be changed');
  }

  if (data.gradingDate !== undefined && data.gradingDate !== null) {
    if (typeof data.gradingDate !== 'string') {
      errors.push('gradingDate must be a string');
    } else if (data.gradingDate.trim() === '') {
      // On create this is the required-field check above. On a CORRECTION it is
      // what stops a re-mark from blanking the date: only an ABSENT field may
      // mean "leave it alone".
      if (!forCreate) errors.push('gradingDate cannot be empty');
    } else if (!DATE_PATTERN.test(data.gradingDate.trim())) {
      errors.push('gradingDate must be a date in YYYY-MM-DD format');
    } else if (!_isRealCalendarDate(data.gradingDate.trim())) {
      errors.push('gradingDate must be a real calendar date');
    }
  }

  // The canonical grading value. Deliberately a bounded, non-empty string: the
  // repository defines no scale, so nothing beyond "a value was recorded" is
  // asserted about it. There is no numeric range, no enum and no format check,
  // because any of those would invent a grading scale.
  //
  // The emptiness check runs on BOTH paths. On create it is the required-field
  // check above; on a CORRECTION it is what stops a re-mark from blanking the
  // outcome, since an omitted field and an explicitly empty one are different
  // intents and only the first may mean "leave it alone".
  if (data.grade !== undefined && data.grade !== null) {
    if (typeof data.grade !== 'string') {
      errors.push('grade must be a string');
    } else if (data.grade.trim() === '' && !forCreate) {
      // On create this is the required-field check above; on a correction it is
      // what stops a re-mark from blanking the outcome.
      errors.push('grade cannot be empty');
    } else if (data.grade.length > MAX_STRING_LEN) {
      errors.push('grade must be at most ' + MAX_STRING_LEN + ' characters');
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

  // Derived ownership and later-phase fields are refused outright.
  for (const later of LATER_PHASE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, later)) {
      errors.push(later + ' is not writable');
    }
  }

  return errors;
}

// Look up a grade by id AND trusted tenant. Returns -1 when absent, never
// leaking cross-tenant existence.
function _findIndexByTenant(records, id, tenantId) {
  return records.findIndex(
    g => String(g.id || '') === String(id) && String(g.tenantId || '') === tenantId
  );
}

// The REQUIRED Enrollment reference, resolved through the existing public
// enrollment.service API with the SAME trusted tenant. A foreign enrollment is
// indistinguishable from a missing one, and the Enrollment is only ever read:
// no Student, Class, Course, Program, Teacher or Center is consulted, and its
// status and timestamps are never used as a gate.
function _assertEnrollmentInTenant(tenantId, enrollmentId) {
  const id = String(enrollmentId || '').trim();
  if (!id) return null;
  const found = enrollmentService.getEnrollment({ tenantId }, id);
  if (!found) {
    throw new ReferenceValidationError('enrollmentId does not reference an Enrollment in this tenant');
  }
  return found;
}

// A grade records an evaluation that has already happened, so the future is not
// recordable - the same rule and the same reason as STU-8's attendanceDate.
function _assertNotFuture(gradingDate) {
  if (String(gradingDate).trim() > _today()) {
    throw new ReferenceValidationError('gradingDate cannot be in the future');
  }
}

// At most one grade per (tenant, enrollment). See GRANULARITY above: there is no
// assessment identity in the repository, so a second row for the same enrollment
// would have to invent one.
function _assertEnrollmentAvailable(records, tenantId, enrollmentId, excludeId) {
  const eid = String(enrollmentId).trim();
  const clash = records.find(g =>
    String(g.tenantId || '') === tenantId &&
    String(g.enrollmentId || '') === eid &&
    String(g.id || '') !== String(excludeId || '')
  );
  if (clash) throw new GradingConflictError(eid);
}

function _present(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function listGrading(tenantContext, filters) {
  const tid = _requireTenantId(tenantContext);
  const f = (filters && typeof filters === 'object') ? filters : {};
  let records = _grades(_readStore()).filter(g => String(g.tenantId || '') === tid);

  if (_present(f.enrollmentId)) {
    const eid = String(f.enrollmentId).trim();
    records = records.filter(g => String(g.enrollmentId || '') === eid);
  }
  if (_present(f.gradingDate)) {
    const day = String(f.gradingDate).trim();
    records = records.filter(g => String(g.gradingDate || '').trim() === day);
  }
  if (_present(f.dateFrom)) {
    const from = String(f.dateFrom).trim();
    records = records.filter(g => String(g.gradingDate || '').trim() >= from);
  }
  if (_present(f.dateTo)) {
    const to = String(f.dateTo).trim();
    records = records.filter(g => String(g.gradingDate || '').trim() <= to);
  }
  if (_present(f.grade)) {
    // EXACT match on the stored value. No case folding and no normalization is
    // applied: the grade is recorded verbatim, so filtering must not invent a
    // comparison rule the record never went through.
    const value = String(f.grade).trim();
    records = records.filter(g => String(g.grade || '').trim() === value);
  }

  // DERIVED filters. `studentId` and `classId` are NOT stored on a grade row;
  // they are resolved through the Enrollment with at most two BATCHED list
  // calls - never one getEnrollment() per row, so there is no N+1 pattern. An
  // unknown or foreign value yields an empty Set, hence an empty list, which is
  // also the correct non-leaking answer.
  const wantsStudent = _present(f.studentId);
  const wantsClass = _present(f.classId);
  if (wantsStudent || wantsClass) {
    let allowed = null;
    if (wantsStudent) {
      allowed = new Set(
        (enrollmentService.listEnrollments({ tenantId: tid }, { studentId: String(f.studentId).trim() }) || [])
          .map(e => String(e.id || ''))
      );
    }
    if (wantsClass) {
      const byClass = new Set(
        (enrollmentService.listEnrollments({ tenantId: tid }, { classId: String(f.classId).trim() }) || [])
          .map(e => String(e.id || ''))
      );
      allowed = allowed ? new Set([...allowed].filter(id => byClass.has(id))) : byClass;
    }
    records = records.filter(g => allowed.has(String(g.enrollmentId || '')));
  }

  // Chronological by grading date, with id as a deterministic tie-breaker for
  // rows sharing a day. A grade list reads by when the outcome was recorded,
  // which is the only ordering this model has.
  records.sort((x, y) => {
    const a = String(x.gradingDate || '');
    const b = String(y.gradingDate || '');
    if (a !== b) return a < b ? -1 : 1;
    return String(x.id || '').localeCompare(String(y.id || ''));
  });
  return records.map(g => ({ ...g }));
}

function getGrade(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const records = _grades(_readStore());
  const idx = _findIndexByTenant(records, id, tid);
  if (idx < 0) return null;
  return { ...records[idx] };
}

function createGrade(tenantContext, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateGrading(input, true);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const records = _grades(doc);

  // Parent first, then date, then uniqueness, then the write. A rejected
  // enrollment or date therefore never reaches the store and never leaves a row
  // behind.
  const enrollmentId = String(clean.enrollmentId).trim();
  const gradingDate = String(clean.gradingDate).trim();
  _assertEnrollmentInTenant(tid, enrollmentId);
  _assertNotFuture(gradingDate);
  _assertEnrollmentAvailable(records, tid, enrollmentId);

  const now = _now();
  const record = {
    id: _generateId('grd'),
    tenantId: tid,
    enrollmentId,
    gradingDate,
    grade: String(clean.grade).trim(),
    notes: clean.notes || '',
    createdAt: now,
    updatedAt: now
  };
  records.push(record);
  _writeStore({ ...doc, grades: records });
  return { ...record };
}

// Correction. `grade`, `gradingDate` and `notes` are mutable; the enrollment
// relationship is not. A supplied date is re-validated end to end (format and
// calendar were already checked, so: not future, and the enrollment still holds
// no other grade), and because every check runs BEFORE the merge and before the
// write, a refused correction leaves the persisted row byte-for-byte unchanged
// - including its id, tenantId, enrollmentId, gradingDate and createdAt.
function updateGrade(tenantContext, id, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateGrading(input, false);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const records = _grades(doc);
  const idx = _findIndexByTenant(records, id, tid);
  if (idx < 0) return null;

  const base = { ...records[idx] };
  // The parent is re-resolved on every correction so a grade can never be
  // touched once its enrollment has become unresolvable in this tenant, and so a
  // partial correction is validated against the same parent a full one would be.
  _assertEnrollmentInTenant(tid, base.enrollmentId);

  const nextDate = Object.prototype.hasOwnProperty.call(clean, 'gradingDate')
    ? String(clean.gradingDate).trim()
    : String(base.gradingDate).trim();
  _assertNotFuture(nextDate);
  // Uniqueness re-runs against the FULL corrected slot, not only when the date
  // changed, and the record being corrected is excluded.
  _assertEnrollmentAvailable(records, tid, base.enrollmentId, base.id);

  const next = {
    ...base,
    id: base.id,
    tenantId: tid,
    enrollmentId: base.enrollmentId,
    gradingDate: nextDate,
    grade: Object.prototype.hasOwnProperty.call(clean, 'grade')
      ? String(clean.grade).trim()
      : base.grade,
    notes: Object.prototype.hasOwnProperty.call(clean, 'notes') ? clean.notes : base.notes,
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  records[idx] = next;
  _writeStore({ ...doc, grades: records });
  return { ...next };
}

module.exports = {
  listGrading,
  getGrade,
  createGrade,
  updateGrade,
  WRITABLE_FIELDS,
  FORBIDDEN_FIELDS,
  LATER_PHASE_FIELDS,
  GradingConflictError,
  ReferenceValidationError,
  STORE_KEY
};