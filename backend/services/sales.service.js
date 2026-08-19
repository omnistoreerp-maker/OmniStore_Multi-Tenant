const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { eventBus } = require('./eventBus');
const config = require('../config');
const BaseRepository = require('../repositories/BaseRepository');
const repository = require('../repositories').sales;
const branchStore = require('../middleware/branchStore');

class SalesService {
  async _load(tenantContext) {
    const repo = this._repoFor(tenantContext);
    return repo.readAsync();
  }
  async _save(db) { return repository.writeAsync(db); }

  // FULL, unfiltered store document for WRITES (BaseRepository._rawStore
  // rule): a write must never persist a tenant-filtered snapshot that could
  // drop other tenants' records from the shared document. Ownership is gated
  // explicitly below. Used by the legacy (isolation-off) read-modify-write
  // path; the Phase 24 isolation path uses the async entity API instead.
  async _loadRaw(tenantContext) {
    const repo = this._repoFor(tenantContext);
    const db = await repo._rawStoreAsync();
    if (!db || typeof db !== 'object') return { invoices: [] };
    if (!Array.isArray(db.invoices)) db.invoices = [];
    return db;
  }

  // Cross-tenant write guard (same rule as Customers / InventoryTransactions):
  // a record claiming a DIFFERENT tenantId is never modified/deleted by this
  // request — treated as not-found (404). Legacy records (no tenantId) stay
  // writable. No-op when no tenant is carried (legacy single-company mode).
  _ownershipBlocked(invoice) {
    if (!repository.hasTenant()) return false;
    if (!invoice || typeof invoice !== 'object') return true;
    const tid = invoice.tenantId;
    if (tid === undefined || tid === null || tid === '') return false;
    const current = repository.getCurrentTenant();
    const currentId = current && (current.tenantId != null ? current.tenantId : current.id);
    return currentId == null || String(tid) !== String(currentId);
  }

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

  // Phase F — Branch isolation. OPT-IN via ENABLE_BRANCH_ISOLATION. The
  // trusted branch comes from the request-level branchStore (resolved by the
  // branchStore.middleware from the STORED user record — never from the
  // client). Rules are identical to the tenant pattern:
  //   - record with NO branchId -> legacy -> always visible (read-only)
  //   - record branchId == branch scope -> visible / writable
  //   - record branchId != branch scope -> hidden (never leaks), not found
  // User without a branch scope (Owner/Admin/Manager/…) is never restricted.
  _branchActive() {
    return config.branchIsolationEnabled && !!branchStore.get();
  }

  _branchBlocked(record) {
    if (!config.branchIsolationEnabled) return false;
    if (!record || typeof record !== 'object') return true;
    const bid = record.branchId;
    if (bid === undefined || bid === null || bid === '') return false; // legacy
    const scope = branchStore.get();
    if (!scope) return false; // unscoped user -> not enforced
    return String(bid) !== String(scope);
  }

  _branchVisibleInvoices(invoices) {
    if (!this._branchActive()) return invoices;
    const scope = branchStore.get();
    return invoices.filter(inv => {
      if (!inv || typeof inv !== 'object') return true;
      if (inv.branchId === undefined || inv.branchId === null || inv.branchId === '') return true; // legacy
      return String(inv.branchId) === scope;
    });
  }

  // Server-authoritative branch stamping for creates + rejection of a create
  // that claims a branch the user does not own (defence-in-depth behind the
  // branchScope middleware).
  _applyBranchToCreate(data) {
    if (!config.branchIsolationEnabled) return null;
    const scope = branchStore.get();
    if (!scope) return null;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      if (data.branchId != null && data.branchId !== '' && String(data.branchId) !== String(scope)) {
        return 'Branch scope denied';
      }
      if (data.branchId === undefined || data.branchId === null || data.branchId === '') {
        data.branchId = scope;
      }
    }
    return null;
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
    invoices = this._branchVisibleInvoices(invoices);

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

  async stats(tenantContext) {
    const db = await this._load(tenantContext);
    let invoices = this._visibleInvoices(db.invoices || [], tenantContext);
    invoices = this._branchVisibleInvoices(invoices);
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

  async getById(id, tenantContext) {
    if (this._isIsolationActive(tenantContext)) {
      const repo = this._repoFor(tenantContext);
      const found = await repo.findAsync('invoices', this._normalizeId(id));
      if (found && this._branchBlocked(found)) return null;
      return found;
    }
    const db = await this._load(tenantContext);
    const normalized = this._normalizeId(id);
    const found = this._findById(db, normalized);
    if (found && this._branchBlocked(found)) return null;
    return found;
  }

  async create(data, tenantContext) {
    const branchError = this._applyBranchToCreate(data);
    if (branchError) return { error: branchError };
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
      try { eventBus.publish('sale.created', created); } catch (_) {}
      return { invoice: created };
    }

    const db = await this._loadRaw(tenantContext);
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
    if (await this._save(db)) {
      try { eventBus.publish('sale.created', invoice); } catch (_) {}
      return { invoice };
    }
    return { error: 'Failed to persist invoice' };
  }

  async update(id, data, tenantContext) {
    const errors = this._validateRequired(data, false);
    if (errors.length) return { error: errors.join('; ') };

    if (this._isIsolationActive(tenantContext)) {
      const repo = this._repoFor(tenantContext);
      const existing = await repo.findAsync('invoices', this._normalizeId(id));
      if (!existing) return { error: 'Invoice not found' };
      if (this._branchBlocked(existing)) return { error: 'Invoice not found' };
      const merged = await repo.updateAsync('invoices', this._normalizeId(id), data);
      if (!merged) return { error: 'Invoice not found' };
      return { invoice: merged };
    }

    const db = await this._loadRaw(tenantContext);
    const normalized = this._normalizeId(id);
    const idx = (db.invoices || []).findIndex(inv => this._normalizeId(inv.id) === normalized);
    if (idx === -1) return { error: 'Invoice not found' };
    if (this._ownershipBlocked(db.invoices[idx]) || this._branchBlocked(db.invoices[idx])) return { error: 'Invoice not found' };

    db.invoices[idx] = { ...db.invoices[idx], ...data, id: db.invoices[idx].id, updatedAt: new Date().toISOString() };
    if (await this._save(db)) return { invoice: db.invoices[idx] };
    return { error: 'Failed to persist update' };
  }

  async delete(id, tenantContext) {
    if (this._isIsolationActive(tenantContext)) {
      const repo = this._repoFor(tenantContext);
      const existing = await repo.findAsync('invoices', this._normalizeId(id));
      if (!existing) return { error: 'Invoice not found' };
      if (this._branchBlocked(existing)) return { error: 'Invoice not found' };
      const ok = await repo.deleteAsync('invoices', this._normalizeId(id));
      if (!ok) return { error: 'Invoice not found' };
      return { success: true };
    }

    const db = await this._loadRaw(tenantContext);
    const normalized = this._normalizeId(id);
    const idx = (db.invoices || []).findIndex(inv => this._normalizeId(inv.id) === normalized);
    if (idx === -1) return { error: 'Invoice not found' };
    if (this._ownershipBlocked(db.invoices[idx]) || this._branchBlocked(db.invoices[idx])) return { error: 'Invoice not found' };
    db.invoices.splice(idx, 1);
    if (await this._save(db)) return { success: true };
    return { error: 'Failed to persist deletion' };
  }
}

module.exports = new SalesService();