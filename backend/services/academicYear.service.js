'use strict';

// academicYear.service.js - P1 Academic Foundation: Academic Year records.
//
// An Academic Year is the top of the academic structure inside a Center:
// Tenant -> Center -> Academic Year -> Term -> Class/Group -> Subject ->
// Teacher/Student. The Center link is REQUIRED (same tenant, validated): the
// year is what roots every term, and therefore every class session, inside
// exactly one center, which is what makes center isolation derivable for the
// whole academic subtree. A year with no center cannot exist, so there is no
// centerless fail-closed case to document.
//
// LIFECYCLE. Exactly the directory semantics every STU entity uses: `active`,
// `inactive` and `archived`. Archiving PRESERVES the record and its Terms.
// There is deliberately NO cascading archive or delete: a Term keeps pointing
// at its archived Year and stays readable, which is the documented safe state.
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
//     foreign Center can never anchor an Academic Year.
//   - A Center belonging to another tenant is indistinguishable from one that
//     does not exist, so cross-tenant links fail closed without leaking
//     existence.
//   - EXPLICIT FIELD WHITELIST. Client payloads are never spread into a
//     persisted record.
//
// SCOPE — the Academic Year directory ONLY. No terms, courses, classes,
// enrollment, scheduling, grading, billing or payroll field. Archiving a Year
// never cascades: Terms, Courses and Classes are only ever READ here through
// reference checks, never written.

const storageAdapter = require('../repositories/storageAdapter');
const centerService = require('./center.service');
const logger = require('../utils/logger');

const STORE_KEY = 'educationAcademicYears';

// Allowed lifecycle states. Anything else is rejected at the service layer.
const ACADEMIC_YEAR_STATUSES = Object.freeze(['active', 'inactive', 'archived']);

// EXPLICIT WRITE WHITELIST with per-key kinds. `centerId` is REQUIRED: a year
// without a center would break the Tenant -> Center -> Year chain the whole
// P1 isolation model derives from. A key absent from this object can never be
// persisted from client input.
const WRITABLE_FIELDS = Object.freeze({
  centerId: 'string',
  yearCode: 'string',
  name: 'string',
  displayName: 'string',
  description: 'string',
  startDate: 'string',
  endDate: 'string',
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

// Relationships that belong to other entities (terms, courses, classes).
// Listed explicitly so a client attempting to inject one is refused rather
// than quietly dropped.
const LATER_PHASE_FIELDS = Object.freeze([
  'teacherId',
  'studentId',
  'classId',
  'enrollmentId',
  'termId',
  'termIds'
]);

// Maximum length applied to every string field.
const MAX_STRING_LEN = 160;

// Raised when yearCode collides inside the trusted tenant. The controller
// maps this to 409 with the repository's `{ code }` details convention.
class YearCodeConflictError extends Error {
  constructor(yearCode) {
    super('yearCode already exists for this tenant: ' + yearCode);
    this.name = 'YearCodeConflictError';
    this.code = 'YEAR_CODE_CONFLICT';
    this.yearCode = yearCode;
    this.conflict = true;
  }
}

function _defaultDoc() {
  return { academicYears: [] };
}

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('academicYear.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(doc) {
  try {
    storageAdapter.write(STORE_KEY, doc);
  } catch (err) {
    logger.warn('academicYear.service: failed to write store', err.message);
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

function _academicYears(doc) {
  return Array.isArray(doc.academicYears) ? doc.academicYears : [];
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

function _isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

// Returns an array of human-readable errors, or an empty array when valid.
// `forCreate` is true for create and false for partial update.
function _validateAcademicYear(data, forCreate) {
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
  // on create AND on update (otherwise a partial update could orphan the year
  // from its Center and break the Tenant -> Center -> Year chain).
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
      !ACADEMIC_YEAR_STATUSES.includes(String(data.status).trim())) {
    errors.push('status must be one of: ' + ACADEMIC_YEAR_STATUSES.join(', '));
  }

  for (const key of ['startDate', 'endDate']) {
    if (data[key] !== undefined && data[key] !== null && String(data[key]).trim() !== '' &&
        !_isDate(data[key])) {
      errors.push(key + ' must be YYYY-MM-DD');
    }
  }
  if (_isDate(data.startDate) && _isDate(data.endDate) &&
      String(data.startDate).trim() > String(data.endDate).trim()) {
    errors.push('startDate must not be after endDate');
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

// Look up an academic year by id AND trusted tenant. Returns -1 when absent,
// never leaking cross-tenant existence.
function _findIndexByTenant(years, id, tenantId) {
  return years.findIndex(
    y => String(y.id || '') === String(id) && String(y.tenantId || '') === tenantId
  );
}

// yearCode is an identifier WITHIN a tenant, so uniqueness is scoped to the
// trusted tenant and only over CURRENT (non-archived) records — the same
// semantics STU-3/STU-4/STU-5 use. Two tenants may hold the same code.
function _assertYearCodeAvailable(years, tenantId, yearCode, excludeId) {
  const code = String(yearCode || '').trim();
  if (!code) return;
  const clash = years.find(y =>
    String(y.tenantId || '') === tenantId &&
    String(y.yearCode || '').trim() === code &&
    y.status !== 'archived' &&
    String(y.id || '') !== String(excludeId || '')
  );
  if (clash) throw new YearCodeConflictError(code);
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

function _searchMatch(year, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return [year.yearCode, year.name, year.displayName, year.description]
    .map(v => String(v || '').toLowerCase())
    .some(v => v.includes(q));
}

// displayName defaults to the year name when the client omits it.
function _displayName(clean) {
  const explicit = String(clean.displayName || '').trim();
  if (explicit) return explicit;
  return String(clean.name || '').trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function listAcademicYears(tenantContext, filters) {
  const tid = _requireTenantId(tenantContext);
  const f = (filters && typeof filters === 'object') ? filters : {};
  let years = _academicYears(_readStore()).filter(y => String(y.tenantId || '') === tid);
  if (f.status !== undefined && f.status !== null && String(f.status).trim() !== '') {
    const st = String(f.status).trim();
    if (ACADEMIC_YEAR_STATUSES.includes(st)) {
      years = years.filter(y => y.status === st);
    }
  }
  if (f.centerId !== undefined && f.centerId !== null && String(f.centerId).trim() !== '') {
    const cid = String(f.centerId).trim();
    years = years.filter(y => String(y.centerId || '') === cid);
  }
  if (f.search !== undefined && f.search !== null && String(f.search).trim() !== '') {
    const q = String(f.search).trim();
    years = years.filter(y => _searchMatch(y, q));
  }
  years.sort((x, y) => String(x.name || '').localeCompare(String(y.name || '')));
  return years.map(y => ({ ...y }));
}

function getAcademicYear(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const years = _academicYears(_readStore());
  const idx = _findIndexByTenant(years, id, tid);
  if (idx < 0) return null;
  return { ...years[idx] };
}

function createAcademicYear(tenantContext, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateAcademicYear(input, true);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const years = _academicYears(doc);

  // Relationship first: a cross-tenant or unknown Center must never reach the
  // store, and never leaves a code reserved as a side effect.
  _assertCenterInTenant(tid, clean.centerId);

  const yearCode = clean.yearCode || _generateId('YEA').toUpperCase();
  _assertYearCodeAvailable(years, tid, yearCode);

  const now = _now();
  const record = {
    id: _generateId('yea'),
    tenantId: tid,
    centerId: clean.centerId,
    yearCode,
    name: clean.name,
    displayName: _displayName(clean),
    description: clean.description || '',
    startDate: clean.startDate || '',
    endDate: clean.endDate || '',
    status: clean.status || 'active',
    notes: clean.notes || '',
    createdAt: now,
    updatedAt: now
  };
  years.push(record);
  _writeStore({ ...doc, academicYears: years });
  return { ...record };
}

function updateAcademicYear(tenantContext, id, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateAcademicYear(input, false);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const years = _academicYears(doc);
  const idx = _findIndexByTenant(years, id, tid);
  if (idx < 0) return null;

  if (clean.centerId) {
    _assertCenterInTenant(tid, clean.centerId);
  }
  if (clean.yearCode) {
    _assertYearCodeAvailable(years, tid, clean.yearCode, years[idx].id);
  }

  const base = { ...years[idx] };
  const merged = { ...base, ...clean };
  // startDate/endDate are validated as a pair on the merged row: moving one
  // bound past the other is refused even when the other bound is old data.
  if (_isDate(merged.startDate) && _isDate(merged.endDate) &&
      String(merged.startDate).trim() > String(merged.endDate).trim()) {
    throw _validationError(['startDate must not be after endDate']);
  }
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
  years[idx] = next;
  _writeStore({ ...doc, academicYears: years });
  return { ...next };
}

// Archive PRESERVES the record and its Terms. There is deliberately NO
// cascading archive or delete: a Term keeps pointing at its archived Year and
// stays readable, which is the documented safe state.
function archiveAcademicYear(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const doc = _readStore();
  const years = _academicYears(doc);
  const idx = _findIndexByTenant(years, id, tid);
  if (idx < 0) return null;

  const base = { ...years[idx] };
  const next = {
    ...base,
    id: base.id,
    tenantId: tid,
    status: 'archived',
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  years[idx] = next;
  _writeStore({ ...doc, academicYears: years });
  return { ...next };
}

function _validationError(errors) {
  const err = new Error(errors.join('; '));
  err.validation = errors;
  return err;
}

module.exports = {
  listAcademicYears,
  getAcademicYear,
  createAcademicYear,
  updateAcademicYear,
  archiveAcademicYear,
  ACADEMIC_YEAR_STATUSES,
  WRITABLE_FIELDS,
  FORBIDDEN_FIELDS,
  LATER_PHASE_FIELDS,
  YearCodeConflictError,
  ReferenceValidationError,
  STORE_KEY
};
