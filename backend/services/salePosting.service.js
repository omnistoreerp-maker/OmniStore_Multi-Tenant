'use strict';

// DAY 1 — SALES POSTING WORKFLOW (ERP core cycle).
//
// Turns a sales invoice into a real business transaction instead of an
// isolated record. When a sale is created through SalesService:
//   1. PLAN    — items referencing an existing product (by id / sku /
//                barcode) with a numeric stockQty are validated for stock
//                sufficiency. Insufficient stock rejects the sale BEFORE any
//                persistence (store stays byte-identical).
//   2. APPLY   — stockQty is decremented, an inventoryTransactions "out"
//                audit record is written per deducted line, and a treasury
//                "in" entry is created for CASH payments, linked via saleId.
//   3. REVERSE — deleting a posted sale restores stock, writes an "in"
//                reversal transaction, and removes the linked treasury entry.
//
// Isolation contract (mirrors Sales / Treasury / InventoryTransactions):
//   - tenantId/branchId on every generated record is stamped from the
//     persisted invoice (server-side values), never from client-only fields.
//   - writes always load the RAW store and save it back UNFILTERED, so other
//     tenants' records are never dropped from the shared document.
//   - legacy behaviour is preserved: items that do not resolve to a product
//     simply produce no stock movement (existing suites rely on this), and
//     invoices without postedEffects delete exactly as before.

const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const productsRepo = require('../repositories').products;
const invTxRepo = require('../repositories').inventoryTransactions;
const treasuryRepo = require('../repositories').treasury;

function norm(v) { return String(v).trim(); }

function itemProductKey(item) {
  const key = item.productId !== undefined && item.productId !== null ? item.productId
    : item.id !== undefined && item.id !== null ? item.id
    : item.sku !== undefined && item.sku !== null ? item.sku
    : item.barcode !== undefined && item.barcode !== null ? item.barcode
    : null;
  if (key === null) return null;
  const k = norm(key);
  return k === '' ? null : k;
}

function itemQty(item) {
  const q = Number(item.qty !== undefined && item.qty !== null ? item.qty : item.quantity);
  return Number.isFinite(q) && q > 0 ? q : null;
}

function isCashPayment(invoice) {
  const p = String(invoice.payment || invoice.paymentType || invoice.invoiceType || 'cash').toLowerCase();
  return p === 'cash' || p === '\u0646\u0642\u062f\u064a' || p === '\u0643\u0627\u0634';
}

class SalePostingService {
  async _loadProductsRaw() {
    const db = await productsRepo._rawStoreAsync();
    if (!db || typeof db !== 'object') return { products: [] };
    if (!Array.isArray(db.products)) db.products = [];
    return db;
  }

  _findProduct(db, key) {
    const k = norm(key);
    if (!k) return null;
    return (db.products || []).find(p =>
      (p.id !== undefined && p.id !== null && norm(p.id) === k) ||
      (p.sku && norm(p.sku) === k) ||
      (p.barcode && norm(p.barcode) === k)
    ) || null;
  }

  _stampTenantBranch(record, invoice, tenantContext) {
    const tenantId = invoice.tenantId !== undefined && invoice.tenantId !== null && invoice.tenantId !== ''
      ? invoice.tenantId
      : (tenantContext && tenantContext.tenantId != null ? tenantContext.tenantId : undefined);
    if (tenantId !== undefined) record.tenantId = String(tenantId);
    if (invoice.branchId !== undefined && invoice.branchId !== null && invoice.branchId !== '') {
      record.branchId = invoice.branchId;
    }
    return record;
  }

  // Aggregate requested quantities per resolvable product. Items without a
  // resolvable product, without a positive numeric qty, or whose product has
  // no numeric stockQty are exempt (legacy/service items).
  async planDeductions(invoice) {
    const items = Array.isArray(invoice && invoice.items) ? invoice.items : [];
    const db = await this._loadProductsRaw();
    const wanted = new Map();
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const key = itemProductKey(item);
      const qty = itemQty(item);
      if (!key || qty === null) continue;
      const product = this._findProduct(db, key);
      if (!product || typeof product.stockQty !== 'number') continue;
      const pid = norm(product.id);
      const entry = wanted.get(pid) || { product, qty: 0 };
      entry.qty += qty;
      wanted.set(pid, entry);
    }
    const deductions = [];
    for (const { product, qty } of wanted.values()) {
      const available = Number(product.stockQty) || 0;
      if (qty > available) {
        const label = product.name || product.id;
        return { error: 'Insufficient stock for product "' + label + '": available ' + available + ', requested ' + qty };
      }
      deductions.push({ productId: product.id, qty, stockBefore: available });
    }
    return { deductions };
  }

  // Applies the posting for a newly created invoice. Returns
  // { posted, summary } where summary is stored on the invoice as
  // postedEffects so delete() can reverse exactly what was posted.
  async applyOnCreate(invoice, tenantContext) {
    const plan = await this.planDeductions(invoice);
    if (plan.error) return { error: plan.error };
    const deductions = plan.deductions;

    const now = new Date().toISOString();
    const summary = {
      posted: true,
      at: now,
      tenantId: invoice.tenantId !== undefined ? invoice.tenantId : undefined,
      branchId: invoice.branchId !== undefined ? invoice.branchId : undefined,
      deductions: [],
      treasuryEntryId: null
    };

    if (deductions.length) {
      const db = await this._loadProductsRaw();
      for (const d of deductions) {
        const product = this._findProduct(db, d.productId);
        if (!product || typeof product.stockQty !== 'number') continue;
        const before = Number(product.stockQty) || 0;
        if (d.qty > before) {
          const label = product.name || product.id;
          return { error: 'Insufficient stock for product "' + label + '": available ' + before + ', requested ' + d.qty };
        }
        product.stockQty = before - d.qty;
        product.updatedAt = now;
        summary.deductions.push({ productId: product.id, qty: d.qty, stockBefore: before, stockAfter: product.stockQty });
      }
      if (!(await productsRepo.writeAsync(db))) {
        return { error: 'Failed to persist stock deduction' };
      }

      const txRaw = await invTxRepo._rawStoreAsync();
      const txStore = txRaw && typeof txRaw === 'object' ? txRaw : { transactions: [] };
      if (!Array.isArray(txStore.transactions)) txStore.transactions = [];
      for (const d of summary.deductions) {
        txStore.transactions.push(this._stampTenantBranch({
          id: uuidv4(),
          productId: String(d.productId),
          type: 'out',
          qty: d.qty,
          stockAfter: d.stockAfter,
          refType: 'sale',
          refId: String(invoice.id),
          date: invoice.date || now,
          createdAt: now,
          updatedAt: now
        }, invoice, tenantContext));
      }
      if (!(await invTxRepo.writeAsync(txStore))) {
        logger.error('salePosting: failed to persist inventory transactions for sale', invoice.id);
      }
    }

    if (isCashPayment(invoice)) {
      const amount = Number(invoice.total) || 0;
      if (amount > 0) {
        const tRaw = await treasuryRepo._rawStoreAsync();
        const tStore = tRaw && typeof tRaw === 'object' ? tRaw : { entries: [] };
        if (!Array.isArray(tStore.entries)) tStore.entries = [];
        const entry = this._stampTenantBranch({
          id: uuidv4(),
          type: 'in',
          amount: amount,
          date: invoice.date || now,
          method: 'cash',
          desc: 'Sale invoice ' + invoice.id,
          source: 'sale',
          saleId: String(invoice.id),
          createdAt: now,
          updatedAt: now
        }, invoice, tenantContext);
        tStore.entries.push(entry);
        if (await treasuryRepo.writeAsync(tStore)) {
          summary.treasuryEntryId = entry.id;
        } else {
          logger.error('salePosting: failed to persist treasury entry for sale', invoice.id);
        }
      }
    }

    return { posted: true, summary: summary };
  }

  // Reverses a previously posted sale (used by sale delete and by the
  // create-failure rollback). Only acts on a posted summary; invoices
  // without postedEffects keep the legacy delete behaviour.
  async rollback(summary, invoice) {
    if (!summary || !summary.posted) return { reverted: false };
    const now = new Date().toISOString();
    const refId = String(invoice && invoice.id !== undefined && invoice.id !== null ? invoice.id : '');

    if (Array.isArray(summary.deductions) && summary.deductions.length) {
      const db = await this._loadProductsRaw();
      for (const d of summary.deductions) {
        const product = this._findProduct(db, d.productId);
        if (!product || typeof product.stockQty !== 'number') continue;
        product.stockQty = (Number(product.stockQty) || 0) + d.qty;
        product.updatedAt = now;
        d.stockAfter = product.stockQty;
      }
      if (!(await productsRepo.writeAsync(db))) {
        logger.error('salePosting: failed to restore stock for sale', refId);
      }

      const txRaw = await invTxRepo._rawStoreAsync();
      const txStore = txRaw && typeof txRaw === 'object' ? txRaw : { transactions: [] };
      if (!Array.isArray(txStore.transactions)) txStore.transactions = [];
      for (const d of summary.deductions) {
        const tx = {
          id: uuidv4(),
          productId: String(d.productId),
          type: 'in',
          qty: d.qty,
          refType: 'sale-reversal',
          refId: refId,
          date: now,
          createdAt: now,
          updatedAt: now
        };
        if (typeof d.stockAfter === 'number') tx.stockAfter = d.stockAfter;
        if (summary.tenantId !== undefined && summary.tenantId !== null) tx.tenantId = String(summary.tenantId);
        if (summary.branchId !== undefined && summary.branchId !== null) tx.branchId = summary.branchId;
        txStore.transactions.push(tx);
      }
      if (!(await invTxRepo.writeAsync(txStore))) {
        logger.error('salePosting: failed to persist reversal transactions for sale', refId);
      }
    }

    if (summary.treasuryEntryId) {
      const tRaw = await treasuryRepo._rawStoreAsync();
      const tStore = tRaw && typeof tRaw === 'object' ? tRaw : { entries: [] };
      if (!Array.isArray(tStore.entries)) tStore.entries = [];
      const idx = tStore.entries.findIndex(e => norm(e.id) === norm(summary.treasuryEntryId));
      if (idx !== -1) {
        tStore.entries.splice(idx, 1);
        if (!(await treasuryRepo.writeAsync(tStore))) {
          logger.error('salePosting: failed to remove treasury entry for sale', refId);
        }
      }
    }

    return { reverted: true };
  }
}

module.exports = new SalePostingService();