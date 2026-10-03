'use strict';

// booking.service.js — Education Bookings (P2 Teacher portal).
//
// WHAT A BOOKING IS.
//   One student, one teacher, one calendar day, one contiguous time range,
//   one explicit status. It exists because a lesson request is a real,
//   first-class fact: a student asks for a slot, the teacher (or an operator)
//   confirms it, the lesson happens, or it is cancelled. Scheduling sessions
//   are CLASS plans (owned by a Class); a booking is a STUDENT-TO-TEACHER
//   commitment, so it is its own entity and is deliberately NOT derived from
//   schedule or enrollments.
//
// STATUS LIFECYCLE — explicit, one-directional, refused otherwise.
//   requested -> confirmed -> completed
//   requested -> cancelled
//   confirmed -> cancelled
//   completed and cancelled are terminal.
//   Any other jump raises a typed `BookingTransitionError` (HTTP 409,
//   BOOKING_TRANSITION_INVALID). Nothing auto-advances and no transition is
//   silently ignored: the caller states the next status, the service proves
//   the edge exists, and only then does the row change.
//
// LINKS — teacher required, student required, class/session optional.
//   `teacherId` and `studentId` are required and resolved through the existing
//   teacher/student services with the SAME trusted tenant, so a foreign
//   reference is indistinguishable from a missing one. `classId` and
//   `sessionId` are OPTIONAL links to existing data:
//     - a bare `classId` must reference a Class actually taught by the booking's
//       teacher (the link is consistency-checked, never trusted);
//     - a `sessionId` references a real Scheduling session: the booking's
//       `scheduledDate`, `startTime` and `endTime` are then DERIVED from that
//       session (and any client-supplied values must match it exactly), and the
//       session's Class must belong to the same teacher.
//   Both links are IMMUTABLE after create: re-pointing a booking to another
//   class or session would rewrite what was actually agreed.
//
// CONFLICTS — the minimum grounded in real ownership data.
//   1. The same TEACHER cannot hold two overlapping PENDING bookings
//      (requested or confirmed) on one date. Completed and cancelled bookings
//      release their slot — that is the point of the status.
//   2. A pending booking cannot overlap one of that teacher's scheduled CLASS
//      sessions on the same date, except the very session it is linked to.
//   Half-open intervals (`a.start < b.end && a.end > b.start`): touching
//   endpoints are back-to-back, not overlapping, and are allowed.
//   Conflicts raise a typed `BookingConflictError` (HTTP 409,
//   BOOKING_CONFLICT). Detection is scoped to ONE tenant's records by
//   construction.
//
// TIME — strict 24-hour `HH:mm` wall clock, strict `YYYY-MM-DD` date, no
//   timezone, exactly like STU-9 Scheduling (see scheduling.service.js for the
//   full rationale). Lexicographic comparison, no parsing, no server-clock
//   rules: a booking describes a planned slot and plans live in the future.
//
// OWNERSHIP — enforced at the controller against `req.teacherActor` (the
//   teacher record linked to the signed-in account, see middleware/teacherActor).
//   This service stays actor-agnostic like every other Education service: it
//   receives only the trusted tenant context. A linked teacher's LIST is
//   force-scoped to their own `teacherId` and their writes to another teacher's
//   booking are refused by the controller with 403 OWNERSHIP_DENIED, even when
//   the account holds `education.bookings.edit`.
//
// TENANT ISOLATION — structural, not incidental:
//   - The tenant comes ONLY from the trusted server-side context the controller
//     passes in (built by canonical `trustedTenantId(req)`). Never from
//     req.query, req.body or any header.
//   - With no trusted tenant every public method throws 'Tenant context is
//     required'.
//   - Both parent references are resolved with that SAME trusted tenant.
//   - tenantId is SERVER-OWNED and IMMUTABLE; the write whitelist is EXPLICIT
//     and client payloads are never spread into a persisted record.
//
// NO PAYMENT SURFACE. The record carries no amount, price, fee, payment,
// invoice, transaction or receipt field, and none is writable. Booking money
// logic does not exist here on purpose: a booking commits TIME, not money.
//
// AUDIT — every mutation rides the global `auditCapture` middleware
//   (backend/middleware/audit.js), which appends requestId, actor userId,
//   resource, resourceId and the request body to the tamper-evident audit log
//   for every POST/PUT/PATCH/DELETE, including status transitions.
//
// SCOPE — bookings only. No payments, no refunds, no notifications, no
// calendar sync, no recurrence.

const storageAdapter = require('../repositories/storageAdapter');
const teacherService = require('./teacher.service');
const studentService = require('./student.service');
const classService = require('./class.service');
const schedulingService = require('./scheduling.service');
const logger = require('../utils/logger');

const STORE_KEY = 'educationBookings';

// EXPLICIT WRITE WHITELIST. `teacherId`, `studentId` and `classId` are create
// only (immutable thereafter); `sessionId` is create only and, when present,
// owns the date/time derivation. `status` is NEVER writable from a body: it
// changes only through `transitionBooking`.
const WRITABLE_FIELDS = Object.freeze({
  teacherId: 'string',
  studentId: 'string',
  classId: 'string',
  sessionId: 'string',
  scheduledDate: 'string',
  startTime: 'string',
  endTime: 'string',
  notes: 'string'
});

// Maximum length applied to every string field.
const MAX_STRING_LEN = 160;

// Strict calendar-date and 24-hour wall-clock patterns, identical to STU-9.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// The full status vocabulary, the initial status, and the ONLY legal edges.
const STATUS_VALUES = Object.freeze(['requested', 'confirmed', 'completed', 'cancelled']);
const INITIAL_STATUS = 'requested';
const TRANSITIONS = Object.freeze({
  requested: Object.freeze(['confirmed', 'cancelled']),
  confirmed: Object.freeze(['completed', 'cancelled']),
  completed: Object.freeze([]),
  cancelled: Object.freeze([])
});

// Statuses that still hold the teacher's time (and therefore block an overlap).
const PENDING_STATUSES = Object.freeze(['requested', 'confirmed']);

// Server-owned fields a client may never set.
const FORBIDDEN_FIELDS = Object.freeze([
  'id',
  'tenantId',
  'companyId',
  'branchId',
  'userId',
  'ownerUserId',
  'createdBy',
  'updatedBy',
  'status',
  'createdAt',
  'updatedAt'
]);

// Fields owned by other domains, or by the deliberately-absent payment layer.
// The finance words are refused so a booking can never grow a price, an amount
// or a transaction by accident: this entity commits TIME, not money.
const LATER_PHASE_FIELDS = Object.freeze([
  'payment',
  'payments',
  'paid',
  'amount',
  'price',
  'fee',
  'total',
  'invoice',
  'billing',
  'receipt',
  'transaction',
  'transactionId',
  'refund',
  'salary',
  'payroll',
  'currency',
  'attendanceId',
  'enrollmentId',
  'grade',
  'gradeId',
  'rating',
  'ratingId',
  'meetingUrl',
  'videoUrl',
  'timezone',
  'recurrence',
  'dayOfWeek',
  'capacity'
]);

// Raised when two pending bookings (or a booking and a class session) claim
// overlapping time for the same teacher on the same date. Mapped to HTTP 409.
class BookingConflictError extends Error {
  constructor(conflictKind, heldById, scheduledDate) {
    const subject = conflictKind === 'session' ? 'class session' : 'teacher';
    super('the ' + subject + ' is already booked at that time on ' + scheduledDate);
    this.name = 'BookingConflictError';
    this.code = 'BOOKING_CONFLICT';
    this.conflict = true;
    this.conflictKind = conflictKind;
    this.conflictingId = heldById;
    this.scheduledDate = scheduledDate;
  }
}

// Raised when a status change does not exist as a legal edge. Mapped to HTTP
// 409 with BOOKING_TRANSITION_INVALID.
class BookingTransitionError extends Error {
  constructor(from, to) {
    super('a booking cannot move from ' + from + ' to ' + to);
    this.name = 'BookingTransitionError';
    this.code = 'BOOKING_TRANSITION_INVALID';
    this.conflict = true;
    this.from = from;
    this.to = to;
  }
}

// Raised when a parent reference cannot be resolved inside the trusted tenant,
// or when the payload is internally inconsistent. Mapped to HTTP 400.
class ReferenceValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReferenceValidationError';
    this.validation = [message];
  }
}

function _defaultDoc() {
  return { bookings: [] };
}

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('booking.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(doc) {
  try {
    storageAdapter.write(STORE_KEY, doc);
  } catch (err) {
    logger.warn('booking.service: failed to write store', err.message);
  }
}

// The ONLY tenant source in this file: the trusted context handed in by the
// controller. Never a default, never a fallback.
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

function _bookings(doc) {
  return Array.isArray(doc.bookings) ? doc.bookings : [];
}

function _validationError(errors) {
  const err = new Error(errors.join('; '));
  err.validation = errors;
  return err;
}

function _present(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

// Returns a fresh object built only from whitelisted keys. Non-string input on
// a string field is a typed validation error (maps to 400), never a 500.
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
    if (typeof value !== 'string') throw _validationError([key + ' must be a string']);
    clean[key] = value.trim().slice(0, MAX_STRING_LEN);
  }
  return clean;
}

// Well-formatted is not automatically real: the round-trip through ISO is the
// only check that catches 2023-02-29 without a calendar table (identical to
// STU-8/STU-9).
function _isRealCalendarDate(value) {
  const ms = Date.parse(value + 'T00:00:00.000Z');
  if (Number.isNaN(ms)) return false;
  return new Date(ms).toISOString().slice(0, 10) === value;
}

// Half-open overlap. Touching endpoints are back-to-back, not overlapping.
function _overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

// Returns an array of human-readable errors, or an empty array when valid.
// `forCreate` distinguishes create from the correction update.
function _validateBooking(data, forCreate) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }

  if (forCreate) {
    if (!_present(data.teacherId)) errors.push('teacherId is required');
    if (!_present(data.studentId)) errors.push('studentId is required');
    // scheduledDate/startTime/endTime are required only when no sessionId is
    // supplied: a linked session OWNS its date/time and derives them.
    if (!_present(data.sessionId)) {
      if (!_present(data.scheduledDate)) errors.push('scheduledDate is required');
      if (!_present(data.startTime)) errors.push('startTime is required');
      if (!_present(data.endTime)) errors.push('endTime is required');
    }
  }

  // IMMUTABILITY of every link and of the slot identity. Only notes is
  // correctable on update; changing WHO books WHOM WHEN is delete + recreate —
  // a correction that could move the slot would also silently re-run the
  // conflict rules against a different time, which is not a correction.
  if (!forCreate) {
    for (const key of ['teacherId', 'studentId', 'classId', 'sessionId', 'scheduledDate', 'startTime', 'endTime']) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        errors.push(key + ' cannot be changed');
      }
    }
  }

  if (_present(data.scheduledDate)) {
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

  for (const forbidden of FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, forbidden)) {
      errors.push(forbidden + ' is not writable');
    }
  }

  for (const later of LATER_PHASE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, later)) {
      errors.push(later + ' is not writable');
    }
  }

  return errors;
}

// Look up a booking by id AND trusted tenant. Returns -1 when absent, never
// leaking cross-tenant existence.
function _findIndexByTenant(records, id, tenantId) {
  return records.findIndex(
    b => String(b.id || '') === String(id) && String(b.tenantId || '') === tenantId
  );
}

// The REQUIRED Teacher reference, resolved through the existing public
// teacher.service with the SAME trusted tenant. An archived teacher is refused
// for a NEW booking (you cannot newly commit time to an archived record) but an
// existing booking survives its teacher being archived.
function _assertTeacherInTenant(tenantId, teacherId, forCreate) {
  const id = String(teacherId || '').trim();
  if (!id) return null;
  const found = teacherService.getTeacher({ tenantId }, id);
  if (!found) {
    throw new ReferenceValidationError('teacherId does not reference a Teacher in this tenant');
  }
  if (forCreate && found.status === 'archived') {
    throw new ReferenceValidationError('teacherId must reference a non-archived Teacher');
  }
  return found;
}

// The REQUIRED Student reference, same rules as the Teacher reference.
function _assertStudentInTenant(tenantId, studentId, forCreate) {
  const id = String(studentId || '').trim();
  if (!id) return null;
  const found = studentService.getStudent({ tenantId }, id);
  if (!found) {
    throw new ReferenceValidationError('studentId does not reference a Student in this tenant');
  }
  if (forCreate && found.status === 'archived') {
    throw new ReferenceValidationError('studentId must reference a non-archived Student');
  }
  return found;
}

// The OPTIONAL Class link. When present it must be a real Class of this tenant
// taught by THIS booking's teacher: a classId is consistency-checked, never
// trusted, so a booking can never point teacher A at teacher B's class.
function _assertClassMatchesTeacher(tenantId, classId, teacherId) {
  const id = String(classId || '').trim();
  if (!id) return null;
  const found = classService.getClass({ tenantId }, id);
  if (!found) {
    throw new ReferenceValidationError('classId does not reference a Class in this tenant');
  }
  if (String(found.teacherId || '') !== String(teacherId || '')) {
    throw new ReferenceValidationError('classId must reference a Class taught by teacherId');
  }
  return found;
}

// The OPTIONAL Session link. When present it must be a real session of this
// tenant, and its Class must belong to the booking's teacher. Returns the
// resolved session so the caller can derive (or verify) the slot.
function _assertSessionMatchesTeacher(tenantId, sessionId, teacherId) {
  const id = String(sessionId || '').trim();
  if (!id) return null;
  const session = schedulingService.getSession({ tenantId }, id);
  if (!session) {
    throw new ReferenceValidationError('sessionId does not reference a Session in this tenant');
  }
  const classId = String(session.classId || '');
  const found = classService.getClass({ tenantId }, classId);
  if (!found || String(found.teacherId || '') !== String(teacherId || '')) {
    throw new ReferenceValidationError('sessionId must reference a Session of a Class taught by teacherId');
  }
  return session;
}

// The two conflict rules, evaluated over THIS TENANT'S OWN records only.
// `records` is the full tenant-scoped list so cross-tenant rows can never
// participate. `excludeId` is the booking being corrected (or its own linked
// session for the session rule).
function _assertNoConflict(records, tenantId, teacherId, scheduledDate, startTime, endTime, excludeId, sessionId) {
  const pending = records.filter(b =>
    String(b.tenantId || '') === tenantId &&
    String(b.teacherId || '') === String(teacherId) &&
    PENDING_STATUSES.includes(String(b.status || '')) &&
    String(b.scheduledDate || '').trim() === scheduledDate &&
    String(b.id || '') !== String(excludeId || '') &&
    _overlaps(startTime, endTime, String(b.startTime || '').trim(), String(b.endTime || '').trim())
  );
  if (pending.length > 0) {
    throw new BookingConflictError('teacher', pending[0].id, scheduledDate);
  }

  // Rule 2: the teacher's scheduled class sessions. The session the booking is
  // LINKED to is excluded by construction — booking into your own session must
  // never conflict with itself.
  const sessions = schedulingService.listScheduling({ tenantId }, { scheduledDate, teacherId });
  const clash = sessions.find(s =>
    String(s.id || '') !== String(sessionId || '') &&
    _overlaps(startTime, endTime, String(s.startTime || '').trim(), String(s.endTime || '').trim())
  );
  if (clash) {
    throw new BookingConflictError('session', clash.id, scheduledDate);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function listBookings(tenantContext, filters) {
  const tid = _requireTenantId(tenantContext);
  const f = (filters && typeof filters === 'object') ? filters : {};
  let records = _bookings(_readStore()).filter(b => String(b.tenantId || '') === tid);

  if (_present(f.teacherId)) {
    const teacherId = String(f.teacherId).trim();
    records = records.filter(b => String(b.teacherId || '') === teacherId);
  }
  if (_present(f.studentId)) {
    const studentId = String(f.studentId).trim();
    records = records.filter(b => String(b.studentId || '') === studentId);
  }
  if (_present(f.classId)) {
    const classId = String(f.classId).trim();
    records = records.filter(b => String(b.classId || '') === classId);
  }
  if (_present(f.status)) {
    const status = String(f.status).trim();
    records = records.filter(b => String(b.status || '') === status);
  }
  if (_present(f.scheduledDate)) {
    const day = String(f.scheduledDate).trim();
    records = records.filter(b => String(b.scheduledDate || '').trim() === day);
  }
  if (_present(f.dateFrom)) {
    const from = String(f.dateFrom).trim();
    records = records.filter(b => String(b.scheduledDate || '').trim() >= from);
  }
  if (_present(f.dateTo)) {
    const to = String(f.dateTo).trim();
    records = records.filter(b => String(b.scheduledDate || '').trim() <= to);
  }

  // A day sheet reads forwards in time, then by start time within a day. The id
  // is a deterministic tie-breaker.
  records.sort((x, y) => {
    const a = String(x.scheduledDate || '');
    const b = String(y.scheduledDate || '');
    if (a !== b) return a < b ? -1 : 1;
    const as = String(x.startTime || '');
    const bs = String(y.startTime || '');
    if (as !== bs) return as < bs ? -1 : 1;
    return String(x.id || '').localeCompare(String(y.id || ''));
  });
  return records.map(b => ({ ...b }));
}

function getBooking(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const records = _bookings(_readStore());
  const idx = _findIndexByTenant(records, id, tid);
  if (idx < 0) return null;
  return { ...records[idx] };
}

function createBooking(tenantContext, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateBooking(input, true);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const teacherId = String(clean.teacherId).trim();
  const studentId = String(clean.studentId).trim();
  const sessionId = _present(clean.sessionId) ? String(clean.sessionId).trim() : '';

  // Parents first, then the slot, then conflicts, then the write: a refused
  // booking never reaches the store.
  _assertTeacherInTenant(tid, teacherId, true);
  _assertStudentInTenant(tid, studentId, true);

  let classId = _present(clean.classId) ? String(clean.classId).trim() : '';
  let scheduledDate = _present(clean.scheduledDate) ? String(clean.scheduledDate).trim() : '';
  let startTime = _present(clean.startTime) ? String(clean.startTime).trim() : '';
  let endTime = _present(clean.endTime) ? String(clean.endTime).trim() : '';

  if (sessionId) {
    const session = _assertSessionMatchesTeacher(tid, sessionId, teacherId);
    // The session OWNS the slot: any client values must match it exactly,
    // otherwise the booking would claim a time the session does not have.
    if (scheduledDate && scheduledDate !== String(session.scheduledDate || '').trim()) {
      throw _validationError(['scheduledDate must match the referenced session']);
    }
    if (startTime && startTime !== String(session.startTime || '').trim()) {
      throw _validationError(['startTime must match the referenced session']);
    }
    if (endTime && endTime !== String(session.endTime || '').trim()) {
      throw _validationError(['endTime must match the referenced session']);
    }
    scheduledDate = String(session.scheduledDate || '').trim();
    startTime = String(session.startTime || '').trim();
    endTime = String(session.endTime || '').trim();
    const sessionClassId = String(session.classId || '');
    if (classId && classId !== sessionClassId) {
      throw _validationError(['classId must match the class of the referenced session']);
    }
    classId = sessionClassId;
  } else if (classId) {
    _assertClassMatchesTeacher(tid, classId, teacherId);
  }

  if (!scheduledDate || !startTime || !endTime) {
    throw _validationError(['scheduledDate, startTime and endTime are required']);
  }
  if (endTime <= startTime) {
    throw _validationError(['endTime must be later than startTime']);
  }

  const doc = _readStore();
  const records = _bookings(doc);
  _assertNoConflict(records, tid, teacherId, scheduledDate, startTime, endTime, null, sessionId);

  const now = _now();
  const record = {
    id: _generateId('bkg'),
    tenantId: tid,
    teacherId,
    studentId,
    classId,
    sessionId,
    scheduledDate,
    startTime,
    endTime,
    status: INITIAL_STATUS,
    notes: clean.notes || '',
    createdAt: now,
    updatedAt: now
  };
  records.push(record);
  _writeStore({ ...doc, bookings: records });
  return { ...record };
}

// Correction. Only `notes` is correctable: every link and the slot itself are
// immutable, and `status` is not a body field at all (see transitionBooking).
// A correction re-runs EVERY check — validation, parents, and both conflict
// rules — before the write, so a refused correction leaves the row unchanged.
function updateBooking(tenantContext, id, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateBooking(input, false);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const records = _bookings(doc);
  const idx = _findIndexByTenant(records, id, tid);
  if (idx < 0) return null;

  const base = { ...records[idx] };

  // The parents are re-resolved on every correction so a booking can never
  // survive a parent that has since been removed, and a partial correction is
  // validated against the same parents a full one would be.
  _assertTeacherInTenant(tid, base.teacherId, false);
  _assertStudentInTenant(tid, base.studentId, false);
  if (base.classId) _assertClassMatchesTeacher(tid, base.classId, base.teacherId);

  // A pending booking re-runs the overlap rules (a newer booking may now hold
  // the slot); terminal rows hold no time and are exempt.
  if (PENDING_STATUSES.includes(String(base.status || ''))) {
    _assertNoConflict(records, tid, base.teacherId,
      String(base.scheduledDate || '').trim(),
      String(base.startTime || '').trim(),
      String(base.endTime || '').trim(),
      base.id, base.sessionId);
  }

  const next = {
    ...base,
    id: base.id,
    tenantId: tid,
    teacherId: base.teacherId,
    studentId: base.studentId,
    classId: base.classId,
    sessionId: base.sessionId,
    scheduledDate: base.scheduledDate,
    startTime: base.startTime,
    endTime: base.endTime,
    status: base.status,
    notes: Object.prototype.hasOwnProperty.call(clean, 'notes') ? clean.notes : base.notes,
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  records[idx] = next;
  _writeStore({ ...doc, bookings: records });
  return { ...next };
}

// The ONLY path to a status change. The edge must exist in TRANSITIONS, the
// row must exist in the tenant, and only `status`/`updatedAt` move — nothing
// else about the booking is touched or revalidated, because a transition
// cannot alter the slot it applies to.
function transitionBooking(tenantContext, id, nextStatus) {
  const tid = _requireTenantId(tenantContext);
  if (typeof nextStatus !== 'string' || !STATUS_VALUES.includes(nextStatus.trim())) {
    throw _validationError(['status must be one of ' + STATUS_VALUES.join(', ')]);
  }
  const to = nextStatus.trim();

  const doc = _readStore();
  const records = _bookings(doc);
  const idx = _findIndexByTenant(records, id, tid);
  if (idx < 0) return null;

  const base = { ...records[idx] };
  const from = String(base.status || INITIAL_STATUS);
  if (!TRANSITIONS[from] || !TRANSITIONS[from].includes(to)) {
    throw new BookingTransitionError(from, to);
  }

  const next = { ...base, status: to, updatedAt: _now() };
  records[idx] = next;
  _writeStore({ ...doc, bookings: records });
  return { ...next };
}

module.exports = {
  listBookings,
  getBooking,
  createBooking,
  updateBooking,
  transitionBooking,
  WRITABLE_FIELDS,
  FORBIDDEN_FIELDS,
  LATER_PHASE_FIELDS,
  STATUS_VALUES,
  INITIAL_STATUS,
  TRANSITIONS,
  PENDING_STATUSES,
  BookingConflictError,
  BookingTransitionError,
  ReferenceValidationError,
  STORE_KEY
};
