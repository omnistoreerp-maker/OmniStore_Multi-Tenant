const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const repository = require('../repositories').vouchers;

class VoucherService {
  async _load() {
    const db = await repository.readAsync();
    if (!db || typeof db !== 'object') return { vouchers: [] };
    if (!Array.isArray(db.vouchers)) db.vouchers = [];
    return db;
  }
  async _save(db) { return repository.writeAsync(db); }

  async _loadRaw() {
    const db = await repository._rawStoreAsync();
    if (!db || typeof db !== 'object') return { vouchers: [] };
    if (!Array.isArray(db.vouchers)) db.vouchers = [];
    return db;
  }

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

  async list(query = {}) {
    const db = await this._load();
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

  async getById(id) {
    const db = await this._load();
    const normalized = this._normalizeId(id);
    return (db.vouchers || []).find(v => this._matchesId(v, normalized)) || null;
  }

  async stats() {
    const db = await this._load();
    const vouchers = db.vouchers || [];
    const types = {};
    vouchers.forEach(v => {
      const t = String(v.type || '').toLowerCase();
      if (t) types[t] = (types[t] || 0) + 1;
    });
    return { count: vouchers.length, types };
  }

  async create(data) {
    const errors = this._validateRequired(data, true);
    if (errors.length) return { error: errors.join('; ') };

    const db = await this._loadRaw();
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

    if (voucher.tenantId !== undefined && voucher.tenantId !== null && voucher.tenantId !== '' && repository.hasTenant()) {
      const current = repository.getCurrentTenant();
      const currentId = current && (current.tenantId != null ? current.tenantId : current.id);
      if (currentId != null && String(voucher.tenantId) !== String(currentId)) {
        return { error: 'Invalid tenant claim' };
      }
    }

    if (!Array.isArray(db.vouchers)) db.vouchers = [];
    db.vouchers.push(voucher);
    if (await this._save(db)) return { voucher };
    return { error: 'Failed to persist voucher' };
  }

  async update(id, data) {
    const db = await this._loadRaw();
    const normalized = this._normalizeId(id);
    const idx = (db.vouchers || []).findIndex(v => this._matchesId(v, normalized));
    if (idx === -1) return { error: 'Voucher not found' };
    if (this._ownershipBlocked(db.vouchers[idx])) return { error: 'Voucher not found' };

    const errors = this._validateRequired(data, false);
    if (errors.length) return { error: errors.join('; ') };

    db.vouchers[idx] = { ...db.vouchers[idx], ...data, id: db.vouchers[idx].id, updatedAt: new Date().toISOString() };
    if (await this._save(db)) return { voucher: db.vouchers[idx] };
    return { error: 'Failed to persist update' };
  }

  async delete(id) {
    const db = await this._loadRaw();
    const normalized = this._normalizeId(id);
    const idx = (db.vouchers || []).findIndex(v => this._matchesId(v, normalized));
    if (idx === -1) return { error: 'Voucher not found' };
    if (this._ownershipBlocked(db.vouchers[idx])) return { error: 'Voucher not found' };
    db.vouchers.splice(idx, 1);
    if (await this._save(db)) return { success: true };
    return { error: 'Failed to persist deletion' };
  }
}

module.exports = new VoucherService();
