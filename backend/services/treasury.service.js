const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const repository = require('../repositories').treasury;

class TreasuryService {
  _load() {
    const db = repository.read();
    if (!db || typeof db !== 'object') return { entries: [] };
    if (!Array.isArray(db.entries)) db.entries = [];
    return db;
  }
  _save(db) { return repository.write(db); }

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

  list(query = {}) {
    const db = this._load();
    let entries = db.entries || [];

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

  getById(id) {
    const db = this._load();
    const normalized = this._normalizeId(id);
    return (db.entries || []).find(e => this._matchesId(e, normalized)) || null;
  }

  stats() {
    const db = this._load();
    const entries = db.entries || [];
    let cashIn = 0, cashOut = 0;
    entries.forEach(e => {
      const type = String(e.type || '').toLowerCase();
      if (type === 'in') cashIn++;
      else if (type === 'out') cashOut++;
    });
    return { count: entries.length, cashIn, cashOut };
  }

  create(data) {
    const errors = this._validateRequired(data, true);
    if (errors.length) return { error: errors.join('; ') };

    const db = this._load();
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

    if (!Array.isArray(db.entries)) db.entries = [];
    db.entries.push(entry);
    if (this._save(db)) return { entry };
    return { error: 'Failed to persist treasury entry' };
  }

  update(id, data) {
    const db = this._load();
    const normalized = this._normalizeId(id);
    const idx = (db.entries || []).findIndex(e => this._matchesId(e, normalized));
    if (idx === -1) return { error: 'Treasury entry not found' };

    const errors = this._validateRequired(data, false);
    if (errors.length) return { error: errors.join('; ') };

    db.entries[idx] = { ...db.entries[idx], ...data, id: db.entries[idx].id, updatedAt: new Date().toISOString() };
    if (this._save(db)) return { entry: db.entries[idx] };
    return { error: 'Failed to persist update' };
  }

  delete(id) {
    const db = this._load();
    const normalized = this._normalizeId(id);
    const idx = (db.entries || []).findIndex(e => this._matchesId(e, normalized));
    if (idx === -1) return { error: 'Treasury entry not found' };
    db.entries.splice(idx, 1);
    if (this._save(db)) return { success: true };
    return { error: 'Failed to persist deletion' };
  }
}

module.exports = new TreasuryService();
