'use strict';

// course.service.js - STU-5 Education Course records (Device 2).
//
// Follows the STU-2 student / STU-3 teacher / STU-4 center / STU-5 program
// service pattern deliberately rather than introducing a shared Education
// repository helper.
//
// DOMAIN SHAPE.
//   Center -> Program -> Course. All three live INSIDE the same existing
//   tenant. A Course's `programId` is REQUIRED and is the single ownership
//   reference: the Course reaches its Center through
//   Course -> Program -> centerId. A Course therefore has NO centerId of its
//   own, so two potentially conflicting ownership references can never exist.
//
//   programId is validated on every create and on every update that supplies
//   it: the Program must exist, must belong to the SAME trusted tenant, and
//   must not be archived. A Program belonging to another tenant is
//   indistinguishable from one that does not exist — the existing not-found
//   convention — so cross-tenant relationships fail closed without leaking
//   existence.
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
// SCOPE — an operational Course directory ONLY. It carries no teacherId,
// studentId, classId, enrollmentId, centerId, price, tuition, payment,
// billing, revenue, payroll, account or credential field. Teacher assignment
// belongs to Classes, a later phase.

const storageAdapter = require('../repositories/storageAdapter');
const programService = require('./program.service');
const logger = require('../utils/logger');

const STORE_KEY = 'educationCourses';

// Allowed lifecycle states. Anything else is rejected at the service layer.
const COURSE_STATUSES = Object.freeze(['active', 'inactive', 'archived']);

// Descriptive duration units. Descriptive metadata only: this file implements
// NO scheduling calculation, calendar behaviour or date-range engine.
const DURATION_UNITS = Object.freeze(['days', 'weeks', 'months']);

// EXPLICIT WRITE WHITELIST with per-key kinds. `programId` is REQUIRED.
// `durationValue` is the only numeric field; everything else is a string.
const WRITABLE_FIELDS = Object.freeze({
  programId: 'string',
  courseCode: 'string',
  name: 'string',
  displayName: 'string',
  description: 'string',
  level: 'string',
  durationValue: 'number',
  durationUnit: 'string',
  status: 'string',
  notes: 'string'
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

// Relationships that belong to later phases (classes, enrollment, teacher
// assignment). `centerId` is included on purpose: a Course owns no Center
// reference of its own, because ownership is derived through programId and a
// second reference could silently disagree with it.
const LATER_PHASE_FIELDS = Object.freeze([
  'teacherId',
  'studentId',
  'classId',
  'enrollmentId',
  'centerId'
]);

// Maximum length applied to every string field.
const MAX_STRING_LEN = 160;

// Bounds for the descriptive duration value.
const MIN_DURATION_VALUE = 1;
const MAX_DURATION_VALUE = 1000;

// Raised when courseCode collides inside the trusted tenant. The controller
// maps this to 409 with the repository's `{ code }` details convention.
class CourseCodeConflictError extends Error {
  constructor(courseCode) {
    super('courseCode already exists for this tenant: ' + courseCode);
    this.name = 'CourseCodeConflictError';
    this.code = 'COURSE_CODE_CONFLICT';
    this.courseCode = courseCode;
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
  return { courses: [] };
}

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('course.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(doc) {
  try {
    storageAdapter.write(STORE_KEY, doc);
  } catch (err) {
    logger.warn('course.service: failed to write store', err.message);
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

function _courses(doc) {
  return Array.isArray(doc.courses) ? doc.courses : [];
}

// Returns a fresh object built only from whitelisted keys, each coerced to its
// declared kind.
function _sanitizeWritable(payload) {
  const src = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
  const clean = {};
  for (const [key, kind] of Object.entries(WRITABLE_FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    const value = src[key];
    if (value === null) {
      clean[key] = kind === 'number' ? null : '';
      continue;
    }
    if (kind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(key + ' must be a number');
      }
      clean[key] = value;
      continue;
    }
    if (typeof value !== 'string') throw new Error(key + ' must be a string');
    clean[key] = value.trim().slice(0, MAX_STRING_LEN);
  }
  return clean;
}

// Returns an array of human-readable errors, or an empty array when valid.
// `forCreate` is true for create and false for partial update.
function _validateCourse(data, forCreate) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }

  if (forCreate) {
    if (data.name === undefined || data.name === null || String(data.name).trim() === '') {
      errors.push('name is required');
    }
    if (data.programId === undefined || data.programId === null || String(data.programId).trim() === '') {
      errors.push('programId is required');
    }
  }

  // The parent relationship may be REASSIGNED on update, but it can never be
  // CLEARED. An explicitly supplied null / undefined / empty / whitespace-only
  // programId is a client attempt to orphan the Course, so it is rejected here
  // rather than silently written as programId: ''. A genuinely OMITTED
  // programId is not an own property of `data` at all, so it never reaches this
  // branch and the existing parent is preserved.
  if (!forCreate && Object.prototype.hasOwnProperty.call(data, 'programId')) {
    const pid = data.programId;
    if (pid === null || pid === undefined || String(pid).trim() === '') {
      errors.push('programId cannot be cleared');
    }
  }

  for (const [key, kind] of Object.entries(WRITABLE_FIELDS)) {
    const value = data[key];
    if (value === undefined || value === null) continue;
    if (kind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push(key + ' must be a number');
      }
      continue;
    }
    if (typeof value !== 'string') {
      errors.push(key + ' must be a string');
      continue;
    }
    if (value.length > MAX_STRING_LEN) {
      errors.push(key + ' must be at most ' + MAX_STRING_LEN + ' characters');
    }
  }

  if (data.status !== undefined && data.status !== null && String(data.status).trim() !== '' &&
      !COURSE_STATUSES.includes(String(data.status).trim())) {
    errors.push('status must be one of: ' + COURSE_STATUSES.join(', '));
  }

  if (data.durationUnit !== undefined && data.durationUnit !== null && String(data.durationUnit).trim() !== '' &&
      !DURATION_UNITS.includes(String(data.durationUnit).trim())) {
    errors.push('durationUnit must be one of: ' + DURATION_UNITS.join(', '));
  }

  // Descriptive metadata only, but it must be a positive bounded number.
  if (data.durationValue !== undefined && data.durationValue !== null) {
    const v = data.durationValue;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < MIN_DURATION_VALUE || v > MAX_DURATION_VALUE) {
      errors.push('durationValue must be an integer between ' + MIN_DURATION_VALUE + ' and ' + MAX_DURATION_VALUE);
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

// Look up a course by id AND trusted tenant. Returns -1 when absent, never
// leaking cross-tenant existence.
function _findIndexByTenant(courses, id, tenantId) {
  return courses.findIndex(
    c => String(c.id || '') === String(id) && String(c.tenantId || '') === tenantId
  );
}

// courseCode is an identifier WITHIN a tenant, so uniqueness is scoped to the
// trusted tenant and only over CURRENT (non-archived) records — the same
// semantics STU-3/STU-4/STU-5-program use. Two tenants may hold the same code.
function _assertCourseCodeAvailable(courses, tenantId, courseCode, excludeId) {
  const code = String(courseCode || '').trim();
  if (!code) return;
  const clash = courses.find(c =>
    String(c.tenantId || '') === tenantId &&
    String(c.courseCode || '').trim() === code &&
    c.status !== 'archived' &&
    String(c.id || '') !== String(excludeId || '')
  );
  if (clash) throw new CourseCodeConflictError(code);
}

// The REQUIRED Program reference. It must exist inside the trusted tenant and
// must not be archived, so a Course can never hang off a dead or foreign
// parent. A foreign Program is indistinguishable from a missing one.
function _assertProgramInTenant(tenantId, programId) {
  const id = String(programId || '').trim();
  if (!id) return;
  const found = programService.getProgram({ tenantId }, id);
  if (!found) throw new ReferenceValidationError('programId does not reference a Program in this tenant');
  if (found.status === 'archived') {
    throw new ReferenceValidationError('programId must reference a non-archived Program');
  }
}

function _searchMatch(course, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return [course.courseCode, course.name, course.displayName, course.description]
    .map(v => String(v || '').toLowerCase())
    .some(v => v.includes(q));
}

function _validationError(errors) {
  const err = new Error(errors.join('; '));
  err.validation = errors;
  return err;
}

// displayName defaults to the course name when the client omits it.
function _displayName(clean) {
  const explicit = String(clean.displayName || '').trim();
  if (explicit) return explicit;
  return String(clean.name || '').trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function listCourses(tenantContext, filters) {
  const tid = _requireTenantId(tenantContext);
  const f = (filters && typeof filters === 'object') ? filters : {};
  let courses = _courses(_readStore()).filter(c => String(c.tenantId || '') === tid);
  if (f.status !== undefined && f.status !== null && String(f.status).trim() !== '') {
    const st = String(f.status).trim();
    if (COURSE_STATUSES.includes(st)) {
      courses = courses.filter(c => c.status === st);
    }
  }
  if (f.programId !== undefined && f.programId !== null && String(f.programId).trim() !== '') {
    const pid = String(f.programId).trim();
    courses = courses.filter(c => String(c.programId || '') === pid);
  }
  if (f.search !== undefined && f.search !== null && String(f.search).trim() !== '') {
    const q = String(f.search).trim();
    courses = courses.filter(c => _searchMatch(c, q));
  }
  courses.sort((x, y) => String(x.name || '').localeCompare(String(y.name || '')));
  return courses.map(c => ({ ...c }));
}

function getCourse(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const courses = _courses(_readStore());
  const idx = _findIndexByTenant(courses, id, tid);
  if (idx < 0) return null;
  return { ...courses[idx] };
}

function createCourse(tenantContext, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateCourse(input, true);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const courses = _courses(doc);

  // Relationship first: a cross-tenant, missing or archived Program must never
  // reach the store, and never leaves a code reserved as a side effect.
  _assertProgramInTenant(tid, clean.programId);

  const courseCode = clean.courseCode || _generateId('CRS').toUpperCase();
  _assertCourseCodeAvailable(courses, tid, courseCode);

  const now = _now();
  const record = {
    id: _generateId('crs'),
    tenantId: tid,
    programId: String(clean.programId).trim(),
    courseCode,
    name: clean.name,
    displayName: _displayName(clean),
    description: clean.description || '',
    level: clean.level || '',
    durationValue: clean.durationValue === undefined ? null : clean.durationValue,
    durationUnit: clean.durationUnit || '',
    status: clean.status || 'active',
    notes: clean.notes || '',
    createdAt: now,
    updatedAt: now
  };
  courses.push(record);
  _writeStore({ ...doc, courses });
  return { ...record };
}

function updateCourse(tenantContext, id, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateCourse(input, false);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const courses = _courses(doc);
  const idx = _findIndexByTenant(courses, id, tid);
  if (idx < 0) return null;

  // Validated whenever the client SUPPLIED a programId. After
  // _validateCourse, a supplied value is guaranteed non-empty, so an own
  // property is the correct test here — a truthiness test would silently skip
  // validation for any falsy value that slipped through.
  if (Object.prototype.hasOwnProperty.call(clean, 'programId')) {
    _assertProgramInTenant(tid, clean.programId);
  }
  if (clean.courseCode) {
    _assertCourseCodeAvailable(courses, tid, clean.courseCode, courses[idx].id);
  }

  const base = { ...courses[idx] };
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
  courses[idx] = next;
  _writeStore({ ...doc, courses });
  return { ...next };
}

// Archive PRESERVES the record and never cascades. Archiving a Course touches
// nothing else; the Program and Center keep their own state.
function archiveCourse(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const doc = _readStore();
  const courses = _courses(doc);
  const idx = _findIndexByTenant(courses, id, tid);
  if (idx < 0) return null;

  const base = { ...courses[idx] };
  const next = {
    ...base,
    id: base.id,
    tenantId: tid,
    status: 'archived',
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  courses[idx] = next;
  _writeStore({ ...doc, courses });
  return { ...next };
}

module.exports = {
  listCourses,
  getCourse,
  createCourse,
  updateCourse,
  archiveCourse,
  COURSE_STATUSES,
  DURATION_UNITS,
  WRITABLE_FIELDS,
  FORBIDDEN_FIELDS,
  LATER_PHASE_FIELDS,
  CourseCodeConflictError,
  ReferenceValidationError,
  STORE_KEY
};