'use strict';

// center.service.js - STU-4 Education Center records (Device 2).
//
// Follows the STU-2 student / STU-3 teacher service pattern deliberately
// rather than introducing a shared Education repository helper: at this size
// the established per-entity service is the smaller, safer change.
//
// WHAT A CENTER IS NOT.
//   A Center is an educational operating entity INSIDE the existing tenant. It
//   is NOT a tenant, NOT a company, NOT an authentication boundary, NOT an
//   RBAC boundary, and NOT a billing or financial account. This file creates
//   no tenant hierarchy: every record is stamped with the trusted tenant of
//   the caller and is reachable only from that tenant. There is deliberately
//   no parent/child tenant field and no centerId on any other entity.
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
// SCOPE — this file is an operational location/entity directory ONLY. It
// carries no billing, payment, payroll, revenue, subscription, bank or
// owner/portal field. Those belong to future or Master-owned domains.

const storageAdapter = require('../repositories/storageAdapter');
const usersService = require('./users.service');
const logger = require('../utils/logger');

const STORE_KEY = 'educationCenters';

// Allowed lifecycle states. Anything else is rejected at the service layer.
const CENTER_STATUSES = Object.freeze(['active', 'inactive', 'archived']);

// EXPLICIT WRITE WHITELIST. A key absent from this object can never be
// persisted from client input. `tenantId` is deliberately absent - tenant
// ownership is server-owned and immutable.
const WRITABLE_FIELDS = Object.freeze({
  centerCode: 'string',
  name: 'string',
  displayName: 'string',
  description: 'string',
  phone: 'string',
  email: 'string',
  address: 'string',
  timezone: 'string',
  status: 'string',
  notes: 'string'
});

// Server-owned fields a client may never set. `ownerUserId` and
// `billingAccountId` are listed explicitly so a client attempting to inject
// them is refused rather than quietly dropped.
const FORBIDDEN_FIELDS = Object.freeze([
  'id',
  'tenantId',
  'companyId',
  'branchId',
  'userId',
  'ownerUserId',
  'billingAccountId',
  'createdAt',
  'updatedAt'
]);

// Maximum length applied to every string field.
const MAX_STRING_LEN = 160;

// Raised when centerCode collides inside the trusted tenant. The controller
// maps this to 409 with the repository's `{ code }` details convention.
class CenterCodeConflictError extends Error {
  constructor(centerCode) {
    super('centerCode already exists for this tenant: ' + centerCode);
    this.name = 'CenterCodeConflictError';
    this.code = 'CENTER_CODE_CONFLICT';
    this.centerCode = centerCode;
    this.conflict = true;
  }
}

// Raised when a link cannot be created because one of the two sides is already
// linked elsewhere. Mapped to 409 with the repository's `{ code }` convention.
class CenterLinkConflictError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CenterLinkConflictError';
    this.code = code;
    this.conflict = true;
  }
}

function _defaultDoc() {
  return { centers: [] };
}

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('center.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(doc) {
  try {
    storageAdapter.write(STORE_KEY, doc);
  } catch (err) {
    logger.warn('center.service: failed to write store', err.message);
  }
}

// The ONLY tenant source in this file: the trusted context object handed in
// by the controller. Mirrors the established student / teacher convention.
// Returns null when absent - never a default, never a fallback.
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

function _centers(doc) {
  return Array.isArray(doc.centers) ? doc.centers : [];
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

// Conservative IANA time-zone check using the runtime's own Intl facility.
// No dependency is added. Descriptive configuration only: this file
// introduces NO scheduling behaviour.
function _isValidTimezone(tz) {
  const value = String(tz || '').trim();
  if (!value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch (err) {
    return false;
  }
}

// Returns an array of human-readable errors, or an empty array when valid.
// `forCreate` is true for create and false for partial update.
function _validateCenter(data, forCreate) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }

  if (forCreate) {
    if (data.name === undefined || data.name === null || String(data.name).trim() === '') {
      errors.push('name is required');
    }
  }

  for (const key of Object.keys(WRITABLE_FIELDS)) {
    if (data[key] !== undefined && data[key] !== null && typeof data[key] !== 'string') {
      errors.push(key + ' must be a string');
    }
  }

  // Oversized input is rejected outright rather than silently truncated.
  for (const key of Object.keys(WRITABLE_FIELDS)) {
    const value = data[key];
    if (typeof value === 'string' && value.length > MAX_STRING_LEN) {
      errors.push(key + ' must be at most ' + MAX_STRING_LEN + ' characters');
    }
  }

  if (data.status !== undefined && data.status !== null && String(data.status).trim() !== '' &&
      !CENTER_STATUSES.includes(String(data.status).trim())) {
    errors.push('status must be one of: ' + CENTER_STATUSES.join(', '));
  }

  if (data.email !== undefined && data.email !== null && String(data.email).trim() !== '' &&
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(data.email).trim())) {
    errors.push('email is invalid');
  }

  if (data.timezone !== undefined && data.timezone !== null && String(data.timezone).trim() !== '' &&
      !_isValidTimezone(data.timezone)) {
    errors.push('timezone must be a valid IANA time zone');
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

// Look up a center by id AND trusted tenant. Returns -1 when absent, never
// leaking cross-tenant existence.
function _findIndexByTenant(centers, id, tenantId) {
  return centers.findIndex(
    c => String(c.id || '') === String(id) && String(c.tenantId || '') === tenantId
  );
}

// centerCode is an identifier WITHIN a tenant, so uniqueness is scoped to the
// trusted tenant and only over CURRENT (non-archived) records. An archived
// center releases its code — the same semantics STU-3 uses for teacherCode.
// Two tenants may legitimately hold the same code.
function _assertCenterCodeAvailable(centers, tenantId, centerCode, excludeId) {
  const code = String(centerCode || '').trim();
  if (!code) return;
  const clash = centers.find(c =>
    String(c.tenantId || '') === tenantId &&
    String(c.centerCode || '').trim() === code &&
    c.status !== 'archived' &&
    String(c.id || '') !== String(excludeId || '')
  );
  if (clash) throw new CenterCodeConflictError(code);
}

// displayName defaults to the center name when the client omits it.
function _displayName(clean) {
  const explicit = String(clean.displayName || '').trim();
  if (explicit) return explicit;
  return String(clean.name || '').trim();
}

function _searchMatch(center, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return [center.centerCode, center.name, center.displayName, center.phone, center.email, center.address]
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

function listCenters(tenantContext, filters) {
  const tid = _requireTenantId(tenantContext);
  const f = (filters && typeof filters === 'object') ? filters : {};
  let centers = _centers(_readStore()).filter(c => String(c.tenantId || '') === tid);
  if (f.status !== undefined && f.status !== null && String(f.status).trim() !== '') {
    const st = String(f.status).trim();
    if (CENTER_STATUSES.includes(st)) {
      centers = centers.filter(c => c.status === st);
    }
  }
  if (f.search !== undefined && f.search !== null && String(f.search).trim() !== '') {
    const q = String(f.search).trim();
    centers = centers.filter(c => _searchMatch(c, q));
  }
  centers.sort((x, y) => String(x.name || '').localeCompare(String(y.name || '')));
  return centers.map(c => ({ ...c }));
}

function getCenter(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const centers = _centers(_readStore());
  const idx = _findIndexByTenant(centers, id, tid);
  if (idx < 0) return null;
  return { ...centers[idx] };
}

function createCenter(tenantContext, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateCenter(input, true);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const centers = _centers(doc);

  // Generated when the client omits a code. Random enough that a collision is
  // practically impossible, but still checked so the guarantee is real.
  const centerCode = clean.centerCode || _generateId('CTR').toUpperCase();
  _assertCenterCodeAvailable(centers, tid, centerCode);

  const now = _now();
  const record = {
    id: _generateId('ctr'),
    tenantId: tid,
    centerCode,
    name: clean.name,
    displayName: _displayName(clean),
    description: clean.description || '',
    phone: clean.phone || '',
    email: clean.email || '',
    address: clean.address || '',
    timezone: clean.timezone || '',
    status: clean.status || 'active',
    notes: clean.notes || '',
    createdAt: now,
    updatedAt: now
  };
  centers.push(record);
  _writeStore({ ...doc, centers });
  return { ...record };
}

function updateCenter(tenantContext, id, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateCenter(input, false);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitizeWritable(input);
  const doc = _readStore();
  const centers = _centers(doc);
  const idx = _findIndexByTenant(centers, id, tid);
  if (idx < 0) return null;

  if (clean.centerCode) {
    _assertCenterCodeAvailable(centers, tid, clean.centerCode, centers[idx].id);
  }

  const base = { ...centers[idx] };
  const merged = { ...base, ...clean };
  const next = {
    ...merged,
    id: base.id,
    tenantId: tid,
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  // A rename refreshes the derived displayName only when the stored value was
  // DERIVED rather than client-supplied. Detected deterministically: the
  // stored displayName still equals the name it would have been derived from
  // before the rename. A custom value does not match and is preserved.
  if (!Object.prototype.hasOwnProperty.call(clean, 'displayName') &&
      clean.name !== undefined) {
    const derivedBefore = String(base.name || '').trim();
    if (String(base.displayName || '').trim() === derivedBefore) {
      next.displayName = String(merged.name || '').trim();
    }
  }
  centers[idx] = next;
  _writeStore({ ...doc, centers });
  return { ...next };
}

function archiveCenter(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const doc = _readStore();
  const centers = _centers(doc);
  const idx = _findIndexByTenant(centers, id, tid);
  if (idx < 0) return null;

  const base = { ...centers[idx] };
  const next = {
    ...base,
    id: base.id,
    tenantId: tid,
    status: 'archived',
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  centers[idx] = next;
  _writeStore({ ...doc, centers });
  return { ...next };
}

// Look up a center by its linked user id inside THIS tenant, or null.
// This is the only lookup the ownership layer performs: it never guesses
// from a claim, and it never crosses tenants.
function getCenterByUserId(tenantContext, userId) {
  const tid = _requireTenantId(tenantContext);
  if (userId === undefined || userId === null || String(userId).trim() === '') return null;
  const uid = String(userId).trim();
  const found = _centers(_readStore()).find(
    c => String(c.tenantId || '') === tid && String(c.userId || '') === uid
  );
  return found ? { ...found } : null;
}

// Owner/Admin-only route: bind an existing authenticated account to this
// center inside this tenant. Server-owned in both directions:
//   - `userId` stays out of WRITABLE_FIELDS/FORBIDDEN_FIELDS as before: only
//     this function writes it, and only a link row that exists can be read;
//   - one account links to AT MOST one center per tenant and one center
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
  const centers = _centers(doc);
  const idx = _findIndexByTenant(centers, id, tid);
  if (idx < 0) return null;

  const user = usersService.getById(uid);
  if (!user) {
    throw _validationError(['userId does not reference an existing user']);
  }
  if (user.tenantId !== undefined && user.tenantId !== null && String(user.tenantId) !== '' &&
      String(user.tenantId) !== tid) {
    throw _validationError(['userId is bound to a different tenant']);
  }

  const base = { ...centers[idx] };
  if (String(base.userId || '') === uid) return { ...base }; // idempotent re-link

  if (base.userId !== undefined && base.userId !== null && String(base.userId) !== '') {
    throw new CenterLinkConflictError(
      'CENTER_ALREADY_LINKED',
      'this center is already linked to an account; unlink it first'
    );
  }
  const taken = centers.find(
    c => String(c.tenantId || '') === tid && String(c.userId || '') === uid
  );
  if (taken) {
    throw new CenterLinkConflictError(
      'USER_ALREADY_LINKED',
      'this account is already linked to another center in this tenant'
    );
  }

  const next = { ...base, userId: uid, updatedAt: _now() };
  centers[idx] = next;
  _writeStore({ ...doc, centers });
  return { ...next };
}

// Clears the link. The `userId` KEY is deleted (not blanked), so an unlinked
// record is byte-identical to one that was never linked. Idempotent: unlinking
// an unlinked center returns the record untouched.
function unlinkUser(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const doc = _readStore();
  const centers = _centers(doc);
  const idx = _findIndexByTenant(centers, id, tid);
  if (idx < 0) return null;

  const base = { ...centers[idx] };
  if (base.userId === undefined || base.userId === null || String(base.userId) === '') {
    return { ...base };
  }
  const next = { ...base, updatedAt: _now() };
  delete next.userId;
  centers[idx] = next;
  _writeStore({ ...doc, centers });
  return { ...next };
}

module.exports = {
  listCenters,
  getCenter,
  createCenter,
  updateCenter,
  archiveCenter,
  getCenterByUserId,
  linkUser,
  unlinkUser,
  CENTER_STATUSES,
  WRITABLE_FIELDS,
  FORBIDDEN_FIELDS,
  CenterCodeConflictError,
  CenterLinkConflictError,
  STORE_KEY
};