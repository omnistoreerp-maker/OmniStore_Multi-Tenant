const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const repository = require('../repositories').inventoryTransactions;

class InventoryTransactionsService {
  _load() {
    const db = repository.read();
    if (!db || typeof db !== 'object') return { transactions: [] };
    if (!Array.isArray(db.transactions)) db.transactions = [];
    return db;
  }
  _save(db) { return repository.write(db); }

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

  list(query = {}) {
    const db = this._load();
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

  getById(id) {
    const db = this._load();
    const normalized = this._normalizeId(id);
    return (db.transactions || []).find(t => this._matchesId(t, normalized)) || null;
  }

  stats() {
    const db = this._load();
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

  create(data) {
    const errors = this._validateRequired(data, true);
    if (errors.length) return { error: errors.join('; ') };

    const db = this._load();
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

    if (!Array.isArray(db.transactions)) db.transactions = [];
    db.transactions.push(transaction);
    if (this._save(db)) return { transaction };
    return { error: 'Failed to persist transaction' };
  }

  update(id, data) {
    const db = this._load();
    const normalized = this._normalizeId(id);
    const idx = (db.transactions || []).findIndex(t => this._matchesId(t, normalized));
    if (idx === -1) return { error: 'Transaction not found' };

    const errors = this._validateRequired(data, false);
    if (errors.length) return { error: errors.join('; ') };

    db.transactions[idx] = { ...db.transactions[idx], ...data, id: db.transactions[idx].id, updatedAt: new Date().toISOString() };
    if (this._save(db)) return { transaction: db.transactions[idx] };
    return { error: 'Failed to persist update' };
  }

  delete(id) {
    const db = this._load();
    const normalized = this._normalizeId(id);
    const idx = (db.transactions || []).findIndex(t => this._matchesId(t, normalized));
    if (idx === -1) return { error: 'Transaction not found' };
    db.transactions.splice(idx, 1);
    if (this._save(db)) return { success: true };
    return { error: 'Failed to persist deletion' };
  }
}

module.exports = new InventoryTransactionsService();
