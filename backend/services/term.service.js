'use strict';

// term.service.js - P1 Academic Foundation: Term / Semester records.
//
// A Term is a bounded teaching period inside exactly one Academic Year:
// Tenant -> Center -> Academic Year -> Term. The Academic Year reference is
// REQUIRED and must resolve inside the trusted tenant; the Term inherits its
// center exclusively through that Year (terms store no center of their own,
// exactly like classes store no program/center of their own). Date bounds
// that fall outside the parent Year are refused: a term cannot teach outside
// the year that contains it.
//
// LIFECYCLE. The directory semantics every STU entity uses: `active`,
// `inactive` and `archived`. Archiving PRESERVES the record. There is
// deliberately NO cascading archive or delete: classes and sessions keep
// pointing at an archived Term and stay readable, which is the documented
// safe state.
//
// Tenant isolation is structural, not incidental:
//   - The tenant comes ONLY from the trusted server-side context the
//     controller passes in. It is NEVER read from req.query, req.body, or
//     any request header.
//   - With no trusted tenant every public method throws 'Tenant context is
//     required'.
//   - tenantId is SERVER-OWNED and IMMUTABLE: stamped on create and
//     re-asserted on every update.
//   - The Year parent is resolved with that same trusted tenant, so a foreign
//     Year can never anchor a Term.
//   - A Year belonging to another tenant is indistinguishable from one that
//     does not exist, so cross-tenant links fail closed without leaking
//     existence.
//   - EXPLICIT FIELD WHITELIST. Client payloads are never spread into a
//     persisted record.
//
// SCOPE — the Term directory ONLY. No classes, sessions, enrollment,
// grading, billing or payroll field. Archiving a Term never cascades.

const storageAdapter = require('../repositories/storageAdapter');
const academicYearService = require('./academicYear.service');
const logger = require('../utils/logger');

const STORE_KEY = 'educationTerms';

// Allowed lifecycle states. Anything else is rejected at the service layer.
const TERM_STATUSES = Object.freeze(['active', 'inactive', 'archived']);

// EXPLICIT WRITE WHITELIST with per-key kinds. `academicYearId` is REQUIRED:
// a term without a year would break the Tenant -> Center -> Year -> Term
// chain the whole P1 isolation model derives from. A key absent from this
// object can never be persisted from client input.
const WRITABLE_FIELDS = Object.freeze({
  academicYearId: 'string',
  termCode: 'string',
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
  'centerId',
  'createdAt',
  'updatedAt'
]);

// Relationships that belong to other entities (classes, sessions, students).
// Listed explicitly so a client attempting to inject one is refused rather
// than quietly dropped. `centerId` is refused on purpose: a Term's center is
// derived through its Year, and a second reference could silently disagree
// with it.
const LATER_PHASE_FIELDS = Object.freeze([
  'centerId',
  'teacherId',
  'studentId',
  'classId',
  'enrollmentId'
]);

// Maximum length applied to every string field.
const MAX_STRING_LEN = 160;

// Raised when termCode collides inside the trusted tenant. The controller
// maps this to 409 with the repository's `{ code }` details convention.
class TermCodeConflictError extends Error {
  constructor(termCode) {
    super('termCode already exists for this tenant: ' + termCode);
    this.name = 'TermCodeConflictError';
    this.code = 'TERM_CODE_CONFLICT';
    this.termCode = termCode;
    this.conflict = true;
  }
}

function _defaultDoc() {
  return { terms: [] };
}

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('term.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(doc) {
  try {
    storageAdapter.write(STORE_KEY, doc);
  } catch (err) {
    logger.warn('term.service: failed to write store', err.message);
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

function _terms(doc) {
  return Array.isArray(doc.terms) ? doc.terms : [];
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
function _validateTerm(data, forCreate) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }

  if (forCreate) {
    if (data.name === undefined || data.name === null || String(data.name).trim() === '') {
      errors.push('name is required');
    }
    if (data.academicYearId === undefined || data.academicYearId === null ||
        String(data.academicYearId).trim() === '') {
      errors.push('academicYearId is required');
    }
  }

  // A required reference can never be cleared: supplying it empty is refused
  // on create AND on update (otherwise a partial update could orphan the row
  // from its Year).
  if (!forCreate && data.academicYearId !== undefined && data.academicYearId !== null &&
      String(data.academicYearId).trim() === '') {
    errors.push('academicYearId is required');
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
      !TERM_STATUSES.includes(String(data.status).trim())) {
    errors.push('status must be one of: ' + TERM_STATUSES.join(', '));
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

// Look up a term by id AND trusted tenant. Returns -1 when absent, never
// leaking cross-tenant existence.
function _findIndexByTenant(terms, id, tenantId) {
  return terms.findIndex(
    t => String(t.id || '') === String(id) && String(t.tenantId || '') === tenantId
  );
}

// termCode is an identifier WITHIN a tenant, so uniqueness is scoped to the
// trusted tenant and only over CURRENT (non-archived) records — the same
// semantics STU-3/STU-4/STU-5 use. Two tenants may hold the same code.
function _assertTermCodeAvailable(terms, tenantId, termCode, excludeId) {
  const code = String(termCode || '').trim();
  if (!code) return;
  const clash = terms.find(t =>
    String(t.tenantId || '') === tenantId &&
    String(t.termCode || '').trim() === code &&
    t.status !== 'archived' &&
    String(t.id || '') !== String(excludeId || '')
  );
  if (clash) throw new TermCodeConflictError(code);
}

// A REQUIRED Academic Year reference. When supplied it must resolve inside
// the trusted tenant AND must not be archived: teaching into an archived Year
// is refused, exactly like courses refuse archived programs. A year belonging
// to another tenant is indistinguishable from one that does not exist, which
// is the existing not-found convention.
function _assertYearInTenant(tenantId, academicYearId) {
  const id = String(academicYearId || '').trim();
  if (!id) return null;
  const found = academicYearService.getAcademicYear({ tenantId }, id);
  if (!found) {
    const err = new Error('academicYearId does not reference an Academic Year in this tenant');
    err.validation = [err.message];
    throw err;
  }
  if (found.status === 'archived') {
    const err = new Error('academicYearId must reference a non-archived Academic Year');
    err.validation = [err.message];
    throw err;
  }
  return found;
}

// A term cannot teach outside the year that contains it: when both the term
// and its year carry date bounds, the term bounds must sit inside the year
// bounds. Bounds the year does not set are not enforced.
function _assertInsideYear(year, startDate, endDate) {
  const errors = [];
  const yStart = String((year && year.startDate) || '').trim();
  const yEnd = String((year && year.endDate) || '').trim();
  const tStart = String(startDate || '').trim();
  const tEnd = String(endDate || '').trim();
  if (_isDate(yStart) && _isDate(tStart) && tStart < yStart) {
    errors.push('startDate must not be before the Academic Year startDate');
  }
  if (_isDate(yEnd) && _isDate(tEnd) && tEnd > yEnd) {
    errors.push('endDate must not be after the Academic Year endDate');
  }
  if (errors.length) {
    const err = new Error(errors.join('; '));
    err.validation = errors;
    throw err;
  }
}

function _searchMatch(term, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return [term.termCode, term.name, term.displayName, term.description]
    .map(v => String(v || '').toLowerCase())
    .some(v => v.includes(q));
}

// displayName defaults to the term name when the client omits it.
function _displayName(clean) {
  const explicit = String(clean.displayName || '').trim();
  if (explicit) return explicit;
  return String(clean.name || '').trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function listTerms(tenantContext, filters) {
  const tid = _requireTenantId(tenantContext);
  const f = (filters && typeof filters === 'object') ? filters : {};
  let terms = _terms(_readStore()).filter(t => String(t.tenantId || '') === tid);
  if (f.status !== undefined && f.status !== null && String(f.status).trim() !== '') {
    const st = String(f.status).trim();
    if (TERM_STATUSES.includes(st)) {
      terms = terms.filter(t => t.status === st);
    }
  }
  if (f.academicYearId !== undefined && f.academicYearId !== null && String(f.academicYearId).trim() !== '') {
    const yid = String(f.academicYearId).trim();
    terms = terms.filter(t => String(t.academicYearId || '') === yid);
  }
  if (f.search !== undefined && f.search !== null && String(f.search).trim() !== '') {
    const q = String(f.search).trim();
    terms = terms.filter(t => _searchMatch(t, q));
  }
  terms.sort((x, y) => String(x.name || '').localeCompare(String(y.name || '')));
  return terms.map(t => ({ ...t }));
}

function getTerm(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const terms = _terms(_readStore());
  const idx = _findIndexByTenant(terms, id, tid);
  if (idx < 0) return null;
  return { ...terms[idx] };
}

function createTerm(tenantContext, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateTerm(input, true);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const terms = _terms(doc);

  // Relationship first: a cross-tenant or unknown Year must never reach the
  // store, and never leaves a code reserved as a side effect.
  const year = _assertYearInTenant(tid, clean.academicYearId);
  _assertInsideYear(year, clean.startDate, clean.endDate);

  const termCode = clean.termCode || _generateId('TRM').toUpperCase();
  _assertTermCodeAvailable(terms, tid, termCode);

  const now = _now();
  const record = {
    id: _generateId('trm'),
    tenantId: tid,
    academicYearId: clean.academicYearId,
    termCode,
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
  terms.push(record);
  _writeStore({ ...doc, terms });
  return { ...record };
}

function updateTerm(tenantContext, id, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateTerm(input, false);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const terms = _terms(doc);
  const idx = _findIndexByTenant(terms, id, tid);
  if (idx < 0) return null;

  const base = { ...terms[idx] };
  // The effective year is the supplied one or the stored one: moving a term
  // re-validates the new parent exactly like a create. After _validateTerm, a
  // supplied value is guaranteed non-empty, so an own property is the correct
  // test here — a truthiness test would silently skip validation for any
  // falsy value that slipped through.
  const yearId = Object.prototype.hasOwnProperty.call(clean, 'academicYearId')
    ? clean.academicYearId
    : base.academicYearId;
  const year = _assertYearInTenant(tid, yearId);
  if (clean.termCode) {
    _assertTermCodeAvailable(terms, tid, clean.termCode, base.id);
  }

  const merged = { ...base, ...clean };
  // startDate/endDate are validated as a pair on the merged row, then against
  // the effective year bounds.
  if (_isDate(merged.startDate) && _isDate(merged.endDate) &&
      String(merged.startDate).trim() > String(merged.endDate).trim()) {
    throw _validationError(['startDate must not be after endDate']);
  }
  _assertInsideYear(year, merged.startDate, merged.endDate);
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
  terms[idx] = next;
  _writeStore({ ...doc, terms });
  return { ...next };
}

// Archive PRESERVES the record. There is deliberately NO cascading archive or
// delete: classes and sessions keep pointing at an archived Term and stay
// readable, which is the documented safe state.
function archiveTerm(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const doc = _readStore();
  const terms = _terms(doc);
  const idx = _findIndexByTenant(terms, id, tid);
  if (idx < 0) return null;

  const base = { ...terms[idx] };
  const next = {
    ...base,
    id: base.id,
    tenantId: tid,
    status: 'archived',
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  terms[idx] = next;
  _writeStore({ ...doc, terms });
  return { ...next };
}

function _validationError(errors) {
  const err = new Error(errors.join('; '));
  err.validation = errors;
  return err;
}

module.exports = {
  listTerms,
  getTerm,
  createTerm,
  updateTerm,
  archiveTerm,
  TERM_STATUSES,
  WRITABLE_FIELDS,
  FORBIDDEN_FIELDS,
  LATER_PHASE_FIELDS,
  TermCodeConflictError,
  STORE_KEY
};
