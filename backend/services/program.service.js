'use strict';

// program.service.js - STU-5 Education Program records (Device 2).
//
// Follows the STU-2 student / STU-3 teacher / STU-4 center service pattern
// deliberately rather than introducing a shared Education repository helper:
// at this size the established per-entity service is the smaller, safer
// change.
//
// DOMAIN SHAPE.
//   Center -> Program -> Course. All three live INSIDE the same existing
//   tenant. A Program's optional `centerId` is a RELATIONSHIP reference, not
//   ownership: it is validated to resolve inside the trusted tenant and is
//   never allowed to point at another tenant. This file introduces no tenant
//   hierarchy — there is no parent/child tenant field and no programId on any
//   other entity.
//
// Tenant isolation is structural, not incidental:
//   - The tenant is taken ONLY from the trusted server-side context the
//     controller passes in (built by the canonical `trustedTenantId(req)`).
//     It is NEVER read from req.query.tenantId, req.body.tenantId, a
//     `tenantId` header, a `companyId` header, or a `branchId` header. There
//     is no second tenant resolver in this file.
//   - With no trusted tenant every public method throws 'Tenant context is
//     required'.
//   - tenantId is SERVER-OWNED and IMMUTABLE: stamped on create and
//     re-asserted on every update and archive.
//   - EXPLICIT FIELD WHITELIST. Client payloads are never spread into a
//     persisted record.
//
// SCOPE — an operational Program directory ONLY. It carries no teacherId,
// studentId, classId, enrollmentId, price, tuition, payment, billing,
// revenue, payroll, account or credential field. Teacher assignment, classes
// and enrollment belong to later or Master-owned domains.

const storageAdapter = require('../repositories/storageAdapter');
const centerService = require('./center.service');
const logger = require('../utils/logger');

const STORE_KEY = 'educationPrograms';

// Allowed lifecycle states. Anything else is rejected at the service layer.
const PROGRAM_STATUSES = Object.freeze(['active', 'inactive', 'archived']);

// Descriptive duration units. Descriptive metadata only: this file implements
// NO scheduling calculation, calendar behaviour or date-range engine.
const DURATION_UNITS = Object.freeze(['days', 'weeks', 'months']);

// EXPLICIT WRITE WHITELIST with per-key kinds. `durationValue` is the only
// numeric field; everything else is a string. A key absent from this object
// can never be persisted from client input.
const WRITABLE_FIELDS = Object.freeze({
  centerId: 'string',
  programCode: 'string',
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
// assignment). Listed explicitly so a client attempting to inject one is
// refused rather than quietly dropped.
const LATER_PHASE_FIELDS = Object.freeze([
  'teacherId',
  'studentId',
  'classId',
  'enrollmentId'
]);

// Maximum length applied to every string field.
const MAX_STRING_LEN = 160;

// Bounds for the descriptive duration value.
const MIN_DURATION_VALUE = 1;
const MAX_DURATION_VALUE = 1000;

// Raised when programCode collides inside the trusted tenant. The controller
// maps this to 409 with the repository's `{ code }` details convention.
class ProgramCodeConflictError extends Error {
  constructor(programCode) {
    super('programCode already exists for this tenant: ' + programCode);
    this.name = 'ProgramCodeConflictError';
    this.code = 'PROGRAM_CODE_CONFLICT';
    this.programCode = programCode;
    this.conflict = true;
  }
}

function _defaultDoc() {
  return { programs: [] };
}

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('program.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(doc) {
  try {
    storageAdapter.write(STORE_KEY, doc);
  } catch (err) {
    logger.warn('program.service: failed to write store', err.message);
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

function _programs(doc) {
  return Array.isArray(doc.programs) ? doc.programs : [];
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
function _validateProgram(data, forCreate) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }

  if (forCreate) {
    if (data.name === undefined || data.name === null || String(data.name).trim() === '') {
      errors.push('name is required');
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
    // Oversized input is rejected outright rather than silently truncated.
    if (value.length > MAX_STRING_LEN) {
      errors.push(key + ' must be at most ' + MAX_STRING_LEN + ' characters');
    }
  }

  if (data.status !== undefined && data.status !== null && String(data.status).trim() !== '' &&
      !PROGRAM_STATUSES.includes(String(data.status).trim())) {
    errors.push('status must be one of: ' + PROGRAM_STATUSES.join(', '));
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

// Look up a program by id AND trusted tenant. Returns -1 when absent, never
// leaking cross-tenant existence.
function _findIndexByTenant(programs, id, tenantId) {
  return programs.findIndex(
    p => String(p.id || '') === String(id) && String(p.tenantId || '') === tenantId
  );
}

// programCode is an identifier WITHIN a tenant, so uniqueness is scoped to the
// trusted tenant and only over CURRENT (non-archived) records — the same
// semantics STU-3/STU-4 use. Two tenants may hold the same code.
function _assertProgramCodeAvailable(programs, tenantId, programCode, excludeId) {
  const code = String(programCode || '').trim();
  if (!code) return;
  const clash = programs.find(p =>
    String(p.tenantId || '') === tenantId &&
    String(p.programCode || '').trim() === code &&
    p.status !== 'archived' &&
    String(p.id || '') !== String(excludeId || '')
  );
  if (clash) throw new ProgramCodeConflictError(code);
}

// An OPTIONAL Center reference. When supplied it must resolve inside the
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

function _searchMatch(program, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return [program.programCode, program.name, program.displayName, program.description]
    .map(v => String(v || '').toLowerCase())
    .some(v => v.includes(q));
}

function _validationError(errors) {
  const err = new Error(errors.join('; '));
  err.validation = errors;
  return err;
}

// displayName defaults to the program name when the client omits it.
function _displayName(clean) {
  const explicit = String(clean.displayName || '').trim();
  if (explicit) return explicit;
  return String(clean.name || '').trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function listPrograms(tenantContext, filters) {
  const tid = _requireTenantId(tenantContext);
  const f = (filters && typeof filters === 'object') ? filters : {};
  let programs = _programs(_readStore()).filter(p => String(p.tenantId || '') === tid);
  if (f.status !== undefined && f.status !== null && String(f.status).trim() !== '') {
    const st = String(f.status).trim();
    if (PROGRAM_STATUSES.includes(st)) {
      programs = programs.filter(p => p.status === st);
    }
  }
  if (f.centerId !== undefined && f.centerId !== null && String(f.centerId).trim() !== '') {
    const cid = String(f.centerId).trim();
    programs = programs.filter(p => String(p.centerId || '') === cid);
  }
  if (f.search !== undefined && f.search !== null && String(f.search).trim() !== '') {
    const q = String(f.search).trim();
    programs = programs.filter(p => _searchMatch(p, q));
  }
  programs.sort((x, y) => String(x.name || '').localeCompare(String(y.name || '')));
  return programs.map(p => ({ ...p }));
}

function getProgram(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const programs = _programs(_readStore());
  const idx = _findIndexByTenant(programs, id, tid);
  if (idx < 0) return null;
  return { ...programs[idx] };
}

function createProgram(tenantContext, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateProgram(input, true);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const programs = _programs(doc);

  // Relationship first: a cross-tenant or unknown Center must never reach the
  // store, and never leaves a code reserved as a side effect.
  _assertCenterInTenant(tid, clean.centerId);

  const programCode = clean.programCode || _generateId('PRG').toUpperCase();
  _assertProgramCodeAvailable(programs, tid, programCode);

  const now = _now();
  const record = {
    id: _generateId('prg'),
    tenantId: tid,
    centerId: clean.centerId || '',
    programCode,
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
  programs.push(record);
  _writeStore({ ...doc, programs });
  return { ...record };
}

function updateProgram(tenantContext, id, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateProgram(input, false);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const programs = _programs(doc);
  const idx = _findIndexByTenant(programs, id, tid);
  if (idx < 0) return null;

  if (clean.centerId) {
    _assertCenterInTenant(tid, clean.centerId);
  }
  if (clean.programCode) {
    _assertProgramCodeAvailable(programs, tid, clean.programCode, programs[idx].id);
  }

  const base = { ...programs[idx] };
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
  programs[idx] = next;
  _writeStore({ ...doc, programs });
  return { ...next };
}

// Archive PRESERVES the record and its Courses. There is deliberately NO
// cascading archive or delete: a Course keeps pointing at its archived Program
// and stays readable, which is the documented safe state. Later phases decide
// what an archived parent means for enrollment.
function archiveProgram(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const doc = _readStore();
  const programs = _programs(doc);
  const idx = _findIndexByTenant(programs, id, tid);
  if (idx < 0) return null;

  const base = { ...programs[idx] };
  const next = {
    ...base,
    id: base.id,
    tenantId: tid,
    status: 'archived',
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  programs[idx] = next;
  _writeStore({ ...doc, programs });
  return { ...next };
}

module.exports = {
  listPrograms,
  getProgram,
  createProgram,
  updateProgram,
  archiveProgram,
  PROGRAM_STATUSES,
  DURATION_UNITS,
  WRITABLE_FIELDS,
  FORBIDDEN_FIELDS,
  LATER_PHASE_FIELDS,
  ProgramCodeConflictError,
  ReferenceValidationError,
  STORE_KEY
};