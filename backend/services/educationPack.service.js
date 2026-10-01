'use strict';

// educationPack.service — STU-1 Education FOUNDATION (Device 2).
//
// SCOPE — READ THIS FIRST.
//
// This service is the tenant-isolation foundation for the future Student /
// Teacher Services vertical. It deliberately implements NO Education business
// entity. There is no Student, Teacher, Guardian, Center, Course, Program,
// Enrollment, Attendance, Timetable, Schedule, Grade or Billing logic here,
// and none may be added without a later, separately approved phase.
//
// What it DOES establish is the pattern every future Education entity must
// follow:
//
//   1. TRUSTED TENANT RESOLUTION. The tenant is taken ONLY from the trusted
//      server-side context the controller passes in (built by the canonical
//      `trustedTenantId(req)` resolver). It is NEVER read from
//      req.query.tenantId, req.body.tenantId, a `tenantId` header, or a
//      `companyId` header. There is no second tenant resolver in this file.
//   2. FAIL CLOSED. With no trusted tenant every public method throws. The
//      service never returns a shared collection, never falls back to a
//      default tenant, never invents a tenant, and never silently creates a
//      global record. This matters because AUTH_REQUIRED and
//      ENABLE_TENANT_CARRY are both OFF by default: the global platform
//      defaults are a Master/deployment decision and this module does not
//      touch them.
//   3. SERVER-OWNED IMMUTABLE tenantId. The trusted tenant is stamped on
//      create and re-asserted on every update. A client-supplied tenantId is
//      IGNORED, never honoured.
//   4. EXPLICIT FIELD WHITELIST. Client payloads are never spread into a
//      persisted record. Only the keys in WRITABLE_FIELDS are copied, and
//      only after a type check. `tenantId` is not a writable field, so the
//      blind-spread re-parenting defect seen in customers.service.js cannot
//      exist here by construction.
//   5. TENANT-OWNED STORAGE. The store is a flat array of per-tenant packs,
//      exactly like studentServicesPack.service. There is no shared/global
//      collection to leak across tenants, and every read filters by tenant.
//
// The `packs` array is keyed by tenantId and every accessor filters by the
// trusted tenant before returning anything, so cross-tenant read, update and
// delete isolation are structural rather than incidental.

const storageAdapter = require('../repositories/storageAdapter');
const logger = require('../utils/logger');

const STORE_KEY = 'educationPack';

// Capability manifest.
//
// This is a static descriptor of what the Education foundation DOES and DOES
// NOT provide, returned by `listCapabilities()`. It is intentionally NOT a
// data model: no shapes, no persistence, no CRUD. Every entry is explicitly
// `implemented: false` because STU-1 ships none of them, and claiming otherwise
// would misrepresent the surface to clients.
//
// Staff capability permissions and future PORTAL actor permissions are
// deliberately kept as separate concepts: a future Guardian must NOT receive
// the broad staff `education.students.view` permission merely to see their own
// child. Portal access must be resource-scoped at the link level.
const CAPABILITIES = Object.freeze([
  { key: 'pack', implemented: true, phase: 'STU-1', description: 'Tenant-scoped Education foundation settings.' },
  { key: 'students', implemented: true, phase: 'STU-2', description: 'Tenant-scoped Student records.' },
  { key: 'teachers', implemented: true, phase: 'STU-3', description: 'Tenant-scoped Teacher directory. Operational records only; no payroll or portal.' },
  { key: 'programs', implemented: false, phase: 'STU-4', description: 'Programs and Centers. Not implemented.' },
  { key: 'enrollments', implemented: false, phase: 'STU-5', description: 'Enrollment. Not implemented.' },
  { key: 'attendance', implemented: false, phase: 'STU-6', description: 'Attendance. Not implemented.' },
  { key: 'scheduling', implemented: false, phase: 'STU-7', description: 'Timetable and scheduling. Not implemented.' }
]);

// EXPLICIT WRITE WHITELIST. A key absent from this object can never be
// persisted from client input. `tenantId` is deliberately absent — tenant
// ownership is server-owned and immutable.
const WRITABLE_FIELDS = Object.freeze({
  academicYear: 'string',
  timezone: 'string',
  currency: 'string'
});

function _defaultDoc() {
  return { packs: [] };
}

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('educationPack.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(doc) {
  try {
    storageAdapter.write(STORE_KEY, doc);
  } catch (err) {
    logger.warn('educationPack.service: failed to write store', err.message);
  }
}

// The ONLY tenant source in this file: the trusted context object handed in by
// the controller. Mirrors the existing studentServicesPack / gameHosting
// convention. Returns null when absent — never a default, never a fallback.
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

function _defaultPack(tenantId) {
  return {
    tenantId,
    academicYear: '',
    timezone: '',
    currency: 'EGP',
    createdAt: null,
    updatedAt: null
  };
}

// Copy ONLY whitelisted keys, only when explicitly present, only after a type
// check. Returns a fresh object — the caller never spreads client input into a
// persisted record.
function _sanitizeWritable(payload) {
  const src = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
  const clean = {};
  for (const [key, kind] of Object.entries(WRITABLE_FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    const value = src[key];
    if (value === null) {
      clean[key] = kind === 'string' ? '' : value;
      continue;
    }
    if (kind === 'string') {
      if (typeof value !== 'string') throw new Error(key + ' must be a string');
      clean[key] = value.trim();
    }
  }
  return clean;
}

function _tenantPacks(doc) {
  return Array.isArray(doc.packs) ? doc.packs : [];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Reads are tenant-filtered BEFORE returning. A tenant with no pack yet gets a
// non-persisted default derived from its own trusted tenant id — never another
// tenant's pack, never a shared/global one.
function getPack(tenantContext) {
  const tid = _requireTenantId(tenantContext);
  const packs = _tenantPacks(_readStore());
  const found = packs.find(p => String(p.tenantId || '') === tid);
  return found ? { ...found } : _defaultPack(tid);
}

// Create-or-update, scoped to the trusted tenant.
//
// The spread here is of the EXISTING SERVER-OWNED RECORD (`base`), never of the
// client payload — `clean` is the whitelisted subset. `tenantId` is re-asserted
// after both spreads so it can never be overwritten by input.
function updatePack(tenantContext, payload) {
  const tid = _requireTenantId(tenantContext);
  const clean = _sanitizeWritable(payload);

  const doc = _readStore();
  const packs = _tenantPacks(doc);
  const idx = packs.findIndex(p => String(p.tenantId || '') === tid);

  const now = new Date().toISOString();
  const base = idx >= 0 ? { ...packs[idx] } : _defaultPack(tid);

  const next = {
    ...base,
    ...clean,
    tenantId: tid,
    createdAt: base.createdAt || now,
    updatedAt: now
  };

  if (idx >= 0) packs[idx] = next;
  else packs.push(next);

  _writeStore({ ...doc, packs });
  return { ...next };
}

// Delete is scoped exactly like every other accessor: it only ever touches the
// caller's OWN tenant pack. A foreign tenant id can never be reached because
// the index lookup is always the trusted tenant.
function resetPack(tenantContext) {
  const tid = _requireTenantId(tenantContext);

  const doc = _readStore();
  const packs = _tenantPacks(doc);
  const idx = packs.findIndex(p => String(p.tenantId || '') === tid);

  if (idx < 0) return false;

  packs.splice(idx, 1);
  _writeStore({ ...doc, packs });
  return true;
}

// Static capability manifest. Carries NO tenant data, so it deliberately does
// not require a tenant context — but the route still enforces the Education
// permission, so it is never a public endpoint.
function listCapabilities() {
  return CAPABILITIES.map(c => ({ ...c }));
}

module.exports = {
  getPack,
  updatePack,
  resetPack,
  listCapabilities,
  CAPABILITIES,
  WRITABLE_FIELDS,
  STORE_KEY
};
