const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const repository = require('../repositories').dashboard;

class DashboardService {
  _load() {
    const db = repository.read();
    if (!db || typeof db !== 'object') return { dashboard: [] };
    if (!Array.isArray(db.dashboard)) db.dashboard = [];
    return db;
  }
  _save(db) { return repository.write(db); }

  // FULL, unfiltered store document for WRITES. Persisting must never be
  // derived from the tenant-filtered view (BaseRepository._rawStore rule):
  // otherwise one tenant's create/update/delete would write back only its
  // own records and silently DROP every other tenant's records from the
  // shared document. Ownership is gated explicitly in the write methods.
  _loadRaw() {
    const db = repository._rawStore();
    if (!db || typeof db !== 'object') return { dashboard: [] };
    if (!Array.isArray(db.dashboard)) db.dashboard = [];
    return db;
  }

  // Cross-tenant write guard. When a tenant context is active, a record
  // that claims a DIFFERENT tenantId must never be modified or deleted by
  // this request — it is treated as not-found, never touched. Legacy
  // records (no tenantId) remain writable, matching the Phase 13 read rule.
  _ownershipBlocked(record) {
    if (!repository.hasTenant()) return false;
    if (!record || typeof record !== 'object') return true;
    const tid = record.tenantId;
    if (tid === undefined || tid === null || tid === '') return false;
    const current = repository.getCurrentTenant();
    const currentId = current && (current.tenantId != null ? current.tenantId : current.id);
    return currentId == null || String(tid) !== String(currentId);
  }

  _validateRequired(data, forCreate) {
    const errors = [];
    if (forCreate && (data.key === undefined || data.key === null || String(data.key).trim() === '')) errors.push('key is required');
    if (data.key !== undefined && typeof data.key !== 'string') errors.push('key must be a string');
    if (data.title !== undefined && typeof data.title !== 'string') errors.push('title must be a string');
    if (data.period !== undefined && typeof data.period !== 'string') errors.push('period must be a string');
    if (data.user !== undefined && typeof data.user !== 'string') errors.push('user must be a string');
    return errors;
  }

  _normalizeId(id) {
    return String(id).trim();
  }

  _matchesId(entry, normalized) {
    return this._normalizeId(entry.id) === normalized || this._normalizeId(entry._backendId || '') === normalized;
  }

  list(query = {}) {
    const db = this._load();
    let entries = db.dashboard || [];

    if (query.search) {
      const q = String(query.search).toLowerCase();
      entries = entries.filter(r =>
        String(r.key || '').toLowerCase().includes(q) ||
        String(r.title || '').toLowerCase().includes(q) ||
        String(r.period || '').toLowerCase().includes(q) ||
        String(r.user || '').toLowerCase().includes(q)
      );
    }
    if (query.key) {
      const q = String(query.key).toLowerCase();
      entries = entries.filter(r => String(r.key || '').toLowerCase() === q);
    }
    if (query.period) {
      const q = String(query.period).toLowerCase();
      entries = entries.filter(r => String(r.period || '').toLowerCase() === q);
    }
    if (query.user) {
      const q = String(query.user).toLowerCase();
      entries = entries.filter(r => String(r.user || '').toLowerCase() === q);
    }

    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    entries.sort((a, b) => {
      let va = a[sortBy], vb = b[sortBy];
      if (sortBy === 'createdAt' || sortBy === 'updatedAt') {
        va = new Date(va || 0).getTime();
        vb = new Date(vb || 0).getTime();
      } else if (sortBy === 'id') {
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

    return { dashboard: paginated, total, page, limit, totalPages };
  }

  getById(id) {
    const db = this._load();
    const normalized = this._normalizeId(id);
    return (db.dashboard || []).find(r => this._matchesId(r, normalized)) || null;
  }

  stats() {
    const db = this._load();
    const entries = db.dashboard || [];
    let withData = 0;
    const keys = {};
    entries.forEach(r => {
      if (r.data !== undefined && r.data !== null) withData++;
      const k = String(r.key || '').toLowerCase();
      if (k) keys[k] = (keys[k] || 0) + 1;
    });
    return { count: entries.length, withData, keys };
  }

  create(data) {
    const errors = this._validateRequired(data, true);
    if (errors.length) return { error: errors.join('; ') };

    const db = this._loadRaw();
    const entry = {
      id: data.id !== undefined && data.id !== null ? data.id : uuidv4(),
      ...data,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const normalized = this._normalizeId(entry.id);
    if ((db.dashboard || []).some(r => this._normalizeId(r.id) === normalized)) {
      return { error: 'Duplicate dashboard entry ID: ' + entry.id };
    }

    // Client-supplied tenantId cannot override the server context: when a
    // tenant is carried, a claimed tenantId must match it. Foreign claims
    // are rejected before any persistence.
    if (entry.tenantId !== undefined && entry.tenantId !== null && entry.tenantId !== '' && repository.hasTenant()) {
      const current = repository.getCurrentTenant();
      const currentId = current && (current.tenantId != null ? current.tenantId : current.id);
      if (currentId != null && String(entry.tenantId) !== String(currentId)) {
        return { error: 'Invalid tenant claim' };
      }
    }

    if (!Array.isArray(db.dashboard)) db.dashboard = [];
    db.dashboard.push(entry);
    if (this._save(db)) return { entry };
    return { error: 'Failed to persist dashboard entry' };
  }

  update(id, data) {
    const db = this._loadRaw();
    const normalized = this._normalizeId(id);
    const idx = (db.dashboard || []).findIndex(r => this._matchesId(r, normalized));
    if (idx === -1) return { error: 'Dashboard entry not found' };
    if (this._ownershipBlocked(db.dashboard[idx])) return { error: 'Dashboard entry not found' };

    const errors = this._validateRequired(data, false);
    if (errors.length) return { error: errors.join('; ') };

    db.dashboard[idx] = { ...db.dashboard[idx], ...data, id: db.dashboard[idx].id, updatedAt: new Date().toISOString() };
    if (this._save(db)) return { entry: db.dashboard[idx] };
    return { error: 'Failed to persist update' };
  }

  delete(id) {
    const db = this._loadRaw();
    const normalized = this._normalizeId(id);
    const idx = (db.dashboard || []).findIndex(r => this._matchesId(r, normalized));
    if (idx === -1) return { error: 'Dashboard entry not found' };
    if (this._ownershipBlocked(db.dashboard[idx])) return { error: 'Dashboard entry not found' };
    db.dashboard.splice(idx, 1);
    if (this._save(db)) return { success: true };
    return { error: 'Failed to persist deletion' };
  }
}

module.exports = new DashboardService();
