'use strict';

// attendance.service.js - STU-8 Education Attendance records (Device 2).
//
// Follows the STU-2 student / STU-3 teacher / STU-4 center / STU-5 program and
// course / STU-6 class / STU-7 enrollment service pattern deliberately rather
// than introducing a shared Education repository helper.
//
// DOMAIN SHAPE.
//   Enrollment is the authoritative historical relationship between a Student
//   and a Class. Attendance is a fact about ONE DAY of that relationship, and
//   it therefore stores exactly ONE reference: `enrollmentId`.
//
//   Nothing else is stored. `studentId` and `classId` are read off the
//   Enrollment when they are needed and are never copied here; `courseId`,
//   `programId`, `teacherId` and `centerId` are not even reachable, because the
//   Class chain behind an Enrollment is deliberately never walked — the same
//   rule STU-7 established. A copied reference is a second opinion that can
//   silently disagree with the Enrollment, and a disagreeing historical record
//   is worse than a join.
//
//   `enrollmentId` is the right handle precisely because STU-7 made it
//   immutable: `studentId` and `classId` can never change, so a reference to
//   the enrollment can never be re-pointed. It is also the ONLY handle that
//   survives a withdraw + re-enroll cycle: the two stints are two enrollment
//   ids, so their attendance stays independently reportable instead of being
//   merged by a (classId, studentId) pair.
//
// GRANULARITY — DAILY. Exactly one row per (tenantId, enrollmentId,
// attendanceDate). There is no `sessionId`, `dayOfWeek`, `startTime`,
// `endTime`, `room` or `recurrence`: scheduling is STU-9 and does not exist
// yet, so a session identifier here would be a fabricated foreign key. When
// STU-9 lands the unique key widens additively to (tenant, enrollment, session)
// and existing daily rows stay valid.
//
// DATE — client-supplied, date-only, strict `YYYY-MM-DD`. A timestamp, a
// localized format or an impossible calendar date is rejected outright. No
// timezone is stored and none is interpreted: `attendanceDate` is an opaque
// calendar day, compared as a string against the UTC calendar dates of the
// Enrollment's `enrolledAt` / `withdrawnAt`. That is deliberate — the Center
// timezone is optional on a Program and the pack carries a second, separate
// timezone, so deriving one here would make day boundaries differ per class
// and would silently change history if a Center's timezone were later edited.
//
// ENROLLMENT WINDOW — a row is valid only when
//   date(enrolledAt) <= attendanceDate <= date(withdrawnAt ?? infinity)
// and attendanceDate <= today (server clock). The Enrollment's `status` is NOT
// checked: a withdrawn enrollment is a CLOSED WINDOW, not an invalid parent,
// and requiring `active` would retroactively destroy the ability to backfill a
// term that genuinely happened. Existing attendance is never re-validated when
// an enrollment is later withdrawn, because withdrawal never moves
// `enrolledAt`.
//
// ARCHIVAL — Attendance records historical facts, so an archived Student,
// Class, Course, Program, Teacher or Center never invalidates it and is never
// even inspected. There are no cascades in either direction: an Attendance
// operation reads the Enrollment and writes only its own store.
//
// LIFECYCLE — there is none. `status` is an OUTCOME, not a lifecycle state, and
// it is correctable: mis-marking a register is the single most common real
// operation, so `status`, `notes` AND `attendanceDate` are all mutable. The
// correction is a real update rather than a delete + recreate, which is why
// there is no DELETE route and no /archive or /withdraw route.
//
// IMMUTABILITY — only `enrollmentId`. It is rejected with an OWN-PROPERTY
// check, so null, undefined, '' and whitespace are all caught as attempts to
// change the relationship rather than mistaken for an omission. A date
// correction re-runs format, calendar, future, window and uniqueness
// validation, and a rejected correction leaves the persisted row byte-for-byte
// unchanged.
//
// Tenant isolation is structural, not incidental:
//   - The tenant comes ONLY from the trusted server-side context the
//     controller passes in (built by the canonical `trustedTenantId(req)`).
//     It is NEVER read from req.query.tenantId, req.body.tenantId, a
//     `tenantId` header, a `companyId` header, or a `branchId` header.
//   - With no trusted tenant every public method throws 'Tenant context is
//     required'.
//   - The Enrollment is resolved with that SAME trusted tenant, so a foreign
//     enrollment is indistinguishable from a missing one.
//   - tenantId is SERVER-OWNED and IMMUTABLE: stamped on create and
//     re-asserted on every update.
//   - EXPLICIT FIELD WHITELIST. Client payloads are never spread into a
//     persisted record.
//
// SCOPE — the daily attendance mark ONLY. No grading, exams, scheduling,
// guardian, certificate, financial or payroll field, and no check-in/out clock.

const storageAdapter = require('../repositories/storageAdapter');
const enrollmentService = require('./enrollment.service');
const logger = require('../utils/logger');

const STORE_KEY = 'educationAttendance';

// The complete outcome enum. `late` is a STATUS, not a duration, so it needs
// no session times. `excused` is a STATUS, not a reason taxonomy: absence
// detail belongs in `notes`. There is no fifth state and deliberately no
// financial (paid/unpaid), grading (graded/failed) or disciplinary
// (suspended) value.
const ATTENDANCE_STATUSES = Object.freeze(['present', 'absent', 'late', 'excused']);

// EXPLICIT WRITE WHITELIST. `enrollmentId` is accepted ONLY on create; it is
// immutable thereafter, which `_validateAttendance` enforces with an
// own-property check. `attendanceDate`, `status` and `notes` are correctable.
const WRITABLE_FIELDS = Object.freeze({
  enrollmentId: 'string',
  attendanceDate: 'string',
  status: 'string',
  notes: 'string'
});

// Maximum length applied to the notes field.
const MAX_STRING_LEN = 160;

// Upper bound on one batch. A single class register is the realistic case; the
// bound exists so one request cannot rewrite the whole tenant's store, and it is
// checked before any enrollment is resolved.
const MAX_BATCH_ENTRIES = 500;

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
  'attendanceId'
]);

// Derived ownership of another record, and fields owned by later phases.
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
  'sessionId',
  'dayOfWeek',
  'startTime',
  'endTime',
  'room',
  'recurrence',
  'guardianId',
  'guardianIds',
  'certificate',
  'capacity',
  'enrollmentStatus',
  'timezone',
  'recordedBy',
  'checkInTime',
  'checkOutTime'
]);

// Raised when an attendance row already exists for the same
// (tenant, enrollment, date) triple. The controller maps this to 409 with the
// repository's `{ code }` details convention.
class AttendanceConflictError extends Error {
  constructor(enrollmentId, attendanceDate) {
    super('attendance already recorded for this enrollment on ' + attendanceDate);
    this.name = 'AttendanceConflictError';
    this.code = 'ATTENDANCE_CONFLICT';
    this.enrollmentId = enrollmentId;
    this.attendanceDate = attendanceDate;
    this.conflict = true;
  }
}

// Raised by the BATCH path when one or more requested rows already exist for
// that (tenant, enrollment, day). It carries EVERY clash rather than the first,
// so one rejected batch never hides the rest. The controller maps this to 409
// with the repository's `{ code }` details convention plus the list.
class AttendanceBulkConflictError extends Error {
  constructor(attendanceDate, conflicts) {
    super('attendance already recorded for ' + conflicts.length + ' enrollment(s) on ' + attendanceDate);
    this.name = 'AttendanceBulkConflictError';
    this.code = 'ATTENDANCE_CONFLICT';
    this.attendanceDate = attendanceDate;
    this.conflicts = conflicts;
    this.conflict = true;
  }
}

// Raised when the Enrollment reference cannot be resolved inside the trusted
// tenant, or when a date falls outside the enrollment window. The controller
// maps this to 400 with a `details` list.
class ReferenceValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReferenceValidationError';
    this.validation = [message];
  }
}

function _defaultDoc() {
  return { attendance: [] };
}

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('attendance.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(doc) {
  try {
    storageAdapter.write(STORE_KEY, doc);
  } catch (err) {
    logger.warn('attendance.service: failed to write store', err.message);
  }
}

// The STRICT write used by the batch path. Unlike `_writeStore` it does not
// swallow a failure: the store is a single JSON document, and the document
// write is the ONLY atomic unit this storage architecture offers, so a batch
// that cannot be persisted must be reported rather than silently lost. The
// single-row paths keep the lenient behaviour they have always had, because
// changing it would be an unrelated behavioural change to a shipped contract.
function _writeStoreStrict(doc) {
  const ok = storageAdapter.write(STORE_KEY, doc);
  if (ok === false) {
    const err = new Error('attendance store could not be written');
    err.storageFailure = true;
    throw err;
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

function _now() {
  return new Date().toISOString();
}

function _today() {
  return _now().slice(0, 10);
}

function _generateId(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

function _attendance(doc) {
  return Array.isArray(doc.attendance) ? doc.attendance : [];
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

// A well-FORMATTED date is not automatically a real one: `2023-02-29` parses
// happily and silently rolls over to March 1. The round-trip through ISO is the
// only check that catches it without a calendar table.
function _isRealCalendarDate(value) {
  const ms = Date.parse(value + 'T00:00:00.000Z');
  if (Number.isNaN(ms)) return false;
  return new Date(ms).toISOString().slice(0, 10) === value;
}

// Returns an array of human-readable errors, or an empty array when valid.
//
// `mode` selects which required fields apply and whether the immutable
// relationship is refused, and nothing else — the format, vocabulary, bound and
// security checks below are shared by all three callers on purpose, so the batch
// path cannot drift from the single-row path:
//   'create'  — a new row: enrollmentId, attendanceDate and status are required
//               and the relationship is being established, not changed.
//   'update'  — a correction: nothing is required, and a supplied enrollmentId is
//               refused because the relationship is frozen.
//   'entry'   — one row inside a batch: enrollmentId and status are required,
//               the relationship is being established, and attendanceDate is
//               NOT a per-entry field at all — the batch carries it once.
function _validateAttendance(data, mode) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }

  if (mode === 'create' || mode === 'entry') {
    if (data.enrollmentId === undefined || data.enrollmentId === null || String(data.enrollmentId).trim() === '') {
      errors.push('enrollmentId is required');
    }
  }
  if (mode === 'create') {
    if (data.attendanceDate === undefined || data.attendanceDate === null || String(data.attendanceDate).trim() === '') {
      errors.push('attendanceDate is required');
    }
  }
  if (mode === 'create' || mode === 'entry') {
    if (data.status === undefined || data.status === null || String(data.status).trim() === '') {
      errors.push('status is required');
    }
  }

  // IMMUTABILITY. Only the enrollment relationship is frozen. `attendanceDate`,
  // `status` and `notes` are correctable and are deliberately NOT checked here.
  //
  // This is an OWN-PROPERTY check on the raw payload, not a truthiness test, so
  // null, undefined, '' and '   ' are all caught as attempts to change the
  // relationship rather than being mistaken for an omission.
  if (mode === 'update' && Object.prototype.hasOwnProperty.call(data, 'enrollmentId')) {
    errors.push('enrollmentId cannot be changed');
  }

  // In a batch the day belongs to the envelope. An entry that carries its own
  // date would be silently ignored by the writer, so it is refused outright
  // rather than quietly dropped.
  if (mode === 'entry' && Object.prototype.hasOwnProperty.call(data, 'attendanceDate')) {
    errors.push('attendanceDate is set once for the whole batch, not per entry');
  }

  if (data.attendanceDate !== undefined && data.attendanceDate !== null && data.attendanceDate !== '') {
    if (typeof data.attendanceDate !== 'string') {
      errors.push('attendanceDate must be a string');
    } else if (!DATE_PATTERN.test(data.attendanceDate.trim())) {
      errors.push('attendanceDate must be a date in YYYY-MM-DD format');
    } else if (!_isRealCalendarDate(data.attendanceDate.trim())) {
      errors.push('attendanceDate must be a real calendar date');
    }
  }

  if (data.status !== undefined && data.status !== null && data.status !== '' &&
      typeof data.status !== 'string') {
    errors.push('status must be a string');
  } else if (data.status !== undefined && data.status !== null && String(data.status).trim() !== '' &&
      !ATTENDANCE_STATUSES.includes(String(data.status).trim())) {
    errors.push('status must be one of: ' + ATTENDANCE_STATUSES.join(', '));
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

// Look up an attendance row by id AND trusted tenant. Returns -1 when absent,
// never leaking cross-tenant existence.
function _findIndexByTenant(records, id, tenantId) {
  return records.findIndex(
    a => String(a.id || '') === String(id) && String(a.tenantId || '') === tenantId
  );
}

// The REQUIRED Enrollment reference, resolved through the existing public
// enrollment.service API with the SAME trusted tenant. A foreign enrollment is
// indistinguishable from a missing one, and the Enrollment is only ever read:
// no Student, Class, Course, Program, Teacher or Center is consulted.
function _assertEnrollmentInTenant(tenantId, enrollmentId) {
  const id = String(enrollmentId || '').trim();
  if (!id) return;
  const found = enrollmentService.getEnrollment({ tenantId }, id);
  if (!found) {
    throw new ReferenceValidationError('enrollmentId does not reference an Enrollment in this tenant');
  }
  return found;
}

// The ENROLLMENT WINDOW. A day is inside the relationship only when it falls
// between the enrollment's start and (if it has one) its end, compared as
// calendar dates. The enrollment's `status` is deliberately NOT consulted: a
// withdrawn enrollment is a closed window, not an invalid parent.
function _assertDateWithinWindow(enrollment, attendanceDate) {
  const day = String(attendanceDate).trim();
  const enrolledDay = String(enrollment.enrolledAt || '').slice(0, 10);
  if (!enrolledDay || day < enrolledDay) {
    throw new ReferenceValidationError('attendanceDate is before the enrollment period');
  }
  const withdrawnDay = enrollment.withdrawnAt ? String(enrollment.withdrawnAt).slice(0, 10) : null;
  if (withdrawnDay && day > withdrawnDay) {
    throw new ReferenceValidationError('attendanceDate is after the enrollment period');
  }
}

// Attendance is a record of what happened, so the future is not recordable.
function _assertNotFuture(attendanceDate) {
  if (String(attendanceDate).trim() > _today()) {
    throw new ReferenceValidationError('attendanceDate cannot be in the future');
  }
}

// At most one row per (tenant, enrollment, calendar day). A correction that
// targets a day another row already holds is refused, so a date can never be
// moved onto an occupied slot.
function _assertDateAvailable(records, tenantId, enrollmentId, attendanceDate, excludeId) {
  const day = String(attendanceDate).trim();
  const eid = String(enrollmentId).trim();
  const clash = records.find(a =>
    String(a.tenantId || '') === tenantId &&
    String(a.enrollmentId || '') === eid &&
    String(a.attendanceDate || '').trim() === day &&
    String(a.id || '') !== String(excludeId || '')
  );
  if (clash) throw new AttendanceConflictError(eid, day);
}

function _validationError(errors) {
  const err = new Error(errors.join('; '));
  err.validation = errors;
  return err;
}

function _present(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function listAttendance(tenantContext, filters) {
  const tid = _requireTenantId(tenantContext);
  const f = (filters && typeof filters === 'object') ? filters : {};
  let records = _attendance(_readStore()).filter(a => String(a.tenantId || '') === tid);

  if (_present(f.enrollmentId)) {
    const eid = String(f.enrollmentId).trim();
    records = records.filter(a => String(a.enrollmentId || '') === eid);
  }
  if (_present(f.attendanceDate)) {
    const day = String(f.attendanceDate).trim();
    records = records.filter(a => String(a.attendanceDate || '').trim() === day);
  }
  if (_present(f.dateFrom)) {
    const from = String(f.dateFrom).trim();
    records = records.filter(a => String(a.attendanceDate || '').trim() >= from);
  }
  if (_present(f.dateTo)) {
    const to = String(f.dateTo).trim();
    records = records.filter(a => String(a.attendanceDate || '').trim() <= to);
  }
  if (_present(f.status)) {
    const st = String(f.status).trim();
    // A status outside the enum matches NOTHING rather than silently dropping
    // the filter, which would return the whole tenant and hide the mistake.
    records = ATTENDANCE_STATUSES.includes(st)
      ? records.filter(a => a.status === st)
      : [];
  }

  // DERIVED filters. `studentId` and `classId` are NOT stored on an attendance
  // row; they are resolved through the Enrollment with at most two BATCHED
  // list calls — never one getEnrollment() per row, so there is no N+1 pattern.
  // An unknown or foreign value yields an empty Set, hence an empty list, which
  // is also the correct non-leaking answer.
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
    records = records.filter(a => allowed.has(String(a.enrollmentId || '')));
  }

  // Chronological, with id as a deterministic tie-breaker for rows sharing a
  // calendar day. A register reads forwards in time, not by insertion order.
  records.sort((x, y) => {
    const a = String(x.attendanceDate || '');
    const b = String(y.attendanceDate || '');
    if (a !== b) return a < b ? -1 : 1;
    return String(x.id || '').localeCompare(String(y.id || ''));
  });
  return records.map(a => ({ ...a }));
}

function getAttendance(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const records = _attendance(_readStore());
  const idx = _findIndexByTenant(records, id, tid);
  if (idx < 0) return null;
  return { ...records[idx] };
}

function createAttendance(tenantContext, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateAttendance(input, 'create');
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const records = _attendance(doc);

  // Parent first, then window, then uniqueness, then the write. A rejected
  // enrollment or date therefore never reaches the store and never leaves a
  // row behind.
  const enrollmentId = String(clean.enrollmentId).trim();
  const attendanceDate = String(clean.attendanceDate).trim();
  const enrollment = _assertEnrollmentInTenant(tid, enrollmentId);
  _assertNotFuture(attendanceDate);
  _assertDateWithinWindow(enrollment, attendanceDate);
  _assertDateAvailable(records, tid, enrollmentId, attendanceDate);

  const now = _now();
  const record = {
    id: _generateId('att'),
    tenantId: tid,
    enrollmentId,
    attendanceDate,
    status: String(clean.status).trim(),
    notes: clean.notes || '',
    createdAt: now,
    updatedAt: now
  };
  records.push(record);
  _writeStore({ ...doc, attendance: records });
  return { ...record };
}

// Correction. `status`, `notes` and `attendanceDate` are mutable; the
// enrollment relationship is not. A supplied date is re-validated end to end
// (format and calendar were already checked, so: not future, inside the
// enrollment window, and not already occupied), and because every check runs
// BEFORE the merge and before the write, a refused correction leaves the
// persisted row byte-for-byte unchanged — including its id, tenantId,
// enrollmentId, attendanceDate and createdAt.
function updateAttendance(tenantContext, id, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateAttendance(input, 'update');
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const records = _attendance(doc);
  const idx = _findIndexByTenant(records, id, tid);
  if (idx < 0) return null;

  const base = { ...records[idx] };
  // The window is re-checked on every correction, not only on a date change:
  // it is a pure read of the Enrollment's immutable timestamps, so a
  // legitimately created row can never fail it.
  const enrollment = _assertEnrollmentInTenant(tid, base.enrollmentId);
  _assertNotFuture(String(base.attendanceDate).trim());
  _assertDateWithinWindow(enrollment, String(base.attendanceDate).trim());

  if (Object.prototype.hasOwnProperty.call(clean, 'attendanceDate')) {
    const day = String(clean.attendanceDate).trim();
    _assertNotFuture(day);
    _assertDateWithinWindow(enrollment, day);
    _assertDateAvailable(records, tid, base.enrollmentId, day, base.id);
  }

  const next = {
    ...base,
    id: base.id,
    tenantId: tid,
    enrollmentId: base.enrollmentId,
    attendanceDate: Object.prototype.hasOwnProperty.call(clean, 'attendanceDate')
      ? String(clean.attendanceDate).trim()
      : base.attendanceDate,
    status: Object.prototype.hasOwnProperty.call(clean, 'status')
      ? String(clean.status).trim()
      : base.status,
    notes: Object.prototype.hasOwnProperty.call(clean, 'notes') ? clean.notes : base.notes,
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  records[idx] = next;
  _writeStore({ ...doc, attendance: records });
  return { ...next };
}

// ---------------------------------------------------------------------------
// BATCH — one register, one request.
//
// WHY THIS EXISTS, AND WHY IT IS SAFE.
// A teacher marking a class of thirty students used to have to save thirty
// times, and thirty saves can fail in the middle. This path records the whole
// register in ONE request. It is deliberately NOT a new attendance model:
//
//   - The persisted record is the SAME record `createAttendance` writes, with
//     the SAME fields, the SAME server-stamped tenantId and the SAME
//     one-row-per-(tenant, enrollment, day) rule. There is no batch-only
//     shape, no batch-only status and no batch-only field.
//   - `entries[].enrollmentId` remains the ONLY ownership authority. The
//     batch does not accept a `tenantId`, a `studentId` or a `classId` — a
//     register of one class is expressed as the enrollment ids of that class,
//     which is why there is nothing here that could claim authority a single
//     create does not already have.
//   - Every rule a single create enforces is enforced here, by CALLING the
//     same helpers (`_validateAttendance`, `_assertEnrollmentInTenant`,
//     `_assertNotFuture`, `_assertDateWithinWindow`, `_assertDateAvailable`).
//     The batch adds no rule and relaxes none.
//   - CORRECTIONS ARE NOT PART OF THIS PATH. An existing row is a typed
//     409 ATTENDANCE_CONFLICT, exactly as a second single create is. A
//     mis-marked register is still corrected through `updateAttendance`, so
//     there is exactly one way to create a row and exactly one way to change
//     one, and a batch can never overwrite a record silently.
//
// ATOMICITY. The Education store is ONE JSON document and `storageAdapter`
// writes it with the repository's established whole-document primitive (temp
// file plus rename, so a reader never observes a torn file). A single document
// write is therefore the only atomic unit this architecture offers, and this
// path uses exactly one of them:
//   1. every entry is validated and every enrollment resolved and checked,
//      accumulating ALL failures;
//   2. every existing-row clash is collected into one typed conflict;
//   3. only then is the new array built in memory and handed to a SINGLE
//      `_writeStoreStrict`.
// A refused batch therefore leaves the store byte-for-byte unchanged — there
// is no code path that can persist a prefix of a batch, and a write that fails
// at the storage layer is reported as a failure rather than swallowed. This is
// NOT an invented transaction API: no new storage primitive, no lock, no
// rollback journal, and no change to fileStore or storageAdapter. If the
// storage engine ever gains real transactions, this path keeps working because
// it only ever needs "all of it or none of it".
function _validateBulk(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return ['request body must be a JSON object'];
  }

  // The batch envelope is checked with the SAME validator the single create
  // uses, with `forCreate` false: the envelope has no enrollment relationship
  // of its own, so a top-level `enrollmentId` is a refused attempt to address
  // the whole batch by one enrollment, and every server-owned or derived field
  // is refused by the same name list the single create uses.
  for (const err of _validateAttendance(payload, 'update')) errors.push(err);

  // `status` and `notes` belong to an entry, never to the envelope: an
  // envelope-level status would be an attempt to stamp one outcome over a whole
  // class, which is exactly the fabricated statistic this product forbids.
  for (const key of ['status', 'notes']) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      errors.push(key + ' is only writable on an entry');
    }
  }

  if (payload.attendanceDate === undefined || payload.attendanceDate === null ||
      String(payload.attendanceDate).trim() === '') {
    errors.push('attendanceDate is required');
  }

  if (!Array.isArray(payload.entries)) {
    errors.push('entries must be an array');
    return errors;
  }
  if (payload.entries.length === 0) {
    errors.push('entries must contain at least one entry');
    return errors;
  }
  if (payload.entries.length > MAX_BATCH_ENTRIES) {
    errors.push('entries must contain at most ' + MAX_BATCH_ENTRIES + ' entries');
    return errors;
  }

  // Each entry runs through the single-row validator verbatim; its messages are
  // prefixed with the index so a rejected register names the offending row
  // rather than only saying "something was wrong".
  payload.entries.forEach((entry, index) => {
    const at = 'entries[' + index + '].';
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(at + 'entry must be a JSON object');
      return;
    }
    for (const err of _validateAttendance(entry, 'entry')) {
      errors.push(at + err.charAt(0).toLowerCase() + err.slice(1));
    }
  });

  return errors;
}

function bulkCreateAttendance(tenantContext, payload) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateBulk(payload);
  if (errors.length) throw _validationError(errors);

  const attendanceDate = String(payload.attendanceDate).trim();

  // A well-FORMATTED date is not automatically a real one, and a future day is
  // not recordable. Both are checked once for the whole batch, because the date
  // is a property of the batch, not of an entry.
  if (!_isRealCalendarDate(attendanceDate)) {
    throw _validationError(['attendanceDate must be a real calendar date']);
  }
  try {
    _assertNotFuture(attendanceDate);
  } catch (err) {
    if (Array.isArray(err.validation)) throw _validationError(err.validation);
    throw err;
  }

  const doc = _readStore();
  const records = _attendance(doc);

  // PHASE 1 — resolve and check EVERY entry, collecting all failures. Nothing
  // is written here, so a foreign enrollment cannot leave a partial register.
  const prepared = [];
  const seen = new Set();
  const failures = [];
  payload.entries.forEach((entry, index) => {
    const at = 'entries[' + index + '].';
    const enrollmentId = String(entry.enrollmentId).trim();

    if (seen.has(enrollmentId)) {
      failures.push(at + 'enrollmentId is repeated in this batch');
      return;
    }
    seen.add(enrollmentId);

    let enrollment = null;
    try {
      enrollment = _assertEnrollmentInTenant(tid, enrollmentId);
      _assertDateWithinWindow(enrollment, attendanceDate);
    } catch (err) {
      if (Array.isArray(err.validation)) {
        err.validation.forEach((message) => failures.push(at + message));
        return;
      }
      throw err;
    }

    prepared.push({
      enrollmentId,
      status: String(entry.status).trim(),
      notes: typeof entry.notes === 'string' ? entry.notes.trim().slice(0, MAX_STRING_LEN) : ''
    });
  });

  if (failures.length) throw _validationError(failures);

  // PHASE 2 — every clash with an existing row, reported together. A batch
  // never overwrites: the correction path is `updateAttendance`.
  const conflicts = [];
  prepared.forEach((row) => {
    const clash = records.find(a =>
      String(a.tenantId || '') === tid &&
      String(a.enrollmentId || '') === row.enrollmentId &&
      String(a.attendanceDate || '').trim() === attendanceDate
    );
    if (clash) conflicts.push({ enrollmentId: row.enrollmentId, attendanceId: clash.id });
  });
  if (conflicts.length) throw new AttendanceBulkConflictError(attendanceDate, conflicts);

  // PHASE 3 — the single write. Every rule has already passed, so the array is
  // built in full and persisted in one document write.
  const now = _now();
  const created = prepared.map(row => ({
    id: _generateId('att'),
    tenantId: tid,
    enrollmentId: row.enrollmentId,
    attendanceDate,
    status: row.status,
    notes: row.notes,
    createdAt: now,
    updatedAt: now
  }));

  _writeStoreStrict({ ...doc, attendance: records.concat(created) });

  return {
    attendanceDate,
    count: created.length,
    records: created.map(r => ({ ...r }))
  };
}

module.exports = {
  listAttendance,
  getAttendance,
  createAttendance,
  updateAttendance,
  bulkCreateAttendance,
  ATTENDANCE_STATUSES,
  WRITABLE_FIELDS,
  FORBIDDEN_FIELDS,
  LATER_PHASE_FIELDS,
  MAX_BATCH_ENTRIES,
  AttendanceConflictError,
  AttendanceBulkConflictError,
  ReferenceValidationError,
  STORE_KEY
};
