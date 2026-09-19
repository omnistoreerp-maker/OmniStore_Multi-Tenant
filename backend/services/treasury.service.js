const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const config = require('../config');
const branchStore = require('../middleware/branchStore');
const repository = require('../repositories').treasury;

class TreasuryService {
  // Tenant-FILTERED read view (list/get/stats). With ENABLE_TENANT_FILTERING
  // on, the repository hides other tenants' records here.
  async _load() {
    const db = await repository.readAsync();
    if (!db || typeof db !== 'object') return { entries: [] };
    if (!Array.isArray(db.entries)) db.entries = [];
    return db;
  }
  async _save(db) { return repository.writeAsync(db); }

  // FULL, unfiltered store document for WRITES (BaseRepository._rawStore
  // rule): a write must never persist a tenant-filtered snapshot that could
  // drop other tenants' records. Ownership is gated explicitly below.
  async _loadRaw() {
    const db = await repository._rawStoreAsync();
    if (!db || typeof db !== 'object') return { entries: [] };
    if (!Array.isArray(db.entries)) db.entries = [];
    return db;
  }

  // Cross-tenant write guard (same rule as Customers / InventoryTransactions):
  // a record claiming a DIFFERENT tenantId is never modified/deleted by this
  // request — treated as not-found (404). Legacy records (no tenantId) stay
  // writable. No-op when no tenant is carried (legacy single-company mode).
  _ownershipBlocked(entry) {
    if (!repository.hasTenant()) return false;
    if (!entry || typeof entry !== 'object') return true;
    const tid = entry.tenantId;
    if (tid === undefined || tid === null || tid === '') return false;
    const current = repository.getCurrentTenant();
    const currentId = current && (current.tenantId != null ? current.tenantId : current.id);
    return currentId == null || String(tid) !== String(currentId);
  }

  // Phase F — Branch isolation. OPT-IN via ENABLE_BRANCH_ISOLATION. The
  // trusted branch comes from the request-level branchStore (resolved by the
  // branchStore.middleware from the STORED user record — never from the
  // client). Rules are identical to the tenant pattern:
  //   - record with NO branchId -> legacy -> always visible (read-only)
  //   - record branchId == branch scope -> visible / writable
  //   - record branchId != branch scope -> hidden (never leaks), not found
  // User without a branch scope (Owner/Admin/Manager/…) is never restricted.
  _branchActive() {
    return config.branchIsolationEnabled && !!branchStore.get();
  }

  _branchBlocked(entry) {
    if (!config.branchIsolationEnabled) return false;
    if (!entry || typeof entry !== 'object') return true;
    const bid = entry.branchId;
    if (bid === undefined || bid === null || bid === '') return false; // legacy
    const scope = branchStore.get();
    if (!scope) return false; // unscoped user -> not enforced
    return String(bid) !== String(scope);
  }

  _branchVisibleEntries(entries) {
    if (!this._branchActive()) return entries;
    const scope = branchStore.get();
    return entries.filter(e => {
      if (!e || typeof e !== 'object') return true;
      if (e.branchId === undefined || e.branchId === null || e.branchId === '') return true; // legacy
      return String(e.branchId) === scope;
    });
  }

  // Server-authoritative branch stamping for creates + rejection of a create
  // that claims a branch the user does not own (defence-in-depth behind the
  // branchScope middleware).
  _applyBranchToCreate(data) {
    if (!config.branchIsolationEnabled) return null;
    const scope = branchStore.get();
    if (!scope) return null;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      if (data.branchId != null && data.branchId !== '' && String(data.branchId) !== String(scope)) {
        return 'Branch scope denied';
      }
      if (data.branchId === undefined || data.branchId === null || data.branchId === '') {
        data.branchId = scope;
      }
    }
    return null;
  }

  _validateRequired(data, forCreate) {
    const errors = [];
    if (forCreate && (data.type === undefined || data.type === null || String(data.type).trim() === '')) errors.push('type is required');
    if (data.type !== undefined && !['in', 'out'].includes(String(data.type))) errors.push('type must be "in" or "out"');
    if (forCreate && (data.amount === undefined || data.amount === null)) errors.push('amount is required');
    if (data.amount !== undefined && typeof data.amount !== 'number') errors.push('amount must be a number');
    if (data.balance !== undefined && typeof data.balance !== 'number') errors.push('balance must be a number');
    if (data.date !== undefined && typeof data.date !== 'string') errors.push('date must be a string');
    if (data.method !== undefined && typeof data.method !== 'string') errors.push('method must be a string');
    if (data.desc !== undefined && typeof data.desc !== 'string') errors.push('desc must be a string');
    if (data.user !== undefined && typeof data.user !== 'string') errors.push('user must be a string');
    return errors;
  }

  _normalizeId(id) {
    return String(id).trim();
  }

  _matchesId(entry, normalized) {
    return this._normalizeId(entry.id) === normalized || this._normalizeId(entry._backendId || '') === normalized;
  }

  async list(query = {}) {
    const db = await this._load();
    let entries = db.entries || [];
    entries = this._branchVisibleEntries(entries);

    if (query.search) {
      const q = String(query.search).toLowerCase();
      entries = entries.filter(e =>
        String(e.desc || '').toLowerCase().includes(q) ||
        String(e.user || '').toLowerCase().includes(q) ||
        String(e.method || '').toLowerCase().includes(q)
      );
    }
    if (query.type) {
      const q = String(query.type).toLowerCase();
      entries = entries.filter(e => String(e.type || '').toLowerCase() === q);
    }
    if (query.method) {
      const q = String(query.method).toLowerCase();
      entries = entries.filter(e => String(e.method || '').toLowerCase() === q);
    }
    if (query.user) {
      const q = String(query.user).toLowerCase();
      entries = entries.filter(e => String(e.user || '').toLowerCase() === q);
    }
    if (query.dateFrom) {
      const from = new Date(query.dateFrom).getTime();
      if (!isNaN(from)) entries = entries.filter(e => new Date(e.date || e.createdAt).getTime() >= from);
    }
    if (query.dateTo) {
      const to = new Date(query.dateTo).getTime();
      if (!isNaN(to)) entries = entries.filter(e => new Date(e.date || e.createdAt).getTime() <= to);
    }

    const sortBy = query.sortBy || 'date';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    entries.sort((a, b) => {
      let va = a[sortBy], vb = b[sortBy];
      if (sortBy === 'date' || sortBy === 'createdAt' || sortBy === 'updatedAt') {
        va = new Date(va || 0).getTime();
        vb = new Date(vb || 0).getTime();
      } else if (sortBy === 'amount' || sortBy === 'balance' || sortBy === 'id') {
        va = Number(va) || 0;
        vb = Number(vb) || 0;
      } else {
        va = String(va || '').toLowerCase();
        vb = String(vb || '').toLowerCase();
      }
      return va < vb ? -sortOrder : va > vb ? sortOrder : 0;
    });

    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
    const total = entries.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const paginated = entries.slice(start, start + limit);

    return { entries: paginated, total, page, limit, totalPages };
  }

  async getById(id) {
    const db = await this._load();
    const normalized = this._normalizeId(id);
    const found = (db.entries || []).find(e => this._matchesId(e, normalized)) || null;
    if (found && this._branchBlocked(found)) return null;
    return found;
  }

  async stats() {
    const db = await this._load();
    let entries = db.entries || [];
    entries = this._branchVisibleEntries(entries);
    let cashIn = 0, cashOut = 0;
    entries.forEach(e => {
      const type = String(e.type || '').toLowerCase();
      if (type === 'in') cashIn++;
      else if (type === 'out') cashOut++;
    });
    return { count: entries.length, cashIn, cashOut };
  }

  async create(data) {
    const branchError = this._applyBranchToCreate(data);
    if (branchError) return { error: branchError };
    const errors = this._validateRequired(data, true);
    if (errors.length) return { error: errors.join('; ') };

    const db = await this._loadRaw();
    const entry = {
      id: data.id !== undefined && data.id !== null ? data.id : uuidv4(),
      ...data,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const normalized = this._normalizeId(entry.id);
    if ((db.entries || []).some(e => this._normalizeId(e.id) === normalized)) {
      return { error: 'Duplicate treasury entry ID: ' + entry.id };
    }

    // Client-supplied tenantId cannot override the server context: when a
    // tenant is carried, a claimed tenantId must match it (mirrors the entity
    // API rule used by Sales/Purchases isolation). Foreign claims are rejected
    // before any persistence.
    if (entry.tenantId !== undefined && entry.tenantId !== null && entry.tenantId !== '' && repository.hasTenant()) {
      const current = repository.getCurrentTenant();
      const currentId = current && (current.tenantId != null ? current.tenantId : current.id);
      if (currentId != null && String(entry.tenantId) !== String(currentId)) {
        return { error: 'Invalid tenant claim' };
      }
    }

    if (!Array.isArray(db.entries)) db.entries = [];
    db.entries.push(entry);
    if (await this._save(db)) return { entry };
    return { error: 'Failed to persist treasury entry' };
  }

  async update(id, data) {
    const db = await this._loadRaw();
    const normalized = this._normalizeId(id);
    const idx = (db.entries || []).findIndex(e => this._matchesId(e, normalized));
    if (idx === -1) return { error: 'Treasury entry not found' };
    if (this._ownershipBlocked(db.entries[idx])) return { error: 'Treasury entry not found' };
    if (this._branchBlocked(db.entries[idx])) return { error: 'Treasury entry not found' };

    const errors = this._validateRequired(data, false);
    if (errors.length) return { error: errors.join('; ') };

    db.entries[idx] = { ...db.entries[idx], ...data, id: db.entries[idx].id, updatedAt: new Date().toISOString() };
    if (await this._save(db)) return { entry: db.entries[idx] };
    return { error: 'Failed to persist update' };
  }

  async delete(id) {
    const db = await this._loadRaw();
    const normalized = this._normalizeId(id);
    const idx = (db.entries || []).findIndex(e => this._matchesId(e, normalized));
    if (idx === -1) return { error: 'Treasury entry not found' };
    if (this._ownershipBlocked(db.entries[idx])) return { error: 'Treasury entry not found' };
    if (this._branchBlocked(db.entries[idx])) return { error: 'Treasury entry not found' };
    db.entries.splice(idx, 1);
    if (await this._save(db)) return { success: true };
    return { error: 'Failed to persist deletion' };
  }
}

module.exports = new TreasuryService();
