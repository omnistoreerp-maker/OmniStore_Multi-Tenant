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

// Platform-GLOBAL store names (3B.2-C). These collections are shared across
// ALL tenants/companies and must NEVER be tenant-stamped, tenant-filtered, or
// entity-isolated. `products` (the catalog) is the canonical example;
// apiKeys/errors/jobs/webhooks are the platform-level stores documented as
// GLOBAL in the 3B.2 discovery report. `companies` is handled separately
// (company.service.js uses storageAdapter directly, not a repository).
const GLOBAL_STORES = new Set(['products', 'apiKeys', 'errors', 'jobs', 'webhooks']);

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

  // Whether this store holds platform-GLOBAL data (never tenant-scoped).
  _isGlobalStore() {
    return GLOBAL_STORES.has(this.storeName);
  }

  _shouldStampTenant() {
    if (this._isGlobalStore()) return false;
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
      if (!fs.existsSync(filePath)) return (this.storeName === 'sales' || this.storeName === 'purchases') ? { invoices: [] } : {};
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
      return (this.storeName === 'sales' || this.storeName === 'purchases') ? { invoices: [] } : {};
    }
  }

  // The FULL, unfiltered store document (fresh from disk). Entity WRITE
  // operations must persist against the complete document so a tenant-scoped
  // mutation can never drop another tenant's records in the shared store.
  // Ownership gating is applied explicitly inside each entity operation.
  _rawStore() {
    return this._readOnDisk();
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
    if (this._isGlobalStore()) return false;
    return config.tenantFilteringEnabled && this.hasTenant();
  }

  // Phase 22 — optional WRITE/READ ownership isolation on the entity API.
  //
  // Dormant by default, exactly like Phases 12/13: enforcement turns ON only
  // when BOTH a tenant accessor is wired AND config.tenantEntityIsolationEnabled
  // (ENABLE_TENANT_ENTITY_ISOLATION=true) is set. The current tenant is taken
  // exclusively from the trusted accessor (tenant context carried by the
  // authenticated request chain — never from body/query/headers).
  _shouldEnforceIsolation() {
    // Per-domain gating: the general entity isolation flag applies to every
    // store; ENABLE_TENANT_SALES_ISOLATION (Phase 24) and
    // ENABLE_TENANT_PURCHASES_ISOLATION (Phase 25) activate the SAME Phase 22
    // boundary but ONLY for their pilot store. This keeps all other
    // repositories 100% unaffected when either flag is set globally.
    if (this._isGlobalStore()) return false;
    const salesIsolation = config.tenantSalesIsolationEnabled && this.storeName === 'sales';
    const purchasesIsolation = config.tenantPurchasesIsolationEnabled && this.storeName === 'purchases';
    return (config.tenantEntityIsolationEnabled || salesIsolation || purchasesIsolation) && this.hasTenant();
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

  // Phase 21 — Repository Entity API Foundation (additive, opt-in).
  //
  // Entity-level overlay ON TOP of the existing read()/write() primitives.
  // It exists so future phases can enforce tenant ownership on a single
  // explicit record (deferred Phase 14) without touching write().
  //
  // This phase enforces NOTHING tenant-related: no tenantId injection, no
  // filtering, no cross-tenant rejection. Every method is a pure read→mutate→
  // persist through the EXACT same path services already use:
  //   - reads go through this.read()  -> Phase 13 read-time filtering applies
  //   - writes go through this.write() -> Phase 12 CREATE stamping applies
  //     (both dormant until a tenant accessor is wired AND the flag is on).
  //
  // Identity (reused, NOT invented): the same ordered key set _entityKey()
  // already uses for Phase 12 diffing — id, _id, invoiceId, recordId, code,
  // userId. The first present key is the record's identity; matching is done
  // case-preserving, trimmed, string-coerced, exactly like the services.
  //
  // Return contract (documented, matches the repo's safe non-throwing style):
  //   createEntity -> the persisted entity, or null (invalid / duplicate / rejected / write failed)
  //   updateEntity -> the merged entity, or null (not found / rejected / write failed)
  //   deleteEntity -> boolean (true removed+persisted; false not-found / rejected / write failed)
  //   findEntity   -> the entity, or null (not found / filtered out by Phase 13+22)
  //
  // Phase 22 tenant ownership isolation (additive, flag+accessor gated):
  //   CREATE  -> entity WITHOUT a tenantId is bound to the current tenant;
  //              entity claiming a different tenantId is rejected (null).
  //   FIND    -> visible only when owned by the current tenant or legacy
  //              (no tenantId); other-tenancy records return null.
  //   UPDATE  -> only records owned by the current tenant; legacy and
  //              other-tenancy records are rejected (null); a patch cannot
  //              move or reassign ownership.
  //   DELETE  -> only records owned by the current tenant; legacy and
  //              other-tenancy records are rejected (false).
  //   Legacy (no tenantId) records stay readable (Phase 13 rule) but are
  //   read-only: they cannot be updated or deleted under isolation.
  //   Rejections happen BEFORE persistence — no partial writes ever occur.
  //   When the flag/accessor are off, every method keeps its Phase 21
  //   behaviour byte-for-byte.

  _identityKeys() {
    return ['id', '_id', 'invoiceId', 'recordId', 'code', 'userId'];
  }

  // First present identity value for a record, or undefined.
  _identityValue(entity) {
    if (!entity || typeof entity !== 'object') return undefined;
    for (const key of this._identityKeys()) {
      if (entity[key] !== undefined && entity[key] !== null && String(entity[key]).trim() !== '') {
        return String(entity[key]).trim();
      }
    }
    return undefined;
  }

  // Whether `record` carries the given identity value (any identity key).
  _matchesIdentity(record, id) {
    if (!record || typeof record !== 'object') return false;
    const value = this._identityValue(record);
    return value !== undefined && value === String(id).trim();
  }

  // The collection array at `collectionName` inside the store document, or
  // undefined when the field is present but is NOT an array.
  _collection(db, collectionName) {
    if (db == null || typeof db !== 'object') return undefined;
    const value = db[collectionName];
    if (value === undefined || value === null) return undefined;
    return Array.isArray(value) ? value : undefined;
  }

  // Single persistence chokepoint for the entity API. Assigns the (already
  // mutated) collection array back onto the store document and persists the
  // whole document through this.write() exactly as services do. Returns the
  // boolean result of write().
  //
  // The baseline document is read UNFILTERED from disk (NOT this.read()):
  // persist must never depend on the caller's tenant-filtered view, or one
  // tenant's write could silently drop another tenant's records from the
  // shared document. Ownership gating already happens inside the operation
  // itself; the document persisted is always the full store.
  _saveCollection(collectionName, collection) {
    if (typeof collectionName !== 'string' || collectionName === '') return false;
    const db = this._readOnDisk();
    if (db == null || typeof db !== 'object') return false;
    db[collectionName] = collection;
    return this.write(db);
  }

  // Append `entity` to the collection. Refuses (returns null) when the entity
  // carries an identity that already exists — mirroring the duplicate-id guard
  // every service already applies. Entities without a resolvable identity are
  // appended as-is. Persists through _saveCollection -> this.write().
  createEntity(collectionName, entity) {
    if (typeof collectionName !== 'string' || collectionName === '') return null;
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return null;

    if (this._shouldEnforceIsolation()) {
      const tenantId = this._currentTenantId();
      if (tenantId == null) return null;
      const claimed = entity.tenantId;
      if (claimed !== undefined && claimed !== null && claimed !== '') {
        if (String(claimed) !== String(tenantId)) return null;
      } else {
        entity = Object.assign({}, entity, { tenantId });
      }
    }

    // Baseline = the FULL store document (unfiltered). Persisting must never be
    // derived from a tenant-filtered view or one tenant's create could erase
    // another tenant's records in the shared document. Ownership gating is done
    // explicitly above (Phase 22 / Phase 24).
    const db = this._rawStore();
    const collection = this._collection(db, collectionName);

    const identity = this._identityValue(entity);
    if (identity !== undefined) {
      const list = collection || [];
      if (list.some(record => this._matchesIdentity(record, identity))) return null;
    }

    const target = collection ? collection.slice() : [];
    target.push(entity);
    if (!this._saveCollection(collectionName, target)) return null;

    // Return the record as it now exists in the store (Phase 12 CREATE
    // stamping may have enriched the persisted copy), not the raw input.
    const stored = this.read();
    const list = this._collection(stored, collectionName) || [];
    if (identity !== undefined) {
      return list.find(record => this._matchesIdentity(record, identity)) || entity;
    }
    return list.length ? list[list.length - 1] : entity;
  }

  // Merge `patchOrEntity` into the record matching `id`. Returns the merged
  // entity, or null when no record matches. Identity keys on the original are
  // preserved (a patch cannot silently rename a record). Persists through
  // _saveCollection -> this.write().
  updateEntity(collectionName, id, patchOrEntity) {
    if (typeof collectionName !== 'string' || collectionName === '' || id == null) return null;
    if (!patchOrEntity || typeof patchOrEntity !== 'object' || Array.isArray(patchOrEntity)) return null;

    const db = this._rawStore(); // unfiltered baseline — see createEntity
    const collection = this._collection(db, collectionName);
    if (!collection) return null;

    const idx = collection.findIndex(record => this._matchesIdentity(record, id));
    if (idx === -1) return null;

    const existing = collection[idx];

    if (this._shouldEnforceIsolation()) {
      const tenantId = this._currentTenantId();
      if (tenantId == null) return null;
      const ownership = existing.tenantId;
      if (ownership === undefined || ownership === null || ownership === '') return null;
      if (String(ownership) !== String(tenantId)) return null;
      const claimed = patchOrEntity.tenantId;
      if (claimed !== undefined && claimed !== null && claimed !== '') {
        if (String(claimed) !== String(tenantId)) return null;
      }
    }

    const merged = Object.assign({}, existing, patchOrEntity);
    for (const key of this._identityKeys()) {
      if (existing[key] !== undefined && existing[key] !== null) merged[key] = existing[key];
    }
    if (this._shouldEnforceIsolation()) merged.tenantId = existing.tenantId;

    const target = collection.slice();
    target[idx] = merged;
    if (!this._saveCollection(collectionName, target)) return null;
    return merged;
  }

  // Remove the record matching `id`. Returns true when removed and persisted,
  // false when nothing matched or the write failed.
  deleteEntity(collectionName, id) {
    if (typeof collectionName !== 'string' || collectionName === '' || id == null) return false;

    const db = this._rawStore(); // unfiltered baseline — see createEntity
    const collection = this._collection(db, collectionName);
    if (!collection) return false;

    const idx = collection.findIndex(record => this._matchesIdentity(record, id));
    if (idx === -1) return false;

    if (this._shouldEnforceIsolation()) {
      const tenantId = this._currentTenantId();
      if (tenantId == null) return false;
      const ownership = collection[idx].tenantId;
      if (ownership === undefined || ownership === null || ownership === '') return false;
      if (String(ownership) !== String(tenantId)) return false;
    }

    const target = collection.slice();
    target.splice(idx, 1);
    return this._saveCollection(collectionName, target);
  }

  // Return the record matching `id`, or null. Reads via this.read(), so Phase
  // 13 tenant filtering applies: a record hidden from the current tenant is
  // simply not found. Under Phase 22 isolation the same visibility rule is
  // applied explicitly (legacy or same-tenant -> found; other tenancy -> null)
  // even when Phase 13 filtering is off. No write is performed.
  findEntity(collectionName, id) {
    if (typeof collectionName !== 'string' || collectionName === '' || id == null) return null;

    const db = this.read();
    const collection = this._collection(db, collectionName);
    if (!collection) return null;

    const found = collection.find(record => this._matchesIdentity(record, id)) || null;
    if (!found) return null;

    if (this._shouldEnforceIsolation()) {
      const tenantId = this._currentTenantId();
      if (tenantId == null) return null;
      return this._isVisibleToTenant(found, tenantId) ? found : null;
    }
    return found;
  }

  // ============================================================
  // 3B.2-A — ASYNC API (additive).
  //
  // Promise-based counterparts of the synchronous read()/write() and the
  // Phase 21/22 entity API. They apply the EXACT same tenant rules
  // (filtering, stamping, ownership isolation) through the same helpers;
  // only persistence is awaitable. The synchronous methods above remain
  // untouched, so every existing caller keeps working unchanged.
  //
  // The async path never touches the filesystem directly: it goes through
  // storageAdapter.readRawAsync()/writeAsync(), so a future PostgreSQL
  // adapter can implement the same contract without repository changes.
  // ============================================================

  // Async whole-document read with the same read-time tenant filtering as
  // the synchronous read(). Returns a Promise of the (filtered) document.
  async readAsync() {
    const data = await storageAdapter.readAsync(this.storeName);
    return this._filterTenantData(data);
  }

  // Async whole-document write with the same CREATE-time tenant stamping as
  // the synchronous write(). Returns a Promise of the write result.
  async writeAsync(data) {
    if (this._shouldStampTenant()) {
      data = this._stampTenantOnCreate(data);
    }
    return storageAdapter.writeAsync(this.storeName, data);
  }

  // Async counterpart of _readOnDisk(): reads the FULL store document fresh
  // from the adapter (bypassing the read cache). Entity WRITE operations use
  // this so a tenant-scoped mutation can never drop another tenant's records
  // from the shared document; ownership gating is applied explicitly inside
  // each entity operation (same rules as the synchronous entity API).
  async _readOnDiskAsync() {
    return storageAdapter.readRawAsync(this.storeName);
  }

  async _rawStoreAsync() {
    return this._readOnDiskAsync();
  }

  // Async persistence chokepoint for the entity API: assigns the (already
  // mutated) collection array onto the full store document and persists it
  // through writeAsync(). Returns a Promise of the write result.
  async _saveCollectionAsync(collectionName, collection) {
    if (typeof collectionName !== 'string' || collectionName === '') return false;
    const db = await this._readOnDiskAsync();
    if (db == null || typeof db !== 'object') return false;
    db[collectionName] = collection;
    return this.writeAsync(db);
  }

  // Async append with the same duplicate-id guard, tenant stamping and
  // ownership gating as createEntity(). Returns a Promise of the persisted
  // entity (or null when invalid/duplicate/rejected/write failed).
  async createAsync(collectionName, entity) {
    if (typeof collectionName !== 'string' || collectionName === '') return null;
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return null;

    if (this._shouldEnforceIsolation()) {
      const tenantId = this._currentTenantId();
      if (tenantId == null) return null;
      const claimed = entity.tenantId;
      if (claimed !== undefined && claimed !== null && claimed !== '') {
        if (String(claimed) !== String(tenantId)) return null;
      } else {
        entity = Object.assign({}, entity, { tenantId });
      }
    }

    const db = await this._rawStoreAsync();
    const collection = this._collection(db, collectionName);

    const identity = this._identityValue(entity);
    if (identity !== undefined) {
      const list = collection || [];
      if (list.some(record => this._matchesIdentity(record, identity))) return null;
    }

    const target = collection ? collection.slice() : [];
    target.push(entity);
    if (!(await this._saveCollectionAsync(collectionName, target))) return null;

    const stored = await this.readAsync();
    const list = this._collection(stored, collectionName) || [];
    if (identity !== undefined) {
      return list.find(record => this._matchesIdentity(record, identity)) || entity;
    }
    return list.length ? list[list.length - 1] : entity;
  }

  // Async merge with the same identity preservation and ownership gating as
  // updateEntity(). Returns a Promise of the merged entity (or null).
  async updateAsync(collectionName, id, patchOrEntity) {
    if (typeof collectionName !== 'string' || collectionName === '' || id == null) return null;
    if (!patchOrEntity || typeof patchOrEntity !== 'object' || Array.isArray(patchOrEntity)) return null;

    const db = await this._rawStoreAsync();
    const collection = this._collection(db, collectionName);
    if (!collection) return null;

    const idx = collection.findIndex(record => this._matchesIdentity(record, id));
    if (idx === -1) return null;

    const existing = collection[idx];

    if (this._shouldEnforceIsolation()) {
      const tenantId = this._currentTenantId();
      if (tenantId == null) return null;
      const ownership = existing.tenantId;
      if (ownership === undefined || ownership === null || ownership === '') return null;
      if (String(ownership) !== String(tenantId)) return null;
      const claimed = patchOrEntity.tenantId;
      if (claimed !== undefined && claimed !== null && claimed !== '') {
        if (String(claimed) !== String(tenantId)) return null;
      }
    }

    const merged = Object.assign({}, existing, patchOrEntity);
    for (const key of this._identityKeys()) {
      if (existing[key] !== undefined && existing[key] !== null) merged[key] = existing[key];
    }
    if (this._shouldEnforceIsolation()) merged.tenantId = existing.tenantId;

    const target = collection.slice();
    target[idx] = merged;
    if (!(await this._saveCollectionAsync(collectionName, target))) return null;
    return merged;
  }

  // Async remove with the same ownership gating as deleteEntity(). Returns a
  // Promise of boolean (true removed+persisted; false otherwise).
  async deleteAsync(collectionName, id) {
    if (typeof collectionName !== 'string' || collectionName === '' || id == null) return false;

    const db = await this._rawStoreAsync();
    const collection = this._collection(db, collectionName);
    if (!collection) return false;

    const idx = collection.findIndex(record => this._matchesIdentity(record, id));
    if (idx === -1) return false;

    if (this._shouldEnforceIsolation()) {
      const tenantId = this._currentTenantId();
      if (tenantId == null) return false;
      const ownership = collection[idx].tenantId;
      if (ownership === undefined || ownership === null || ownership === '') return false;
      if (String(ownership) !== String(tenantId)) return false;
    }

    const target = collection.slice();
    target.splice(idx, 1);
    return this._saveCollectionAsync(collectionName, target);
  }

  // Async single-record read with the same visibility rules as findEntity().
  // Returns a Promise of the entity (or null).
  async findAsync(collectionName, id) {
    if (typeof collectionName !== 'string' || collectionName === '' || id == null) return null;

    const db = await this.readAsync();
    const collection = this._collection(db, collectionName);
    if (!collection) return null;

    const found = collection.find(record => this._matchesIdentity(record, id)) || null;
    if (!found) return null;

    if (this._shouldEnforceIsolation()) {
      const tenantId = this._currentTenantId();
      if (tenantId == null) return null;
      return this._isVisibleToTenant(found, tenantId) ? found : null;
    }
    return found;
  }

  // Async collection read (same shape as readCollection()). Returns a
  // Promise of the primary array inside the store document, if present.
  async readCollectionAsync(key) {
    const db = await this.readAsync();
    return Array.isArray(key) ? key : ((db && db[key]) || []);
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