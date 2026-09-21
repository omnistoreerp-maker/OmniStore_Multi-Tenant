'use strict';

// DAY 2 — PURCHASE POSTING WORKFLOW (ERP core cycle, mirror of Day 1 Sales).
//
// Turns a purchase invoice into a real business transaction:
//   1. PLAN    — items referencing an existing product (by id / sku /
//                barcode) with a numeric stockQty are validated: a present
//                but non-positive / non-numeric qty rejects the purchase
//                BEFORE any persistence (byte-identical stores).
//   2. APPLY   — stockQty is INCREASED, an inventoryTransactions "in" audit
//                record is written per received line, and a treasury "out"
//                entry is created for CASH purchases, linked via purchaseId.
//   3. REPOST  — updating a posted purchase reverses the OLD posting fully,
//                then posts the merged invoice (no double posting).
//   4. REVERSE — deleting a posted purchase removes the added stock, writes
//                a "purchase-reversal" inventory transaction, and removes
//                the linked treasury entry.
//
// Supplier balance follows the EXISTING model: supplier debt is derived as
// opening balance + credit(ajel) purchase invoices - payments (see
// DigiTronics_v5.html getSupplierBalance). Mutating supplier.balance on a
// credit purchase would DOUBLE-COUNT the debt, so this workflow deliberately
// never touches it — the credit invoice itself IS the balance effect, and
// reversing/deleting the invoice removes the debt automatically.
//
// Isolation contract (mirrors SalePosting / Treasury / InventoryTransactions):
//   - tenantId/branchId on generated records is stamped from the persisted
//     invoice (server-side values), never from client-only fields;
//   - writes load the RAW store and save it back UNFILTERED;
//   - invoices without postedEffects keep the exact legacy behaviour.

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

// Purchases RECEIVE stock: a line that references a real product must carry
// a valid positive qty. Missing qty stays exempt (legacy/service lines);
// a present but invalid qty is a validation error (no partial write).
function readItemQty(item) {
  const raw = item.qty !== undefined && item.qty !== null ? item.qty : item.quantity;
  if (raw === undefined || raw === null || raw === '') return { skip: true };
  const q = Number(raw);
  if (!Number.isFinite(q) || q <= 0) return { error: true, raw: raw };
  return { qty: q };
}

function isCashPayment(invoice) {
  const p = String(invoice.payment || invoice.paymentType || invoice.invoiceType || 'cash').toLowerCase();
  return p === 'cash' || p === '\u0646\u0642\u062f\u064a' || p === '\u0643\u0627\u0634';
}

class PurchasePostingService {
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

  // Aggregate received quantities per resolvable product. Duplicate lines of
  // the same product are summed once. Pure read+validate: never writes.
  async planAdditions(invoice) {
    const items = Array.isArray(invoice && invoice.items) ? invoice.items : [];
    const db = await this._loadProductsRaw();
    const wanted = new Map();
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const key = itemProductKey(item);
      if (!key) continue;
      const product = this._findProduct(db, key);
      if (!product || typeof product.stockQty !== 'number') continue;
      const qr = readItemQty(item);
      if (qr.error) {
        const label = product.name || product.id;
        return { error: 'Invalid qty for product "' + label + '": ' + String(qr.raw) };
      }
      if (qr.skip) continue;
      const pid = norm(product.id);
      const entry = wanted.get(pid) || { product: product, qty: 0 };
      entry.qty += qr.qty;
      wanted.set(pid, entry);
    }
    const additions = [];
    for (const entry of wanted.values()) {
      additions.push({ productId: entry.product.id, qty: entry.qty, stockBefore: Number(entry.product.stockQty) || 0 });
    }
    return { additions: additions };
  }

  // Applies the posting for a newly created (or reposted) purchase invoice.
  // Returns { posted, summary }; summary is stored on the invoice as
  // postedEffects so update/delete can reverse exactly what was posted.
  async applyOnCreate(invoice, tenantContext) {
    const plan = await this.planAdditions(invoice);
    if (plan.error) return { error: plan.error };
    const additions = plan.additions;

    const now = new Date().toISOString();
    const summary = {
      posted: true,
      kind: 'purchase',
      at: now,
      tenantId: invoice.tenantId !== undefined ? invoice.tenantId : undefined,
      branchId: invoice.branchId !== undefined ? invoice.branchId : undefined,
      additions: [],
      treasuryEntryId: null
    };

    if (additions.length) {
      const db = await this._loadProductsRaw();
      for (const a of additions) {
        const product = this._findProduct(db, a.productId);
        if (!product || typeof product.stockQty !== 'number') continue;
        const before = Number(product.stockQty) || 0;
        product.stockQty = before + a.qty;
        product.updatedAt = now;
        summary.additions.push({ productId: product.id, qty: a.qty, stockBefore: before, stockAfter: product.stockQty });
      }
      if (!(await productsRepo.writeAsync(db))) {
        return { error: 'Failed to persist stock addition' };
      }

      const txRaw = await invTxRepo._rawStoreAsync();
      const txStore = txRaw && typeof txRaw === 'object' ? txRaw : { transactions: [] };
      if (!Array.isArray(txStore.transactions)) txStore.transactions = [];
      for (const a of summary.additions) {
        txStore.transactions.push(this._stampTenantBranch({
          id: uuidv4(),
          productId: String(a.productId),
          type: 'in',
          qty: a.qty,
          stockAfter: a.stockAfter,
          refType: 'purchase',
          refId: String(invoice.id),
          date: invoice.date || now,
          createdAt: now,
          updatedAt: now
        }, invoice, tenantContext));
      }
      if (!(await invTxRepo.writeAsync(txStore))) {
        logger.error('purchasePosting: failed to persist inventory transactions for purchase', invoice.id);
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
          type: 'out',
          amount: amount,
          date: invoice.date || now,
          method: 'cash',
          desc: 'Purchase invoice ' + invoice.id,
          source: 'purchase',
          purchaseId: String(invoice.id),
          createdAt: now,
          updatedAt: now
        }, invoice, tenantContext);
        tStore.entries.push(entry);
        if (await treasuryRepo.writeAsync(tStore)) {
          summary.treasuryEntryId = entry.id;
        } else {
          logger.error('purchasePosting: failed to persist treasury entry for purchase', invoice.id);
        }
      }
    }

    return { posted: true, summary: summary };
  }

  // Reverses a previously posted purchase (delete + update-repost +
  // create-failure rollback). Only acts on a posted summary.
  async rollback(summary, invoice) {
    if (!summary || !summary.posted) return { reverted: false };
    const now = new Date().toISOString();
    const refId = String(invoice && invoice.id !== undefined && invoice.id !== null ? invoice.id : '');

    if (Array.isArray(summary.additions) && summary.additions.length) {
      const db = await this._loadProductsRaw();
      for (const a of summary.additions) {
        const product = this._findProduct(db, a.productId);
        if (!product || typeof product.stockQty !== 'number') continue;
        product.stockQty = (Number(product.stockQty) || 0) - a.qty;
        product.updatedAt = now;
        a.stockAfter = product.stockQty;
      }
      if (!(await productsRepo.writeAsync(db))) {
        logger.error('purchasePosting: failed to restore stock for purchase', refId);
      }

      const txRaw = await invTxRepo._rawStoreAsync();
      const txStore = txRaw && typeof txRaw === 'object' ? txRaw : { transactions: [] };
      if (!Array.isArray(txStore.transactions)) txStore.transactions = [];
      for (const a of summary.additions) {
        const tx = {
          id: uuidv4(),
          productId: String(a.productId),
          type: 'out',
          qty: a.qty,
          refType: 'purchase-reversal',
          refId: refId,
          date: now,
          createdAt: now,
          updatedAt: now
        };
        if (typeof a.stockAfter === 'number') tx.stockAfter = a.stockAfter;
        if (summary.tenantId !== undefined && summary.tenantId !== null) tx.tenantId = String(summary.tenantId);
        if (summary.branchId !== undefined && summary.branchId !== null) tx.branchId = summary.branchId;
        txStore.transactions.push(tx);
      }
      if (!(await invTxRepo.writeAsync(txStore))) {
        logger.error('purchasePosting: failed to persist reversal transactions for purchase', refId);
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
          logger.error('purchasePosting: failed to remove treasury entry for purchase', refId);
        }
      }
    }

    return { reverted: true };
  }
}

module.exports = new PurchasePostingService();