const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { eventBus } = require('./eventBus');
const repository = require('../repositories').sales;

class SalesService {
  _load() { return repository.read(); }
  _save(db) { return repository.write(db); }

  _validateRequired(data, forCreate) {
    const errors = [];
    if (forCreate && !data.items) errors.push('items is required');
    if (forCreate && (!data.items || data.items.length === 0)) errors.push('items must be a non-empty array');
    if (forCreate && data.total === undefined) errors.push('total is required');
    if (data.total !== undefined && typeof data.total !== 'number') errors.push('total must be a number');
    if (data.discount !== undefined && typeof data.discount !== 'number') errors.push('discount must be a number');
    if (data.items && !Array.isArray(data.items)) errors.push('items must be an array');
    return errors;
  }

  _normalizeId(id) {
    const str = String(id).trim();
    if (/^INV-\d{6}$/i.test(str)) return str.toUpperCase();
    return str;
  }

  list(query = {}) {
    const db = this._load();
    let invoices = db.invoices || [];

    // Filtering
    if (query.customer) {
      const q = query.customer.toLowerCase();
      invoices = invoices.filter(inv => (inv.customer || '').toLowerCase().includes(q));
    }
    if (query.branch) {
      const q = query.branch.toLowerCase();
      invoices = invoices.filter(inv => String(inv.branchId || inv.branch || '').toLowerCase() === q || (inv.branchName || '').toLowerCase().includes(q));
    }
    if (query.payment) {
      invoices = invoices.filter(inv => String(inv.payment || inv.paymentType || '').toLowerCase() === query.payment.toLowerCase());
    }
    if (query.invoiceNumber || query.inv) {
      const q = (query.invoiceNumber || query.inv || '').toLowerCase();
      invoices = invoices.filter(inv => String(inv.id || inv.invoiceId || '').toLowerCase().includes(q));
    }
    if (query.dateFrom) {
      const from = new Date(query.dateFrom).getTime();
      if (!isNaN(from)) invoices = invoices.filter(inv => new Date(inv.date || inv.createdAt).getTime() >= from);
    }
    if (query.dateTo) {
      const to = new Date(query.dateTo).getTime();
      if (!isNaN(to)) invoices = invoices.filter(inv => new Date(inv.date || inv.createdAt).getTime() <= to);
    }

    // Sorting
    const sortBy = query.sortBy || 'date';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    invoices.sort((a, b) => {
      let va = a[sortBy], vb = b[sortBy];
      if (sortBy === 'date' || sortBy === 'createdAt' || sortBy === 'updatedAt') {
        va = new Date(va || 0).getTime();
        vb = new Date(vb || 0).getTime();
      } else if (sortBy === 'total' || sortBy === 'profit' || sortBy === 'discount') {
        va = Number(va) || 0;
        vb = Number(vb) || 0;
      } else {
        va = String(va || '').toLowerCase();
        vb = String(vb || '').toLowerCase();
      }
      return va < vb ? -sortOrder : va > vb ? sortOrder : 0;
    });

    // Pagination
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
    const total = invoices.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const paginated = invoices.slice(start, start + limit);

    return { invoices: paginated, total, page, limit, totalPages };
  }

  stats() {
    const db = this._load();
    const invoices = db.invoices || [];
    const count = invoices.length;
    let totalSales = 0, cashSales = 0, creditSales = 0, totalProfit = 0;
    invoices.forEach(inv => {
      const t = Number(inv.total) || 0;
      totalSales += t;
      totalProfit += Number(inv.profit) || 0;
      const pay = String(inv.payment || inv.paymentType || inv.invoiceType || 'cash').toLowerCase();
      if (pay === 'cash' || pay === 'cash') cashSales += t;
      else creditSales += t;
    });
    return { count, totalSales: Math.round(totalSales * 100) / 100, cashSales: Math.round(cashSales * 100) / 100, creditSales: Math.round(creditSales * 100) / 100, profit: Math.round(totalProfit * 100) / 100 };
  }

  getById(id) {
    const db = this._load();
    const normalized = this._normalizeId(id);
    return (db.invoices || []).find(inv => this._normalizeId(inv.id) === normalized || this._normalizeId(inv.invoiceId) === normalized) || null;
  }

  create(data) {
    const errors = this._validateRequired(data, true);
    if (errors.length) return { error: errors.join('; ') };

    const db = this._load();
    const invoice = {
      id: data.id || data.invoiceId || 'INV-' + String(Date.now()).slice(-6),
      ...data,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Check duplicate ID
    const normalized = this._normalizeId(invoice.id);
    if ((db.invoices || []).some(inv => this._normalizeId(inv.id) === normalized)) {
      return { error: 'Duplicate invoice ID: ' + invoice.id };
    }

    if (!Array.isArray(db.invoices)) db.invoices = [];
    db.invoices.push(invoice);
    if (this._save(db)) {
      try { eventBus.publish('sale.created', invoice); } catch (_) {}
      return { invoice };
    }
    return { error: 'Failed to persist invoice' };
  }

  update(id, data) {
    const db = this._load();
    const normalized = this._normalizeId(id);
    const idx = (db.invoices || []).findIndex(inv => this._normalizeId(inv.id) === normalized);
    if (idx === -1) return { error: 'Invoice not found' };

    const errors = this._validateRequired(data, false);
    if (errors.length) return { error: errors.join('; ') };

    db.invoices[idx] = { ...db.invoices[idx], ...data, id: db.invoices[idx].id, updatedAt: new Date().toISOString() };
    if (this._save(db)) return { invoice: db.invoices[idx] };
    return { error: 'Failed to persist update' };
  }

  delete(id) {
    const db = this._load();
    const normalized = this._normalizeId(id);
    const idx = (db.invoices || []).findIndex(inv => this._normalizeId(inv.id) === normalized);
    if (idx === -1) return { error: 'Invoice not found' };
    db.invoices.splice(idx, 1);
    if (this._save(db)) return { success: true };
    return { error: 'Failed to persist deletion' };
  }
}

module.exports = new SalesService();