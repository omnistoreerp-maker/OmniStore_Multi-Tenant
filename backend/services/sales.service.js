const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { eventBus } = require('./eventBus');
const config = require('../config');
const BaseRepository = require('../repositories/BaseRepository');
const repository = require('../repositories').sales;

class SalesService {
  _load(tenantContext) {
    const repo = this._repoFor(tenantContext);
    return repo.read();
  }
  _save(db) { return repository.write(db); }

  // Phase 24 — Sales tenant isolation. OPT-IN via ENABLE_TENANT_SALES_ISOLATION
  // and active only when a TRUSTED tenant context is present. The tenant id is
  // taken exclusively from `req.tenantContext` (reconstructed from the signed
  // JWT by tenantCarry) — never from body/query/headers.
  //
  // When active, the service delegates to the existing Phase 21/22 entity API
  // on an accessor-wired repository, reusing the SAME isolation boundary as
  // createEntity/updateEntity/deleteEntity/findEntity. No storageAdapter /
  // fileStore / JWT changes are involved.
  _isIsolationActive(tenantContext) {
    return config.tenantSalesIsolationEnabled && !!(tenantContext && tenantContext.tenantId != null);
  }

  _repoFor(tenantContext) {
    if (!this._isIsolationActive(tenantContext)) return repository;
    const tenantId = String(tenantContext.tenantId);
    return new BaseRepository('sales', { getCurrentTenant: () => ({ tenantId }) });
  }

  _findById(db, normalized) {
    return (db.invoices || []).find(inv => this._normalizeId(inv.id) === normalized || this._normalizeId(inv.invoiceId) === normalized) || null;
  }

  // Phase 24 — READ-scope the loaded invoice list to the trusted tenant. The
  // underlying document is written back UNFILTERED by the entity API (so other
  // tenants' records are never dropped); therefore list/stats scope visibility
  // explicitly here, using the exact Phase 13/22 rule:
  //   - record with NO tenantId  -> legacy -> ALWAYS visible (read-only)
  //   - record tenantId == current -> visible
  //   - record tenantId != current -> hidden (never leaks)
  _visibleInvoices(invoices, tenantContext) {
    if (!this._isIsolationActive(tenantContext)) return invoices;
    const tenantId = String(tenantContext.tenantId);
    return invoices.filter(inv => {
      if (!inv || typeof inv !== 'object') return true;
      if (inv.tenantId === undefined || inv.tenantId === null || inv.tenantId === '') return true;
      return String(inv.tenantId) === tenantId;
    });
  }

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

  list(query = {}, tenantContext) {
    const db = this._load(tenantContext);
    let invoices = this._visibleInvoices ? this._visibleInvoices(db.invoices || [], tenantContext) : (db.invoices || []);

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

  stats(tenantContext) {
    const db = this._load(tenantContext);
    const invoices = this._visibleInvoices(db.invoices || [], tenantContext);
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

  getById(id, tenantContext) {
    if (this._isIsolationActive(tenantContext)) {
      const repo = this._repoFor(tenantContext);
      return repo.findEntity('invoices', this._normalizeId(id));
    }
    const db = this._load();
    const normalized = this._normalizeId(id);
    return this._findById(db, normalized);
  }

  create(data, tenantContext) {
    const errors = this._validateRequired(data, true);
    if (errors.length) return { error: errors.join('; ') };

    if (this._isIsolationActive(tenantContext)) {
      const repo = this._repoFor(tenantContext);
      const invoice = {
        id: data.id || data.invoiceId || 'INV-' + String(Date.now()).slice(-6),
        ...data,
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const created = repo.createEntity('invoices', invoice);
      if (!created) return { error: 'Failed to persist invoice' };
      try { eventBus.publish('sale.created', created); } catch (_) {}
      return { invoice: created };
    }

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

  update(id, data, tenantContext) {
    const errors = this._validateRequired(data, false);
    if (errors.length) return { error: errors.join('; ') };

    if (this._isIsolationActive(tenantContext)) {
      const repo = this._repoFor(tenantContext);
      const merged = repo.updateEntity('invoices', this._normalizeId(id), data);
      if (!merged) return { error: 'Invoice not found' };
      return { invoice: merged };
    }

    const db = this._load();
    const normalized = this._normalizeId(id);
    const idx = (db.invoices || []).findIndex(inv => this._normalizeId(inv.id) === normalized);
    if (idx === -1) return { error: 'Invoice not found' };

    db.invoices[idx] = { ...db.invoices[idx], ...data, id: db.invoices[idx].id, updatedAt: new Date().toISOString() };
    if (this._save(db)) return { invoice: db.invoices[idx] };
    return { error: 'Failed to persist update' };
  }

  delete(id, tenantContext) {
    if (this._isIsolationActive(tenantContext)) {
      const repo = this._repoFor(tenantContext);
      const ok = repo.deleteEntity('invoices', this._normalizeId(id));
      if (!ok) return { error: 'Invoice not found' };
      return { success: true };
    }

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