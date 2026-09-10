const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const repository = require('../repositories').suppliers;

class SuppliersService {
  async _load() {
    const db = await repository.readAsync();
    if (!db || typeof db !== 'object') return { suppliers: [] };
    if (!Array.isArray(db.suppliers)) db.suppliers = [];
    return db;
  }
  async _save(db) { return repository.writeAsync(db); }

  async _loadRaw() {
    const db = await repository._rawStoreAsync();
    if (!db || typeof db !== 'object') return { suppliers: [] };
    if (!Array.isArray(db.suppliers)) db.suppliers = [];
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
    if (forCreate && (data.name === undefined || data.name === null || String(data.name).trim() === '')) errors.push('name is required');
    if (data.name !== undefined && typeof data.name !== 'string') errors.push('name must be a string');
    if (data.phone !== undefined && typeof data.phone !== 'string') errors.push('phone must be a string');
    if (data.phone2 !== undefined && typeof data.phone2 !== 'string') errors.push('phone2 must be a string');
    if (data.email !== undefined && typeof data.email !== 'string') errors.push('email must be a string');
    if (data.address !== undefined && typeof data.address !== 'string') errors.push('address must be a string');
    if (data.balance !== undefined && typeof data.balance !== 'number') errors.push('balance must be a number');
    return errors;
  }

  _normalizeId(id) {
    return String(id).trim();
  }

  _matchesId(supplier, normalized) {
    return this._normalizeId(supplier.id) === normalized || this._normalizeId(supplier._backendId || '') === normalized;
  }

  async list(query = {}) {
    const db = await this._load();
    let suppliers = db.suppliers || [];

    if (query.search) {
      const q = String(query.search).toLowerCase();
      suppliers = suppliers.filter(s =>
        String(s.name || '').toLowerCase().includes(q) ||
        String(s.phone || '').toLowerCase().includes(q) ||
        String(s.phone2 || '').toLowerCase().includes(q) ||
        String(s.email || '').toLowerCase().includes(q) ||
        String(s.address || '').toLowerCase().includes(q)
      );
    }
    if (query.name) {
      const q = String(query.name).toLowerCase();
      suppliers = suppliers.filter(s => String(s.name || '').toLowerCase().includes(q));
    }
    if (query.phone) {
      const q = String(query.phone).replace(/\s/g, '');
      suppliers = suppliers.filter(s => String(s.phone || '').replace(/\s/g, '') === q || String(s.phone2 || '').replace(/\s/g, '') === q);
    }
    if (query.email) {
      const q = String(query.email).toLowerCase();
      suppliers = suppliers.filter(s => String(s.email || '').toLowerCase() === q);
    }
    if (query.hasBalance !== undefined && query.hasBalance !== '') {
      const want = String(query.hasBalance) === 'true';
      suppliers = suppliers.filter(s => want ? Number(s.balance || 0) !== 0 : Number(s.balance || 0) === 0);
    }

    const sortBy = query.sortBy || 'name';
    const sortOrder = query.sortOrder === 'desc' ? -1 : 1;
    suppliers.sort((a, b) => {
      let va = a[sortBy], vb = b[sortBy];
      if (sortBy === 'createdAt' || sortBy === 'updatedAt') {
        va = new Date(va || 0).getTime();
        vb = new Date(vb || 0).getTime();
      } else if (sortBy === 'balance' || sortBy === 'id') {
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
    const total = suppliers.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const paginated = suppliers.slice(start, start + limit);

    return { suppliers: paginated, total, page, limit, totalPages };
  }

  async getById(id) {
    const db = await this._load();
    const normalized = this._normalizeId(id);
    return (db.suppliers || []).find(s => this._matchesId(s, normalized)) || null;
  }

  async stats() {
    const db = await this._load();
    const suppliers = db.suppliers || [];
    let withPhone = 0, withEmail = 0, withBalance = 0;
    suppliers.forEach(s => {
      if (String(s.phone || '').trim() !== '') withPhone++;
      if (String(s.email || '').trim() !== '') withEmail++;
      if (Number(s.balance || 0) !== 0) withBalance++;
    });
    return { count: suppliers.length, withPhone, withEmail, withBalance };
  }

  async create(data) {
    const errors = this._validateRequired(data, true);
    if (errors.length) return { error: errors.join('; ') };

    const db = await this._loadRaw();
    const supplier = {
      id: data.id !== undefined && data.id !== null ? data.id : uuidv4(),
      ...data,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const normalized = this._normalizeId(supplier.id);
    if ((db.suppliers || []).some(s => this._normalizeId(s.id) === normalized)) {
      return { error: 'Duplicate supplier ID: ' + supplier.id };
    }

    if (supplier.tenantId !== undefined && supplier.tenantId !== null && supplier.tenantId !== '' && repository.hasTenant()) {
      const current = repository.getCurrentTenant();
      const currentId = current && (current.tenantId != null ? current.tenantId : current.id);
      if (currentId != null && String(supplier.tenantId) !== String(currentId)) {
        return { error: 'Invalid tenant claim' };
      }
    }

    if (!Array.isArray(db.suppliers)) db.suppliers = [];
    db.suppliers.push(supplier);
    if (await this._save(db)) return { supplier };
    return { error: 'Failed to persist supplier' };
  }

  async update(id, data) {
    const db = await this._loadRaw();
    const normalized = this._normalizeId(id);
    const idx = (db.suppliers || []).findIndex(s => this._matchesId(s, normalized));
    if (idx === -1) return { error: 'Supplier not found' };
    if (this._ownershipBlocked(db.suppliers[idx])) return { error: 'Supplier not found' };

    const errors = this._validateRequired(data, false);
    if (errors.length) return { error: errors.join('; ') };

    db.suppliers[idx] = { ...db.suppliers[idx], ...data, id: db.suppliers[idx].id, updatedAt: new Date().toISOString() };
    if (await this._save(db)) return { supplier: db.suppliers[idx] };
    return { error: 'Failed to persist update' };
  }

  async delete(id) {
    const db = await this._loadRaw();
    const normalized = this._normalizeId(id);
    const idx = (db.suppliers || []).findIndex(s => this._matchesId(s, normalized));
    if (idx === -1) return { error: 'Supplier not found' };
    if (this._ownershipBlocked(db.suppliers[idx])) return { error: 'Supplier not found' };
    db.suppliers.splice(idx, 1);
    if (await this._save(db)) return { success: true };
    return { error: 'Failed to persist deletion' };
  }
}

module.exports = new SuppliersService();
