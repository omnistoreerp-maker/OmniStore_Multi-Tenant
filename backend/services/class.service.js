'use strict';

// class.service.js - STU-6 Education Class records (Device 2).
//
// Follows the STU-2 student / STU-3 teacher / STU-4 center / STU-5 program /
// STU-5 course service pattern deliberately rather than introducing a shared
// Education repository helper.
//
// DOMAIN SHAPE.
//   Center -> Program -> Course -> Class, plus Teacher participating in Class:
//     Class -> Course
//     Class -> teacherId
//     Class -> Course -> Program
//     Class -> Course -> Program -> Center
//
//   A Class stores ONLY its two authoritative relationships, `courseId` and
//   `teacherId`. It deliberately has NO programId and NO centerId: both are
//   DERIVED through the Course. A second reference could silently disagree with
//   the Course, so contradictory relationship state is made structurally
//   impossible rather than merely validated.
//
//   Both relationships are validated on create and on every update that
//   SUPPLIES them: the parent must exist, must belong to the SAME trusted
//   tenant, and must not be archived. A Course whose own Program is archived is
//   also refused, because a new Class assignment cannot be created under an
//   archived Program chain. A parent belonging to another tenant is
//   indistinguishable from one that does not exist, so cross-tenant
//   relationships fail closed without leaking existence.
//
//   Center status is deliberately NOT checked: Center is optional, is not
//   Class-owned, and STU-5 established that archiving a Center does not cascade
//   to Programs or Courses.
//
//   `courseId` and `teacherId` may be REASSIGNED but never CLEARED. An
//   explicitly supplied null / undefined / empty / whitespace-only value is
//   rejected instead of being written as ''. A genuinely OMITTED value is not
//   an own property of the payload, so the existing relationship is preserved.
//
//   Relationship validation runs BEFORE the classCode uniqueness check and
//   BEFORE any write, so a rejected parent never reserves a code and a failed
//   update leaves BOTH relationships untouched.
//
// Tenant isolation is structural, not incidental:
//   - The tenant comes ONLY from the trusted server-side context the
//     controller passes in (built by the canonical `trustedTenantId(req)`).
//     It is NEVER read from req.query.tenantId, req.body.tenantId, a
//     `tenantId` header, a `companyId` header, or a `branchId` header.
//   - With no trusted tenant every public method throws 'Tenant context is
//     required'.
//   - tenantId is SERVER-OWNED and IMMUTABLE: stamped on create and
//     re-asserted on every update and archive.
//   - EXPLICIT FIELD WHITELIST. Client payloads are never spread into a
//     persisted record.
//
// SCOPE — an operational Class directory ONLY. It carries no studentId,
// enrollment, attendance, grading, exam, scheduling, billing, payment, tuition,
// salary or payroll field. `capacity` is DEFERRED to the Enrollment phase, and
// dayOfWeek / startTime / endTime / room / recurrence belong to Scheduling.
// The ONE financial field is `fee` (P2): the operator-entered price of the
// class itself, a decimal amount stored as a plain string (e.g. '1500.50') and
// OPTIONAL — a Class created without it has no fee key at all, so revenue is
// simply not claimable for that class rather than silently zero. It is the
// class's own price only: no payment, transaction, invoice or receipt concept
// exists here, and teacher revenue is COMPUTED elsewhere as fee x active
// enrollments of that teacher's classes.
// Archiving a Class never cascades: Students, Teachers, Centers, Programs and
// Courses are only ever READ here, never written.

const storageAdapter = require('../repositories/storageAdapter');
const courseService = require('./course.service');
const teacherService = require('./teacher.service');
const programService = require('./program.service');
const logger = require('../utils/logger');

const STORE_KEY = 'educationClasses';

// Allowed lifecycle states. Scheduling states (scheduled, running, completed,
// cancelled) are deliberately absent: scheduling is a later phase.
const CLASS_STATUSES = Object.freeze(['active', 'inactive', 'archived']);

// EXPLICIT WRITE WHITELIST with per-key kinds. `courseId` and `teacherId` are
// REQUIRED; everything else is optional string metadata. `fee` (P2) is the
// operator-entered class price: a non-negative decimal with up to two decimals
// (validated below), or '' to clear it — a cleared/absent fee leaves the key
// OUT of the stored record entirely.
const WRITABLE_FIELDS = Object.freeze({
  courseId: 'string',
  teacherId: 'string',
  classCode: 'string',
  name: 'string',
  displayName: 'string',
  description: 'string',
  status: 'string',
  notes: 'string',
  fee: 'string'
});

// Server-owned fields a client may never set.
const FORBIDDEN_FIELDS = Object.freeze([
  'id',
  'tenantId',
  'companyId',
  'branchId',
  'userId',
  'ownerUserId',
  'createdAt',
  'updatedAt'
]);

// Fields that belong to later phases or that would duplicate a DERIVED
// relationship. `programId` and `centerId` are included on purpose: a Class
// owns no Program or Center reference of its own, because both are derived
// through courseId and a second reference could silently disagree with it.
const LATER_PHASE_FIELDS = Object.freeze([
  'programId',
  'centerId',
  'level',
  'capacity',
  'studentId',
  'studentIds',
  'enrollmentId',
  'enrollmentIds',
  'attendance',
  'grades',
  'exam',
  'payment',
  'tuition',
  'billing',
  'salary',
  'payroll',
  'dayOfWeek',
  'startTime',
  'endTime',
  'room',
  'recurrence'
]);

// Maximum length applied to every string field.
const MAX_STRING_LEN = 160;

// Raised when classCode collides inside the trusted tenant. The controller
// maps this to 409 with the repository's `{ code }` details convention.
class ClassCodeConflictError extends Error {
  constructor(classCode) {
    super('classCode already exists for this tenant: ' + classCode);
    this.name = 'ClassCodeConflictError';
    this.code = 'CLASS_CODE_CONFLICT';
    this.classCode = classCode;
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
  return { classes: [] };
}

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('class.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(doc) {
  try {
    storageAdapter.write(STORE_KEY, doc);
  } catch (err) {
    logger.warn('class.service: failed to write store', err.message);
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

function _classes(doc) {
  return Array.isArray(doc.classes) ? doc.classes : [];
}

// Returns a fresh object built only from whitelisted keys. Every whitelisted
// Class field is a string, so there is no kind coercion to perform.
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
// `forCreate` is true for create and false for partial update.
function _validateClass(data, forCreate) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }

  if (forCreate) {
    if (data.courseId === undefined || data.courseId === null || String(data.courseId).trim() === '') {
      errors.push('courseId is required');
    }
    if (data.teacherId === undefined || data.teacherId === null || String(data.teacherId).trim() === '') {
      errors.push('teacherId is required');
    }
  }

  // BOTH relationships may be REASSIGNED on update, but neither may ever be
  // CLEARED. An explicitly supplied null / undefined / empty / whitespace-only
  // value is a client attempt to orphan the Class, so it is rejected here rather
  // than silently written as ''. A genuinely OMITTED value is not an own
  // property of `data` at all, so it never reaches this branch and the existing
  // parent is preserved.
  if (!forCreate) {
    for (const key of ['courseId', 'teacherId']) {
      if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
      const value = data[key];
      if (value === null || value === undefined || String(value).trim() === '') {
        errors.push(key + ' cannot be cleared');
      }
    }
  }

  for (const key of Object.keys(WRITABLE_FIELDS)) {
    const value = data[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      errors.push(key + ' must be a string');
      continue;
    }
    if (value.length > MAX_STRING_LEN) {
      errors.push(key + ' must be at most ' + MAX_STRING_LEN + ' characters');
    }
  }

  // `fee` is either a non-negative decimal amount (up to two decimals) or the
  // empty string, which explicitly means "no fee" and clears the key.
  if (typeof data.fee === 'string' && data.fee.trim() !== '') {
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(data.fee.trim())) {
      errors.push('fee must be a non-negative amount with up to 2 decimals (e.g. 1500.50)');
    }
  }

  if (data.status !== undefined && data.status !== null && String(data.status).trim() !== '' &&
      !CLASS_STATUSES.includes(String(data.status).trim())) {
    errors.push('status must be one of: ' + CLASS_STATUSES.join(', '));
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

// Look up a class by id AND trusted tenant. Returns -1 when absent, never
// leaking cross-tenant existence.
function _findIndexByTenant(classes, id, tenantId) {
  return classes.findIndex(
    c => String(c.id || '') === String(id) && String(c.tenantId || '') === tenantId
  );
}

// classCode is an identifier WITHIN a tenant, so uniqueness is scoped to the
// trusted tenant and only over CURRENT (non-archived) records — the same
// semantics STU-3/STU-4/STU-5 use. Two tenants may hold the same code, and an
// archived record releases its code for reuse.
function _assertClassCodeAvailable(classes, tenantId, classCode, excludeId) {
  const code = String(classCode || '').trim();
  if (!code) return;
  const clash = classes.find(c =>
    String(c.tenantId || '') === tenantId &&
    String(c.classCode || '').trim() === code &&
    c.status !== 'archived' &&
    String(c.id || '') !== String(excludeId || '')
  );
  if (clash) throw new ClassCodeConflictError(code);
}

// The REQUIRED Course reference, resolved through the existing public
// course.service API. It must exist inside the trusted tenant, must not be
// archived, and its own Program must resolve inside the same tenant and must
// not be archived either — a new Class cannot be assigned under an archived
// Program chain. Center status is intentionally NOT checked.
function _assertCourseInTenant(tenantId, courseId) {
  const id = String(courseId || '').trim();
  if (!id) return;
  const found = courseService.getCourse({ tenantId }, id);
  if (!found) throw new ReferenceValidationError('courseId does not reference a Course in this tenant');
  if (found.status === 'archived') {
    throw new ReferenceValidationError('courseId must reference a non-archived Course');
  }
  const programId = String(found.programId || '').trim();
  if (!programId) {
    throw new ReferenceValidationError('courseId does not reference a Course in this tenant');
  }
  const program = programService.getProgram({ tenantId }, programId);
  if (!program) {
    throw new ReferenceValidationError('courseId must reference a Course with a Program in this tenant');
  }
  if (program.status === 'archived') {
    throw new ReferenceValidationError('courseId must reference a Course whose Program is not archived');
  }
}

// The REQUIRED Teacher reference, resolved through the existing public
// teacher.service API. An `inactive` Teacher is still eligible; only an
// `archived` Teacher is refused for a NEW assignment.
function _assertTeacherInTenant(tenantId, teacherId) {
  const id = String(teacherId || '').trim();
  if (!id) return;
  const found = teacherService.getTeacher({ tenantId }, id);
  if (!found) throw new ReferenceValidationError('teacherId does not reference a Teacher in this tenant');
  if (found.status === 'archived') {
    throw new ReferenceValidationError('teacherId must reference a non-archived Teacher');
  }
}

function _searchMatch(record, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return [record.classCode, record.name, record.displayName, record.description]
    .map(v => String(v || '').toLowerCase())
    .some(v => v.includes(q));
}

function _validationError(errors) {
  const err = new Error(errors.join('; '));
  err.validation = errors;
  return err;
}

// displayName defaults to the class name when the client omits it.
function _displayName(clean) {
  const explicit = String(clean.displayName || '').trim();
  if (explicit) return explicit;
  return String(clean.name || '').trim();
}

// Resolves `?programId=` WITHOUT denormalizing programId onto the Class: the
// tenant's Courses are read ONCE and reduced to the set of Course ids that
// belong to that Program. An unknown or foreign Program simply yields an empty
// set, so the answer is an empty list and existence is never leaked.
function _courseIdsForProgram(tenantId, programId) {
  const pid = String(programId).trim();
  const courses = courseService.listCourses({ tenantId }) || [];
  return new Set(
    courses
      .filter(c => String(c.programId || '').trim() === pid)
      .map(c => String(c.id || ''))
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function listClasses(tenantContext, filters) {
  const tid = _requireTenantId(tenantContext);
  const f = (filters && typeof filters === 'object') ? filters : {};
  let classes = _classes(_readStore()).filter(c => String(c.tenantId || '') === tid);
  if (f.status !== undefined && f.status !== null && String(f.status).trim() !== '') {
    const st = String(f.status).trim();
    if (CLASS_STATUSES.includes(st)) {
      classes = classes.filter(c => c.status === st);
    }
  }
  if (f.courseId !== undefined && f.courseId !== null && String(f.courseId).trim() !== '') {
    const cid = String(f.courseId).trim();
    classes = classes.filter(c => String(c.courseId || '') === cid);
  }
  if (f.teacherId !== undefined && f.teacherId !== null && String(f.teacherId).trim() !== '') {
    const tid2 = String(f.teacherId).trim();
    classes = classes.filter(c => String(c.teacherId || '') === tid2);
  }
  // `programId` is a DERIVED filter: it is resolved through the Course, never
  // stored on the Class.
  if (f.programId !== undefined && f.programId !== null && String(f.programId).trim() !== '') {
    const allowed = _courseIdsForProgram(tid, f.programId);
    classes = classes.filter(c => allowed.has(String(c.courseId || '')));
  }
  if (f.search !== undefined && f.search !== null && String(f.search).trim() !== '') {
    const q = String(f.search).trim();
    classes = classes.filter(c => _searchMatch(c, q));
  }
  classes.sort((x, y) => String(x.name || '').localeCompare(String(y.name || '')));
  return classes.map(c => ({ ...c }));
}

function getClass(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const classes = _classes(_readStore());
  const idx = _findIndexByTenant(classes, id, tid);
  if (idx < 0) return null;
  return { ...classes[idx] };
}

function createClass(tenantContext, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateClass(input, true);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const classes = _classes(doc);

  // Relationships first: a cross-tenant, missing or archived parent must never
  // reach the store, and never leaves a code reserved as a side effect.
  _assertCourseInTenant(tid, clean.courseId);
  _assertTeacherInTenant(tid, clean.teacherId);

  const classCode = clean.classCode || _generateId('CLS').toUpperCase();
  _assertClassCodeAvailable(classes, tid, classCode);

  const now = _now();
  const record = {
    id: _generateId('cls'),
    tenantId: tid,
    courseId: String(clean.courseId).trim(),
    teacherId: String(clean.teacherId).trim(),
    classCode,
    name: clean.name || '',
    displayName: _displayName(clean),
    description: clean.description || '',
    status: clean.status || 'active',
    notes: clean.notes || '',
    createdAt: now,
    updatedAt: now
  };
  // `fee` exists only when actually supplied and non-empty: a Class without a
  // price carries NO fee key (so the pinned record shape for a fee-less create
  // is unchanged), and revenue for it is unclaimable rather than 0.
  if (typeof clean.fee === 'string' && clean.fee !== '') {
    record.fee = clean.fee;
  }
  classes.push(record);
  _writeStore({ ...doc, classes });
  return { ...record };
}

function updateClass(tenantContext, id, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateClass(input, false);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const classes = _classes(doc);
  const idx = _findIndexByTenant(classes, id, tid);
  if (idx < 0) return null;

  // Validated whenever the client SUPPLIED a relationship, and always BEFORE any
  // write. After _validateClass, a supplied value is guaranteed non-empty, so an
  // own property is the correct test here — a truthiness test would silently
  // skip validation for any falsy value that slipped through. Because both
  // checks run before the classCode check and before the merge, a rejected
  // parent leaves BOTH stored relationships untouched.
  if (Object.prototype.hasOwnProperty.call(clean, 'courseId')) {
    _assertCourseInTenant(tid, clean.courseId);
  }
  if (Object.prototype.hasOwnProperty.call(clean, 'teacherId')) {
    _assertTeacherInTenant(tid, clean.teacherId);
  }
  if (clean.classCode) {
    _assertClassCodeAvailable(classes, tid, clean.classCode, classes[idx].id);
  }

  const base = { ...classes[idx] };
  const merged = { ...base, ...clean };
  const next = {
    ...merged,
    id: base.id,
    tenantId: tid,
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  // A rename refreshes the derived displayName only when the stored value was
  // DERIVED rather than client-supplied.
  if (!Object.prototype.hasOwnProperty.call(clean, 'displayName') && clean.name !== undefined) {
    if (String(base.displayName || '').trim() === String(base.name || '').trim()) {
      next.displayName = String(merged.name || '').trim();
    }
  }
  // An explicitly supplied empty fee CLEARS it: the key is deleted, returning
  // the record to the fee-less shape it had before any price was set. A fee
  // that is simply Omitted is never touched (it lives in `merged` only when
  // the client actually sent it).
  if (Object.prototype.hasOwnProperty.call(clean, 'fee') && clean.fee === '') {
    delete next.fee;
  }
  classes[idx] = next;
  _writeStore({ ...doc, classes });
  return { ...next };
}

// Archive PRESERVES the record and never cascades. Archiving a Class touches
// nothing else; Students, Teachers, Centers, Programs and Courses keep their
// own state, and existing Classes stay readable after a Teacher, Course, Program
// or Center is archived.
function archiveClass(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const doc = _readStore();
  const classes = _classes(doc);
  const idx = _findIndexByTenant(classes, id, tid);
  if (idx < 0) return null;

  const base = { ...classes[idx] };
  const next = {
    ...base,
    id: base.id,
    tenantId: tid,
    status: 'archived',
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  classes[idx] = next;
  _writeStore({ ...doc, classes });
  return { ...next };
}

module.exports = {
  listClasses,
  getClass,
  createClass,
  updateClass,
  archiveClass,
  CLASS_STATUSES,
  WRITABLE_FIELDS,
  FORBIDDEN_FIELDS,
  LATER_PHASE_FIELDS,
  ClassCodeConflictError,
  ReferenceValidationError,
  STORE_KEY
};
