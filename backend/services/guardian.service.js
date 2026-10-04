'use strict';

// guardian.service.js — Phase 0 Parent / Guardian records (Education V2).
//
// Follows teacher.service.js deliberately rather than introducing a shared
// Education repository helper: at this size the established per-entity service
// is the smaller, safer change, and reusing the proven shape is what keeps the
// two portal identities (Teacher, Guardian) behaviourally identical.
//
// WHY THIS FILE EXISTS. Phase 0 needed a real Parent identity. The student
// record carried only a flat `guardianName` string, which is a label, not a
// person: it cannot be authenticated, cannot own rows, and cannot be scoped.
// This service introduces the missing PERSON, with the same guarantees Teacher
// already has.
//
// SECURITY MODEL (identical to teacher.service.js, plus one extra rule):
//   - The tenant is taken ONLY from the trusted server-side context the
//     controller passes in (built by the canonical `trustedTenantId(req)`).
//     It is NEVER read from req.query.tenantId, req.body.tenantId, a
//     `tenantId` header, a `companyId` header, or a `branchId` header. There
//     is no second tenant resolver in this file.
//   - With no trusted tenant every public method throws 'Tenant context is
//     required'. The service never returns a shared collection, never falls
//     back to a default tenant, never invents a tenant.
//   - tenantId is SERVER-OWNED and IMMUTABLE: stamped on create and
//     re-asserted on every update and archive. A client-supplied tenantId is
//     REJECTED, not silently dropped.
//   - EXPLICIT FIELD WHITELIST. Client payloads are never spread into a
//     persisted record, so a blind-spread re-parenting defect cannot exist
//     here by construction.
//
// TWO SERVER-OWNED RELATIONSHIPS, both deliberately OUT of the write
// whitelist so no generic create/update can ever set them:
//   1. `userId` — the optional link to an authenticated account, written
//      exclusively by linkUser/unlinkUser (Owner/Admin-only routes). Same
//      one-account-to-one-record rule as Teacher.
//   2. `childStudentIds` — the child relationship, written exclusively by
//      linkChild/unlinkChild (Owner/Admin-only routes). EVERY candidate child
//      id is resolved through studentService inside the SAME trusted tenant
//      before it is stored, so a cross-tenant or non-existent student id can
//      never enter the list and later be trusted by the own-row scoping.
//
// SCOPE — this file is the operational Guardian directory ONLY. It carries no
// credential of any kind: no password, no token, no secret. `relation` is a
// descriptive family relation (father/mother/guardian/...), never a financial
// or custody determination. Phase 0 parents are READ-ONLY: nothing here grants
// a parent the ability to write Education rows, and the write guard is left
// untouched for that reason.

const storageAdapter = require('../repositories/storageAdapter');
const usersService = require('./users.service');
const studentService = require('./student.service');
const logger = require('../utils/logger');

const STORE_KEY = 'educationGuardians';

// Allowed lifecycle states. Anything else is rejected at the service layer.
const GUARDIAN_STATUSES = Object.freeze(['active', 'inactive', 'archived']);

// Descriptive family relation. Deliberately NOT a custody, financial or legal
// determination — Phase 0 records who the person is, nothing more.
const RELATION_TYPES = Object.freeze([
  'father', 'mother', 'guardian', 'sibling', 'grandparent', 'other'
]);

// EXPLICIT WRITE WHITELIST. A key absent from this object can never be
// persisted from client input. `tenantId` is deliberately absent, and so are
// `userId` and `childStudentIds` — both are server-owned relationships.
const WRITABLE_FIELDS = Object.freeze({
  guardianCode: 'string',
  firstName: 'string',
  lastName: 'string',
  displayName: 'string',
  phone: 'string',
  email: 'string',
  address: 'string',
  relation: 'string',
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
  'childStudentIds',
  'createdAt',
  'updatedAt'
]);

// Maximum length applied to every string field.
const MAX_STRING_LEN = 160;

// Raised when guardianCode collides inside the trusted tenant. The controller
// maps this to 409 with the repository's `{ code }` details convention.
class GuardianCodeConflictError extends Error {
  constructor(guardianCode) {
    super('guardianCode already exists for this tenant: ' + guardianCode);
    this.name = 'GuardianCodeConflictError';
    this.code = 'GUARDIAN_CODE_CONFLICT';
    this.guardianCode = guardianCode;
    this.conflict = true;
  }
}

// Raised when a link cannot be created because one of the two sides is already
// linked elsewhere. Mapped to 409 with the repository's `{ code }` convention.
class GuardianLinkConflictError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GuardianLinkConflictError';
    this.code = code;
    this.conflict = true;
  }
}

function _defaultDoc() {
  return { guardians: [] };
}

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('guardian.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(doc) {
  try {
    storageAdapter.write(STORE_KEY, doc);
  } catch (err) {
    logger.warn('guardian.service: failed to write store', err.message);
  }
}

// The ONLY tenant source in this file: the trusted context object handed in by
// the controller. Returns null when absent - never a default, never a fallback.
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

function _guardians(doc) {
  return Array.isArray(doc.guardians) ? doc.guardians : [];
}

// Always return a fresh array: never hand out the stored array by reference.
function _childIds(record) {
  return Array.isArray(record && record.childStudentIds)
    ? record.childStudentIds.map(v => String(v)).filter(Boolean)
    : [];
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
function _validateGuardian(data, forCreate) {
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

  for (const key of Object.keys(WRITABLE_FIELDS)) {
    const value = data[key];
    if (typeof value === 'string' && value.length > MAX_STRING_LEN) {
      errors.push(key + ' must be at most ' + MAX_STRING_LEN + ' characters');
    }
  }

  if (data.status !== undefined && data.status !== null && String(data.status).trim() !== '' &&
      !GUARDIAN_STATUSES.includes(String(data.status).trim())) {
    errors.push('status must be one of: ' + GUARDIAN_STATUSES.join(', '));
  }

  if (data.relation !== undefined && data.relation !== null && String(data.relation).trim() !== '' &&
      !RELATION_TYPES.includes(String(data.relation).trim())) {
    errors.push('relation must be one of: ' + RELATION_TYPES.join(', '));
  }

  if (data.email !== undefined && data.email !== null && String(data.email).trim() !== '' &&
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(data.email).trim())) {
    errors.push('email is invalid');
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

// Look up by id AND trusted tenant. Returns -1 when absent, never leaking
// cross-tenant existence.
function _findIndexByTenant(guardians, id, tenantId) {
  return guardians.findIndex(
    g => String(g.id || '') === String(id) && String(g.tenantId || '') === tenantId
  );
}

// guardianCode is an identifier WITHIN a tenant, so uniqueness is scoped to the
// trusted tenant and only over CURRENT (non-archived) records. Two tenants may
// legitimately hold the same code.
function _assertGuardianCodeAvailable(guardians, tenantId, guardianCode, excludeId) {
  const code = String(guardianCode || '').trim();
  if (!code) return;
  const clash = guardians.find(g =>
    String(g.tenantId || '') === tenantId &&
    String(g.guardianCode || '').trim() === code &&
    g.status !== 'archived' &&
    String(g.id || '') !== String(excludeId || '')
  );
  if (clash) throw new GuardianCodeConflictError(code);
}

function _displayName(clean) {
  const explicit = String(clean.displayName || '').trim();
  if (explicit) return explicit;
  return [String(clean.firstName || '').trim(), String(clean.lastName || '').trim()]
    .filter(Boolean).join(' ');
}

function _searchMatch(guardian, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return [
    guardian.guardianCode,
    guardian.firstName,
    guardian.lastName,
    guardian.displayName,
    guardian.email,
    guardian.relation
  ]
    .map(v => String(v || '').toLowerCase())
    .some(v => v.includes(q));
}

function _validationError(errors) {
  const err = new Error(errors.join('; '));
  err.validation = errors;
  return err;
}

// Is this account a member of THIS tenant?
//
// The account model carries its tenants in `tenantIds` (array) and
// `tenantRoles` (map), with a legacy singular `tenantId` on older records — so
// a check that only inspects the singular field would never fire on real data
// and the "cross-tenant link refused" guarantee would be decorative. All three
// shapes are therefore considered here.
//
// A user bound to NO tenant at all is the legacy shared space and is allowed,
// which matches the established users.service._tenantVisible semantics: an
// unbound account is visible to every tenant, a bound one only to its own.
function _userBoundToTenant(user, tid) {
  if (!user) return false;
  const bound = new Set();
  if (Array.isArray(user.tenantIds)) {
    for (const t of user.tenantIds) if (t !== undefined && t !== null && String(t) !== '') bound.add(String(t));
  }
  if (user.tenantRoles && typeof user.tenantRoles === 'object' && !Array.isArray(user.tenantRoles)) {
    for (const t of Object.keys(user.tenantRoles)) if (t) bound.add(String(t));
  }
  if (user.tenantId !== undefined && user.tenantId !== null && String(user.tenantId) !== '') {
    bound.add(String(user.tenantId));
  }
  if (bound.size === 0) return true; // legacy shared space
  return bound.has(String(tid));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function listGuardians(tenantContext, filters) {
  const tid = _requireTenantId(tenantContext);
  const f = (filters && typeof filters === 'object') ? filters : {};
  let guardians = _guardians(_readStore()).filter(g => String(g.tenantId || '') === tid);
  if (f.status !== undefined && f.status !== null && String(f.status).trim() !== '') {
    const st = String(f.status).trim();
    if (GUARDIAN_STATUSES.includes(st)) {
      guardians = guardians.filter(g => g.status === st);
    }
  }
  if (f.relation !== undefined && f.relation !== null && String(f.relation).trim() !== '') {
    const rel = String(f.relation).trim();
    if (RELATION_TYPES.includes(rel)) {
      guardians = guardians.filter(g => g.relation === rel);
    }
  }
  if (f.search !== undefined && f.search !== null && String(f.search).trim() !== '') {
    guardians = guardians.filter(g => _searchMatch(g, String(f.search).trim()));
  }
  guardians.sort((x, y) => String(x.lastName || '').localeCompare(String(y.lastName || '')));
  return guardians.map(g => ({ ...g, childStudentIds: _childIds(g) }));
}

function getGuardian(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const guardians = _guardians(_readStore());
  const idx = _findIndexByTenant(guardians, id, tid);
  if (idx < 0) return null;
  return { ...guardians[idx], childStudentIds: _childIds(guardians[idx]) };
}

function createGuardian(tenantContext, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateGuardian(input, true);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const guardians = _guardians(doc);

  const guardianCode = clean.guardianCode || _generateId('GRD').toUpperCase();
  _assertGuardianCodeAvailable(guardians, tid, guardianCode);

  const now = _now();
  const record = {
    id: _generateId('grd'),
    tenantId: tid,
    guardianCode,
    firstName: clean.firstName,
    lastName: clean.lastName,
    displayName: _displayName(clean),
    phone: clean.phone || '',
    email: clean.email || '',
    address: clean.address || '',
    relation: clean.relation || '',
    status: clean.status || 'active',
    notes: clean.notes || '',
    // A new guardian starts with NO children and NO account link. Both are
    // server-owned and can only be granted through the Owner/Admin-only
    // link routes — never by the create payload.
    childStudentIds: [],
    createdAt: now,
    updatedAt: now
  };
  guardians.push(record);
  _writeStore({ ...doc, guardians });
  return { ...record, childStudentIds: [] };
}

function updateGuardian(tenantContext, id, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateGuardian(input, false);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const guardians = _guardians(doc);
  const idx = _findIndexByTenant(guardians, id, tid);
  if (idx < 0) return null;

  if (clean.guardianCode) {
    _assertGuardianCodeAvailable(guardians, tid, clean.guardianCode, guardians[idx].id);
  }

  const base = { ...guardians[idx] };
  const merged = { ...base, ...clean };
  const next = {
    ...merged,
    id: base.id,
    tenantId: tid,
    // Re-assert the two server-owned relationships on every write so a merge
    // can never drop or move them.
    childStudentIds: _childIds(base),
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  if (base.userId !== undefined) next.userId = base.userId;

  // Refresh the derived display name only when the stored one was DERIVED.
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
  guardians[idx] = next;
  _writeStore({ ...doc, guardians });
  return { ...next, childStudentIds: _childIds(next) };
}

function archiveGuardian(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const doc = _readStore();
  const guardians = _guardians(doc);
  const idx = _findIndexByTenant(guardians, id, tid);
  if (idx < 0) return null;

  const base = { ...guardians[idx] };
  const next = {
    ...base,
    id: base.id,
    tenantId: tid,
    status: 'archived',
    childStudentIds: _childIds(base),
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  guardians[idx] = next;
  _writeStore({ ...doc, guardians });
  return { ...next, childStudentIds: _childIds(next) };
}

// ---------------------------------------------------------------------------
// Account link (Parent portal) — mirrors teacher.service.js exactly
// ---------------------------------------------------------------------------

// The guardian record linked to this signed-in account inside THIS tenant, or
// null. This is the only lookup the ownership layer performs: it never guesses
// from a claim, and it never crosses tenants.
function getGuardianByUserId(tenantContext, userId) {
  const tid = _requireTenantId(tenantContext);
  if (userId === undefined || userId === null || String(userId).trim() === '') return null;
  const uid = String(userId).trim();
  const found = _guardians(_readStore()).find(
    g => String(g.tenantId || '') === tid && String(g.userId || '') === uid
  );
  return found ? { ...found, childStudentIds: _childIds(found) } : null;
}

// Owner/Admin-only route: bind an existing authenticated account to this
// guardian inside this tenant. Server-owned in both directions:
//   - `userId` stays out of WRITABLE_FIELDS/FORBIDDEN_FIELDS: only this
//     function writes it, and only a link row that exists can be read;
//   - one account links to AT MOST one guardian per tenant and one guardian
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
  const guardians = _guardians(doc);
  const idx = _findIndexByTenant(guardians, id, tid);
  if (idx < 0) return null;

  const user = usersService.getById(uid);
  if (!user) {
    throw _validationError(['userId does not reference an existing user']);
  }
  if (!_userBoundToTenant(user, tid)) {
    throw _validationError(['userId is bound to a different tenant']);
  }

  const base = { ...guardians[idx] };
  if (String(base.userId || '') === uid) {
    return { ...base, childStudentIds: _childIds(base) }; // idempotent re-link
  }

  if (base.userId !== undefined && base.userId !== null && String(base.userId) !== '') {
    throw new GuardianLinkConflictError(
      'GUARDIAN_ALREADY_LINKED',
      'this guardian is already linked to an account; unlink it first'
    );
  }
  const taken = guardians.find(
    g => String(g.tenantId || '') === tid && String(g.userId || '') === uid
  );
  if (taken) {
    throw new GuardianLinkConflictError(
      'USER_ALREADY_LINKED',
      'this account is already linked to another guardian in this tenant'
    );
  }

  const next = { ...base, userId: uid, updatedAt: _now() };
  guardians[idx] = next;
  _writeStore({ ...doc, guardians });
  return { ...next, childStudentIds: _childIds(next) };
}

// Clears the link. The `userId` KEY is deleted (not blanked), so an unlinked
// record is byte-identical to one that was never linked. Idempotent.
function unlinkUser(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const doc = _readStore();
  const guardians = _guardians(doc);
  const idx = _findIndexByTenant(guardians, id, tid);
  if (idx < 0) return null;

  const base = { ...guardians[idx] };
  if (base.userId === undefined || base.userId === null || String(base.userId) === '') {
    return { ...base, childStudentIds: _childIds(base) };
  }
  const next = { ...base, updatedAt: _now() };
  delete next.userId;
  guardians[idx] = next;
  _writeStore({ ...doc, guardians });
  return { ...next, childStudentIds: _childIds(next) };
}

// ---------------------------------------------------------------------------
// Child relationship (Parent portal)
// ---------------------------------------------------------------------------

// Owner/Admin-only route: grant this guardian access to one student.
//
// THE TRUST RULE. The candidate child id is NEVER taken on faith. It is
// resolved through studentService inside the SAME trusted tenant, so:
//   - a student that does not exist answers a 404-shaped validation error,
//   - a student owned by ANOTHER tenant does not resolve either, so a
//     cross-tenant child can never enter the list;
// only the resolved row's own id is then stored. That stored id is the single
// thing the parent portal trusts later, which is why it can only be produced
// here and never by a client payload.
function linkChild(tenantContext, id, studentId) {
  const tid = _requireTenantId(tenantContext);
  if (studentId === undefined || studentId === null || String(studentId).trim() === '') {
    throw _validationError(['studentId is required']);
  }
  const sid = String(studentId).trim().slice(0, MAX_STRING_LEN);

  const doc = _readStore();
  const guardians = _guardians(doc);
  const idx = _findIndexByTenant(guardians, id, tid);
  if (idx < 0) return null;

  const student = studentService.getStudent({ tenantId: tid }, sid);
  if (!student) {
    throw _validationError(['studentId does not reference a student in this tenant']);
  }

  const base = { ...guardians[idx] };
  const children = _childIds(base);
  if (children.indexOf(String(student.id)) !== -1) {
    return { ...base, childStudentIds: children }; // idempotent re-link
  }

  const next = { ...base, childStudentIds: children.concat([String(student.id)]), updatedAt: _now() };
  guardians[idx] = next;
  _writeStore({ ...doc, guardians });
  return { ...next, childStudentIds: _childIds(next) };
}

// Idempotent. An unknown student id is simply not removed.
function unlinkChild(tenantContext, id, studentId) {
  const tid = _requireTenantId(tenantContext);
  const sid = studentId === undefined || studentId === null ? '' : String(studentId).trim();

  const doc = _readStore();
  const guardians = _guardians(doc);
  const idx = _findIndexByTenant(guardians, id, tid);
  if (idx < 0) return null;

  const base = { ...guardians[idx] };
  const children = _childIds(base);
  if (!sid || children.indexOf(sid) === -1) {
    return { ...base, childStudentIds: children };
  }
  const next = { ...base, childStudentIds: children.filter(v => v !== sid), updatedAt: _now() };
  guardians[idx] = next;
  _writeStore({ ...doc, guardians });
  return { ...next, childStudentIds: _childIds(next) };
}

// The students this guardian may see — resolved INSIDE the trusted tenant, so
// the result can never contain a row from another tenant even if the stored
// list were somehow corrupted. Ids that no longer resolve are skipped.
function getGuardianChildren(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const guardians = _guardians(_readStore());
  const idx = _findIndexByTenant(guardians, id, tid);
  if (idx < 0) return null;
  const out = [];
  for (const childId of _childIds(guardians[idx])) {
    const student = studentService.getStudent({ tenantId: tid }, childId);
    if (student) out.push(student);
  }
  return out;
}

module.exports = {
  listGuardians,
  getGuardian,
  createGuardian,
  updateGuardian,
  archiveGuardian,
  getGuardianByUserId,
  linkUser,
  unlinkUser,
  linkChild,
  unlinkChild,
  getGuardianChildren,
  GUARDIAN_STATUSES,
  RELATION_TYPES,
  WRITABLE_FIELDS,
  FORBIDDEN_FIELDS,
  GuardianCodeConflictError,
  GuardianLinkConflictError,
  STORE_KEY
};