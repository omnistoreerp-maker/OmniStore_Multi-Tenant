'use strict';

// DAY 3 — CUSTOMER LEDGER WORKFLOW (payments side).
//
// UNIFIES the existing model — it does NOT invent a new accounting system:
//   customer.balance is an OPENING-balance seed only (DigiTronics_v5.html
//   getCustomerBalance / getEntityLedgerBalance: "customer.balance is NOT
//   summed anymore"; sales/payments/vouchers no longer write to it).
//   Customer debt is DERIVED:
//       outstanding = opening + SUM(credit sale totals) - SUM(payments)
//
//   - a CREDIT SALE is itself the ledger debit row (linked by saleId through
//     the sale invoice record + Day 1 sales posting) — nothing else to write;
//   - a CUSTOMER PAYMENT is a ledger credit row: a persisted customerPayments
//     record linked to a treasury "in" receipt (Day 3, this module).
//
// Isolation contract (mirrors Treasury / SalePosting / PurchasePosting):
//   - tenantId/branchId are stamped from SERVER context, never client fields;
//   - a customer from another tenant/branch is NEVER payable (404);
//   - writes load the RAW store and save it back UNFILTERED;
//   - every effect is reversible: delete/repost undo their treasury entry.

class CustomerPaymentsService {
  constructor(deps) {
    deps = deps || {};
    this._repository = deps.repository || require('../repositories').customerPayments;
    this._treasuryRepo = deps.treasuryRepo || require('../repositories').treasury;
    this._customersService = deps.customersService || require('./customers.service');
    this._branchStore = deps.branchStore || require('../middleware/branchStore');
    this._config = deps.config || require('../config');
  }

  async _load() {
    const db = await this._repository.readAsync();
    if (!db || typeof db !== 'object') return { payments: [] };
    if (!Array.isArray(db.payments)) db.payments = [];
    return db;
  }
  async _save(db) { return this._repository.writeAsync(db); }

  async _loadRaw() {
    const db = await this._repository._rawStoreAsync();
    if (!db || typeof db !== 'object') return { payments: [] };
    if (!Array.isArray(db.payments)) db.payments = [];
    return db;
  }

  async _loadTreasuryRaw() {
    const db = await this._treasuryRepo._rawStoreAsync();
    const store = db && typeof db === 'object' ? db : { entries: [] };
    if (!Array.isArray(store.entries)) store.entries = [];
    return store;
  }

  _ownershipBlocked(record) {
    if (!this._repository.hasTenant()) return false;
    if (!record || typeof record !== 'object') return true;
    const tid = record.tenantId;
    if (tid === undefined || tid === null || tid === '') return false;
    const current = this._repository.getCurrentTenant();
    const currentId = current && (current.tenantId != null ? current.tenantId : current.id);
    return currentId == null || String(tid) !== String(currentId);
  }

  _branchActive() {
    return this._config.branchIsolationEnabled && !!this._branchStore.get();
  }

  _branchBlocked(record) {
    if (!this._config.branchIsolationEnabled) return false;
    if (!record || typeof record !== 'object') return true;
    const bid = record.branchId;
    if (bid === undefined || bid === null || bid === '') return false;
    const scope = this._branchStore.get();
    if (!scope) return false;
    return String(bid) !== String(scope);
  }

  _branchVisible(payments) {
    if (!this._branchActive()) return payments;
    const scope = this._branchStore.get();
    return payments.filter(p => {
      if (!p || typeof p !== 'object') return true;
      if (p.branchId === undefined || p.branchId === null || p.branchId === '') return true;
      return String(p.branchId) === scope;
    });
  }

  _applyBranchToCreate(data) {
    if (!this._config.branchIsolationEnabled) return null;
    const scope = this._branchStore.get();
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
    if (forCreate && (data.customerId === undefined || data.customerId === null || String(data.customerId).trim() === '')) errors.push('customerId is required');
    if (forCreate && (data.amount === undefined || data.amount === null)) errors.push('amount is required');
    if (data.amount !== undefined && typeof data.amount !== 'number') errors.push('amount must be a number');
    ['date', 'method', 'desc', 'user'].forEach(f => {
      if (data[f] !== undefined && typeof data[f] !== 'string') errors.push(f + ' must be a string');
    });
    return errors;
  }

  _normalizeId(id) { return String(id).trim(); }

  _matchesId(payment, normalized) {
    return this._normalizeId(payment.id) === normalized || this._normalizeId(payment._backendId || '') === normalized;
  }

  // Resolves a customer and enforces the tenant/branch scope server-side.
  // A customer from another tenant (or another branch, when scoped) is never
  // payable — reported as not-found with no information leak.
  async _resolveCustomer(customerId) {
    const strId = this._normalizeId(customerId);
    if (!strId) return { error: 'Customer not found' };
    const customer = await this._customersService.getById(strId);
    if (!customer) return { error: 'Customer not found' };
    if (this._customersService._ownershipBlocked(customer)) return { error: 'Customer not found' };
    if (this._branchBlocked(customer)) return { error: 'Customer not found' };
    return { customer: customer };
  }

  _stamp(record, current) {
    if (this._repository.hasTenant() && current && current.tenantId != null) {
      const currentId = current.tenantId != null ? current.tenantId : current.id;
      if (currentId != null) record.tenantId = String(currentId);
    }
    return record;
  }

  async _createTreasuryEntry(payment) {
    const now = new Date().toISOString();
    const store = await this._loadTreasuryRaw();
    const entry = {
      id: require('uuid').v4(),
      type: 'in',
      amount: Number(payment.amount) || 0,
      date: payment.date || now,
      method: payment.method || 'cash',
      desc: 'Customer payment ' + (payment.customerName || payment.customerId),
      source: 'customer-payment',
      paymentId: String(payment.id),
      customerId: String(payment.customerId),
      createdAt: now,
      updatedAt: now
    };
    if (payment.tenantId !== undefined && payment.tenantId !== null) entry.tenantId = String(payment.tenantId);
    if (payment.branchId !== undefined && payment.branchId !== null && payment.branchId !== '') entry.branchId = payment.branchId;
    store.entries.push(entry);
    if (!(await this._treasuryRepo.writeAsync(store))) return null;
    return entry;
  }

  async _removeTreasuryEntry(entryId) {
    if (!entryId) return true;
    const store = await this._loadTreasuryRaw();
    const idx = store.entries.findIndex(e => this._normalizeId(e.id) === this._normalizeId(entryId));
    if (idx === -1) return true;
    store.entries.splice(idx, 1);
    return await this._treasuryRepo.writeAsync(store);
  }

  async list(query) {
    query = query || {};
    const db = await this._load();
    let payments = this._branchVisible(db.payments || []);

    if (query.customerId !== undefined && query.customerId !== '') {
      payments = payments.filter(p => String(p.customerId) === String(query.customerId));
    }
    if (query.search) {
      const q = String(query.search).toLowerCase();
      payments = payments.filter(p => String(p.customerName || '').toLowerCase().includes(q) || String(p.desc || '').toLowerCase().includes(q) || String(p.method || '').toLowerCase().includes(q));
    }

    const sortBy = query.sortBy || 'date';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    payments.sort((a, b) => {
      let va = a[sortBy], vb = b[sortBy];
      if (sortBy === 'date' || sortBy === 'createdAt') { va = new Date(va || 0).getTime(); vb = new Date(vb || 0).getTime(); }
      else if (sortBy === 'amount') { va = Number(va) || 0; vb = Number(vb) || 0; }
      else { va = String(va || '').toLowerCase(); vb = String(vb || '').toLowerCase(); }
      return va < vb ? -sortOrder : va > vb ? sortOrder : 0;
    });

    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
    const total = payments.length;
    const totalPages = Math.ceil(total / limit);
    return { payments: payments.slice((page - 1) * limit, (page - 1) * limit + limit), total: total, page: page, limit: limit, totalPages: totalPages };
  }

  async getById(id) {
    const db = await this._load();
    const normalized = this._normalizeId(id);
    const found = (db.payments || []).find(p => this._matchesId(p, normalized)) || null;
    if (found && this._branchBlocked(found)) return null;
    return found;
  }

  async stats() {
    const db = await this._load();
    const payments = this._branchVisible(db.payments || []);
    const total = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    return { count: payments.length, total: Math.round(total * 100) / 100 };
  }

  async create(data) {
    const branchError = this._applyBranchToCreate(data);
    if (branchError) return { error: branchError };
    const errors = this._validateRequired(data, true);
    if (errors.length) return { error: errors.join('; ') };

    const amount = Number(data.amount);
    if (!(amount > 0)) return { error: 'amount must be a positive number' };

    const resolved = await this._resolveCustomer(data.customerId);
    if (resolved.error) return { error: resolved.error };
    const customer = resolved.customer;

    const db = await this._loadRaw();
    const payment = {
      id: data.id !== undefined && data.id !== null ? data.id : require('uuid').v4(),
      customerId: String(customer.id),
      customerName: customer.name || '',
      amount: amount,
      date: data.date,
      method: data.method,
      desc: data.desc,
      user: data.user,
      branchId: data.branchId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const normalized = this._normalizeId(payment.id);
    if ((db.payments || []).some(p => this._normalizeId(p.id) === normalized)) {
      return { error: 'Duplicate customer payment ID: ' + payment.id };
    }

    // Client tenant claims can never override the server context.
    if (data.tenantId !== undefined && data.tenantId !== null && data.tenantId !== '' && this._repository.hasTenant()) {
      const current = this._repository.getCurrentTenant();
      const currentId = current && (current.tenantId != null ? current.tenantId : current.id);
      if (currentId != null && String(data.tenantId) !== String(currentId)) {
        return { error: 'Invalid tenant claim' };
      }
    }
    this._stamp(payment, this._repository.getCurrentTenant());

    // Treasury first, then persist the payment; undo on persist failure.
    const entry = await this._createTreasuryEntry(payment);
    if (!entry) return { error: 'Failed to persist treasury receipt' };
    payment.treasuryEntryId = entry.id;

    if (!Array.isArray(db.payments)) db.payments = [];
    db.payments.push(payment);
    if (await this._save(db)) return { payment: payment };

    await this._removeTreasuryEntry(entry.id);
    return { error: 'Failed to persist customer payment' };
  }

  // UPDATE-safe reposting: validate the merged record FIRST, then replace the
  // treasury effect exactly once (old entry removed, new entry created). No
  // double payment, no double treasury entry, old state untouched on failure.
  async update(id, data) {
    const errors = this._validateRequired(data, false);
    if (errors.length) return { error: errors.join('; ') };
    if (data.amount !== undefined && !(Number(data.amount) > 0)) return { error: 'amount must be a positive number' };

    const db = await this._loadRaw();
    const normalized = this._normalizeId(id);
    const idx = (db.payments || []).findIndex(p => this._matchesId(p, normalized));
    if (idx === -1) return { error: 'Customer payment not found' };
    const existing = db.payments[idx];
    if (this._ownershipBlocked(existing) || this._branchBlocked(existing)) return { error: 'Customer payment not found' };

    const merged = Object.assign({}, existing, data, { id: existing.id, customerId: existing.customerId, customerName: existing.customerName, treasuryEntryId: existing.treasuryEntryId, createdAt: existing.createdAt, updatedAt: new Date().toISOString() });
    if (data.customerId !== undefined && String(data.customerId) !== String(existing.customerId)) {
      const resolved = await this._resolveCustomer(data.customerId);
      if (resolved.error) return { error: resolved.error };
      merged.customerId = String(resolved.customer.id);
      merged.customerName = resolved.customer.name || '';
    }
    if (!(Number(merged.amount) > 0)) return { error: 'amount must be a positive number' };

    if (!(await this._removeTreasuryEntry(existing.treasuryEntryId))) {
      return { error: 'Failed to update treasury receipt' };
    }
    const entry = await this._createTreasuryEntry(merged);
    if (!entry) {
      await this._createTreasuryEntry(existing); // best-effort restore
      return { error: 'Failed to persist treasury receipt' };
    }

    merged.treasuryEntryId = entry.id;
    db.payments[idx] = merged;
    if (await this._save(db)) return { payment: merged };

    await this._removeTreasuryEntry(entry.id);
    await this._createTreasuryEntry(existing); // best-effort restore
    return { error: 'Failed to persist customer payment update' };
  }

  async delete(id) {
    const db = await this._loadRaw();
    const normalized = this._normalizeId(id);
    const idx = (db.payments || []).findIndex(p => this._matchesId(p, normalized));
    if (idx === -1) return { error: 'Customer payment not found' };
    const existing = db.payments[idx];
    if (this._ownershipBlocked(existing) || this._branchBlocked(existing)) return { error: 'Customer payment not found' };

    db.payments.splice(idx, 1);
    if (await this._save(db)) {
      await this._removeTreasuryEntry(existing.treasuryEntryId);
      return { success: true };
    }
    return { error: 'Failed to persist deletion' };
  }

  // ------------------------------------------------------------------
  // LEDGER (Reports-ready, derived). Rows:
  //   opening  -> debit/credit from customer.balance (seed rule)
  //   invoice  -> credit sale (payment != cash): debit = invoice total
  //   payment  -> customer payment: credit = amount, linked to treasury
  // outstanding = max(0, sum(debit) - sum(credit))
  // ------------------------------------------------------------------
  async ledger(customerId) {
    const resolved = await this._resolveCustomer(customerId);
    if (resolved.error) return { error: resolved.error };
    const customer = resolved.customer;
    const cid = String(customer.id);
    const name = String(customer.name || '').toLowerCase();

    const rows = [];
    const opening = Number(customer.balance) || 0;
    if (opening !== 0) {
      rows.push({
        kind: 'opening', label: 'opening balance',
        reference: 'opening-' + cid, date: customer.createdAt || '',
        debit: opening > 0 ? opening : 0, credit: opening < 0 ? -opening : 0,
        customerId: cid, tenantId: customer.tenantId, branchId: customer.branchId
      });
    }

    const salesDb = await require('../repositories').sales._rawStoreAsync();
    const invoices = salesDb && typeof salesDb === 'object' && Array.isArray(salesDb.invoices) ? salesDb.invoices : [];
    invoices.forEach(inv => {
      if (!inv || typeof inv !== 'object') return;
      const mine = (inv.customerId !== undefined && inv.customerId !== null && String(inv.customerId) === cid) ||
        (name && String(inv.customer || '').toLowerCase() === name);
      if (!mine) return;
      // Tenant guard: an invoice belonging to another tenant never enters this
      // ledger, even if a client-supplied customerId/name happens to match.
      if (this._repository.hasTenant() && inv.tenantId !== undefined && inv.tenantId !== null && inv.tenantId !== '') {
        const current = this._repository.getCurrentTenant();
        const currentId = current && (current.tenantId != null ? current.tenantId : current.id);
        if (currentId == null || String(inv.tenantId) !== String(currentId)) return;
      }
      const pay = String(inv.payment || inv.paymentType || inv.invoiceType || 'cash').toLowerCase();
      if (pay === 'cash' || pay === '\u0646\u0642\u062f\u064a' || pay === '\u0643\u0627\u0634') return; // cash sales carry no debt
      rows.push({
        kind: 'invoice', label: 'credit sale',
        reference: String(inv.id || ''), saleId: String(inv.id || ''),
        date: inv.date || inv.createdAt || '',
        debit: Number(inv.total) || 0, credit: 0,
        customerId: cid, tenantId: inv.tenantId, branchId: inv.branchId
      });
    });

    const payDb = await this._loadRaw();
    (payDb.payments || []).forEach(p => {
      if (!p || typeof p !== 'object') return;
      if (String(p.customerId) !== cid) return;
      if (this._ownershipBlocked(p) || this._branchBlocked(p)) return;
      rows.push({
        kind: 'payment', label: 'customer payment',
        reference: String(p.id || ''), paymentId: String(p.id || ''),
        treasuryEntryId: p.treasuryEntryId || null,
        date: p.date || p.createdAt || '',
        debit: 0, credit: Number(p.amount) || 0,
        customerId: cid, tenantId: p.tenantId, branchId: p.branchId
      });
    });

    rows.sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());
    const balance = rows.reduce((s, r) => s + (Number(r.debit) || 0) - (Number(r.credit) || 0), 0);
    return {
      customerId: cid,
      customerName: customer.name || '',
      rows: rows,
      balance: Math.round(balance * 100) / 100,
      outstanding: Math.max(0, Math.round(balance * 100) / 100)
    };
  }
}

module.exports = new CustomerPaymentsService();