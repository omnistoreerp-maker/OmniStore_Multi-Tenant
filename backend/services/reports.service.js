const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const repository = require('../repositories').reports;

class ReportsService {
  _load() {
    const db = repository.read();
    if (!db || typeof db !== 'object') return { reports: [] };
    if (!Array.isArray(db.reports)) db.reports = [];
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
    if (!db || typeof db !== 'object') return { reports: [] };
    if (!Array.isArray(db.reports)) db.reports = [];
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
    if (forCreate && (data.type === undefined || data.type === null || String(data.type).trim() === '')) errors.push('type is required');
    if (data.type !== undefined && typeof data.type !== 'string') errors.push('type must be a string');
    if (data.title !== undefined && typeof data.title !== 'string') errors.push('title must be a string');
    if (data.month !== undefined && typeof data.month !== 'string') errors.push('month must be a string');
    if (data.user !== undefined && typeof data.user !== 'string') errors.push('user must be a string');
    return errors;
  }

  _normalizeId(id) {
    return String(id).trim();
  }

  _matchesId(report, normalized) {
    return this._normalizeId(report.id) === normalized || this._normalizeId(report._backendId || '') === normalized;
  }

  list(query = {}) {
    const db = this._load();
    let reports = db.reports || [];

    if (query.search) {
      const q = String(query.search).toLowerCase();
      reports = reports.filter(r =>
        String(r.type || '').toLowerCase().includes(q) ||
        String(r.title || '').toLowerCase().includes(q) ||
        String(r.month || '').toLowerCase().includes(q) ||
        String(r.user || '').toLowerCase().includes(q)
      );
    }
    if (query.type) {
      const q = String(query.type).toLowerCase();
      reports = reports.filter(r => String(r.type || '').toLowerCase() === q);
    }
    if (query.month) {
      const q = String(query.month).toLowerCase();
      reports = reports.filter(r => String(r.month || '').toLowerCase() === q);
    }
    if (query.user) {
      const q = String(query.user).toLowerCase();
      reports = reports.filter(r => String(r.user || '').toLowerCase() === q);
    }

    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    reports.sort((a, b) => {
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
    const total = reports.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const paginated = reports.slice(start, start + limit);

    return { reports: paginated, total, page, limit, totalPages };
  }

  getById(id) {
    const db = this._load();
    const normalized = this._normalizeId(id);
    return (db.reports || []).find(r => this._matchesId(r, normalized)) || null;
  }

  stats() {
    const db = this._load();
    const reports = db.reports || [];
    let withData = 0;
    const types = {};
    reports.forEach(r => {
      if (r.data !== undefined && r.data !== null) withData++;
      const t = String(r.type || '').toLowerCase();
      if (t) types[t] = (types[t] || 0) + 1;
    });
    return { count: reports.length, withData, types };
  }

  create(data) {
    const errors = this._validateRequired(data, true);
    if (errors.length) return { error: errors.join('; ') };

    const db = this._loadRaw();
    const report = {
      id: data.id !== undefined && data.id !== null ? data.id : uuidv4(),
      ...data,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const normalized = this._normalizeId(report.id);
    if ((db.reports || []).some(r => this._normalizeId(r.id) === normalized)) {
      return { error: 'Duplicate report ID: ' + report.id };
    }

    // Client-supplied tenantId cannot override the server context: when a
    // tenant is carried, a claimed tenantId must match it. Foreign claims
    // are rejected before any persistence.
    if (report.tenantId !== undefined && report.tenantId !== null && report.tenantId !== '' && repository.hasTenant()) {
      const current = repository.getCurrentTenant();
      const currentId = current && (current.tenantId != null ? current.tenantId : current.id);
      if (currentId != null && String(report.tenantId) !== String(currentId)) {
        return { error: 'Invalid tenant claim' };
      }
    }

    if (!Array.isArray(db.reports)) db.reports = [];
    db.reports.push(report);
    if (this._save(db)) return { report };
    return { error: 'Failed to persist report' };
  }

  update(id, data) {
    const db = this._loadRaw();
    const normalized = this._normalizeId(id);
    const idx = (db.reports || []).findIndex(r => this._matchesId(r, normalized));
    if (idx === -1) return { error: 'Report not found' };
    if (this._ownershipBlocked(db.reports[idx])) return { error: 'Report not found' };

    const errors = this._validateRequired(data, false);
    if (errors.length) return { error: errors.join('; ') };

    db.reports[idx] = { ...db.reports[idx], ...data, id: db.reports[idx].id, updatedAt: new Date().toISOString() };
    if (this._save(db)) return { report: db.reports[idx] };
    return { error: 'Failed to persist update' };
  }

  delete(id) {
    const db = this._loadRaw();
    const normalized = this._normalizeId(id);
    const idx = (db.reports || []).findIndex(r => this._matchesId(r, normalized));
    if (idx === -1) return { error: 'Report not found' };
    if (this._ownershipBlocked(db.reports[idx])) return { error: 'Report not found' };
    db.reports.splice(idx, 1);
    if (this._save(db)) return { success: true };
    return { error: 'Failed to persist deletion' };
  }
}

module.exports = new ReportsService();
