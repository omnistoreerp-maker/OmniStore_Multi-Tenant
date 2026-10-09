'use strict';

// assignment.service.js - EDU-ASG Assignment records.
//
// An Assignment is class-owned instructional content (a task, homework or
// activity): it belongs to exactly one Class and nothing else. It owns no
// student list, no grades, no submissions and no files — those are later
// phases. Storing a second parent (course/program/teacher/center) would let it
// silently disagree with the Class, so every one of those is DERIVED through
// `classId` and refused on write.
//
// Tenant isolation is structural, not incidental:
//   - The tenant comes ONLY from the trusted server-side context the
//     controller passes in (built by the canonical `trustedTenantId(req)`).
//     It is NEVER read from req.query.tenantId, req.body.tenantId, a
//     `tenantId` header, or a `companyId` header. There is no second tenant
//     resolver in this file.
//   - With no trusted tenant every public method throws 'Tenant context is
//     required'. The service never returns a shared collection, never falls
//     back to a default tenant, never invents a tenant, and never silently
//     creates a global record.
//   - tenantId is SERVER-OWNED and IMMUTABLE: stamped on create and
//     re-asserted on archive. A client-supplied tenantId is IGNORED.
//   - The parent Class is resolved with that same trusted tenant, so a foreign
//     Class can never anchor an Assignment. A foreign Class is
//     indistinguishable from a missing one.
//   - EXPLICIT FIELD WHITELIST. Client payloads are never spread into a
//     persisted record.
//
// LIFECYCLE. Exactly two states: `active` and `archived`. Archiving is the
// ONLY terminal operation and it never cascades: Students, Classes, Courses
// and Programs are only ever READ here, never written.

const storageAdapter = require('../repositories/storageAdapter');
const classService = require('./class.service');
const logger = require('../utils/logger');

const STORE_KEY = 'educationAssignments';

// The complete lifecycle. `inactive` is deliberately absent: an Assignment is
// either current or retired, and a second non-terminal state would give the
// domain two ways to say the same thing with no rule to choose between them.
const ASSIGNMENT_STATUSES = Object.freeze(['active', 'archived']);

// EXPLICIT WRITE WHITELIST. `classId` is accepted ONLY on create: the parent
// is immutable thereafter, which `_validateAssignment` enforces with an
// own-property check so an omitted field is never confused with a falsy one.
// `title`, `description` and `dueDate` are the only mutable fields.
const WRITABLE_FIELDS = Object.freeze({
  classId: 'string',
  title: 'string',
  description: 'string',
  dueDate: 'string'
});

// Server-owned fields a client may never set. `status` joins the usual list
// because the lifecycle is server-owned: archiving happens only through the
// archive path, never by client write.
const FORBIDDEN_FIELDS = Object.freeze([
  'id',
  'tenantId',
  'companyId',
  'branchId',
  'userId',
  'ownerUserId',
  'createdAt',
  'updatedAt',
  'status'
]);

// Maximum lengths. Titles stay at the platform-wide cap; the description is a
// body-text field and carries its own explicit, still bounded cap.
const MAX_TITLE_LEN = 160;
const MAX_DESC_LEN = 2000;

function _defaultDoc() {
  return { assignments: [] };
}

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('assignment.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(doc) {
  try {
    storageAdapter.write(STORE_KEY, doc);
  } catch (err) {
    logger.warn('assignment.service: failed to write store', err.message);
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

function _assignments(doc) {
  return Array.isArray(doc.assignments) ? doc.assignments : [];
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
    clean[key] = value.trim();
  }
  return clean;
}

// A due date is calendar truth, never a datetime: strict YYYY-MM-DD over a
// real calendar date. Past and future are both accepted — teachers plan ahead
// and record catch-up work, so the service takes no position on scheduling
// policy. Anything else is refused outright rather than coerced.
function _isValidDueDate(value) {
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const parts = s.split('-').map(Number);
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return dt.getUTCFullYear() === parts[0] &&
    dt.getUTCMonth() === parts[1] - 1 &&
    dt.getUTCDate() === parts[2];
}

// Returns an array of human-readable errors, or an empty array when valid.
// `forCreate` is true for create and false for partial update.
function _validateAssignment(data, forCreate) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }

  if (forCreate) {
    if (data.classId === undefined || data.classId === null || String(data.classId).trim() === '') {
      errors.push('classId is required');
    }
    if (data.title === undefined || data.title === null || String(data.title).trim() === '') {
      errors.push('title is required');
    }
  }

  // IMMUTABILITY. Once the assignment exists its parent class is a historical
  // fact: it is never reassigned and never cleared. This is an OWN-PROPERTY
  // check on the raw payload, not a truthiness test, so null, undefined, ''
  // and '   ' are all caught as attempts to move the row rather than being
  // mistaken for an omission. A genuinely omitted classId never reaches this
  // branch and the stored parent is untouched.
  if (!forCreate) {
    if (Object.prototype.hasOwnProperty.call(data, 'classId')) {
      errors.push('classId cannot be changed');
    }
  }

  if (data.title !== undefined && data.title !== null) {
    if (typeof data.title !== 'string') {
      errors.push('title must be a string');
    } else if (data.title.trim() === '') {
      errors.push('title must not be blank');
    } else if (data.title.trim().length > MAX_TITLE_LEN) {
      errors.push('title must be at most ' + MAX_TITLE_LEN + ' characters');
    }
  }

  if (data.description !== undefined && data.description !== null) {
    if (typeof data.description !== 'string') {
      errors.push('description must be a string');
    } else if (data.description.length > MAX_DESC_LEN) {
      errors.push('description must be at most ' + MAX_DESC_LEN + ' characters');
    }
  }

  if (data.dueDate !== undefined && data.dueDate !== null && String(data.dueDate).trim() !== '') {
    if (typeof data.dueDate !== 'string' || !_isValidDueDate(data.dueDate)) {
      errors.push('dueDate must be a real calendar date in YYYY-MM-DD format');
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

  return errors;
}

function _validationError(errors) {
  const err = new Error(errors.join('; '));
  err.validation = errors;
  return err;
}

// Look up an assignment by id AND trusted tenant. Returns -1 when absent,
// never leaking cross-tenant existence.
function _findIndexByTenant(assignments, id, tenantId) {
  return assignments.findIndex(
    a => String(a.id || '') === String(id) && String(a.tenantId || '') === tenantId
  );
}

function _searchMatch(assignment, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return [assignment.title, assignment.description]
    .map(v => String(v || '').toLowerCase())
    .some(v => v.includes(q));
}

// The REQUIRED Class parent, resolved through the existing public
// class.service API. It must exist inside the trusted tenant and must not be
// archived. A foreign Class is indistinguishable from a missing one. Classes
// are only ever read.
function _assertClassInTenant(tenantId, classId) {
  const id = String(classId || '').trim();
  if (!id) return;
  const found = classService.getClass({ tenantId }, id);
  if (!found) throw new ReferenceValidationError('classId does not reference a Class in this tenant');
  if (found.status === 'archived') {
    throw new ReferenceValidationError('classId must reference a non-archived Class');
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function listAssignments(tenantContext, filters) {
  const tid = _requireTenantId(tenantContext);
  const f = (filters && typeof filters === 'object') ? filters : {};
  let assignments = _assignments(_readStore()).filter(a => String(a.tenantId || '') === tid);

  if (f.status !== undefined && f.status !== null && String(f.status).trim() !== '') {
    const st = String(f.status).trim();
    if (ASSIGNMENT_STATUSES.includes(st)) {
      assignments = assignments.filter(a => a.status === st);
    }
  }
  if (f.classId !== undefined && f.classId !== null && String(f.classId).trim() !== '') {
    const cid = String(f.classId).trim();
    assignments = assignments.filter(a => String(a.classId || '') === cid);
  }
  if (f.search !== undefined && f.search !== null && String(f.search).trim() !== '') {
    const q = String(f.search).trim();
    assignments = assignments.filter(a => _searchMatch(a, q));
  }

  assignments.sort((x, y) => String(x.title || '').localeCompare(String(y.title || '')));
  return assignments.map(a => ({ ...a }));
}

function getAssignment(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const assignments = _assignments(_readStore());
  const idx = _findIndexByTenant(assignments, id, tid);
  if (idx < 0) return null;
  return { ...assignments[idx] };
}

function createAssignment(tenantContext, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateAssignment(input, true);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);

  // Parent first, then the write. A rejected Class never reaches the store
  // and never leaves a row behind.
  const classId = String(clean.classId).trim();
  _assertClassInTenant(tid, classId);

  const now = _now();
  const record = {
    id: _generateId('asg'),
    tenantId: tid,
    classId,
    title: String(clean.title).trim(),
    description: clean.description || '',
    dueDate: clean.dueDate ? String(clean.dueDate).trim() : '',
    status: 'active',
    createdAt: now,
    updatedAt: now
  };
  const doc = _readStore();
  const assignments = _assignments(doc);
  assignments.push(record);
  _writeStore({ ...doc, assignments });
  return { ...record };
}

// Updates `title`, `description` and `dueDate` only. The parent class is
// immutable, so there is no parent re-validation to run here and no way for
// this call to move a row between classes. A rejected payload never reaches
// the store.
function updateAssignment(tenantContext, id, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateAssignment(input, false);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const assignments = _assignments(doc);
  const idx = _findIndexByTenant(assignments, id, tid);
  if (idx < 0) return null;

  const base = { ...assignments[idx] };
  const next = {
    ...base,
    id: base.id,
    tenantId: tid,
    classId: base.classId,
    status: base.status,
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  if (Object.prototype.hasOwnProperty.call(clean, 'title')) next.title = String(clean.title).trim();
  if (Object.prototype.hasOwnProperty.call(clean, 'description')) next.description = clean.description;
  if (Object.prototype.hasOwnProperty.call(clean, 'dueDate')) {
    next.dueDate = clean.dueDate ? String(clean.dueDate).trim() : '';
  }
  assignments[idx] = next;
  _writeStore({ ...doc, assignments });
  return { ...next };
}

function archiveAssignment(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const doc = _readStore();
  const assignments = _assignments(doc);
  const idx = _findIndexByTenant(assignments, id, tid);
  if (idx < 0) return null;

  const base = { ...assignments[idx] };
  const next = {
    ...base,
    id: base.id,
    tenantId: tid,
    classId: base.classId,
    status: 'archived',
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  assignments[idx] = next;
  _writeStore({ ...doc, assignments });
  return { ...next };
}

module.exports = {
  listAssignments,
  getAssignment,
  createAssignment,
  updateAssignment,
  archiveAssignment,
  ASSIGNMENT_STATUSES,
  WRITABLE_FIELDS,
  FORBIDDEN_FIELDS,
  STORE_KEY
};
