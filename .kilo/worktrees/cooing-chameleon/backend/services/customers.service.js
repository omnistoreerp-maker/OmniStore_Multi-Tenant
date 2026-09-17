const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const repository = require('../repositories').customers;

class CustomersService {
  // Tenant-FILTERED read view (list/get/stats/search). When
  // ENABLE_TENANT_FILTERING is on, the repository hides other tenants'
  // records here — reads stay scoped to the current tenant.
  async _load() {
    const db = await repository.readAsync();
    if (!db || typeof db !== 'object') return { customers: [] };
    if (!Array.isArray(db.customers)) db.customers = [];
    return db;
  }
  async _save(db) { return repository.writeAsync(db); }

  // FULL, unfiltered store document for WRITES. Persisting must never be
  // derived from the tenant-filtered view (BaseRepository._rawStore rule):
  // otherwise one tenant's create/update/delete would write back only its
  // own records and silently DROP every other tenant's records from the
  // shared document. Ownership is gated explicitly below.
  async _loadRaw() {
    const db = await repository._rawStoreAsync();
    if (!db || typeof db !== 'object') return { customers: [] };
    if (!Array.isArray(db.customers)) db.customers = [];
    return db;
  }

  // Cross-tenant write guard. When a tenant context is active, a record
  // that claims a DIFFERENT tenantId must never be modified or deleted by
  // this request — it is treated as not-found (404), never touched. Legacy
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
    if (forCreate && (data.name === undefined || data.name === null || String(data.name).trim() === '')) errors.push('name is required');
    if (data.name !== undefined && typeof data.name !== 'string') errors.push('name must be a string');
    if (data.phone !== undefined && typeof data.phone !== 'string') errors.push('phone must be a string');
    if (data.phone2 !== undefined && typeof data.phone2 !== 'string') errors.push('phone2 must be a string');
    if (data.address !== undefined && typeof data.address !== 'string') errors.push('address must be a string');
    if (data.notes !== undefined && typeof data.notes !== 'string') errors.push('notes must be a string');
    if (data.balance !== undefined && typeof data.balance !== 'number') errors.push('balance must be a number');
    if (data.points !== undefined && typeof data.points !== 'number') errors.push('points must be a number');
    return errors;
  }

  _normalizeId(id) {
    return String(id).trim();
  }

  _matchesId(customer, normalized) {
    return this._normalizeId(customer.id) === normalized || this._normalizeId(customer._backendId || '') === normalized;
  }

  async list(query = {}) {
    const db = await this._load();
    let customers = db.customers || [];

    if (query.search) {
      const q = String(query.search).toLowerCase();
      customers = customers.filter(c =>
        String(c.name || '').toLowerCase().includes(q) ||
        String(c.phone || '').toLowerCase().includes(q) ||
        String(c.phone2 || '').toLowerCase().includes(q) ||
        String(c.address || '').toLowerCase().includes(q)
      );
    }
    if (query.name) {
      const q = String(query.name).toLowerCase();
      customers = customers.filter(c => String(c.name || '').toLowerCase().includes(q));
    }
    if (query.phone) {
      const q = String(query.phone).replace(/\s/g, '');
      customers = customers.filter(c => String(c.phone || '').replace(/\s/g, '') === q || String(c.phone2 || '').replace(/\s/g, '') === q);
    }
    if (query.hasBalance !== undefined && query.hasBalance !== '') {
      const want = String(query.hasBalance) === 'true';
      customers = customers.filter(c => want ? Number(c.balance || 0) !== 0 : Number(c.balance || 0) === 0);
    }

    const sortBy = query.sortBy || 'name';
    const sortOrder = query.sortOrder === 'desc' ? -1 : 1;
    customers.sort((a, b) => {
      let va = a[sortBy], vb = b[sortBy];
      if (sortBy === 'createdAt' || sortBy === 'updatedAt' || sortBy === 'registrationDate') {
        va = new Date(va || 0).getTime();
        vb = new Date(vb || 0).getTime();
      } else if (sortBy === 'balance' || sortBy === 'points' || sortBy === 'id') {
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
    const total = customers.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const paginated = customers.slice(start, start + limit);

    return { customers: paginated, total, page, limit, totalPages };
  }

  async getById(id) {
    const db = await this._load();
    const normalized = this._normalizeId(id);
    return (db.customers || []).find(c => this._matchesId(c, normalized)) || null;
  }

  async stats() {
    const db = await this._load();
    const customers = db.customers || [];
    let withPhone = 0, withBalance = 0;
    customers.forEach(c => {
      if (String(c.phone || '').trim() !== '') withPhone++;
      if (Number(c.balance || 0) !== 0) withBalance++;
    });
    return { count: customers.length, withPhone, withBalance };
  }

  async create(data) {
    const errors = this._validateRequired(data, true);
    if (errors.length) return { error: errors.join('; ') };

    const db = await this._loadRaw();
    const customer = {
      id: data.id !== undefined && data.id !== null ? data.id : uuidv4(),
      ...data,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const normalized = this._normalizeId(customer.id);
    if ((db.customers || []).some(c => this._normalizeId(c.id) === normalized)) {
      return { error: 'Duplicate customer ID: ' + customer.id };
    }

    // Client-supplied tenantId cannot override the server context: when a
    // tenant is carried, a claimed tenantId must match it. Foreign claims are
    // rejected before any persistence (same rule as Treasury).
    if (customer.tenantId !== undefined && customer.tenantId !== null && customer.tenantId !== '' && repository.hasTenant()) {
      const current = repository.getCurrentTenant();
      const currentId = current && (current.tenantId != null ? current.tenantId : current.id);
      if (currentId != null && String(customer.tenantId) !== String(currentId)) {
        return { error: 'Invalid tenant claim' };
      }
    }

    if (!Array.isArray(db.customers)) db.customers = [];
    db.customers.push(customer);
    if (await this._save(db)) return { customer };
    return { error: 'Failed to persist customer' };
  }

  async update(id, data) {
    const db = await this._loadRaw();
    const normalized = this._normalizeId(id);
    const idx = (db.customers || []).findIndex(c => this._matchesId(c, normalized));
    if (idx === -1) return { error: 'Customer not found' };
    if (this._ownershipBlocked(db.customers[idx])) return { error: 'Customer not found' };

    const errors = this._validateRequired(data, false);
    if (errors.length) return { error: errors.join('; ') };

    db.customers[idx] = { ...db.customers[idx], ...data, id: db.customers[idx].id, updatedAt: new Date().toISOString() };
    if (await this._save(db)) return { customer: db.customers[idx] };
    return { error: 'Failed to persist update' };
  }

  async delete(id) {
    const db = await this._loadRaw();
    const normalized = this._normalizeId(id);
    const idx = (db.customers || []).findIndex(c => this._matchesId(c, normalized));
    if (idx === -1) return { error: 'Customer not found' };
    if (this._ownershipBlocked(db.customers[idx])) return { error: 'Customer not found' };
    db.customers.splice(idx, 1);
    if (await this._save(db)) return { success: true };
    return { error: 'Failed to persist deletion' };
  }
}

module.exports = new CustomersService();
