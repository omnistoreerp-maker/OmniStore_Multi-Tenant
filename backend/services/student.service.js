'use strict';

// student.service.js - STU-2 Student records (Device 2).
//
// Tenant isolation is structural, not incidental:
//   - The tenant is taken ONLY from the trusted server-side context the
//     controller passes in (built by the canonical `trustedTenantId(req)`).
//     It is NEVER read from req.query.tenantId, req.body.tenantId, a
//     `tenantId` header, or a `companyId` header. There is no second tenant
//     resolver in this file.
//   - With no trusted tenant every public method throws 'Tenant context is
//     required'. The service never returns a shared collection, never falls
//     back to a default tenant, never invents a tenant, and never silently
//     creates a global record.
//   - tenantId is SERVER-OWNED and IMMUTABLE: stamped on create and
//     re-asserted on every update. A client-supplied tenantId is IGNORED.
//   - EXPLICIT FIELD WHITELIST. Client payloads are never spread into a
//     persisted record. Only whitelisted keys are copied, and only after a
//     type check, so the blind-spread re-parenting defect seen in
//     customers.service.js cannot exist here by construction.

const storageAdapter = require('../repositories/storageAdapter');
const usersService = require('./users.service');
const logger = require('../utils/logger');

const STORE_KEY = 'educationStudents';

// Allowed lifecycle states. Anything else is rejected at the service layer.
const STUDENT_STATUSES = Object.freeze(['active', 'inactive', 'archived']);

// EXPLICIT WRITE WHITELIST. A key absent from this object can never be
// persisted from client input. `tenantId` is deliberately absent - tenant
// ownership is server-owned and immutable.
const WRITABLE_FIELDS = Object.freeze({
  studentCode: 'string',
  firstName: 'string',
  lastName: 'string',
  dateOfBirth: 'string',
  gender: 'string',
  phone: 'string',
  email: 'string',
  address: 'string',
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

// Typed conflict raised when a user↔student link already exists in the
// opposite direction. Mirrors CenterLinkConflictError: the controller maps
// `err.conflict === true` to HTTP 409 with the typed `code` (USER_ALREADY_LINKED
// / STUDENT_ALREADY_LINKED).
class StudentLinkConflictError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StudentLinkConflictError';
    this.code = code;
    this.conflict = true;
  }
}

function _defaultDoc() {
  return { students: [] };
}

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('student.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(doc) {
  try {
    storageAdapter.write(STORE_KEY, doc);
  } catch (err) {
    logger.warn('student.service: failed to write store', err.message);
  }
}

// The ONLY tenant source in this file: the trusted context object handed in
// by the controller. Mirrors the established studentServicesPack / educationPack
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

function _students(doc) {
  return Array.isArray(doc.students) ? doc.students : [];
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
function _validateStudent(data, forCreate) {
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

  if (data.status !== undefined && data.status !== null && String(data.status).trim() !== '' &&
      !STUDENT_STATUSES.includes(String(data.status).trim())) {
    errors.push('status must be one of: ' + STUDENT_STATUSES.join(', '));
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

// Look up a student by id AND trusted tenant. Returns null when absent, never
// leaking cross-tenant existence.
function _findIndexByTenant(students, id, tenantId) {
  return students.findIndex(
    s => String(s.id || '') === String(id) && String(s.tenantId || '') === tenantId
  );
}

function _searchMatch(student, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return [student.firstName, student.lastName, student.studentCode, student.email, student.phone]
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

function listStudents(tenantContext, filters) {
  const tid = _requireTenantId(tenantContext);
  const f = (filters && typeof filters === 'object') ? filters : {};
  let students = _students(_readStore()).filter(s => String(s.tenantId || '') === tid);
  if (f.status !== undefined && f.status !== null && String(f.status).trim() !== '') {
    const st = String(f.status).trim();
    if (STUDENT_STATUSES.includes(st)) {
      students = students.filter(s => s.status === st);
    }
  }
  if (f.search !== undefined && f.search !== null && String(f.search).trim() !== '') {
    const q = String(f.search).trim();
    students = students.filter(s => _searchMatch(s, q));
  }
  students.sort((x, y) => String(x.lastName || '').localeCompare(String(y.lastName || '')));
  return students.map(s => ({ ...s }));
}

function getStudent(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const students = _students(_readStore());
  const idx = _findIndexByTenant(students, id, tid);
  if (idx < 0) return null;
  return { ...students[idx] };
}

function createStudent(tenantContext, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateStudent(input, true);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const students = _students(doc);
  const now = _now();
  const record = {
    id: _generateId('std'),
    tenantId: tid,
    studentCode: clean.studentCode || _generateId('STU').toUpperCase(),
    firstName: clean.firstName,
    lastName: clean.lastName,
    dateOfBirth: clean.dateOfBirth || '',
    gender: clean.gender || '',
    phone: clean.phone || '',
    email: clean.email || '',
    address: clean.address || '',
    status: clean.status || 'active',
    notes: clean.notes || '',
    createdAt: now,
    updatedAt: now
  };
  students.push(record);
  _writeStore({ ...doc, students });
  return { ...record };
}

function updateStudent(tenantContext, id, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateStudent(input, false);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const students = _students(doc);
  const idx = _findIndexByTenant(students, id, tid);
  if (idx < 0) return null;

  const base = { ...students[idx] };
  const next = {
    ...base,
    ...clean,
    id: base.id,
    tenantId: tid,
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  students[idx] = next;
  _writeStore({ ...doc, students });
  return { ...next };
}

function archiveStudent(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const doc = _readStore();
  const students = _students(doc);
  const idx = _findIndexByTenant(students, id, tid);
  if (idx < 0) return null;

  const base = { ...students[idx] };
  const next = {
    ...base,
    id: base.id,
    tenantId: tid,
    status: 'archived',
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  students[idx] = next;
  _writeStore({ ...doc, students });
  return { ...next };
}

// Look up a student by its linked user id inside THIS tenant, or null.
function getStudentByUserId(tenantContext, userId) {
  const tid = _requireTenantId(tenantContext);
  if (userId === undefined || userId === null || String(userId).trim() === '') return null;
  const uid = String(userId).trim();
  const found = _students(_readStore()).find(
    s => String(s.tenantId || '') === tid && String(s.userId || '') === uid
  );
  return found ? { ...found } : null;
}

// Owner/Admin-only route: bind an existing authenticated account to this
// student inside this tenant. Server-owned in both directions:
//   - `userId` stays out of WRITABLE_FIELDS/FORBIDDEN_FIELDS as before;
//   - one account links to AT MOST one student per tenant and one student
//     holds AT MOST one account (repeat of same pair = idempotent no-op;
//     different pair = typed 409);
//   - the account must exist and, when tenant-bound, must be bound to THIS
//     tenant — a cross-tenant link is refused, never repaired.
function linkUser(tenantContext, id, userId) {
  const tid = _requireTenantId(tenantContext);
  if (userId === undefined || userId === null || String(userId).trim() === '') {
    throw _validationError(['userId is required']);
  }
  const uid = String(userId).trim().slice(0, MAX_STRING_LEN);

  const doc = _readStore();
  const students = _students(doc);
  const idx = _findIndexByTenant(students, id, tid);
  if (idx < 0) return null;

  const user = usersService.getById(uid);
  if (!user) {
    throw _validationError(['userId does not reference an existing user']);
  }
  if (user.tenantId !== undefined && user.tenantId !== null && String(user.tenantId) !== '' &&
      String(user.tenantId) !== tid) {
    throw _validationError(['userId is bound to a different tenant']);
  }

  const base = { ...students[idx] };
  if (String(base.userId || '') === uid) return { ...base }; // idempotent re-link

  if (base.userId !== undefined && base.userId !== null && String(base.userId) !== '') {
    throw new StudentLinkConflictError(
      'STUDENT_ALREADY_LINKED',
      'this student is already linked to an account; unlink it first'
    );
  }
  const taken = students.find(
    s => String(s.tenantId || '') === tid && String(s.userId || '') === uid
  );
  if (taken) {
    throw new StudentLinkConflictError(
      'USER_ALREADY_LINKED',
      'this account is already linked to another student in this tenant'
    );
  }

  const next = { ...base, userId: uid, updatedAt: _now() };
  students[idx] = next;
  _writeStore({ ...doc, students });
  return { ...next };
}

// Clears the link. The `userId` KEY is deleted (not blanked). Idempotent.
function unlinkUser(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const doc = _readStore();
  const students = _students(doc);
  const idx = _findIndexByTenant(students, id, tid);
  if (idx < 0) return null;

  const base = { ...students[idx] };
  if (base.userId === undefined || base.userId === null || String(base.userId) === '') {
    return { ...base };
  }
  const next = { ...base, updatedAt: _now() };
  delete next.userId;
  students[idx] = next;
  _writeStore({ ...doc, students });
  return { ...next };
}

module.exports = {
  listStudents,
  getStudent,
  createStudent,
  updateStudent,
  archiveStudent,
  getStudentByUserId,
  linkUser,
  unlinkUser,
  STUDENT_STATUSES,
  WRITABLE_FIELDS,
  FORBIDDEN_FIELDS,
  StudentLinkConflictError,
  STORE_KEY
};