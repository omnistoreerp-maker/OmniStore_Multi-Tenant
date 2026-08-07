'use strict';

// Generic repository base. Binds a concrete store name to the storage
// adapter and exposes read/write plus small searching helpers. Services
// depend only on this Repository abstraction — they never touch the
// storage adapter or the underlying engine directly.
//
// Design notes for future multi-tenant / provider work:
//   - tenant-scoped filtering can be added here (or in the adapter) without
//     touching any Service.
//   - a different storage provider can implement the same thin interface
//     (`read(storeName)` / `write(storeName, data)`) and be injected here.

const fs = require('fs');
const storageAdapter = require('./storageAdapter');
const config = require('../config');

class BaseRepository {
  constructor(storeName, tenantAccessor) {
    this.storeName = storeName;
    // OPTIONAL: tenant-accessor (Tenant-Capable, NOT Tenant-Dependent). When
    // absent the tenant helpers below return null/false. The optional write-time
    // tenant metadata injection (see write) only activates when an accessor is
    // present AND ENABLE_TENANT_METADATA is enabled.
    this.tenantAccessor = tenantAccessor || null;
  }

  read() {
    const data = storageAdapter.read(this.storeName);
    return this._filterTenantData(data);
  }

  write(data) {
    if (this._shouldStampTenant()) {
      data = this._stampTenantOnCreate(data);
    }
    return storageAdapter.write(this.storeName, data);
  }

  // Tenant helpers (opt-in; NO repository uses them yet). Both delegate to
  // the optional TenantAccessor when it is available, otherwise they return
  // null / false so existing behaviour is 100% preserved.

  // Return the current TenantContext, or null when no accessor is wired.
  getCurrentTenant() {
    if (!this.tenantAccessor) return null;
    const tenant = this.tenantAccessor.getCurrentTenant
      ? this.tenantAccessor.getCurrentTenant()
      : null;
    return tenant != null ? tenant : null;
  }

  // Whether a tenant is available for this repository, or false by default.
  hasTenant() {
    return this.getCurrentTenant() != null;
  }

  // OPTIONAL write-time tenant metadata injection (Phase 12).
  //
  // When BOTH a tenant accessor is wired AND config.tenantMetadataEnabled
  // (ENABLE_TENANT_METADATA=true) is on, records that are NEW (absent from the
  // on-disk document) and that do not already carry a `tenantId` get stamped
  // with the current tenant id — on CREATE only. It never overwrites an
  // existing `tenantId`, never touches records already present on disk
  // (updates/imports/old data), and is a pure no-op when the flag is off or
  // no tenant is resolved, keeping existing JSON byte-for-byte identical.

  _shouldStampTenant() {
    return config.tenantMetadataEnabled && this.hasTenant();
  }

  // Best-effort stable identity for a record, used to tell NEW records apart
  // from records already present on disk. Falls back to a JSON fingerprint so
  // stores without an id-like field still diff correctly.
  _entityKey(entity) {
    if (!entity || typeof entity !== 'object') return 'json:' + JSON.stringify(entity);
    for (const key of ['id', '_id', 'invoiceId', 'recordId', 'code', 'userId']) {
      if (entity[key] !== undefined && entity[key] !== null) return key + ':' + String(entity[key]);
    }
    return 'json:' + JSON.stringify(entity);
  }

  // Read the previous durable state straight from disk, bypassing the in-memory
  // read cache. The diffusion needs the state as it was at the START of this
  // write — i.e. without the caller's yet-to-be-persisted mutations — while
  // storageAdapter.read() returns a live cached reference the service may have
  // already mutated.
  _readOnDisk() {
    const filePath = storageAdapter.path(this.storeName);
    try {
      if (!fs.existsSync(filePath)) return this.storeName === 'sales' ? { invoices: [] } : {};
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
      return this.storeName === 'sales' ? { invoices: [] } : {};
    }
  }

  _currentTenantId() {
    const tenant = this.getCurrentTenant();
    if (tenant == null) return null;
    const id = tenant.tenantId != null ? tenant.tenantId : tenant.id;
    return id != null && id !== '' ? String(id) : null;
  }

  _stampTenantOnCreate(data) {
    if (data == null || typeof data !== 'object') return data;

    const tenantId = this._currentTenantId();
    if (tenantId == null) return data;

    const disk = this._readOnDisk();
    const out = Array.isArray(data) ? [] : {};

    for (const key of Object.keys(data)) {
      const value = data[key];
      if (!Array.isArray(value)) {
        out[key] = value;
        continue;
      }
      const diskArr = (disk && Array.isArray(disk[key])) ? disk[key] : [];
      const diskIds = new Set(diskArr.map(el => this._entityKey(el)));
      let changed = false;
      const stamped = value.map(el => {
        if (!el || typeof el !== 'object' || el.tenantId !== undefined) return el;
        if (diskIds.has(this._entityKey(el))) return el;
        changed = true;
        return Object.assign({}, el, { tenantId });
      });
      out[key] = changed ? stamped : value;
    }

    return out;
  }

  // OPTIONAL read-time tenant isolation (Phase 13).
  //
  // When BOTH a tenant accessor is wired AND config.tenantFilteringEnabled
  // (ENABLE_TENANT_FILTERING=true) is on, every array-valued collection inside
  // the read document is filtered so that only the caller's tenant is visible.
  //
  // Visibility rule (read-only — nothing is ever written or mutated):
  //   - a record with NO tenantId is legacy data  -> ALWAYS visible
  //   - a record with tenantId === currentTenant -> visible
  //   - a record with tenantId !== currentTenant -> hidden
  //
  // Filtering is a pure no-op (returns the underlying document untouched and
  // strictly byte-identical to Phase 12) when the flag is off, no accessor is
  // wired, no tenant is resolved, or the record has no tenant metadata.

  _shouldFilterTenant() {
    return config.tenantFilteringEnabled && this.hasTenant();
  }

  // Visibility rule for a single record under the current tenant. Legacy
  // records (no tenantId) and matching records pass; other-tenancy records are
  // hidden.
  _isVisibleToTenant(record, tenantId) {
    if (record == null || typeof record !== 'object') return true;
    if (record.tenantId === undefined || record.tenantId === null || record.tenantId === '') return true;
    return String(record.tenantId) === tenantId;
  }

  _filterTenantData(data) {
    if (!this._shouldFilterTenant() || data == null || typeof data !== 'object') return data;

    const tenantId = this._currentTenantId();
    if (tenantId == null) return data;

    const out = Array.isArray(data) ? [] : {};
    let changed = false;

    for (const key of Object.keys(data)) {
      const value = data[key];
      if (!Array.isArray(value)) {
        out[key] = value;
        continue;
      }
      const visible = value.filter(el => this._isVisibleToTenant(el, tenantId));
      if (visible.length !== value.length) changed = true;
      out[key] = visible;
    }

    return changed ? out : data;
  }

  // Common collection-style helpers (opt-in; most services keep their own
  // richer logic on top of read()/write()). These are thin conveniences.

  // Read the primary array inside a store document, if present.
  readCollection(key) {
    const db = this.read();
    return Array.isArray(key) ? key : ((db && db[key]) || []);
  }

  // Find the first element in `arr` matching `predicate`.
  findIn(arr, predicate) {
    if (!Array.isArray(arr)) return null;
    return arr.find(predicate) || null;
  }

  findIndexIn(arr, predicate) {
    if (!Array.isArray(arr)) return -1;
    return arr.findIndex(predicate);
  }

  // Storage-level primitives (readiness/health probes). Behaviour identical
  // to the previous direct use of the engine internals.
  static ensureDataDir() {
    return storageAdapter.ensureDir();
  }

  static resolvePath(name) {
    return storageAdapter.path(name);
  }
}

module.exports = BaseRepository;