'use strict';

// scheduling.service.js - STU-9 Education Scheduling records (Device 2).
//
// Follows the STU-2..STU-8 Education service pattern deliberately rather than
// introducing a shared Education repository helper.
//
// WHAT A SCHEDULED SESSION IS.
//   One Class, one calendar day, one contiguous time range. That is the whole
//   entity. It exists because STU-6 Class deliberately stored NO schedule
//   (`dayOfWeek`, `startTime`, `endTime`, `room` and `recurrence` are all on
//   Class's LATER_PHASE_FIELDS list) and STU-8 Attendance is a DAILY FACT about
//   an enrollment. Nothing in the repository could express "this class meets on
//   these days at these times", so this service owns exactly that and nothing
//   else.
//
// OWNERSHIP — `classId`, and nothing else.
//   Class is the authoritative scheduled entity. STU-6 already made Class own
//   `courseId` and `teacherId`, with `programId` and `centerId` DERIVED through
//   the Course. Copying any of those here would create a second, silently
//   disagreeable opinion: a Class reassigned to another Teacher (explicitly
//   allowed by STU-6) would leave every session claiming the old teacher.
//
//   `teacherId` is therefore DERIVED from the Class, exactly the way STU-8
//   derives `studentId` and `classId` from the Enrollment. It is never stored,
//   and it is never a writable field. This also means the teacher conflict rule
//   below automatically follows a teacher reassignment, instead of needing a
//   migration.
//
//   There is deliberately NO `enrollmentId`. A session belongs to a CLASS, so
//   every enrolled student attends it; putting an enrollment on a session would
//   silently exclude the rest of the class. STU-8 Attendance keeps referencing
//   only the Enrollment, and this service reads and writes nothing in the
//   attendance store: attendance stays valid on its own whether or not a
//   session exists for that day.
//
// GRANULARITY — one explicit occurrence, not a rule.
//   There is no `recurrence`, `dayOfWeek` or template. A repeating rule needs a
//   materialized-occurrence story, an expansion horizon, an exception model and
//   a "which instance did you mean" identity, none of which the repository
//   supports today. Modelling one occurrence at a time is honest about that: an
//   operator who needs a weekly course creates the occurrences they need, and
//   each one is independently correctable and independently reportable.
//
// TIME — strict 24-hour `HH:mm` wall clock, no timezone.
//   The repository has no HH:mm convention and no date/time helper module, and
//   the timezone sources DISAGREE: Center carries an optional IANA `timezone`,
//   Program carries none, and the Education Pack carries its own. There is
//   therefore no authoritative zone to store or convert against, so none is
//   stored. `startTime`/`endTime` are opaque local wall-clock labels compared
//   lexicographically, which is exact for a fixed-width zero-padded format and
//   needs no parsing at all. `scheduledDate` is the same strict date-only
//   `YYYY-MM-DD` STU-8 established, never a timestamp, and never derived from
//   the server clock — a session describes a planned day, and a plan may
//   legitimately be in the future, so there is no "not in the future" rule here
//   (unlike attendance, which records what already happened).
//
// CONFLICTS — the minimum grounded in real ownership data.
//   Two rules, both derived from facts the repository actually stores:
//     1. The same CLASS cannot have two overlapping sessions on one day.
//     2. The same TEACHER cannot teach two overlapping sessions on one day,
//        whether or not the classes differ. The teacher comes from the Class,
//        so this rule needs no extra data to be trustworthy.
//   Half-open intervals: `a.start < b.end && a.end > b.start`, so a session
//   ending at 10:00 and one starting at 10:00 TOUCH but do not OVERLAP and are
//   both allowed. Back-to-back sessions are the normal case in a timetable, and
//   a strict rule would forbid the most ordinary schedule in the product.
//
//   There is deliberately NO room, resource or capacity rule. Center has no
//   capacity, room or resource field anywhere in STU-4, so there is no
//   authoritative resource to collide on and inventing one would be a guess.
//
//   Conflicts produce a typed `SchedulingConflictError` carrying a stable
//   `SCHEDULING_CONFLICT` code, mapped to HTTP 409. Nothing is ever auto-
//   resolved and no winner is silently chosen: the second write is refused and
//   the caller decides. Conflict detection is scoped to ONE tenant's records by
//   construction, so it can never see, or be influenced by, another tenant.
//
// LIFECYCLE — none. There is no status, no DELETE, no /archive and no
// /cancel. A scheduled session is a plan, and a wrong plan is corrected through
// PUT: a mis-typed time is a far more common operation than a plan that must be
// retired, and a correction keeps one row instead of destroying and recreating
// it. `classId` is IMMUTABLE for the same reason Attendance's `enrollmentId` is:
//   moving a session to a different class is delete + recreate, so the historical
//   timetable is never rewritten. `scheduledDate`, `startTime`, `endTime` and
//   `notes` are all correctable, and a correction re-runs EVERY check — format,
//   calendar, ordering, parent, and both conflict rules — BEFORE the write, so
//   a refused correction leaves the row byte-for-byte unchanged.
//
// Tenant isolation is structural, not incidental:
//   - The tenant comes ONLY from the trusted server-side context the controller
//     passes in (built by the canonical `trustedTenantId(req)`). It is NEVER
//     read from req.query.tenantId, req.body.tenantId, a `tenantId` header, a
//     `companyId` header, or a `branchId` header.
//   - With no trusted tenant every public method throws 'Tenant context is
//     required'.
//   - The Class is resolved with that SAME trusted tenant, so a foreign class is
//     indistinguishable from a missing one.
//   - tenantId is SERVER-OWNED and IMMUTABLE: stamped on create and re-asserted
//     on every update.
//   - EXPLICIT FIELD WHITELIST. Client payloads are never spread into a
//     persisted record.
//
// SCOPE — scheduling only. No rooms or resources, no recurrence, no billing,
// payroll, Zoom/LMS, grades, certificates, notifications or calendar sync.

const storageAdapter = require('../repositories/storageAdapter');
const classService = require('./class.service');
const logger = require('../utils/logger');

const STORE_KEY = 'educationScheduling';

// EXPLICIT WRITE WHITELIST. `classId` is accepted ONLY on create; it is
// immutable thereafter, which `_validateSession` enforces with an own-property
// check. Everything else on a session is correctable.
const WRITABLE_FIELDS = Object.freeze({
  classId: 'string',
  scheduledDate: 'string',
  startTime: 'string',
  endTime: 'string',
  notes: 'string'
});

// Maximum length applied to the notes field.
const MAX_STRING_LEN = 160;

// Strict calendar-date pattern, matching STU-8 exactly. A timestamp, a localized
// format or a padded variant is rejected rather than coerced.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Strict 24-hour wall clock. 00:00-23:59 only: no 24:00, no "9:00", no AM/PM,
// no offset, no seconds.
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

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
  'sessionId'
]);

// Fields owned by other entities, by other domains, or by phases that do not
// exist. `teacherId` is here because it is DERIVED from the Class, and
// `enrollmentId` because a session belongs to a class rather than to one
// student. The scheduling keywords are here to keep the historical rejections
// (from Class, Enrollment and Attendance) intact on this entity too.
const LATER_PHASE_FIELDS = Object.freeze([
  'teacherId',
  'teacherIds',
  'studentId',
  'studentIds',
  'enrollmentId',
  'enrollmentIds',
  'attendanceId',
  'attendanceIds',
  'attendance',
  'courseId',
  'programId',
  'centerId',
  'academicYear',
  'dayOfWeek',
  'room',
  'rooms',
  'resource',
  'resources',
  'capacity',
  'recurrence',
  'recurring',
  'schedule',
  'scheduleId',
  'classSessionId',
  'level',
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
  'guardianId',
  'guardianIds',
  'certificate',
  'enrollmentStatus',
  'timezone',
  'lms',
  'zoom',
  'meetingUrl',
  'videoUrl',
  'notification',
  'notifications',
  'calendarSync',
  'color',
  'notesTemplate'
]);

// Raised when a session would overlap another one that the same Class, or the
// same Teacher, is already committed to on that date. The controller maps this
// to 409 with the repository's `{ code }` details convention.
class SchedulingConflictError extends Error {
  constructor(conflictKind, heldById, scheduledDate) {
    const subject = conflictKind === 'class' ? 'class' : 'teacher';
    super('the ' + subject + ' is already scheduled at that time on ' + scheduledDate);
    this.name = 'SchedulingConflictError';
    this.code = 'SCHEDULING_CONFLICT';
    this.conflict = true;
    // Which rule fired, and the id of the session that already holds the slot.
    // Both are tenant-local ids, never a tenant identifier.
    this.conflictKind = conflictKind;
    this.conflictingSessionId = heldById;
    this.scheduledDate = scheduledDate;
  }
}

// Raised when the Class reference cannot be resolved inside the trusted tenant,
// or when the time range is empty or inverted. The controller maps this to 400
// with a `details` list.
class ReferenceValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReferenceValidationError';
    this.validation = [message];
  }
}

function _defaultDoc() {
  return { sessions: [] };
}

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('scheduling.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(doc) {
  try {
    storageAdapter.write(STORE_KEY, doc);
  } catch (err) {
    logger.warn('scheduling.service: failed to write store', err.message);
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

function _generateId(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

function _sessions(doc) {
  return Array.isArray(doc.sessions) ? doc.sessions : [];
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

// Half-open overlap. Touching endpoints (a.end === b.start) are NOT an overlap,
// because back-to-back sessions are the ordinary case in a timetable.
function _overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

// Returns an array of human-readable errors, or an empty array when valid.
// `forCreate` is true for create and false for the correction update.
function _validateSession(data, forCreate) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }

  if (forCreate) {
    if (data.classId === undefined || data.classId === null || String(data.classId).trim() === '') {
      errors.push('classId is required');
    }
    if (data.scheduledDate === undefined || data.scheduledDate === null || String(data.scheduledDate).trim() === '') {
      errors.push('scheduledDate is required');
    }
    if (data.startTime === undefined || data.startTime === null || String(data.startTime).trim() === '') {
      errors.push('startTime is required');
    }
    if (data.endTime === undefined || data.endTime === null || String(data.endTime).trim() === '') {
      errors.push('endTime is required');
    }
  }

  // IMMUTABILITY. Only the ownership reference is frozen. `scheduledDate`,
  // `startTime`, `endTime` and `notes` are correctable and are deliberately NOT
  // checked here.
  //
  // This is an OWN-PROPERTY check on the raw payload, not a truthiness test, so
  // null, undefined, '' and '   ' are all caught as attempts to re-point the
  // session rather than being mistaken for an omission.
  if (!forCreate && Object.prototype.hasOwnProperty.call(data, 'classId')) {
    errors.push('classId cannot be changed');
  }

  if (data.scheduledDate !== undefined && data.scheduledDate !== null && data.scheduledDate !== '') {
    if (typeof data.scheduledDate !== 'string') {
      errors.push('scheduledDate must be a string');
    } else if (!DATE_PATTERN.test(data.scheduledDate.trim())) {
      errors.push('scheduledDate must be a date in YYYY-MM-DD format');
    } else if (!_isRealCalendarDate(data.scheduledDate.trim())) {
      errors.push('scheduledDate must be a real calendar date');
    }
  }

  for (const key of ['startTime', 'endTime']) {
    const value = data[key];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string') {
      errors.push(key + ' must be a string');
    } else if (!TIME_PATTERN.test(value.trim())) {
      errors.push(key + ' must be a time in HH:mm 24-hour format');
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

  // Derived ownership, other domains and non-existent phases are refused.
  for (const later of LATER_PHASE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, later)) {
      errors.push(later + ' is not writable');
    }
  }

  return errors;
}

// Look up a session by id AND trusted tenant. Returns -1 when absent, never
// leaking cross-tenant existence.
function _findIndexByTenant(records, id, tenantId) {
  return records.findIndex(
    s => String(s.id || '') === String(id) && String(s.tenantId || '') === tenantId
  );
}

// The REQUIRED Class reference, resolved through the existing public
// class.service API with the SAME trusted tenant. A foreign class is
// indistinguishable from a missing one, and an ARCHIVED class is refused for a
// NEW or CORRECTED session - the same rule STU-7 applies to a new Enrollment.
// Nothing behind the Class is walked: an archived Course, Program, Teacher or
// Center does not block a session, exactly as it does not block an Enrollment.
function _assertClassInTenant(tenantId, classId) {
  const id = String(classId || '').trim();
  if (!id) return null;
  const found = classService.getClass({ tenantId }, id);
  if (!found) {
    throw new ReferenceValidationError('classId does not reference a Class in this tenant');
  }
  if (found.status === 'archived') {
    throw new ReferenceValidationError('classId must reference a non-archived Class');
  }
  return found;
}

// The TEACHER behind a set of Class ids, resolved with ONE batched list call
// rather than a getClass() per id. Returns a Map of classId -> teacherId. A
// class that cannot be read (archived, or removed) simply contributes no
// teacher, which is the safe direction: it can never manufacture a conflict.
function _teacherIdByClassId(tenantId, classIds) {
  const map = new Map();
  const wanted = new Set(classIds.map(String));
  if (wanted.size === 0) return map;
  const classes = classService.listClasses({ tenantId }) || [];
  for (const k of classes) {
    const id = String(k.id || '');
    if (wanted.has(id)) map.set(id, String(k.teacherId || ''));
  }
  return map;
}

// The two conflict rules, evaluated over the TENANT'S OWN records only.
//
// `records` is already tenant-scoped, so no cross-tenant record can ever
// participate. Both rules are checked against the SAME candidate slot, and the
// class rule is evaluated first because it is the more direct statement of the
// conflict: the same class cannot be in two places at once, and that holds even
// if the teacher has since been reassigned.
function _assertNoConflict(records, tenantId, classId, scheduledDate, startTime, endTime, excludeId) {
  const sameDay = records.filter(s =>
    String(s.tenantId || '') === tenantId &&
    String(s.scheduledDate || '').trim() === scheduledDate &&
    String(s.id || '') !== String(excludeId || '') &&
    _overlaps(startTime, endTime, String(s.startTime || '').trim(), String(s.endTime || '').trim())
  );
  if (sameDay.length === 0) return;

  const ownClass = sameDay.find(s => String(s.classId || '') === String(classId));
  if (ownClass) {
    throw new SchedulingConflictError('class', ownClass.id, scheduledDate);
  }

  // The teacher is DERIVED from the Class, so this rule automatically follows a
  // teacher reassignment instead of needing the sessions to be rewritten.
  const teacherByClass = _teacherIdByClassId(tenantId, [classId, ...sameDay.map(s => s.classId)]);
  const teacherId = teacherByClass.get(String(classId));
  if (teacherId) {
    const clash = sameDay.find(s => teacherByClass.get(String(s.classId || '')) === teacherId);
    if (clash) throw new SchedulingConflictError('teacher', clash.id, scheduledDate);
  }
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

function listScheduling(tenantContext, filters) {
  const tid = _requireTenantId(tenantContext);
  const f = (filters && typeof filters === 'object') ? filters : {};
  let records = _sessions(_readStore()).filter(s => String(s.tenantId || '') === tid);

  if (_present(f.classId)) {
    const cid = String(f.classId).trim();
    records = records.filter(s => String(s.classId || '') === cid);
  }
  if (_present(f.scheduledDate)) {
    const day = String(f.scheduledDate).trim();
    records = records.filter(s => String(s.scheduledDate || '').trim() === day);
  }
  if (_present(f.dateFrom)) {
    const from = String(f.dateFrom).trim();
    records = records.filter(s => String(s.scheduledDate || '').trim() >= from);
  }
  if (_present(f.dateTo)) {
    const to = String(f.dateTo).trim();
    records = records.filter(s => String(s.scheduledDate || '').trim() <= to);
  }

  // DERIVED filter. `teacherId` is NOT stored on a session: it is the Teacher of
  // the session's Class, resolved here with ONE batched class list call. An
  // unknown or foreign teacher yields an empty Set, hence an empty list, which
  // is also the correct non-leaking answer.
  if (_present(f.teacherId)) {
    const teacherId = String(f.teacherId).trim();
    const allowed = new Set(
      (classService.listClasses({ tenantId: tid }) || [])
        .filter(k => String(k.teacherId || '') === teacherId)
        .map(k => String(k.id || ''))
    );
    records = records.filter(s => allowed.has(String(s.classId || '')));
  }

  // A timetable reads forwards in time, then by start time within a day. The id
  // is a deterministic tie-breaker for two sessions sharing a day and a start.
  records.sort((x, y) => {
    const a = String(x.scheduledDate || '');
    const b = String(y.scheduledDate || '');
    if (a !== b) return a < b ? -1 : 1;
    const as = String(x.startTime || '');
    const bs = String(y.startTime || '');
    if (as !== bs) return as < bs ? -1 : 1;
    return String(x.id || '').localeCompare(String(y.id || ''));
  });
  return records.map(s => ({ ...s }));
}

function getSession(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const records = _sessions(_readStore());
  const idx = _findIndexByTenant(records, id, tid);
  if (idx < 0) return null;
  return { ...records[idx] };
}

function createSession(tenantContext, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateSession(input, true);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const classId = String(clean.classId).trim();
  const scheduledDate = String(clean.scheduledDate).trim();
  const startTime = String(clean.startTime).trim();
  const endTime = String(clean.endTime).trim();

  // A half-open range needs real duration: `endTime === startTime` is a
  // zero-length session and `endTime < startTime` is an inverted one. Both are
  // refused rather than silently swapped, because guessing which end the caller
  // meant is how a timetable ends up teaching at 11:00-09:00.
  if (endTime <= startTime) {
    throw _validationError(['endTime must be later than startTime']);
  }

  const doc = _readStore();
  const records = _sessions(doc);

  // Parent first, then conflicts, then the write, so a refused session never
  // reaches the store and never leaves a row behind.
  _assertClassInTenant(tid, classId);
  _assertNoConflict(records, tid, classId, scheduledDate, startTime, endTime);

  const now = _now();
  const record = {
    id: _generateId('ses'),
    tenantId: tid,
    classId,
    scheduledDate,
    startTime,
    endTime,
    notes: clean.notes || '',
    createdAt: now,
    updatedAt: now
  };
  records.push(record);
  _writeStore({ ...doc, sessions: records });
  return { ...record };
}

// Correction. `scheduledDate`, `startTime`, `endTime` and `notes` are mutable;
// `classId` is immutable. A session is often re-timed by minutes, so unlike
// Attendance the time fields are NOT an immutable fact - but the ownership
// reference is, because re-pointing it would rewrite the history of which class
// met when.
function updateSession(tenantContext, id, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateSession(input, false);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const records = _sessions(doc);
  const idx = _findIndexByTenant(records, id, tid);
  if (idx < 0) return null;

  const base = { ...records[idx] };
  const nextDate = Object.prototype.hasOwnProperty.call(clean, 'scheduledDate')
    ? String(clean.scheduledDate).trim()
    : String(base.scheduledDate).trim();
  const nextStart = Object.prototype.hasOwnProperty.call(clean, 'startTime')
    ? String(clean.startTime).trim()
    : String(base.startTime).trim();
  const nextEnd = Object.prototype.hasOwnProperty.call(clean, 'endTime')
    ? String(clean.endTime).trim()
    : String(base.endTime).trim();

  if (nextEnd <= nextStart) {
    throw _validationError(['endTime must be later than startTime']);
  }

  // The class is re-resolved on every correction so a session can never be
  // re-timed onto a Class that has since been archived, and so a partial
  // correction is validated against the same parent a full one would be.
  _assertClassInTenant(tid, base.classId);
  // Both conflict rules re-run against the FULL corrected slot - not only when
  // the date or time changed - and the record being corrected is excluded.
  _assertNoConflict(records, tid, base.classId, nextDate, nextStart, nextEnd, base.id);

  const next = {
    ...base,
    id: base.id,
    tenantId: tid,
    classId: base.classId,
    scheduledDate: nextDate,
    startTime: nextStart,
    endTime: nextEnd,
    notes: Object.prototype.hasOwnProperty.call(clean, 'notes') ? clean.notes : base.notes,
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  records[idx] = next;
  _writeStore({ ...doc, sessions: records });
  return { ...next };
}

module.exports = {
  listScheduling,
  getSession,
  createSession,
  updateSession,
  WRITABLE_FIELDS,
  FORBIDDEN_FIELDS,
  LATER_PHASE_FIELDS,
  SchedulingConflictError,
  ReferenceValidationError,
  STORE_KEY
};
