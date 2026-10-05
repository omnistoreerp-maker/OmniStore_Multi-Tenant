'use strict';

// subject.service.js - P1 Academic Foundation: Subject records.
//
// A Subject is a teachable discipline inside exactly one Center:
// Tenant -> Center -> Subject. The Center link is REQUIRED (same tenant,
// validated): subjects never float at tenant level, so every course that
// names a subject, and every class taught under that course, resolves to
// exactly one center. A Subject is what connects the academic structure to
// Teacher/Student assignment: a teacher is assigned a subject by teaching a
// class whose course names it; a student takes a subject by enrolling in such
// a class. Both directions are DERIVED through the chain — no assignment
// rows are stored here.
//
// LIFECYCLE. The directory semantics every STU entity uses: `active`,
// `inactive` and `archived`. Archiving PRESERVES the record and its Courses.
// There is deliberately NO cascading archive or delete: a Course keeps
// pointing at its archived Subject and stays readable, which is the
// documented safe state.
//
// Tenant isolation is structural, not incidental:
//   - The tenant comes ONLY from the trusted server-side context the
//     controller passes in. It is NEVER read from req.query, req.body, or
//     any request header.
//   - With no trusted tenant every public method throws 'Tenant context is
//     required'.
//   - tenantId and centerId are SERVER-OWNED on write: stamped on create from
//     validated input, re-asserted on every update.
//   - The Center parent is resolved with that same trusted tenant, so a
//     foreign Center can never anchor a Subject.
//   - A Center belonging to another tenant is indistinguishable from one that
//     does not exist, so cross-tenant links fail closed without leaking
//     existence.
//   - EXPLICIT FIELD WHITELIST. Client payloads are never spread into a
//     persisted record.
//
// SCOPE — the Subject directory ONLY. No courses, classes, teacher or
// student assignment rows. Archiving a Subject never cascades.

const storageAdapter = require('../repositories/storageAdapter');
const centerService = require('./center.service');
const logger = require('../utils/logger');

const STORE_KEY = 'educationSubjects';

// Allowed lifecycle states. Anything else is rejected at the service layer.
const SUBJECT_STATUSES = Object.freeze(['active', 'inactive', 'archived']);

// EXPLICIT WRITE WHITELIST with per-key kinds. `centerId` is REQUIRED: a
// subject without a center would break the Tenant -> Center -> Subject chain
// the whole P1 isolation model derives from. A key absent from this object
// can never be persisted from client input.
const WRITABLE_FIELDS = Object.freeze({
  centerId: 'string',
  subjectCode: 'string',
  name: 'string',
  displayName: 'string',
  description: 'string',
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

// Relationships that belong to other entities (courses, classes, teachers,
// students). Listed explicitly so a client attempting to inject one is
// refused rather than quietly dropped.
const LATER_PHASE_FIELDS = Object.freeze([
  'teacherId',
  'studentId',
  'classId',
  'courseId',
  'enrollmentId'
]);

// Maximum length applied to every string field.
const MAX_STRING_LEN = 160;

// Raised when subjectCode collides inside the trusted tenant. The controller
// maps this to 409 with the repository's `{ code }` details convention.
class SubjectCodeConflictError extends Error {
  constructor(subjectCode) {
    super('subjectCode already exists for this tenant: ' + subjectCode);
    this.name = 'SubjectCodeConflictError';
    this.code = 'SUBJECT_CODE_CONFLICT';
    this.subjectCode = subjectCode;
    this.conflict = true;
  }
}

function _defaultDoc() {
  return { subjects: [] };
}

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('subject.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(doc) {
  try {
    storageAdapter.write(STORE_KEY, doc);
  } catch (err) {
    logger.warn('subject.service: failed to write store', err.message);
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

let _lastNowMs = 0;

function _now() {
  const nowMs = Date.now();
  _lastNowMs = Math.max(nowMs, _lastNowMs + 1);
  return new Date(_lastNowMs).toISOString();
}

function _generateId(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

function _subjects(doc) {
  return Array.isArray(doc.subjects) ? doc.subjects : [];
}

// Returns a fresh object built only from whitelisted keys, each coerced to its
// declared kind. The caller never spreads client input into a persisted record.
function _sanitizeWritable(payload) {
  const src = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
  const clean = {};
  for (const [key, kind] of Object.entries(WRITABLE_FIELDS)) {
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
function _validateSubject(data, forCreate) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }

  if (forCreate) {
    if (data.name === undefined || data.name === null || String(data.name).trim() === '') {
      errors.push('name is required');
    }
    if (data.centerId === undefined || data.centerId === null || String(data.centerId).trim() === '') {
      errors.push('centerId is required');
    }
  }

  // A required reference can never be cleared: supplying it empty is refused
  // on create AND on update (otherwise a partial update could orphan the
  // subject from its Center and break the Tenant -> Center -> Subject chain).
  if (!forCreate && data.centerId !== undefined && data.centerId !== null &&
      String(data.centerId).trim() === '') {
    errors.push('centerId is required');
  }

  for (const [key, kind] of Object.entries(WRITABLE_FIELDS)) {
    const value = data[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      errors.push(key + ' must be a string');
      continue;
    }
    // Oversized input is rejected outright rather than silently truncated.
    if (value.length > MAX_STRING_LEN) {
      errors.push(key + ' must be at most ' + MAX_STRING_LEN + ' characters');
    }
  }

  if (data.status !== undefined && data.status !== null && String(data.status).trim() !== '' &&
      !SUBJECT_STATUSES.includes(String(data.status).trim())) {
    errors.push('status must be one of: ' + SUBJECT_STATUSES.join(', '));
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

  // Later-phase relationships are refused outright, not silently dropped.
  for (const later of LATER_PHASE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, later)) {
      errors.push(later + ' is not writable');
    }
  }

  return errors;
}

// Look up a subject by id AND trusted tenant. Returns -1 when absent, never
// leaking cross-tenant existence.
function _findIndexByTenant(subjects, id, tenantId) {
  return subjects.findIndex(
    s => String(s.id || '') === String(id) && String(s.tenantId || '') === tenantId
  );
}

// subjectCode is an identifier WITHIN a tenant, so uniqueness is scoped to
// the trusted tenant and only over CURRENT (non-archived) records — the same
// semantics STU-3/STU-4/STU-5 use. Two tenants may hold the same code.
function _assertSubjectCodeAvailable(subjects, tenantId, subjectCode, excludeId) {
  const code = String(subjectCode || '').trim();
  if (!code) return;
  const clash = subjects.find(s =>
    String(s.tenantId || '') === tenantId &&
    String(s.subjectCode || '').trim() === code &&
    s.status !== 'archived' &&
    String(s.id || '') !== String(excludeId || '')
  );
  if (clash) throw new SubjectCodeConflictError(code);
}

// A REQUIRED Center reference. When supplied it must resolve inside the
// trusted tenant. A center belonging to another tenant is indistinguishable
// from one that does not exist, which is the existing not-found convention.
function _assertCenterInTenant(tenantId, centerId) {
  const id = String(centerId || '').trim();
  if (!id) return;
  const found = centerService.getCenter({ tenantId }, id);
  if (!found) throw new ReferenceValidationError('centerId does not reference a Center in this tenant');
}

// Raised for a relationship reference that cannot be resolved inside the
// trusted tenant. The controller maps this to 400 with a `details` list.
class ReferenceValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReferenceValidationError';
    this.validation = [message];
  }
}

function _searchMatch(subject, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return [subject.subjectCode, subject.name, subject.displayName, subject.description]
    .map(v => String(v || '').toLowerCase())
    .some(v => v.includes(q));
}

// displayName defaults to the subject name when the client omits it.
function _displayName(clean) {
  const explicit = String(clean.displayName || '').trim();
  if (explicit) return explicit;
  return String(clean.name || '').trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function listSubjects(tenantContext, filters) {
  const tid = _requireTenantId(tenantContext);
  const f = (filters && typeof filters === 'object') ? filters : {};
  let subjects = _subjects(_readStore()).filter(s => String(s.tenantId || '') === tid);
  if (f.status !== undefined && f.status !== null && String(f.status).trim() !== '') {
    const st = String(f.status).trim();
    if (SUBJECT_STATUSES.includes(st)) {
      subjects = subjects.filter(s => s.status === st);
    }
  }
  if (f.centerId !== undefined && f.centerId !== null && String(f.centerId).trim() !== '') {
    const cid = String(f.centerId).trim();
    subjects = subjects.filter(s => String(s.centerId || '') === cid);
  }
  if (f.search !== undefined && f.search !== null && String(f.search).trim() !== '') {
    const q = String(f.search).trim();
    subjects = subjects.filter(s => _searchMatch(s, q));
  }
  subjects.sort((x, y) => String(x.name || '').localeCompare(String(y.name || '')));
  return subjects.map(s => ({ ...s }));
}

function getSubject(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const subjects = _subjects(_readStore());
  const idx = _findIndexByTenant(subjects, id, tid);
  if (idx < 0) return null;
  return { ...subjects[idx] };
}

function createSubject(tenantContext, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateSubject(input, true);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const subjects = _subjects(doc);

  // Relationship first: a cross-tenant or unknown Center must never reach the
  // store, and never leaves a code reserved as a side effect.
  _assertCenterInTenant(tid, clean.centerId);

  const subjectCode = clean.subjectCode || _generateId('SUB').toUpperCase();
  _assertSubjectCodeAvailable(subjects, tid, subjectCode);

  const now = _now();
  const record = {
    id: _generateId('sub'),
    tenantId: tid,
    centerId: clean.centerId,
    subjectCode,
    name: clean.name,
    displayName: _displayName(clean),
    description: clean.description || '',
    status: clean.status || 'active',
    notes: clean.notes || '',
    createdAt: now,
    updatedAt: now
  };
  subjects.push(record);
  _writeStore({ ...doc, subjects });
  return { ...record };
}

function updateSubject(tenantContext, id, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateSubject(input, false);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const subjects = _subjects(doc);
  const idx = _findIndexByTenant(subjects, id, tid);
  if (idx < 0) return null;

  if (clean.centerId) {
    _assertCenterInTenant(tid, clean.centerId);
  }
  if (clean.subjectCode) {
    _assertSubjectCodeAvailable(subjects, tid, clean.subjectCode, subjects[idx].id);
  }

  const base = { ...subjects[idx] };
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
  subjects[idx] = next;
  _writeStore({ ...doc, subjects });
  return { ...next };
}

// Archive PRESERVES the record and its Courses. There is deliberately NO
// cascading archive or delete: a Course keeps pointing at its archived Subject
// and stays readable, which is the documented safe state.
function archiveSubject(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const doc = _readStore();
  const subjects = _subjects(doc);
  const idx = _findIndexByTenant(subjects, id, tid);
  if (idx < 0) return null;

  const base = { ...subjects[idx] };
  const next = {
    ...base,
    id: base.id,
    tenantId: tid,
    status: 'archived',
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  subjects[idx] = next;
  _writeStore({ ...doc, subjects });
  return { ...next };
}

function _validationError(errors) {
  const err = new Error(errors.join('; '));
  err.validation = errors;
  return err;
}

module.exports = {
  listSubjects,
  getSubject,
  createSubject,
  updateSubject,
  archiveSubject,
  SUBJECT_STATUSES,
  WRITABLE_FIELDS,
  FORBIDDEN_FIELDS,
  LATER_PHASE_FIELDS,
  SubjectCodeConflictError,
  ReferenceValidationError,
  STORE_KEY
};
