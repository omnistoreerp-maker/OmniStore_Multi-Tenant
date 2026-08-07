const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const repository = require('../repositories').vouchers;

class VoucherService {
  _load() {
    const db = repository.read();
    if (!db || typeof db !== 'object') return { vouchers: [] };
    if (!Array.isArray(db.vouchers)) db.vouchers = [];
    return db;
  }
  _save(db) { return repository.write(db); }

  _validateRequired(data, forCreate) {
    const errors = [];
    if (forCreate && (data.type === undefined || data.type === null || String(data.type).trim() === '')) errors.push('type is required');
    if (data.type !== undefined && typeof data.type !== 'string') errors.push('type must be a string');
    if (data.partyName !== undefined && typeof data.partyName !== 'string') errors.push('partyName must be a string');
    if (data.partyType !== undefined && typeof data.partyType !== 'string') errors.push('partyType must be a string');
    if (data.method !== undefined && typeof data.method !== 'string') errors.push('method must be a string');
    if (data.date !== undefined && typeof data.date !== 'string') errors.push('date must be a string');
    if (data.user !== undefined && typeof data.user !== 'string') errors.push('user must be a string');
    if (data.amount !== undefined && typeof data.amount !== 'number') errors.push('amount must be a number');
    return errors;
  }

  _normalizeId(id) {
    return String(id).trim();
  }

  _matchesId(voucher, normalized) {
    return this._normalizeId(voucher.id) === normalized || this._normalizeId(voucher._backendId || '') === normalized;
  }

  list(query = {}) {
    const db = this._load();
    let vouchers = db.vouchers || [];

    if (query.search) {
      const q = String(query.search).toLowerCase();
      vouchers = vouchers.filter(v =>
        String(v.type || '').toLowerCase().includes(q) ||
        String(v.partyName || '').toLowerCase().includes(q) ||
        String(v.partyType || '').toLowerCase().includes(q) ||
        String(v.desc || '').toLowerCase().includes(q) ||
        String(v.user || '').toLowerCase().includes(q)
      );
    }
    if (query.type) {
      const q = String(query.type).toLowerCase();
      vouchers = vouchers.filter(v => String(v.type || '').toLowerCase() === q);
    }
    if (query.partyType) {
      const q = String(query.partyType).toLowerCase();
      vouchers = vouchers.filter(v => String(v.partyType || '').toLowerCase() === q);
    }
    if (query.method) {
      const q = String(query.method).toLowerCase();
      vouchers = vouchers.filter(v => String(v.method || '').toLowerCase() === q);
    }
    if (query.from) {
      vouchers = vouchers.filter(v => String(v.date || '') >= String(query.from));
    }
    if (query.to) {
      vouchers = vouchers.filter(v => String(v.date || '') <= String(query.to));
    }

    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    vouchers.sort((a, b) => {
      let va = a[sortBy], vb = b[sortBy];
      if (sortBy === 'createdAt' || sortBy === 'updatedAt') {
        va = new Date(va || 0).getTime();
        vb = new Date(vb || 0).getTime();
      } else if (sortBy === 'amount') {
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
    const total = vouchers.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const paginated = vouchers.slice(start, start + limit);

    return { vouchers: paginated, total, page, limit, totalPages };
  }

  getById(id) {
    const db = this._load();
    const normalized = this._normalizeId(id);
    return (db.vouchers || []).find(v => this._matchesId(v, normalized)) || null;
  }

  stats() {
    const db = this._load();
    const vouchers = db.vouchers || [];
    const types = {};
    vouchers.forEach(v => {
      const t = String(v.type || '').toLowerCase();
      if (t) types[t] = (types[t] || 0) + 1;
    });
    return { count: vouchers.length, types };
  }

  create(data) {
    const errors = this._validateRequired(data, true);
    if (errors.length) return { error: errors.join('; ') };

    const db = this._load();
    const voucher = {
      id: data.id !== undefined && data.id !== null ? data.id : uuidv4(),
      ...data,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const normalized = this._normalizeId(voucher.id);
    if ((db.vouchers || []).some(v => this._normalizeId(v.id) === normalized)) {
      return { error: 'Duplicate voucher ID: ' + voucher.id };
    }

    if (!Array.isArray(db.vouchers)) db.vouchers = [];
    db.vouchers.push(voucher);
    if (this._save(db)) return { voucher };
    return { error: 'Failed to persist voucher' };
  }

  update(id, data) {
    const db = this._load();
    const normalized = this._normalizeId(id);
    const idx = (db.vouchers || []).findIndex(v => this._matchesId(v, normalized));
    if (idx === -1) return { error: 'Voucher not found' };

    const errors = this._validateRequired(data, false);
    if (errors.length) return { error: errors.join('; ') };

    db.vouchers[idx] = { ...db.vouchers[idx], ...data, id: db.vouchers[idx].id, updatedAt: new Date().toISOString() };
    if (this._save(db)) return { voucher: db.vouchers[idx] };
    return { error: 'Failed to persist update' };
  }

  delete(id) {
    const db = this._load();
    const normalized = this._normalizeId(id);
    const idx = (db.vouchers || []).findIndex(v => this._matchesId(v, normalized));
    if (idx === -1) return { error: 'Voucher not found' };
    db.vouchers.splice(idx, 1);
    if (this._save(db)) return { success: true };
    return { error: 'Failed to persist deletion' };
  }
}

module.exports = new VoucherService();
