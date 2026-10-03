'use strict';

// teacher.service.js - STU-3 Teacher records (Device 2).
//
// Follows the STU-2 student.service.js pattern deliberately rather than
// introducing a shared Education repository helper: at this size the
// established per-entity service is the smaller, safer change.
//
// Tenant isolation is structural, not incidental:
//   - The tenant is taken ONLY from the trusted server-side context the
//     controller passes in (built by the canonical `trustedTenantId(req)`).
//     It is NEVER read from req.query.tenantId, req.body.tenantId, a
//     `tenantId` header, a `companyId` header, or a `branchId` header. There
//     is no second tenant resolver in this file.
//   - With no trusted tenant every public method throws 'Tenant context is
//     required'. The service never returns a shared collection, never falls
//     back to a default tenant, never invents a tenant, and never silently
//     creates a global record.
//   - tenantId is SERVER-OWNED and IMMUTABLE: stamped on create and
//     re-asserted on every update and archive. A client-supplied tenantId is
//     REJECTED, not silently dropped.
//   - EXPLICIT FIELD WHITELIST. Client payloads are never spread into a
//     persisted record, so the blind-spread re-parenting defect seen in
//     customers.service.js cannot exist here by construction.
//
// SCOPE — this file is the operational Teacher directory ONLY. It carries no
// salary, payroll, bank account, compensation, billing or payment field, and
// no credential of any kind: no password, no token, no secret. The ONE
// identity field is `userId`, an optional link to an existing authenticated
// account that is SERVER-OWNED and written exclusively by `linkUser` /
// `unlinkUser` (exposed as Owner/Admin-only routes). It never appears in
// WRITABLE_FIELDS, so a generic create/update can never set or move it, and
// unlinking deletes the key entirely. Payroll remains out of scope.

const storageAdapter = require('../repositories/storageAdapter');
const usersService = require('./users.service');
const logger = require('../utils/logger');

const STORE_KEY = 'educationTeachers';

// Allowed lifecycle states. Anything else is rejected at the service layer.
const TEACHER_STATUSES = Object.freeze(['active', 'inactive', 'archived']);

// Descriptive, non-financial employment classification. Deliberately carries
// NO compensation, rate, or billing semantics.
const EMPLOYMENT_TYPES = Object.freeze(['full_time', 'part_time', 'contract']);

// EXPLICIT WRITE WHITELIST. A key absent from this object can never be
// persisted from client input. `tenantId` is deliberately absent - tenant
// ownership is server-owned and immutable.
const WRITABLE_FIELDS = Object.freeze({
  teacherCode: 'string',
  firstName: 'string',
  lastName: 'string',
  displayName: 'string',
  dateOfBirth: 'string',
  gender: 'string',
  phone: 'string',
  email: 'string',
  address: 'string',
  specialization: 'string',
  qualification: 'string',
  employmentType: 'string',
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
  'createdAt',
  'updatedAt'
]);

// Maximum length applied to every string field.
const MAX_STRING_LEN = 160;

// Raised when teacherCode collides inside the trusted tenant. The controller
// maps this to 409 with the repository's `{ code }` details convention.
class TeacherCodeConflictError extends Error {
  constructor(teacherCode) {
    super('teacherCode already exists for this tenant: ' + teacherCode);
    this.name = 'TeacherCodeConflictError';
    this.code = 'TEACHER_CODE_CONFLICT';
    this.teacherCode = teacherCode;
    this.conflict = true;
  }
}

// Raised when a link cannot be created because one of the two sides is already
// linked elsewhere. Mapped to 409 with the repository's `{ code }` convention.
class TeacherLinkConflictError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TeacherLinkConflictError';
    this.code = code;
    this.conflict = true;
  }
}

function _defaultDoc() {
  return { teachers: [] };
}

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('teacher.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(doc) {
  try {
    storageAdapter.write(STORE_KEY, doc);
  } catch (err) {
    logger.warn('teacher.service: failed to write store', err.message);
  }
}

// The ONLY tenant source in this file: the trusted context object handed in
// by the controller. Mirrors the established student / educationPack
// convention. Returns null when absent - never a default, never a fallback.
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

function _teachers(doc) {
  return Array.isArray(doc.teachers) ? doc.teachers : [];
}

// Returns a fresh object built only from whitelisted keys. The caller never
// spreads client input into a persisted record.
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
function _validateTeacher(data, forCreate) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }

  if (forCreate) {
    if (data.firstName === undefined || data.firstName === null || String(data.firstName).trim() === '') {
      errors.push('firstName is required');
    }
    if (data.lastName === undefined || data.lastName === null || String(data.lastName).trim() === '') {
      errors.push('lastName is required');
    }
  }

  for (const key of Object.keys(WRITABLE_FIELDS)) {
    if (data[key] !== undefined && data[key] !== null && typeof data[key] !== 'string') {
      errors.push(key + ' must be a string');
    }
  }

  // Oversized input is rejected outright rather than silently truncated on the
  // create/update call. (Stored values are still capped defensively.)
  for (const key of Object.keys(WRITABLE_FIELDS)) {
    const value = data[key];
    if (typeof value === 'string' && value.length > MAX_STRING_LEN) {
      errors.push(key + ' must be at most ' + MAX_STRING_LEN + ' characters');
    }
  }

  if (data.status !== undefined && data.status !== null && String(data.status).trim() !== '' &&
      !TEACHER_STATUSES.includes(String(data.status).trim())) {
    errors.push('status must be one of: ' + TEACHER_STATUSES.join(', '));
  }

  if (data.employmentType !== undefined && data.employmentType !== null && String(data.employmentType).trim() !== '' &&
      !EMPLOYMENT_TYPES.includes(String(data.employmentType).trim())) {
    errors.push('employmentType must be one of: ' + EMPLOYMENT_TYPES.join(', '));
  }

  if (data.dateOfBirth !== undefined && data.dateOfBirth !== null && String(data.dateOfBirth).trim() !== '' &&
      !/^\d{4}-\d{2}-\d{2}$/.test(String(data.dateOfBirth).trim())) {
    errors.push('dateOfBirth must be YYYY-MM-DD');
  }

  if (data.email !== undefined && data.email !== null && String(data.email).trim() !== '' &&
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(data.email).trim())) {
    errors.push('email is invalid');
  }

  // Reject prototype-pollution payloads: a key named __proto__ on a plain
  // object literal is not an own property, so hasOwnProperty catches it.
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

  return errors;
}

// Look up a teacher by id AND trusted tenant. Returns -1 when absent, never
// leaking cross-tenant existence.
function _findIndexByTenant(teachers, id, tenantId) {
  return teachers.findIndex(
    t => String(t.id || '') === String(id) && String(t.tenantId || '') === tenantId
  );
}

// teacherCode is an identifier WITHIN a tenant, so uniqueness is scoped to the
// trusted tenant and only over CURRENT (non-archived) records. An archived
// teacher releases its code, which is what makes archive-then-recreate a safe
// flow. Two tenants may legitimately hold the same code.
function _assertTeacherCodeAvailable(teachers, tenantId, teacherCode, excludeId) {
  const code = String(teacherCode || '').trim();
  if (!code) return;
  const clash = teachers.find(t =>
    String(t.tenantId || '') === tenantId &&
    String(t.teacherCode || '').trim() === code &&
    t.status !== 'archived' &&
    String(t.id || '') !== String(excludeId || '')
  );
  if (clash) throw new TeacherCodeConflictError(code);
}

// Stable display name: prefer an explicit displayName, else "first last".
function _displayName(clean) {
  const explicit = String(clean.displayName || '').trim();
  if (explicit) return explicit;
  return [String(clean.firstName || '').trim(), String(clean.lastName || '').trim()]
    .filter(Boolean).join(' ');
}

function _searchMatch(teacher, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return [
    teacher.teacherCode,
    teacher.firstName,
    teacher.lastName,
    teacher.displayName,
    teacher.email,
    teacher.specialization
  ]
    .map(v => String(v || '').toLowerCase())
    .some(v => v.includes(q));
}

function _validationError(errors) {
  const err = new Error(errors.join('; '));
  err.validation = errors;
  return err;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function listTeachers(tenantContext, filters) {
  const tid = _requireTenantId(tenantContext);
  const f = (filters && typeof filters === 'object') ? filters : {};
  let teachers = _teachers(_readStore()).filter(t => String(t.tenantId || '') === tid);
  if (f.status !== undefined && f.status !== null && String(f.status).trim() !== '') {
    const st = String(f.status).trim();
    if (TEACHER_STATUSES.includes(st)) {
      teachers = teachers.filter(t => t.status === st);
    }
  }
  if (f.employmentType !== undefined && f.employmentType !== null && String(f.employmentType).trim() !== '') {
    const et = String(f.employmentType).trim();
    if (EMPLOYMENT_TYPES.includes(et)) {
      teachers = teachers.filter(t => t.employmentType === et);
    }
  }
  if (f.search !== undefined && f.search !== null && String(f.search).trim() !== '') {
    const q = String(f.search).trim();
    teachers = teachers.filter(t => _searchMatch(t, q));
  }
  teachers.sort((x, y) => String(x.lastName || '').localeCompare(String(y.lastName || '')));
  return teachers.map(t => ({ ...t }));
}

function getTeacher(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const teachers = _teachers(_readStore());
  const idx = _findIndexByTenant(teachers, id, tid);
  if (idx < 0) return null;
  return { ...teachers[idx] };
}

function createTeacher(tenantContext, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateTeacher(input, true);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const teachers = _teachers(doc);

  // Generated when the client omits a code. Random enough that a collision is
  // practically impossible, but still checked so the guarantee is real.
  const teacherCode = clean.teacherCode || _generateId('TCH').toUpperCase();
  _assertTeacherCodeAvailable(teachers, tid, teacherCode);

  const now = _now();
  const record = {
    id: _generateId('tch'),
    tenantId: tid,
    teacherCode,
    firstName: clean.firstName,
    lastName: clean.lastName,
    displayName: _displayName({ ...clean, firstName: clean.firstName, lastName: clean.lastName }),
    dateOfBirth: clean.dateOfBirth || '',
    gender: clean.gender || '',
    phone: clean.phone || '',
    email: clean.email || '',
    address: clean.address || '',
    specialization: clean.specialization || '',
    qualification: clean.qualification || '',
    employmentType: clean.employmentType || '',
    status: clean.status || 'active',
    notes: clean.notes || '',
    createdAt: now,
    updatedAt: now
  };
  teachers.push(record);
  _writeStore({ ...doc, teachers });
  return { ...record };
}

function updateTeacher(tenantContext, id, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateTeacher(input, false);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const teachers = _teachers(doc);
  const idx = _findIndexByTenant(teachers, id, tid);
  if (idx < 0) return null;

  if (clean.teacherCode) {
    _assertTeacherCodeAvailable(teachers, tid, clean.teacherCode, teachers[idx].id);
  }

  const base = { ...teachers[idx] };
  const merged = { ...base, ...clean };
  const next = {
    ...merged,
    id: base.id,
    tenantId: tid,
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  // A rename refreshes the derived display name only when the stored value was
  // DERIVED rather than client-supplied. There is no extra flag to persist, so
  // it is detected deterministically: the stored displayName still equals the
  // name it would have been derived from before the rename. A custom value
  // (e.g. 'Dr. Omar') does not match and is therefore preserved.
  //
  // The new name is always built from the MERGED first/last name, never from
  // `merged.displayName`, which still holds the pre-rename value and would
  // otherwise win over the new one.
  if (!Object.prototype.hasOwnProperty.call(clean, 'displayName') &&
      (clean.firstName !== undefined || clean.lastName !== undefined)) {
    const derivedBefore = [base.firstName, base.lastName]
      .map(v => String(v || '').trim())
      .filter(Boolean).join(' ');
    if (String(base.displayName || '').trim() === derivedBefore) {
      next.displayName = [merged.firstName, merged.lastName]
        .map(v => String(v || '').trim())
        .filter(Boolean).join(' ');
    }
  }
  teachers[idx] = next;
  _writeStore({ ...doc, teachers });
  return { ...next };
}

function archiveTeacher(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const doc = _readStore();
  const teachers = _teachers(doc);
  const idx = _findIndexByTenant(teachers, id, tid);
  if (idx < 0) return null;

  const base = { ...teachers[idx] };
  const next = {
    ...base,
    id: base.id,
    tenantId: tid,
    status: 'archived',
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  teachers[idx] = next;
  _writeStore({ ...doc, teachers });
  return { ...next };
}

// ---------------------------------------------------------------------------
// Account link (P2 Teacher portal)
// ---------------------------------------------------------------------------

// The teacher record linked to this signed-in account inside THIS tenant, or
// null. This is the only lookup the ownership layer performs: it never guesses
// from a claim, and it never crosses tenants.
function getTeacherByUserId(tenantContext, userId) {
  const tid = _requireTenantId(tenantContext);
  if (userId === undefined || userId === null || String(userId).trim() === '') return null;
  const uid = String(userId).trim();
  const found = _teachers(_readStore()).find(
    t => String(t.tenantId || '') === tid && String(t.userId || '') === uid
  );
  return found ? { ...found } : null;
}

// Owner/Admin-only route: bind an existing authenticated account to this
// teacher inside this tenant. Server-owned in both directions:
//   - `userId` stays out of WRITABLE_FIELDS/FORBIDDEN_FIELDS as before: only
//     this function writes it, and only a link row that exists can be read;
//   - one account links to AT MOST one teacher per tenant and one teacher
//     holds AT MOST one account (a repeat of the same pair is an idempotent
//     no-op; a different pair is a typed 409);
//   - the account must exist and, when it carries a tenant binding, it must
//     be bound to THIS tenant — a cross-tenant link is refused, never repaired.
function linkUser(tenantContext, id, userId) {
  const tid = _requireTenantId(tenantContext);
  if (userId === undefined || userId === null || String(userId).trim() === '') {
    throw _validationError(['userId is required']);
  }
  const uid = String(userId).trim().slice(0, MAX_STRING_LEN);

  const doc = _readStore();
  const teachers = _teachers(doc);
  const idx = _findIndexByTenant(teachers, id, tid);
  if (idx < 0) return null;

  const user = usersService.getById(uid);
  if (!user) {
    throw _validationError(['userId does not reference an existing user']);
  }
  if (user.tenantId !== undefined && user.tenantId !== null && String(user.tenantId) !== '' &&
      String(user.tenantId) !== tid) {
    throw _validationError(['userId is bound to a different tenant']);
  }

  const base = { ...teachers[idx] };
  if (String(base.userId || '') === uid) return { ...base }; // idempotent re-link

  if (base.userId !== undefined && base.userId !== null && String(base.userId) !== '') {
    throw new TeacherLinkConflictError(
      'TEACHER_ALREADY_LINKED',
      'this teacher is already linked to an account; unlink it first'
    );
  }
  const taken = teachers.find(
    t => String(t.tenantId || '') === tid && String(t.userId || '') === uid
  );
  if (taken) {
    throw new TeacherLinkConflictError(
      'USER_ALREADY_LINKED',
      'this account is already linked to another teacher in this tenant'
    );
  }

  const next = { ...base, userId: uid, updatedAt: _now() };
  teachers[idx] = next;
  _writeStore({ ...doc, teachers });
  return { ...next };
}

// Clears the link. The `userId` KEY is deleted (not blanked), so an unlinked
// record is byte-identical to one that was never linked. Idempotent: unlinking
// an unlinked teacher returns the record untouched.
function unlinkUser(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const doc = _readStore();
  const teachers = _teachers(doc);
  const idx = _findIndexByTenant(teachers, id, tid);
  if (idx < 0) return null;

  const base = { ...teachers[idx] };
  if (base.userId === undefined || base.userId === null || String(base.userId) === '') {
    return { ...base };
  }
  const next = { ...base, updatedAt: _now() };
  delete next.userId;
  teachers[idx] = next;
  _writeStore({ ...doc, teachers });
  return { ...next };
}

module.exports = {
  listTeachers,
  getTeacher,
  createTeacher,
  updateTeacher,
  archiveTeacher,
  getTeacherByUserId,
  linkUser,
  unlinkUser,
  TEACHER_STATUSES,
  EMPLOYMENT_TYPES,
  WRITABLE_FIELDS,
  FORBIDDEN_FIELDS,
  TeacherCodeConflictError,
  TeacherLinkConflictError,
  STORE_KEY
};