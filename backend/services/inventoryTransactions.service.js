const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const repository = require('../repositories').inventoryTransactions;

class InventoryTransactionsService {
  // Tenant-FILTERED read view (list/get/stats). With ENABLE_TENANT_FILTERING
  // on, the repository hides other tenants' records here.
  async _load() {
    const db = await repository.readAsync();
    if (!db || typeof db !== 'object') return { transactions: [] };
    if (!Array.isArray(db.transactions)) db.transactions = [];
    return db;
  }
  async _save(db) { return repository.writeAsync(db); }

  // FULL, unfiltered store document for WRITES (BaseRepository._rawStore
  // rule): a write must never persist a tenant-filtered snapshot that could
  // drop other tenants' records. Ownership is gated explicitly below.
  async _loadRaw() {
    const db = await repository._rawStoreAsync();
    if (!db || typeof db !== 'object') return { transactions: [] };
    if (!Array.isArray(db.transactions)) db.transactions = [];
    return db;
  }

  // Cross-tenant write guard (same rule as Customers): a record claiming a
  // DIFFERENT tenantId is never modified/deleted by this request — treated
  // as not-found (404). Legacy records (no tenantId) stay writable.
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
    if (forCreate && (data.productId === undefined || data.productId === null || String(data.productId).trim() === '')) errors.push('productId is required');
    if (forCreate && (data.type === undefined || String(data.type).trim() === '')) errors.push('type is required');
    if (data.type !== undefined && typeof data.type !== 'string') errors.push('type must be a string');
    if (data.qty !== undefined && typeof data.qty !== 'number') errors.push('qty must be a number');
    if (data.stockAfter !== undefined && typeof data.stockAfter !== 'number') errors.push('stockAfter must be a number');
    return errors;
  }

  _normalizeId(id) {
    return String(id).trim();
  }

  _matchesId(transaction, normalized) {
    return this._normalizeId(transaction.id) === normalized || this._normalizeId(transaction._backendId || '') === normalized;
  }

  async list(query = {}) {
    const db = await this._load();
    let transactions = db.transactions || [];

    if (query.productId !== undefined && query.productId !== '') {
      transactions = transactions.filter(t => String(t.productId) === String(query.productId));
    }
    if (query.type) {
      const q = String(query.type).toLowerCase();
      transactions = transactions.filter(t => String(t.type || '').toLowerCase() === q);
    }
    if (query.user) {
      const q = String(query.user).toLowerCase();
      transactions = transactions.filter(t => (t.user || '').toLowerCase() === q);
    }
    if (query.reason) {
      const q = String(query.reason).toLowerCase();
      transactions = transactions.filter(t => (t.reason || '').toLowerCase().includes(q));
    }
    if (query.dateFrom) {
      const from = new Date(query.dateFrom).getTime();
      if (!isNaN(from)) transactions = transactions.filter(t => new Date(t.date || t.createdAt).getTime() >= from);
    }
    if (query.dateTo) {
      const to = new Date(query.dateTo).getTime();
      if (!isNaN(to)) transactions = transactions.filter(t => new Date(t.date || t.createdAt).getTime() <= to);
    }

    const sortBy = query.sortBy || 'date';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    transactions.sort((a, b) => {
      let va = a[sortBy], vb = b[sortBy];
      if (sortBy === 'date' || sortBy === 'createdAt' || sortBy === 'updatedAt') {
        va = new Date(va || 0).getTime();
        vb = new Date(vb || 0).getTime();
      } else if (sortBy === 'qty' || sortBy === 'stockAfter' || sortBy === 'id') {
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
    const total = transactions.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const paginated = transactions.slice(start, start + limit);

    return { transactions: paginated, total, page, limit, totalPages };
  }

  async getById(id) {
    const db = await this._load();
    const normalized = this._normalizeId(id);
    return (db.transactions || []).find(t => this._matchesId(t, normalized)) || null;
  }

  async stats() {
    const db = await this._load();
    const transactions = db.transactions || [];
    let stockIn = 0, stockOut = 0, adjustments = 0;
    transactions.forEach(t => {
      const type = String(t.type || '').toLowerCase();
      if (type === 'in') stockIn++;
      else if (type === 'out') stockOut++;
      else if (type === 'adjustment') adjustments++;
    });
    return { count: transactions.length, stockIn, stockOut, adjustments };
  }

  async create(data) {
    const errors = this._validateRequired(data, true);
    if (errors.length) return { error: errors.join('; ') };

    const db = await this._loadRaw();
    const transaction = {
      id: data.id !== undefined && data.id !== null ? data.id : uuidv4(),
      ...data,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const normalized = this._normalizeId(transaction.id);
    if ((db.transactions || []).some(t => this._normalizeId(t.id) === normalized)) {
      return { error: 'Duplicate transaction ID: ' + transaction.id };
    }

    // Client-supplied tenantId cannot override the server context: when a
    // tenant is carried, a claimed tenantId must match it. Foreign claims are
    // rejected before any persistence (same rule as Treasury).
    if (transaction.tenantId !== undefined && transaction.tenantId !== null && transaction.tenantId !== '' && repository.hasTenant()) {
      const current = repository.getCurrentTenant();
      const currentId = current && (current.tenantId != null ? current.tenantId : current.id);
      if (currentId != null && String(transaction.tenantId) !== String(currentId)) {
        return { error: 'Invalid tenant claim' };
      }
    }

    // Auto-stamp tenantId from server context when client omits it.
    // Prevents cross-tenant read leaks (transactions without a tenantId
    // appear in ALL tenants' filtered views).
    if (repository.hasTenant() && (transaction.tenantId === undefined || transaction.tenantId === null || transaction.tenantId === '')) {
      const current = repository.getCurrentTenant();
      const currentId = current && (current.tenantId != null ? current.tenantId : current.id);
      if (currentId != null) {
        transaction.tenantId = String(currentId);
      }
    }

    if (!Array.isArray(db.transactions)) db.transactions = [];
    db.transactions.push(transaction);
    if (await this._save(db)) return { transaction };
    return { error: 'Failed to persist transaction' };
  }

  async update(id, data) {
    const db = await this._loadRaw();
    const normalized = this._normalizeId(id);
    const idx = (db.transactions || []).findIndex(t => this._matchesId(t, normalized));
    if (idx === -1) return { error: 'Transaction not found' };
    if (this._ownershipBlocked(db.transactions[idx])) return { error: 'Transaction not found' };

    const errors = this._validateRequired(data, false);
    if (errors.length) return { error: errors.join('; ') };

    db.transactions[idx] = { ...db.transactions[idx], ...data, id: db.transactions[idx].id, updatedAt: new Date().toISOString() };
    if (await this._save(db)) return { transaction: db.transactions[idx] };
    return { error: 'Failed to persist update' };
  }

  async delete(id) {
    const db = await this._loadRaw();
    const normalized = this._normalizeId(id);
    const idx = (db.transactions || []).findIndex(t => this._matchesId(t, normalized));
    if (idx === -1) return { error: 'Transaction not found' };
    if (this._ownershipBlocked(db.transactions[idx])) return { error: 'Transaction not found' };
    db.transactions.splice(idx, 1);
    if (await this._save(db)) return { success: true };
    return { error: 'Failed to persist deletion' };
  }
}

module.exports = new InventoryTransactionsService();
