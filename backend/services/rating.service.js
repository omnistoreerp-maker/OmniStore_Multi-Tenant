'use strict';

// rating.service.js — Education Ratings (P2 Teacher portal).
//
// WHAT A RATING IS. Operator-entered student FEEDBACK about one teacher (and,
// optionally, one student, one class and one lesson day): a score of 1-5 plus
// a short comment. It is a first-class record, not a derived view, because the
// feedback is a fact someone types in after a lesson. It carries NO money: the
// score is an integer from 1 to 5, stored as a string like every other
// Education field, and no amount, price, fee, payment or salary concept exists
// here.
//
// WHO WRITES IT. Operators only (education.ratings.edit). A linked teacher
// actor (req.teacherActor, see middleware/teacherActor) may READ their own
// ratings — the list is force-scoped to their id and every other row answers
// 403 OWNERSHIP_DENIED — and may never create, edit or archive any rating:
// entering feedback about yourself is not your call. Ownership is enforced in
// the controller; this service stays actor-agnostic like every other
// Education service.
//
// LINKS. `teacherId` and `studentId` are REQUIRED and resolved through the
// existing teacher/student services with the SAME trusted tenant (a foreign
// reference is indistinguishable from a missing one). `classId` and
// `scheduledDate` are OPTIONAL consistency links: a classId must be taught by
// the rating's teacher, and a date must be a real calendar day. Unlike a
// booking, ARCHED parents are allowed — feedback describes something that
// already happened, so it must outlive the records it mentions. All three
// references are IMMUTABLE after create (re-pointing feedback would rewrite
// whose feedback it is); only `score`, `comment` and `scheduledDate` are
// correctable.
//
// TENANT ISOLATION — structural, not incidental:
//   - The tenant comes ONLY from the trusted server-side context the
//     controller passes in (canonical `trustedTenantId(req)`), never from
//     query, body or any header.
//   - With no trusted tenant every public method throws 'Tenant context is
//     required'.
//   - tenantId is SERVER-OWNED and IMMUTABLE; the write whitelist is EXPLICIT
//     and client payloads are never spread into a persisted record.
//
// AUDIT — every mutation rides the global `auditCapture` middleware
//   (backend/middleware/audit.js).
//
// SCOPE — ratings only. No payments, no grading (grades belong to STU-10),
//   no notifications, no aggregation.

const storageAdapter = require('../repositories/storageAdapter');
const teacherService = require('./teacher.service');
const studentService = require('./student.service');
const classService = require('./class.service');
const logger = require('../utils/logger');

const STORE_KEY = 'educationRatings';

// EXPLICIT WRITE WHITELIST. `teacherId`, `studentId` and `classId` are create
// only (immutable thereafter); `score`, `comment` and `scheduledDate` are the
// correctable feedback itself.
const WRITABLE_FIELDS = Object.freeze({
  teacherId: 'string',
  studentId: 'string',
  classId: 'string',
  scheduledDate: 'string',
  score: 'string',
  comment: 'string'
});

// Maximum length applied to every string field (comment included — feedback
// stays short and specific, like every other Education note).
const MAX_STRING_LEN = 160;

// Strict calendar-date pattern, identical to STU-8/STU-9 and booking.service.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// The score vocabulary: 1-5 inclusive, validated as a string, never coerced.
const SCORE_PATTERN = /^[1-5]$/;

// Allowed lifecycle states. A rating is entered 'active' and can only be
// ARCHIVED (withdrawn) — there is no other state and no client-writable status.
const RATING_STATUSES = Object.freeze(['active', 'archived']);

// Server-owned fields a client may never set. `status` is included on purpose:
// feedback is withdrawn only through archiveRating, never through a body.
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
// `rating` itself is listed on purpose: the canonical field on THIS record is
// `score`, so a payload using `rating` as an alias gets an explicit refusal
// instead of a silent drop.
const LATER_PHASE_FIELDS = Object.freeze([
  'rating',
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
  'meetingUrl',
  'videoUrl',
  'timezone'
]);

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
  return { ratings: [] };
}

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('rating.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(doc) {
  try {
    storageAdapter.write(STORE_KEY, doc);
  } catch (err) {
    logger.warn('rating.service: failed to write store', err.message);
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

function _ratings(doc) {
  return Array.isArray(doc.ratings) ? doc.ratings : [];
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
// only check that catches 2023-02-29 without a calendar table.
function _isRealCalendarDate(value) {
  const ms = Date.parse(value + 'T00:00:00.000Z');
  if (Number.isNaN(ms)) return false;
  return new Date(ms).toISOString().slice(0, 10) === value;
}

// Returns an array of human-readable errors, or an empty array when valid.
// `forCreate` distinguishes create from the correction update.
function _validateRating(data, forCreate) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }

  if (forCreate) {
    if (!_present(data.teacherId)) errors.push('teacherId is required');
    if (!_present(data.studentId)) errors.push('studentId is required');
    if (!_present(data.score)) errors.push('score is required');
  }

  // IMMUTABILITY of every reference: only the feedback itself is correctable.
  if (!forCreate) {
    for (const key of ['teacherId', 'studentId', 'classId']) {
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

  if (_present(data.score)) {
    if (typeof data.score !== 'string') {
      errors.push('score must be a string');
    } else if (!SCORE_PATTERN.test(data.score.trim())) {
      errors.push('score must be an integer from 1 to 5');
    }
  }

  if (data.comment !== undefined && data.comment !== null) {
    if (typeof data.comment !== 'string') {
      errors.push('comment must be a string');
    } else if (data.comment.length > MAX_STRING_LEN) {
      errors.push('comment must be at most ' + MAX_STRING_LEN + ' characters');
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

// Look up a rating by id AND trusted tenant. Returns -1 when absent, never
// leaking cross-tenant existence.
function _findIndexByTenant(records, id, tenantId) {
  return records.findIndex(
    r => String(r.id || '') === String(id) && String(r.tenantId || '') === tenantId
  );
}

// The REQUIRED Teacher reference. Archived teachers are DELIBERATELY allowed:
// feedback describes a lesson that already happened, so it must outlive the
// record it mentions (contrast booking.service, which refuses archived
// parents because it commits FUTURE time).
function _assertTeacherInTenant(tenantId, teacherId) {
  const id = String(teacherId || '').trim();
  if (!id) return null;
  const found = teacherService.getTeacher({ tenantId }, id);
  if (!found) {
    throw new ReferenceValidationError('teacherId does not reference a Teacher in this tenant');
  }
  return found;
}

// The REQUIRED Student reference, same archived-allowed rule.
function _assertStudentInTenant(tenantId, studentId) {
  const id = String(studentId || '').trim();
  if (!id) return null;
  const found = studentService.getStudent({ tenantId }, id);
  if (!found) {
    throw new ReferenceValidationError('studentId does not reference a Student in this tenant');
  }
  return found;
}

// The OPTIONAL Class link: it must be a real Class of this tenant taught by
// THIS rating's teacher, so feedback can never point teacher A at teacher B's
// class.
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function listRatings(tenantContext, filters) {
  const tid = _requireTenantId(tenantContext);
  const f = (filters && typeof filters === 'object') ? filters : {};
  let records = _ratings(_readStore()).filter(r => String(r.tenantId || '') === tid);

  if (_present(f.teacherId)) {
    const teacherId = String(f.teacherId).trim();
    records = records.filter(r => String(r.teacherId || '') === teacherId);
  }
  if (_present(f.studentId)) {
    const studentId = String(f.studentId).trim();
    records = records.filter(r => String(r.studentId || '') === studentId);
  }
  if (_present(f.classId)) {
    const classId = String(f.classId).trim();
    records = records.filter(r => String(r.classId || '') === classId);
  }
  if (_present(f.score)) {
    const score = String(f.score).trim();
    records = records.filter(r => String(r.score || '') === score);
  }
  if (f.status !== undefined && f.status !== null && String(f.status).trim() !== '') {
    const st = String(f.status).trim();
    if (RATING_STATUSES.includes(st)) {
      records = records.filter(r => String(r.status || 'active') === st);
    }
  }
  if (_present(f.scheduledDate)) {
    const day = String(f.scheduledDate).trim();
    records = records.filter(r => String(r.scheduledDate || '').trim() === day);
  }
  if (_present(f.dateFrom)) {
    const from = String(f.dateFrom).trim();
    records = records.filter(r => String(r.scheduledDate || '').trim() >= from);
  }
  if (_present(f.dateTo)) {
    const to = String(f.dateTo).trim();
    records = records.filter(r => String(r.scheduledDate || '').trim() <= to);
  }

  // Newest lesson day first, then most recently entered, with the id as a
  // deterministic tie-breaker.
  records.sort((x, y) => {
    const a = String(x.scheduledDate || '');
    const b = String(y.scheduledDate || '');
    if (a !== b) return a > b ? -1 : 1;
    const ca = String(x.createdAt || '');
    const cb = String(y.createdAt || '');
    if (ca !== cb) return ca > cb ? -1 : 1;
    return String(x.id || '').localeCompare(String(y.id || ''));
  });
  return records.map(r => ({ ...r }));
}

function getRating(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const records = _ratings(_readStore());
  const idx = _findIndexByTenant(records, id, tid);
  if (idx < 0) return null;
  return { ...records[idx] };
}

function createRating(tenantContext, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateRating(input, true);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const teacherId = String(clean.teacherId).trim();
  const studentId = String(clean.studentId).trim();
  const classId = _present(clean.classId) ? String(clean.classId).trim() : '';

  // Parents first, then the optional class link, then the write: a refused
  // rating never reaches the store.
  _assertTeacherInTenant(tid, teacherId);
  _assertStudentInTenant(tid, studentId);
  if (classId) _assertClassMatchesTeacher(tid, classId, teacherId);

  const now = _now();
  const record = {
    id: _generateId('rat'),
    tenantId: tid,
    teacherId,
    studentId,
    classId,
    scheduledDate: _present(clean.scheduledDate) ? String(clean.scheduledDate).trim() : '',
    score: String(clean.score).trim(),
    comment: clean.comment || '',
    status: 'active',
    createdAt: now,
    updatedAt: now
  };
  const doc = _readStore();
  const records = _ratings(doc);
  records.push(record);
  _writeStore({ ...doc, ratings: records });
  return { ...record };
}

// Correction. References are immutable; score, comment and scheduledDate are
// correctable. The parents are re-resolved on every correction so a rating can
// never survive a parent that has since been removed.
function updateRating(tenantContext, id, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateRating(input, false);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const records = _ratings(doc);
  const idx = _findIndexByTenant(records, id, tid);
  if (idx < 0) return null;

  const base = { ...records[idx] };
  _assertTeacherInTenant(tid, base.teacherId);
  _assertStudentInTenant(tid, base.studentId);
  if (base.classId) _assertClassMatchesTeacher(tid, base.classId, base.teacherId);

  // `scheduledDate` and `comment` are correctable (an explicit '' clears
  // them); `score` can never be cleared — a rating without a score is not a
  // rating — so an empty score simply leaves the stored one alone. References
  // and status are not body fields at all.
  const next = {
    ...base,
    id: base.id,
    tenantId: tid,
    teacherId: base.teacherId,
    studentId: base.studentId,
    classId: base.classId,
    scheduledDate: Object.prototype.hasOwnProperty.call(clean, 'scheduledDate')
      ? clean.scheduledDate
      : base.scheduledDate,
    score: Object.prototype.hasOwnProperty.call(clean, 'score') && clean.score !== ''
      ? clean.score
      : base.score,
    comment: Object.prototype.hasOwnProperty.call(clean, 'comment') ? clean.comment : base.comment,
    status: base.status || 'active',
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  records[idx] = next;
  _writeStore({ ...doc, ratings: records });
  return { ...next };
}

// Feedback is withdrawn, never destroyed: the record stays readable with
// status semantics expressed by `archivedAt`-style honesty — here, mirroring
// the Education convention, an explicit `status` of 'archived'.
function archiveRating(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const doc = _readStore();
  const records = _ratings(doc);
  const idx = _findIndexByTenant(records, id, tid);
  if (idx < 0) return null;

  const base = { ...records[idx] };
  const next = { ...base, id: base.id, tenantId: tid, status: 'archived', updatedAt: _now() };
  records[idx] = next;
  _writeStore({ ...doc, ratings: records });
  return { ...next };
}

module.exports = {
  listRatings,
  getRating,
  createRating,
  updateRating,
  archiveRating,
  RATING_STATUSES,
  WRITABLE_FIELDS,
  FORBIDDEN_FIELDS,
  LATER_PHASE_FIELDS,
  ReferenceValidationError,
  STORE_KEY
};
