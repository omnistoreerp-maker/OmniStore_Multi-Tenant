'use strict';

// DAY 4 — REPORTS WIRING (computed readers, nothing persisted).
//
// Every figure below is derived LIVE from the real posting sources wired in
// Days 1-3 (sales / purchases / customerPayments / treasury /
// inventoryTransactions / products). No fake numbers, no demo metrics, no
// persisted aggregates: the stores of record stay the single source of truth.
//
// Accounting rules enforced:
//   - tenant guard: a record whose tenantId differs from the server tenant is
//     invisible (legacy records without tenantId stay visible, Phase 13/22).
//   - branch guard: same rule against the request branch scope.
//   - reversal records (refType kind ...reversal) are exposed as REVERSAL
//     rows with their own date; they are never merged into the original line.
//   - no double counting: cash-flow aggregates treasury entries by their
//     CATEGORY (sale receipt / payment receipt / purchase / manual), and
//     summaries count each posting once. Statements derive from invoices +
//     payment ledgers, never by adding treasury on top of the same event.
//   - date filtering is inclusive and timezone-safe (ISO day compare).
//   - empty datasets return zeros/empty structures, never errors.
//   - onboarding/demo seed records belong to a real tenant and are treated
//     exactly like any stored record (the system has no record-exclusion
//     convention beyond tenant/branch visibility).

class FinancialReportsService {
  constructor(deps) {
    deps = deps || {};
    const repositories = deps.repositories || require('../repositories');
    this._salesRepo = deps.salesRepo || repositories.sales;
    this._purchasesRepo = deps.purchasesRepo || repositories.purchases;
    this._paymentsRepo = deps.paymentsRepo || repositories.customerPayments;
    this._treasuryRepo = deps.treasuryRepo || repositories.treasury;
    this._invTxRepo = deps.invTxRepo || repositories.inventoryTransactions;
    this._productsRepo = deps.productsRepo || repositories.products;
    this._customersRepo = deps.customersRepo || repositories.customers;
    this._suppliersRepo = deps.suppliersRepo || repositories.suppliers;
    this._branchStore = deps.branchStore || require('../middleware/branchStore');
  }

  _tenantOf() {
    const repo = this._salesRepo;
    if (!repo || !repo.hasTenant || !repo.hasTenant()) return null;
    const current = repo.getCurrentTenant();
    const currentId = current && (current.tenantId != null ? current.tenantId : current.id);
    return currentId != null ? String(currentId) : null;
  }

  _branchOf() {
    return this._branchStore && this._branchStore.get ? this._branchStore.get() : null;
  }

  _visible(record) {
    if (!record || typeof record !== 'object') return false;
    const tid = this._tenantOf();
    if (tid !== null && record.tenantId !== undefined && record.tenantId !== null && record.tenantId !== '') {
      if (String(record.tenantId) !== tid) return false;
    }
    // No second-guessing for legacy records here: they stay visible to the
    // trusted tenant exactly like every other reader in the system.
    // (Removed an experimental hide-legacy rule that contradicted the
    // Phase 13/22 legacy-visibility contract.)
    const scope = this._branchOf();
    if (scope !== null && record.branchId !== undefined && record.branchId !== null && record.branchId !== '') {
      if (String(record.branchId) !== String(scope)) return false;
    }
    return true;
  }

  async _readAll(repo, key) {
    try {
      const db = await repo._rawStoreAsync();
      if (!db || typeof db !== 'object') return [];
      return Array.isArray(db[key]) ? db[key] : [];
    } catch (err) { return []; }
  }

  _isCash(inv) {
    const p = String(inv.payment || inv.paymentType || inv.invoiceType || 'cash').toLowerCase();
    return p === 'cash' || p === '\u0646\u0642\u062f\u064a' || p === '\u0643\u0627\u0634';
  }

  _dateOf(record) {
    return record.date || record.createdAt || record.updatedAt || '';
  }

  _dayOf(value) {
    const d = new Date(value || 0);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  _inRange(dateValue, from, to) {
    const day = this._dayOf(dateValue);
    if (!day) return false;
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  }

  _num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  _round2(value) { return Math.round((Number(value) || 0) * 100) / 100; }

  _emptyTotals() {
    return { count: 0, total: 0, cashCount: 0, cashTotal: 0, creditCount: 0, creditTotal: 0 };
  }

  _sumInvoice(inv) { return this._num(inv.total); }

  // ---------- customer statement (Day 3 ledger model + running balance) ----
  async customerStatement(customerId, query) {
    query = query || {};
    if (customerId === undefined || customerId === null || String(customerId).trim() === '') {
      return { error: 'customerId is required' };
    }
    const strId = String(customerId).trim();
    const customers = await this._readAll(this._customersRepo, 'customers');
    const customer = customers.find(c => c && String(c.id) === strId) || null;
    if (!customer || !this._visible(customer)) return { error: 'Customer not found' };

    const name = String(customer.name || '').toLowerCase();
    const rows = [];
    const opening = this._num(customer.balance);
    if (opening !== 0) {
      rows.push({ date: customer.createdAt || '', time: customer.createdAt || '', type: 'opening', reference: 'opening-' + strId, description: 'opening balance', debit: opening > 0 ? opening : 0, credit: opening < 0 ? -opening : 0, running: 0 });
    }

    const sales = await this._readAll(this._salesRepo, 'invoices');
    sales.forEach(inv => {
      if (!inv || !this._visible(inv)) return;
      const mine = (inv.customerId !== undefined && inv.customerId !== null && String(inv.customerId) === strId) ||
        (name !== '' && String(inv.customer || '').toLowerCase() === name);
      if (!mine) return;
      if (!this._inRange(this._dateOf(inv), query.from, query.to)) return;
      if (this._isCash(inv)) {
        rows.push({ date: this._dayOf(this._dateOf(inv)), time: this._dateOf(inv), type: 'sale-cash', reference: String(inv.id || ''), description: 'cash sale (no debt)', debit: 0, credit: 0, trace: { saleId: String(inv.id || '') } });
        return;
      }
      const amount = this._sumInvoice(inv);
      rows.push({ date: this._dayOf(this._dateOf(inv)), time: this._dateOf(inv), type: 'invoice', reference: String(inv.id || ''), description: 'credit sale', debit: amount, credit: 0, trace: { saleId: String(inv.id || '') } });
    });

    const payments = await this._readAll(this._paymentsRepo, 'payments');
    payments.forEach(p => {
      if (!p || !this._visible(p)) return;
      if (String(p.customerId) !== strId) return;
      if (!this._inRange(this._dateOf(p), query.from, query.to)) return;
      rows.push({ date: this._dayOf(this._dateOf(p)), time: this._dateOf(p), type: 'payment', reference: String(p.id || ''), description: 'customer payment ' + (p.method || ''), debit: 0, credit: this._num(p.amount), trace: { paymentId: String(p.id || ''), treasuryEntryId: p.treasuryEntryId || null } });
    });

    rows.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
    let running = 0;
    rows.forEach(r => { running = this._round2(running + this._num(r.debit) - this._num(r.credit)); r.running = running; });
    const outstanding = Math.max(0, running);
    return { customerId: strId, customerName: customer.name || '', opening: opening, rows: rows, balance: running, outstanding: outstanding, from: query.from || null, to: query.to || null };
  }

  // ---------- supplier statement (derived; NO balance mutation anywhere) ----
  async supplierStatement(supplierId, query) {
    query = query || {};
    if (supplierId === undefined || supplierId === null || String(supplierId).trim() === '') {
      return { error: 'supplierId is required' };
    }
    const strId = String(supplierId).trim();
    const suppliers = await this._readAll(this._suppliersRepo, 'suppliers');
    const supplier = suppliers.find(s => s && String(s.id) === strId) || null;
    if (!supplier || !this._visible(supplier)) return { error: 'Supplier not found' };

    const name = String(supplier.name || '').toLowerCase();
    const rows = [];
    const opening = this._num(supplier.balance);
    if (opening !== 0) {
      rows.push({ date: supplier.createdAt || '', time: supplier.createdAt || '', type: 'opening', reference: 'opening-' + strId, description: 'opening balance', debit: opening > 0 ? opening : 0, credit: opening < 0 ? -opening : 0, running: 0 });
    }

    const purchases = await this._readAll(this._purchasesRepo, 'invoices');
    purchases.forEach(inv => {
      if (!inv || !this._visible(inv)) return;
      const mine = (inv.supplierId !== undefined && inv.supplierId !== null && String(inv.supplierId) === strId) ||
        (name !== '' && String(inv.supplier || inv.supplierName || '').toLowerCase() === name);
      if (!mine) return;
      if (!this._inRange(this._dateOf(inv), query.from, query.to)) return;
      const amount = this._sumInvoice(inv);
      if (this._isCash(inv)) {
        rows.push({ date: this._dayOf(this._dateOf(inv)), time: this._dateOf(inv), type: 'purchase-cash', reference: String(inv.id || ''), description: 'cash purchase (paid)', debit: 0, credit: 0, trace: { purchaseId: String(inv.id || '') } });
        return;
      }
      rows.push({ date: this._dayOf(this._dateOf(inv)), time: this._dateOf(inv), type: 'purchase', reference: String(inv.id || ''), description: 'credit purchase', debit: amount, credit: 0, trace: { purchaseId: String(inv.id || '') } });
    });

    rows.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
    let running = 0;
    rows.forEach(r => { running = this._round2(running + this._num(r.debit) - this._num(r.credit)); r.running = running; });
    return { supplierId: strId, supplierName: supplier.name || '', opening: opening, rows: rows, balance: running, outstanding: Math.max(0, running), from: query.from || null, to: query.to || null };
  }

  // ---------- daily sales (from real posted invoices) ----------------------
  async dailySales(query) {
    query = query || {};
    const days = {};
    const sales = await this._readAll(this._salesRepo, 'invoices');
    sales.forEach(inv => {
      if (!inv || !this._visible(inv)) return;
      const time = this._dateOf(inv);
      const day = this._dayOf(time);
      if (!day) return;
      if (!this._inRange(time, query.from, query.to)) return;
      const bucket = days[day] || (days[day] = this._emptyTotals());
      const total = this._sumInvoice(inv);
      bucket.count += 1;
      bucket.total = this._round2(bucket.total + total);
      if (this._isCash(inv)) { bucket.cashCount += 1; bucket.cashTotal = this._round2(bucket.cashTotal + total); }
      else { bucket.creditCount += 1; bucket.creditTotal = this._round2(bucket.creditTotal + total); }
      (bucket.refs = bucket.refs || []).push(String(inv.id || ''));
    });
    const rows = Object.keys(days).sort().map(day => Object.assign({ date: day }, days[day]));
    const totals = rows.reduce((acc, r) => {
      acc.count += r.count; acc.total = this._round2(acc.total + r.total);
      acc.cashCount += r.cashCount; acc.cashTotal = this._round2(acc.cashTotal + r.cashTotal);
      acc.creditCount += r.creditCount; acc.creditTotal = this._round2(acc.creditTotal + r.creditTotal);
      return acc;
    }, this._emptyTotals());
    return { rows: rows, totals: totals, from: query.from || null, to: query.to || null };
  }

  // ---------- daily purchases ---------------------------------------------
  async dailyPurchases(query) {
    query = query || {};
    const days = {};
    const purchases = await this._readAll(this._purchasesRepo, 'invoices');
    purchases.forEach(inv => {
      if (!inv || !this._visible(inv)) return;
      const time = this._dateOf(inv);
      const day = this._dayOf(time);
      if (!day) return;
      if (!this._inRange(time, query.from, query.to)) return;
      const bucket = days[day] || (days[day] = this._emptyTotals());
      const total = this._sumInvoice(inv);
      bucket.count += 1;
      bucket.total = this._round2(bucket.total + total);
      if (this._isCash(inv)) { bucket.cashCount += 1; bucket.cashTotal = this._round2(bucket.cashTotal + total); }
      else { bucket.creditCount += 1; bucket.creditTotal = this._round2(bucket.creditTotal + total); }
      (bucket.refs = bucket.refs || []).push(String(inv.id || ''));
    });
    const rows = Object.keys(days).sort().map(day => Object.assign({ date: day }, days[day]));
    const totals = rows.reduce((acc, r) => {
      acc.count += r.count; acc.total = this._round2(acc.total + r.total);
      acc.cashCount += r.cashCount; acc.cashTotal = this._round2(acc.cashTotal + r.cashTotal);
      acc.creditCount += r.creditCount; acc.creditTotal = this._round2(acc.creditTotal + r.creditTotal);
      return acc;
    }, this._emptyTotals());
    return { rows: rows, totals: totals, from: query.from || null, to: query.to || null };
  }

  // ---------- cash flow (treasury is the ONLY source; each entry counts once)
  _treasuryCategory(entry) {
    if (!entry || typeof entry !== 'object') return 'manual';
    const source = String(entry.source || '').toLowerCase();
    if (source === 'sale' || entry.saleId !== undefined) return 'sale-receipt';
    if (source === 'customer-payment' || entry.paymentId !== undefined) return 'customer-payment';
    if (source === 'purchase' || entry.purchaseId !== undefined) return 'purchase-payment';
    return 'manual';
  }

  async cashFlow(query) {
    query = query || {};
    const entries = await this._readAll(this._treasuryRepo, 'entries');
    const result = { in: 0, out: 0, net: 0, countIn: 0, countOut: 0, byCategory: {}, rows: [] };
    entries.forEach(e => {
      if (!e || !this._visible(e)) return;
      const time = e.date || e.createdAt || '';
      if (!this._inRange(time, query.from, query.to)) return;
      const amount = this._num(e.amount);
      const type = String(e.type || '').toLowerCase();
      const category = this._treasuryCategory(e);
      const bucket = result.byCategory[category] || (result.byCategory[category] = { in: 0, out: 0, count: 0 });
      if (type === 'in') {
        result.in = this._round2(result.in + amount); result.countIn += 1;
        bucket.in = this._round2(bucket.in + amount); bucket.count += 1;
      } else if (type === 'out') {
        result.out = this._round2(result.out + amount); result.countOut += 1;
        bucket.out = this._round2(bucket.out + amount); bucket.count += 1;
      } else { return; }
      result.rows.push({ date: this._dayOf(time), time: time, type: type, amount: amount, category: category, reference: String(e.id || ''), description: e.desc || '', trace: { saleId: e.saleId, purchaseId: e.purchaseId, paymentId: e.paymentId } });
    });
    result.rows.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
    result.net = this._round2(result.in - result.out);
    return Object.assign(result, { from: query.from || null, to: query.to || null });
  }

  // ---------- inventory summary (from real inventory transactions) ----------
  async inventorySummary(query) {
    query = query || {};
    const perProduct = {};
    const txs = await this._readAll(this._invTxRepo, 'transactions');
    txs.forEach(t => {
      if (!t || !this._visible(t)) return;
      const time = this._dateOf(t);
      if (!this._inRange(time, query.from, query.to)) return;
      const pid = t.productId !== undefined && t.productId !== null ? String(t.productId) : '';
      if (!pid) return;
      const bucket = perProduct[pid] || (perProduct[pid] = { productId: pid, in: 0, out: 0, reversals: 0, net: 0, rows: [] });
      const qty = this._num(t.qty);
      const refType = String(t.refType || '').toLowerCase();
      const type = String(t.type || '').toLowerCase();
      const isReversal = refType.indexOf('reversal') !== -1 || String(t.reason || '').toLowerCase().indexOf('reversal') !== -1;
      if (isReversal) bucket.reversals += 1;
      if (type === 'in') { bucket.in = this._round2(bucket.in + qty); bucket.net = this._round2(bucket.net + qty); }
      else if (type === 'out') { bucket.out = this._round2(bucket.out + qty); bucket.net = this._round2(bucket.net - qty); }
      bucket.rows.push({ date: this._dayOf(time), time: time, type: type, qty: qty, refType: t.refType || null, refId: t.refId || null, stockAfter: t.stockAfter !== undefined ? t.stockAfter : null, reversal: isReversal });
    });

    const products = await this._readAll(this._productsRepo, 'products');
    const rows = Object.keys(perProduct).sort().map(pid => {
      const bucket = perProduct[pid];
      const product = products.find(p => p && (String(p.id) === pid || (p.sku && String(p.sku) === pid) || (p.barcode && String(p.barcode) === pid))) || null;
      bucket.rows.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
      return Object.assign(bucket, {
        productName: product ? (product.name || '') : '',
        currentStock: product && typeof product.stockQty === 'number' ? product.stockQty : null
      });
    });
    const totals = rows.reduce((acc, r) => {
      acc.in = this._round2(acc.in + r.in); acc.out = this._round2(acc.out + r.out);
      acc.reversals += r.reversals; acc.net = this._round2(acc.net + r.net); acc.products += 1;
      return acc;
    }, { in: 0, out: 0, reversals: 0, net: 0, products: 0 });
    return { rows: rows, totals: totals, from: query.from || null, to: query.to || null };
  }
}

module.exports = new FinancialReportsService();