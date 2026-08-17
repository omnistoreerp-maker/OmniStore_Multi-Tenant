const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { eventBus } = require('./eventBus');
const config = require('../config');
const BaseRepository = require('../repositories/BaseRepository');
const repository = require('../repositories').purchases;

class PurchaseService {
  async _load(tenantContext) {
    const repo = this._repoFor(tenantContext);
    return repo.readAsync();
  }
  async _save(db) { return repository.writeAsync(db); }

  // FULL, unfiltered store document for WRITES (BaseRepository._rawStore
  // rule): a write must never persist a tenant-filtered snapshot that could
  // drop other tenants' records from the shared document. Ownership is gated
  // explicitly below. Used by the legacy (isolation-off) read-modify-write
  // path; the Phase 25 isolation path uses the async entity API instead.
  async _loadRaw(tenantContext) {
    const repo = this._repoFor(tenantContext);
    const db = await repo._rawStoreAsync();
    if (!db || typeof db !== 'object') return { invoices: [] };
    if (!Array.isArray(db.invoices)) db.invoices = [];
    return db;
  }

  // Cross-tenant write guard (same rule as Customers / InventoryTransactions /
  // Sales): a record claiming a DIFFERENT tenantId is never modified/deleted
  // by this request — treated as not-found (404). Legacy records (no tenantId)
  // stay writable. No-op when no tenant is carried (legacy single-company
  // mode).
  _ownershipBlocked(invoice) {
    if (!repository.hasTenant()) return false;
    if (!invoice || typeof invoice !== 'object') return true;
    const tid = invoice.tenantId;
    if (tid === undefined || tid === null || tid === '') return false;
    const current = repository.getCurrentTenant();
    const currentId = current && (current.tenantId != null ? current.tenantId : current.id);
    return currentId == null || String(tid) !== String(currentId);
  }

  // Phase 25 — Purchases tenant isolation. OPT-IN via
  // ENABLE_TENANT_PURCHASES_ISOLATION and active only when a TRUSTED tenant
  // context is present. The tenant id is taken exclusively from
  // `req.tenantContext` (reconstructed from the signed JWT by tenantCarry) —
  // never from body/query/headers. Mirrors the proven Phase 24 Sales pattern:
  // delegate to the existing Phase 21/22 entity API on an accessor-wired
  // repository. No storageAdapter / fileStore / JWT changes are involved.
  _isIsolationActive(tenantContext) {
    return config.tenantPurchasesIsolationEnabled && !!(tenantContext && tenantContext.tenantId != null);
  }

  _repoFor(tenantContext) {
    if (!this._isIsolationActive(tenantContext)) return repository;
    const tenantId = String(tenantContext.tenantId);
    return new BaseRepository('purchases', { getCurrentTenant: () => ({ tenantId }) });
  }

  // Phase 25 — READ-scope the loaded invoice list to the trusted tenant using
  // the exact Phase 13/22 rule:
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

  async list(query = {}, tenantContext) {
    const db = await this._load(tenantContext);
    let invoices = this._visibleInvoices(db.invoices || [], tenantContext);

    if (query.supplier) {
      const q = query.supplier.toLowerCase();
      invoices = invoices.filter(inv => (inv.supplier || '').toLowerCase().includes(q));
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

    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
    const total = invoices.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const paginated = invoices.slice(start, start + limit);

    return { invoices: paginated, total, page, limit, totalPages };
  }

  async stats(tenantContext) {
    const db = await this._load(tenantContext);
    const invoices = this._visibleInvoices(db.invoices || [], tenantContext);
    const count = invoices.length;
    let totalPurchases = 0, cashPurchases = 0, creditPurchases = 0;
    invoices.forEach(inv => {
      const t = Number(inv.total) || 0;
      totalPurchases += t;
      const pay = String(inv.payment || inv.paymentType || inv.invoiceType || 'cash').toLowerCase();
      if (pay === 'cash' || pay === 'cash') cashPurchases += t;
      else creditPurchases += t;
    });
    return { count, totalPurchases: Math.round(totalPurchases * 100) / 100, cashPurchases: Math.round(cashPurchases * 100) / 100, creditPurchases: Math.round(creditPurchases * 100) / 100 };
  }

  async getById(id, tenantContext) {
    if (this._isIsolationActive(tenantContext)) {
      const repo = this._repoFor(tenantContext);
      return repo.findAsync('invoices', this._normalizeId(id));
    }
    const db = await this._load(tenantContext);
    const normalized = this._normalizeId(id);
    return (db.invoices || []).find(inv => this._normalizeId(inv.id) === normalized || this._normalizeId(inv.invoiceId) === normalized) || null;
  }

  async create(data, tenantContext) {
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
      const created = await repo.createAsync('invoices', invoice);
      if (!created) return { error: 'Failed to persist invoice' };
      try { eventBus.publish('purchase.created', created); } catch (_) {}
      return { invoice: created };
    }

    const db = await this._loadRaw(tenantContext);
    const invoice = {
      id: data.id || data.invoiceId || 'INV-' + String(Date.now()).slice(-6),
      ...data,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const normalized = this._normalizeId(invoice.id);
    if ((db.invoices || []).some(inv => this._normalizeId(inv.id) === normalized)) {
      return { error: 'Duplicate invoice ID: ' + invoice.id };
    }

    if (!Array.isArray(db.invoices)) db.invoices = [];
    db.invoices.push(invoice);
    if (await this._save(db)) return { invoice };
    return { error: 'Failed to persist invoice' };
  }

  async update(id, data, tenantContext) {
    const errors = this._validateRequired(data, false);
    if (errors.length) return { error: errors.join('; ') };

    if (this._isIsolationActive(tenantContext)) {
      const repo = this._repoFor(tenantContext);
      const merged = await repo.updateAsync('invoices', this._normalizeId(id), data);
      if (!merged) return { error: 'Invoice not found' };
      return { invoice: merged };
    }

    const db = await this._loadRaw(tenantContext);
    const normalized = this._normalizeId(id);
    const idx = (db.invoices || []).findIndex(inv => this._normalizeId(inv.id) === normalized);
    if (idx === -1) return { error: 'Invoice not found' };
    if (this._ownershipBlocked(db.invoices[idx])) return { error: 'Invoice not found' };

    db.invoices[idx] = { ...db.invoices[idx], ...data, id: db.invoices[idx].id, updatedAt: new Date().toISOString() };
    if (await this._save(db)) return { invoice: db.invoices[idx] };
    return { error: 'Failed to persist update' };
  }

  async delete(id, tenantContext) {
    if (this._isIsolationActive(tenantContext)) {
      const repo = this._repoFor(tenantContext);
      const ok = await repo.deleteAsync('invoices', this._normalizeId(id));
      if (!ok) return { error: 'Invoice not found' };
      return { success: true };
    }

    const db = await this._loadRaw(tenantContext);
    const normalized = this._normalizeId(id);
    const idx = (db.invoices || []).findIndex(inv => this._normalizeId(inv.id) === normalized);
    if (idx === -1) return { error: 'Invoice not found' };
    if (this._ownershipBlocked(db.invoices[idx])) return { error: 'Invoice not found' };
    db.invoices.splice(idx, 1);
    if (await this._save(db)) return { success: true };
    return { error: 'Failed to persist deletion' };
  }
}

module.exports = new PurchaseService();