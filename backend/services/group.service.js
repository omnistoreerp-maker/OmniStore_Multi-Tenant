'use strict';

// group.service.js - P1 Academic Foundation: Class Group records.
//
// A Group is a named subdivision of exactly one Class (a lab section, a
// language track, a project team): Tenant -> Center -> ... -> Class -> Group.
// The Class reference is REQUIRED and IMMUTABLE: a group never moves between
// classes, because moving it would silently re-parent every derived
// membership. Membership itself is DERIVED, never stored: the members of a
// group are the students enrolled in its parent class. Storing a student list
// on the group would be exactly the fan-out the Enrollment entity exists to
// prevent, so this file stores no roster of its own.
//
// LIFECYCLE. The directory semantics every STU entity uses: `active`,
// `inactive` and `archived`. Archiving PRESERVES the record. There is
// deliberately NO cascading archive or delete.
//
// Tenant isolation is structural, not incidental:
//   - The tenant comes ONLY from the trusted server-side context the
//     controller passes in. It is NEVER read from req.query, req.body, or
//     any request header.
//   - With no trusted tenant every public method throws 'Tenant context is
//     required'.
//   - tenantId is SERVER-OWNED and IMMUTABLE: stamped on create and
//     re-asserted on every update. classId is immutable after create.
//   - The Class parent is resolved with that same trusted tenant, so a
//     foreign Class can never anchor a Group. A Class of another tenant, or
//     an archived one, is refused — indistinguishable from missing, so
//     cross-tenant links fail closed without leaking existence.
//   - EXPLICIT FIELD WHITELIST. Client payloads are never spread into a
//     persisted record.
//
// SCOPE — the Group directory ONLY. No rosters, sessions, enrollment,
// grading, billing or payroll field. Archiving a Group never cascades.

const storageAdapter = require('../repositories/storageAdapter');
const classService = require('./class.service');
const logger = require('../utils/logger');

const STORE_KEY = 'educationGroups';

// Allowed lifecycle states. Anything else is rejected at the service layer.
const GROUP_STATUSES = Object.freeze(['active', 'inactive', 'archived']);

// EXPLICIT WRITE WHITELIST with per-key kinds. `classId` is REQUIRED and
// IMMUTABLE: a group without a class would break the Class -> Group chain,
// and moving it would silently re-parent derived membership. A key absent
// from this object can never be persisted from client input.
const WRITABLE_FIELDS = Object.freeze({
  classId: 'string',
  groupCode: 'string',
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

// Relationships that belong to other entities (students, teachers, sessions).
// Listed explicitly so a client attempting to inject one is refused rather
// than quietly dropped. `capacity` stays refused on purpose, exactly like the
// Class entity refuses it: headcounts are derived from enrollments, never
// stored as a second source of truth.
const LATER_PHASE_FIELDS = Object.freeze([
  'capacity',
  'teacherId',
  'studentId',
  'studentIds',
  'enrollmentId',
  'sessionId'
]);

// Maximum length applied to every string field.
const MAX_STRING_LEN = 160;

// Raised when groupCode collides inside the trusted tenant. The controller
// maps this to 409 with the repository's `{ code }` details convention.
class GroupCodeConflictError extends Error {
  constructor(groupCode) {
    super('groupCode already exists for this tenant: ' + groupCode);
    this.name = 'GroupCodeConflictError';
    this.code = 'GROUP_CODE_CONFLICT';
    this.groupCode = groupCode;
    this.conflict = true;
  }
}

function _defaultDoc() {
  return { groups: [] };
}

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('group.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(doc) {
  try {
    storageAdapter.write(STORE_KEY, doc);
  } catch (err) {
    logger.warn('group.service: failed to write store', err.message);
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

function _groups(doc) {
  return Array.isArray(doc.groups) ? doc.groups : [];
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
function _validateGroup(data, forCreate) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }

  if (forCreate) {
    if (data.name === undefined || data.name === null || String(data.name).trim() === '') {
      errors.push('name is required');
    }
    if (data.classId === undefined || data.classId === null || String(data.classId).trim() === '') {
      errors.push('classId is required');
    }
  }

  // classId is IMMUTABLE after create: supplying it on update is refused
  // outright, so a group can never be moved between classes (which would
  // silently re-parent every derived membership).
  if (!forCreate && Object.prototype.hasOwnProperty.call(data, 'classId')) {
    errors.push('classId is immutable');
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
      !GROUP_STATUSES.includes(String(data.status).trim())) {
    errors.push('status must be one of: ' + GROUP_STATUSES.join(', '));
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

// Look up a group by id AND trusted tenant. Returns -1 when absent, never
// leaking cross-tenant existence.
function _findIndexByTenant(groups, id, tenantId) {
  return groups.findIndex(
    g => String(g.id || '') === String(id) && String(g.tenantId || '') === tenantId
  );
}

// groupCode is an identifier WITHIN a tenant, so uniqueness is scoped to the
// trusted tenant and only over CURRENT (non-archived) records — the same
// semantics STU-3/STU-4/STU-5 use. Two tenants may hold the same code.
function _assertGroupCodeAvailable(groups, tenantId, groupCode, excludeId) {
  const code = String(groupCode || '').trim();
  if (!code) return;
  const clash = groups.find(g =>
    String(g.tenantId || '') === tenantId &&
    String(g.groupCode || '').trim() === code &&
    g.status !== 'archived' &&
    String(g.id || '') !== String(excludeId || '')
  );
  if (clash) throw new GroupCodeConflictError(code);
}

// A REQUIRED Class reference. When supplied it must resolve inside the
// trusted tenant AND must not be archived: grouping an archived class is
// refused, exactly like courses refuse archived programs. A class belonging
// to another tenant is indistinguishable from one that does not exist, which
// is the existing not-found convention.
function _assertClassInTenant(tenantId, classId) {
  const id = String(classId || '').trim();
  if (!id) return null;
  const found = classService.getClass({ tenantId }, id);
  if (!found) {
    const err = new Error('classId does not reference a Class in this tenant');
    err.validation = [err.message];
    throw err;
  }
  if (found.status === 'archived') {
    const err = new Error('classId must reference a non-archived Class');
    err.validation = [err.message];
    throw err;
  }
  return found;
}

function _searchMatch(group, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return [group.groupCode, group.name, group.displayName, group.description]
    .map(v => String(v || '').toLowerCase())
    .some(v => v.includes(q));
}

// displayName defaults to the group name when the client omits it.
function _displayName(clean) {
  const explicit = String(clean.displayName || '').trim();
  if (explicit) return explicit;
  return String(clean.name || '').trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function listGroups(tenantContext, filters) {
  const tid = _requireTenantId(tenantContext);
  const f = (filters && typeof filters === 'object') ? filters : {};
  let groups = _groups(_readStore()).filter(g => String(g.tenantId || '') === tid);
  if (f.status !== undefined && f.status !== null && String(f.status).trim() !== '') {
    const st = String(f.status).trim();
    if (GROUP_STATUSES.includes(st)) {
      groups = groups.filter(g => g.status === st);
    }
  }
  if (f.classId !== undefined && f.classId !== null && String(f.classId).trim() !== '') {
    const cid = String(f.classId).trim();
    groups = groups.filter(g => String(g.classId || '') === cid);
  }
  if (f.search !== undefined && f.search !== null && String(f.search).trim() !== '') {
    const q = String(f.search).trim();
    groups = groups.filter(g => _searchMatch(g, q));
  }
  groups.sort((x, y) => String(x.name || '').localeCompare(String(y.name || '')));
  return groups.map(g => ({ ...g }));
}

function getGroup(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const groups = _groups(_readStore());
  const idx = _findIndexByTenant(groups, id, tid);
  if (idx < 0) return null;
  return { ...groups[idx] };
}

function createGroup(tenantContext, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateGroup(input, true);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const groups = _groups(doc);

  // Relationship first: a cross-tenant, unknown or archived Class must never
  // reach the store, and never leaves a code reserved as a side effect.
  _assertClassInTenant(tid, clean.classId);

  const groupCode = clean.groupCode || _generateId('GRP').toUpperCase();
  _assertGroupCodeAvailable(groups, tid, groupCode);

  const now = _now();
  const record = {
    id: _generateId('grp'),
    tenantId: tid,
    classId: String(clean.classId).trim(),
    groupCode,
    name: clean.name,
    displayName: _displayName(clean),
    description: clean.description || '',
    status: clean.status || 'active',
    notes: clean.notes || '',
    createdAt: now,
    updatedAt: now
  };
  groups.push(record);
  _writeStore({ ...doc, groups });
  return { ...record };
}

function updateGroup(tenantContext, id, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateGroup(input, false);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const groups = _groups(doc);
  const idx = _findIndexByTenant(groups, id, tid);
  if (idx < 0) return null;

  if (clean.groupCode) {
    _assertGroupCodeAvailable(groups, tid, clean.groupCode, groups[idx].id);
  }

  const base = { ...groups[idx] };
  // classId is immutable: _validateGroup already refused any supplied value,
  // so clean never carries it here — belt and braces against a future edit
  // that forgets the rule.
  delete clean.classId;
  const merged = { ...base, ...clean };
  const next = {
    ...merged,
    id: base.id,
    tenantId: tid,
    classId: base.classId,
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
  groups[idx] = next;
  _writeStore({ ...doc, groups });
  return { ...next };
}

// Archive PRESERVES the record. There is deliberately NO cascading archive or
// delete.
function archiveGroup(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const doc = _readStore();
  const groups = _groups(doc);
  const idx = _findIndexByTenant(groups, id, tid);
  if (idx < 0) return null;

  const base = { ...groups[idx] };
  const next = {
    ...base,
    id: base.id,
    tenantId: tid,
    status: 'archived',
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  groups[idx] = next;
  _writeStore({ ...doc, groups });
  return { ...next };
}

function _validationError(errors) {
  const err = new Error(errors.join('; '));
  err.validation = errors;
  return err;
}

module.exports = {
  listGroups,
  getGroup,
  createGroup,
  updateGroup,
  archiveGroup,
  GROUP_STATUSES,
  WRITABLE_FIELDS,
  FORBIDDEN_FIELDS,
  LATER_PHASE_FIELDS,
  GroupCodeConflictError,
  STORE_KEY
};
