'use strict';

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const BaseRepository = require('../repositories/BaseRepository');
const inventoryRepository = require('../repositories').products;
const txRepository = new BaseRepository('inventoryTransactions');
const orderRepository = new BaseRepository('marketOrders');
const salesRepository = new BaseRepository('sales');
const salesService = require('../services/sales.service');
const marketConfigService = require('./marketConfig.service');
const marketAuthService = require('./marketAuth.service');
const { stockLock } = require('../utils/asyncLock');
const logger = require('../utils/logger');

function _round(n) {
  return Math.round(n * 100) / 100;
}

function _projectOrder(order) {
  return {
    id: order.id,
    orderCode: order.orderCode,
    trackingToken: order.trackingToken,
    tenantId: order.tenantId,
    customerId: order.customerId,
    items: order.items,
    subtotal: order.subtotal,
    discount: order.discount,
    shippingFee: order.shippingFee,
    total: order.total,
    couponCode: order.couponCode,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    status: order.status,
    shippingAddress: order.shippingAddress,
    saleId: order.saleId,
    createdAt: order.createdAt
  };
}

async function _findByIdempotency(tenantId, key) {
  const db = await orderRepository._rawStoreAsync();
  return (db.orders || []).find(
    (o) => String(o.tenantId) === String(tenantId) && o.idempotencyKey === key
  ) || null;
}

// P0-3 — Compensating rollback.
//
// The checkout writes to FOUR stores:
//   W1: products        (decrement stockQty)
//   W2: inventoryTransactions (append 'out' transactions)
//   W3: sales           (create invoice via salesService.create)
//   W4: marketOrders    (push order)
//
// There is no cross-store transaction in the file-based storage.
// If any later write fails, we run best-effort reverse-order compensation
// to restore the earlier successful writes. Compensation errors are
// captured and returned to the caller so the response can indicate that
// the system is in a recovery-required state.
//
// This is NOT a transaction. It is compensating rollback.
//
// The `stage` argument is the number of writes that SUCCEEDED before the
// failure. We must undo writes 1..stage inclusive. The ID gates
// (ctx.createdOrderId, ctx.createdSaleId, ctx.appendedTxIds, ctx.originalStock)
// tell us whether each write actually committed; stage tells us how far
// to attempt. A write that succeeded but has no ID to find will be a
// no-op (e.g., W3 succeeded but createdSaleId is null — should not
// happen, but defended against).
async function _compensate({ stage, ctx }) {
  // stage: number of successful writes BEFORE the failure (0..4).
  const errors = [];

  // W4 — order rollback (newest first)
  if (stage >= 4 && ctx.createdOrderId) {
    try {
      const odb = await orderRepository._rawStoreAsync();
      odb.orders = (odb.orders || []).filter((o) => o.id !== ctx.createdOrderId);
      await orderRepository.writeAsync(odb);
    } catch (e) {
      errors.push('order-rollback: ' + e.message);
      logger.error('marketCheckout compensate W4 failed:', e.message);
    }
  }

  // W3 — sale rollback
  if (stage >= 3 && ctx.createdSaleId) {
    try {
      const sdb = await salesRepository._rawStoreAsync();
      sdb.invoices = (sdb.invoices || []).filter((i) => i.id !== ctx.createdSaleId);
      await salesRepository.writeAsync(sdb);
    } catch (e) {
      errors.push('sale-rollback: ' + e.message);
      logger.error('marketCheckout compensate W3 failed:', e.message);
    }
  }

  // W2 — inventory transactions rollback
  if (stage >= 2 && ctx.appendedTxIds && ctx.appendedTxIds.length) {
    try {
      const tdb = await txRepository._rawStoreAsync();
      const ids = new Set(ctx.appendedTxIds);
      tdb.transactions = (tdb.transactions || []).filter((t) => !ids.has(t.id));
      await txRepository.writeAsync(tdb);
    } catch (e) {
      errors.push('tx-rollback: ' + e.message);
      logger.error('marketCheckout compensate W2 failed:', e.message);
    }
  }

  // W1 — stock restoration
  if (stage >= 1 && ctx.originalStock && Object.keys(ctx.originalStock).length) {
    try {
      const db = await inventoryRepository._rawStoreAsync();
      for (const [productId, qty] of Object.entries(ctx.originalStock)) {
        const p = (db.products || []).find((x) => String(x.id) === String(productId));
        if (p) p.stockQty = qty;
      }
      await inventoryRepository.writeAsync(db);
    } catch (e) {
      errors.push('stock-rollback: ' + e.message);
      logger.error('marketCheckout compensate W1 failed:', e.message);
    }
  }

  return errors;
}

async function processCheckout(input) {
  const {
    tenantId,
    items,
    shippingZoneId,
    paymentMethodId,
    couponCode,
    customerId,
    idempotencyKey,
    shippingAddress,
    customerInfo
  } = input;

  const cfg = marketConfigService.get(tenantId);
  if (!cfg || !cfg.enabled) return { error: 'Market unavailable for tenant', status: 404 };

  if (!Array.isArray(items) || items.length === 0) return { error: 'items are required', status: 400 };

  const cleanItems = [];
  for (const it of items) {
    const productId = String(it.productId || '').trim();
    const qty = Number(it.qty);
    if (!productId) return { error: 'productId is required', status: 400 };
    if (!Number.isInteger(qty) || qty < 1) return { error: 'qty must be a positive integer', status: 400 };
    cleanItems.push({ productId, qty });
  }

  if (idempotencyKey) {
    const existing = await _findByIdempotency(tenantId, idempotencyKey);
    if (existing) return { order: _projectOrder(existing), idempotent: true };
  }

  // P0-1 — Apply the per-tenant product visibility overlay at checkout time.
  // A product the tenant cannot list cannot be purchased, even if the
  // client knows the productId. The visibility check is server-side.
  const allow = marketConfigService.resolveProductVisibility(cfg);
  for (const ci of cleanItems) {
    if (!allow(ci.productId)) {
      return { error: 'Product not available: ' + ci.productId, status: 404 };
    }
  }

  let customer = null;
  if (customerId) {
    customer = marketAuthService.getById(customerId);
    if (!customer || String(customer.tenantId) !== String(tenantId)) {
      return { error: 'Invalid customer', status: 403 };
    }
  }

  const release = await stockLock.acquire();
  // P0-3 — Compensation context. Each stage populates this with what it
  // changed so a failure in a later stage can be reversed. Keys are
  // undefined before the corresponding write; the compensator checks.
  const ctx = {
    tenantId: String(tenantId),
    originalStock: {},        // productId -> pre-decrement stockQty
    appendedTxIds: [],        // inventory transaction IDs we pushed
    createdSaleId: null,      // sales invoice id (string)
    createdOrderId: null      // marketOrders id (string)
  };

  try {
    // ===== W1: products — decrement stock =====
    let byId = new Map();
    const orderLines = [];
    let subtotal = 0;
    let products;
    try {
      const db = await inventoryRepository._rawStoreAsync();
      products = Array.isArray(db.products) ? db.products : [];
      for (const ci of cleanItems) {
        const p = products.find((x) => String(x.id) === ci.productId);
        if (!p) return { error: 'Product not found: ' + ci.productId, status: 404 };
        const stock = Number(p.stockQty) || 0;
        if (stock < ci.qty) return { error: 'Insufficient stock for ' + (p.name || ci.productId), status: 409 };
        const price = marketConfigService.priceFor(p, cfg);
        // P0-3: capture ORIGINAL stock BEFORE mutation, for compensation.
        ctx.originalStock[ci.productId] = stock;
        byId.set(ci.productId, p);
        orderLines.push({
          productId: ci.productId,
          name: p.name,
          qty: ci.qty,
          unitPrice: price,
          lineTotal: _round(price * ci.qty)
        });
        subtotal += price * ci.qty;
      }
      subtotal = _round(subtotal);

      for (const ci of cleanItems) {
        const p = byId.get(ci.productId);
        p.stockQty = (Number(p.stockQty) || 0) - ci.qty;
      }
      const ok = await inventoryRepository.writeAsync(db);
      if (!ok) throw new Error('products store write returned false');
    } catch (err) {
      // No W1 was successfully written, no compensation needed.
      logger.error('marketCheckout W1 failure:', err.message);
      return { error: 'Checkout failed at inventory stage', status: 500 };
    }

    // ===== W2: inventoryTransactions — append 'out' records =====
    try {
      const txDb = await txRepository._rawStoreAsync();
      if (!txDb.transactions) txDb.transactions = [];
      for (const ci of cleanItems) {
        const p = byId.get(ci.productId);
        const txId = uuidv4();
        txDb.transactions.push({
          id: txId,
          productId: ci.productId,
          type: 'out',
          qty: ci.qty,
          stockAfter: Number(p.stockQty) || 0,
          user: 'market',
          reason: 'market-checkout',
          tenantId: String(tenantId),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        ctx.appendedTxIds.push(txId);
      }
      const ok = await txRepository.writeAsync(txDb);
      if (!ok) throw new Error('inventoryTransactions store write returned false');
    } catch (err) {
      // P0-3: W1 succeeded. Compensate by restoring stock.
      const compErrors = await _compensate({ stage: 1, ctx });
      logger.error('marketCheckout W2 failure:', err.message, 'compErrors:', compErrors);
      return {
        error: 'Checkout failed at transactions stage',
        status: 500,
        compensation: { attempted: true, errors: compErrors }
      };
    }

    const coupon = couponCode ? marketConfigService.resolveCoupon(cfg, String(couponCode), subtotal) : null;
    const discount = coupon ? coupon.discount : 0;

    const shipping = marketConfigService.resolveShipping(cfg, shippingZoneId, subtotal);
    const shippingFee = shipping ? shipping.fee : 0;

    const payment = marketConfigService.resolvePayment(cfg, paymentMethodId);
    if (!payment) {
      // P0-3: W1 + W2 succeeded. Compensate both.
      const compErrors = await _compensate({ stage: 2, ctx });
      return {
        error: 'Invalid payment method',
        status: 400,
        compensation: { attempted: true, errors: compErrors }
      };
    }

    const total = _round(subtotal - discount + shippingFee);
    if (total < 0) {
      // P0-3: W1 + W2 succeeded. Compensate both.
      const compErrors = await _compensate({ stage: 2, ctx });
      return {
        error: 'Invalid order total',
        status: 400,
        compensation: { attempted: true, errors: compErrors }
      };
    }

    // ===== W3: sales — create invoice =====
    const invoice = {
      id: 'MKT-' + Date.now().toString().slice(-6) + '-' + uuidv4().slice(0, 4),
      items: orderLines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, price: l.unitPrice })),
      total,
      subtotal,
      discount,
      shippingFee,
      customer: customer ? customer.name : (customerInfo && customerInfo.name) || 'Market Guest',
      customerId: customer ? customer.id : null,
      email: customer ? customer.email : (customerInfo && customerInfo.email) || null,
      payment: payment.id,
      paymentType: payment.type,
      invoiceType: 'market',
      tenantId: String(tenantId),
      status: 'pending',
      date: new Date().toISOString()
    };
    let saleRes;
    try {
      saleRes = await salesService.create(invoice, { tenantId: String(tenantId) });
    } catch (err) {
      const compErrors = await _compensate({ stage: 2, ctx });
      logger.error('marketCheckout W3 (sales) failure:', err.message, 'compErrors:', compErrors);
      return {
        error: 'Checkout failed at sales stage',
        status: 500,
        compensation: { attempted: true, errors: compErrors }
      };
    }
    if (saleRes.error) {
      // salesService.create returned a business-level error. The
      // duplicate-id guard returns a 'Duplicate invoice ID' error
      // BEFORE any write — that is a normal business error (400) and
      // requires no compensation. A 'Failed to persist' error means
      // the sales service's write itself failed — that is an
      // infrastructure error (500) and triggers compensation.
      if (/duplicate invoice id/i.test(saleRes.error)) {
        return { error: saleRes.error, status: 400 };
      }
      const compErrors = await _compensate({ stage: 2, ctx });
      logger.error('marketCheckout W3 (sales) failure:', saleRes.error, 'compErrors:', compErrors);
      return {
        error: 'Checkout failed at sales stage',
        status: 500,
        compensation: { attempted: true, errors: compErrors }
      };
    }
    // P0-2 — Post-write tenant verification. The sales service
    // accepted the invoice and stamped tenantId from the body (which
    // is the trusted tenant). Verify the persisted record carries the
    // expected tenantId. If not, the system has been misconfigured and
    // the order MUST NOT proceed. Compensate and return an error.
    if (!saleRes.invoice || String(saleRes.invoice.tenantId) !== String(tenantId)) {
      const compErrors = await _compensate({ stage: 2, ctx });
      logger.error('marketCheckout W3 tenant mismatch: expected', tenantId, 'got', saleRes.invoice && saleRes.invoice.tenantId);
      return {
        error: 'Checkout failed: sales tenant stamp mismatch',
        status: 500,
        compensation: { attempted: true, errors: compErrors }
      };
    }
    ctx.createdSaleId = saleRes.invoice.id;

    // ===== W4: marketOrders — persist the order =====
    const orderCode = 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const trackingToken = crypto.randomBytes(24).toString('hex');
    const order = {
      id: uuidv4(),
      orderCode,
      trackingToken,
      tenantId: String(tenantId),
      customerId: customer ? customer.id : null,
      customerEmail: customer ? customer.email : (customerInfo && customerInfo.email) || null,
      customerName: customer ? customer.name : (customerInfo && customerInfo.name) || null,
      items: orderLines,
      subtotal,
      discount,
      shippingFee,
      total,
      couponCode: coupon ? coupon.code : null,
      paymentMethod: payment.id,
      paymentStatus: 'pending',
      status: 'received',
      shippingAddress: shippingAddress || null,
      saleId: saleRes.invoice.id,
      idempotencyKey: idempotencyKey || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    try {
      const odb = await orderRepository._rawStoreAsync();
      if (!odb.orders) odb.orders = [];
      odb.orders.push(order);
      const ok = await orderRepository.writeAsync(odb);
      if (!ok) throw new Error('marketOrders store write returned false');
      ctx.createdOrderId = order.id;
    } catch (err) {
      // P0-3: W1 + W2 + W3 succeeded. Compensate all three in reverse.
      const compErrors = await _compensate({ stage: 3, ctx });
      logger.error('marketCheckout W4 failure:', err.message, 'compErrors:', compErrors);
      return {
        error: 'Checkout failed at order persistence stage',
        status: 500,
        compensation: { attempted: true, errors: compErrors }
      };
    }

    return { order: _projectOrder(order) };
  } catch (err) {
    // Last-resort catch (e.g. logic errors above). The catch does NOT
    // compensate — the inner try/catch around each write is the
    // authoritative compensation point. If we reach here, something
    // threw outside a known write, which is a programming error.
    logger.error('marketCheckout.processCheckout outer error:', err.message);
    return { error: 'Checkout failed', status: 500 };
  } finally {
    release();
  }
}

module.exports = { processCheckout };
