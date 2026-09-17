const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const repository = require('../repositories').partners;

class PartnersService {
  async _load() {
    const db = await repository.readAsync();
    if (!db || typeof db !== 'object') return { partners: [] };
    if (!Array.isArray(db.partners)) db.partners = [];
    return db;
  }
  async _save(db) { return repository.writeAsync(db); }

  async _loadRaw() {
    const db = await repository._rawStoreAsync();
    if (!db || typeof db !== 'object') return { partners: [] };
    if (!Array.isArray(db.partners)) db.partners = [];
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
    if (data.capital !== undefined && typeof data.capital !== 'number') errors.push('capital must be a number');
    if (data.initialCapital !== undefined && typeof data.initialCapital !== 'number') errors.push('initialCapital must be a number');
    if (data.percent !== undefined && typeof data.percent !== 'number') errors.push('percent must be a number');
    return errors;
  }

  _normalizeId(id) {
    return String(id).trim();
  }

  _matchesId(partner, normalized) {
    return this._normalizeId(partner.id) === normalized || this._normalizeId(partner._backendId || '') === normalized;
  }

  async list(query = {}) {
    const db = await this._load();
    let partners = db.partners || [];

    if (query.search) {
      const q = String(query.search).toLowerCase();
      partners = partners.filter(p =>
        String(p.name || '').toLowerCase().includes(q) ||
        String(p.phone || '').toLowerCase().includes(q) ||
        String(p.phone2 || '').toLowerCase().includes(q)
      );
    }
    if (query.name) {
      const q = String(query.name).toLowerCase();
      partners = partners.filter(p => String(p.name || '').toLowerCase().includes(q));
    }
    if (query.phone) {
      const q = String(query.phone).replace(/\s/g, '');
      partners = partners.filter(p => String(p.phone || '').replace(/\s/g, '') === q || String(p.phone2 || '').replace(/\s/g, '') === q);
    }
    if (query.hasCapital !== undefined && query.hasCapital !== '') {
      const want = String(query.hasCapital) === 'true';
      partners = partners.filter(p => want ? Number(p.capital || 0) !== 0 : Number(p.capital || 0) === 0);
    }

    const sortBy = query.sortBy || 'name';
    const sortOrder = query.sortOrder === 'desc' ? -1 : 1;
    partners.sort((a, b) => {
      let va = a[sortBy], vb = b[sortBy];
      if (sortBy === 'createdAt' || sortBy === 'updatedAt') {
        va = new Date(va || 0).getTime();
        vb = new Date(vb || 0).getTime();
      } else if (sortBy === 'capital' || sortBy === 'initialCapital' || sortBy === 'percent' || sortBy === 'id') {
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
    const total = partners.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const paginated = partners.slice(start, start + limit);

    return { partners: paginated, total, page, limit, totalPages };
  }

  async getById(id) {
    const db = await this._load();
    const normalized = this._normalizeId(id);
    return (db.partners || []).find(p => this._matchesId(p, normalized)) || null;
  }

  async stats() {
    const db = await this._load();
    const partners = db.partners || [];
    let withPhone = 0, withCapital = 0;
    partners.forEach(p => {
      if (String(p.phone || '').trim() !== '') withPhone++;
      if (Number(p.capital || 0) !== 0) withCapital++;
    });
    return { count: partners.length, withPhone, withCapital };
  }

  async create(data) {
    const errors = this._validateRequired(data, true);
    if (errors.length) return { error: errors.join('; ') };

    const db = await this._loadRaw();
    const partner = {
      id: data.id !== undefined && data.id !== null ? data.id : uuidv4(),
      ...data,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const normalized = this._normalizeId(partner.id);
    if ((db.partners || []).some(p => this._normalizeId(p.id) === normalized)) {
      return { error: 'Duplicate partner ID: ' + partner.id };
    }

    if (partner.tenantId !== undefined && partner.tenantId !== null && partner.tenantId !== '' && repository.hasTenant()) {
      const current = repository.getCurrentTenant();
      const currentId = current && (current.tenantId != null ? current.tenantId : current.id);
      if (currentId != null && String(partner.tenantId) !== String(currentId)) {
        return { error: 'Invalid tenant claim' };
      }
    }

    if (!Array.isArray(db.partners)) db.partners = [];
    db.partners.push(partner);
    if (await this._save(db)) return { partner };
    return { error: 'Failed to persist partner' };
  }

  async update(id, data) {
    const db = await this._loadRaw();
    const normalized = this._normalizeId(id);
    const idx = (db.partners || []).findIndex(p => this._matchesId(p, normalized));
    if (idx === -1) return { error: 'Partner not found' };
    if (this._ownershipBlocked(db.partners[idx])) return { error: 'Partner not found' };

    const errors = this._validateRequired(data, false);
    if (errors.length) return { error: errors.join('; ') };

    db.partners[idx] = { ...db.partners[idx], ...data, id: db.partners[idx].id, updatedAt: new Date().toISOString() };
    if (await this._save(db)) return { partner: db.partners[idx] };
    return { error: 'Failed to persist update' };
  }

  async delete(id) {
    const db = await this._loadRaw();
    const normalized = this._normalizeId(id);
    const idx = (db.partners || []).findIndex(p => this._matchesId(p, normalized));
    if (idx === -1) return { error: 'Partner not found' };
    if (this._ownershipBlocked(db.partners[idx])) return { error: 'Partner not found' };
    db.partners.splice(idx, 1);
    if (await this._save(db)) return { success: true };
    return { error: 'Failed to persist deletion' };
  }
}

module.exports = new PartnersService();
