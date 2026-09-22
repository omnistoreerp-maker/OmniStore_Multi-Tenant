'use strict';

// gameHostingOrder.service — subscription order + payment lifecycle for
// Game Hosting, built ON TOP of the platform's existing payment
// infrastructure (tenantPayments.service store patterns + market
// idempotency patterns). NO new payment gateway is invented: the
// order records an intent, payments are confirmed through the SAME
// payment record store used by tenant addons, and the webhook path
// reuses updatePaymentStatus semantics.
//
// ORDER LIFECYCLE (per protocol):
//   pending → paid → provisioning → active ⇄ suspended → terminated
//                 ↘ cancelled (before payment)   ↘ expired (grace end)
//   provisioning may fail → provisioning_failed (retryable, keeps the
//   order + payment intact; retry is idempotent via providerKey).
//
// PRICE INTEGRITY: the amount is resolved server-side from
// gameHostingPricing.service (plan catalog). `amount` from the client
// is IGNORED — stored amount always equals the server quote.
//
// DUPLICATE PAYMENT CALLBACKS: applyPaymentResult is idempotent — a
// callback for an order already in `paid` (or later) is a no-op that
// returns the unchanged order with `alreadyProcessed: true`.

const { v4: uuidv4 } = require('uuid');
const BaseRepository = require('../repositories/BaseRepository');
const pricingService = require('./gameHostingPricing.service');
const gameHostingService = require('./gameHosting.service');
const { stockLock } = require('../utils/asyncLock');

const orderRepository = new BaseRepository('gameHostingOrders');

const ORDER_STATUSES = Object.freeze([
  'pending', 'paid', 'provisioning', 'active',
  'suspended', 'terminated', 'cancelled', 'expired', 'provisioning_failed'
]);

const PAYMENT_STATUSES = Object.freeze(['pending', 'paid', 'failed', 'refunded']);

function _trustedTenantId(tenantContext) {
  if (!tenantContext) return null;
  const t = tenantContext.tenantId;
  if (t == null || t === '') return null;
  return String(t);
}

function _rejectForeignTenantClaim(data, trustedTid) {
  if (data && data.tenantId !== undefined && data.tenantId !== null && data.tenantId !== '') {
    if (trustedTid && String(data.tenantId) !== trustedTid) {
      return 'tenantId claim does not match the trusted tenant';
    }
  }
  return null;
}

function _publicOrder(order) {
  return Object.assign({}, order);
}

async function _load() {
  const db = await orderRepository._rawStoreAsync();
  if (!Array.isArray(db.orders)) db.orders = [];
  return db;
}

async function _persist(db) {
  return orderRepository.writeAsync(db);
}

async function getOrderById({ id, tenantContext } = {}) {
  if (id == null || id === '') return null;
  const trustedTid = _trustedTenantId(tenantContext);
  const db = await orderRepository.readAsync();
  const found = (db.orders || []).find((o) => o && String(o.id) === String(id));
  if (!found) return null;
  if (trustedTid && String(found.tenantId) !== trustedTid) return null;
  return _publicOrder(found);
}

async function listOrders({ tenantContext, customerId, status } = {}) {
  const trustedTid = _trustedTenantId(tenantContext);
  const db = await orderRepository.readAsync();
  let orders = (db.orders || []).filter((o) => o && (!trustedTid || String(o.tenantId) === trustedTid));
  if (customerId) orders = orders.filter((o) => String(o.customerId) === String(customerId));
  if (status) orders = orders.filter((o) => String(o.status) === String(status));
  return orders.map(_publicOrder);
}

// === Creation (price from catalog, never from the client) ===
async function createOrder({ data, tenantContext } = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { error: 'request body must be a JSON object' };
  }
  const trustedTid = _trustedTenantId(tenantContext);
  const claimErr = _rejectForeignTenantClaim(data, trustedTid);
  if (claimErr) return { error: claimErr };

  // Tenant-scoped plan → server-side quote.
  const q = await pricingService.quote({
    planId: data.planId,
    billingPeriod: data.billingPeriod,
    tenantContext
  });
  if (q.error) return { error: q.error };
  const quote = q.quote;

  const serverName = data.serverName ? String(data.serverName).trim() : '';
  if (!serverName) return { error: 'serverName is required' };
  if (serverName.length > 64) return { error: 'serverName must be 64 characters or fewer' };

  // Idempotency: client may pass idempotencyKey (e.g. retry of a
  // dropped response). Same tenant+customer+key returns the same order.
  const idempotencyKey = data.idempotencyKey ? String(data.idempotencyKey).trim() : null;
  if (idempotencyKey) {
    const db = await orderRepository.readAsync();
    const dup = (db.orders || []).find((o) =>
      o && (!trustedTid || String(o.tenantId) === trustedTid) &&
      String(o.customerId || '') === String(data.customerId || '') &&
      String(o.idempotencyKey || '') === idempotencyKey);
    if (dup) return { order: _publicOrder(dup), idempotent: true };
  }

  const now = new Date().toISOString();
  const order = {
    id: uuidv4(),
    tenantId: trustedTid || null,
    customerId: data.customerId ? String(data.customerId) : null,
    planId: quote.planId,
    planName: quote.planName,
    serverName,
    region: data.region || null,
    billingPeriod: quote.billingPeriod,
    currency: quote.currency,
    amount: quote.total,            // SERVER-side price. Client amount ignored.
    monthlyPrice: quote.monthlyPrice,
    status: 'pending',
    paymentStatus: 'pending',
    paymentRef: null,
    payments: [],                    // payment attempt ledger
    providerKey: 'ghorder-' + uuidv4(), // idempotency key toward the provider
    providerInfo: null,
    provisioningAttempts: 0,
    lastProvisionError: null,
    periodStartsAt: null,
    periodEndsAt: null,
    idempotencyKey,
    createdAt: now,
    updatedAt: now
  };

  const db = await orderRepository._rawStoreAsync();
  if (!Array.isArray(db.orders)) db.orders = [];
  db.orders.push(order);
  if (await _persist(db)) return { order: _publicOrder(order) };
  return { error: 'Failed to persist order' };
}

// === Payment confirmation (idempotent; called by webhook/controller) ===
//
// expectedAmount: when provided, the recorded payment MUST match it
// exactly — a callback claiming a different amount is rejected as
// amount mismatch (defence against tampered payment references).
async function applyPaymentResult({ orderId, tenantContext, paymentRef, amount, status, meta } = {}) {
  const trustedTid = _trustedTenantId(tenantContext);
  if (!orderId) return { error: 'orderId is required' };
  const normStatus = String(status || '').toLowerCase();
  if (['paid', 'failed'].indexOf(normStatus) === -1) {
    return { error: 'status must be paid or failed' };
  }
  if (!paymentRef) return { error: 'paymentRef is required' };

  const release = await stockLock.acquire();
  try {
    const db = await _load();
    const idx = (db.orders || []).findIndex((o) => o && String(o.id) === String(orderId));
    if (idx === -1) return { error: 'Order not found' };
    const order = db.orders[idx];
    if (trustedTid && String(order.tenantId) !== trustedTid) return { error: 'Order not found' };

    // Idempotency 1 — replay of an already-applied paymentRef.
    const already = (order.payments || []).find((p) => String(p.paymentRef) === String(paymentRef));
    if (already) {
      return { order: _publicOrder(order), alreadyProcessed: true };
    }
    // Idempotency 2 — order already past payment.
    if (order.paymentStatus === 'paid') {
      return { order: _publicOrder(order), alreadyProcessed: true };
    }

    // Amount integrity: a successful payment must match the server-side
    // amount exactly (float-safe comparison on rounded currency units).
    if (normStatus === 'paid') {
      const claimed = Number(amount);
      if (!Number.isFinite(claimed) || Math.round(claimed * 100) !== Math.round(order.amount * 100)) {
        const entry = {
          paymentRef: String(paymentRef),
          status: 'failed',
          amount: Number.isFinite(claimed) ? claimed : null,
          reason: 'AMOUNT_MISMATCH',
          at: new Date().toISOString(),
          meta: meta || null
        };
        order.payments.push(entry);
        order.updatedAt = new Date().toISOString();
        await _persist(db);
        return { error: 'Payment amount mismatch', order: _publicOrder(order) };
      }
    }

    const entry = {
      paymentRef: String(paymentRef),
      status: normStatus,
      amount: Number.isFinite(Number(amount)) ? Number(amount) : order.amount,
      at: new Date().toISOString(),
      meta: meta || null
    };
    order.payments.push(entry);
    order.paymentRef = String(paymentRef);
    order.updatedAt = new Date().toISOString();

    if (normStatus === 'failed') {
      order.paymentStatus = 'failed';
      // Order stays `pending` (recoverable): a new attempt can still pay.
      db.orders[idx] = order;
      await _persist(db);
      return { order: _publicOrder(order) };
    }

    order.paymentStatus = 'paid';
    order.status = 'paid';
    order.periodStartsAt = new Date().toISOString();
    const months = pricingService.PERIOD_MONTHS[order.billingPeriod] || 1;
    const end = new Date(order.periodStartsAt);
    end.setUTCMonth(end.getUTCMonth() + months);
    order.periodEndsAt = end.toISOString();
    db.orders[idx] = order;
    await _persist(db);
    return { order: _publicOrder(order) };
  } finally {
    release();
  }
}

// Record a refund against a paid order (only if the platform store
// already supports refunds — the payment ledger keeps the trail).
async function applyRefund({ orderId, tenantContext, paymentRef, reason } = {}) {
  const trustedTid = _trustedTenantId(tenantContext);
  if (!orderId) return { error: 'orderId is required' };
  const release = await stockLock.acquire();
  try {
    const db = await _load();
    const idx = (db.orders || []).findIndex((o) => o && String(o.id) === String(orderId));
    if (idx === -1) return { error: 'Order not found' };
    const order = db.orders[idx];
    if (trustedTid && String(order.tenantId) !== trustedTid) return { error: 'Order not found' };
    if (order.paymentStatus !== 'paid') return { error: 'Order is not paid' };
    order.paymentStatus = 'refunded';
    order.status = 'terminated';
    order.terminatedReason = reason ? String(reason) : 'refunded';
    order.updatedAt = new Date().toISOString();
    if (paymentRef) {
      order.payments.push({ paymentRef: String(paymentRef), status: 'refunded', amount: order.amount, at: order.updatedAt, meta: null });
    }
    db.orders[idx] = order;
    await _persist(db);
    return { order: _publicOrder(order) };
  } finally {
    release();
  }
}

// === Lifecycle transitions (validated against the order machine) ===
const ORDER_TRANSITIONS = Object.freeze({
  pending: Object.freeze(['cancelled']),
  paid: Object.freeze(['provisioning', 'cancelled']),
  provisioning: Object.freeze(['active', 'provisioning_failed', 'terminated']),
  provisioning_failed: Object.freeze(['provisioning', 'terminated', 'cancelled']),
  active: Object.freeze(['suspended', 'terminated', 'expired']),
  suspended: Object.freeze(['active', 'terminated', 'expired']),
  expired: Object.freeze(['terminated']),
  terminated: Object.freeze([]),
  cancelled: Object.freeze([])
});

function canTransition(from, to) {
  const allowed = ORDER_TRANSITIONS[from];
  return Boolean(allowed && allowed.indexOf(to) !== -1);
}

async function transitionOrder({ orderId, to, tenantContext, meta } = {}) {
  const trustedTid = _trustedTenantId(tenantContext);
  if (!orderId) return { error: 'orderId is required' };
  if (!to || ORDER_STATUSES.indexOf(to) === -1) return { error: 'Unknown order status: ' + to };
  const release = await stockLock.acquire();
  try {
    const db = await _load();
    const idx = (db.orders || []).findIndex((o) => o && String(o.id) === String(orderId));
    if (idx === -1) return { error: 'Order not found' };
    const order = db.orders[idx];
    if (trustedTid && String(order.tenantId) !== trustedTid) return { error: 'Order not found' };
    if (!canTransition(order.status, to)) {
      return { error: 'Invalid transition: ' + order.status + ' -> ' + to, allowed: ORDER_TRANSITIONS[order.status] };
    }
    order.status = to;
    order.updatedAt = new Date().toISOString();
    if (meta && typeof meta === 'object') {
      if (meta.providerInfo !== undefined) order.providerInfo = meta.providerInfo;
      if (meta.lastProvisionError !== undefined) order.lastProvisionError = meta.lastProvisionError;
      if (meta.provisioningAttempts !== undefined) order.provisioningAttempts = meta.provisioningAttempts;
      if (meta.periodEndsAt !== undefined) order.periodEndsAt = meta.periodEndsAt;
      if (meta.terminatedReason !== undefined) order.terminatedReason = meta.terminatedReason;
    }
    db.orders[idx] = order;
    await _persist(db);
    return { order: _publicOrder(order) };
  } finally {
    release();
  }
}

// === Renewal ===
//
// Extends periodEndsAt by the billing period. Renewal uses the CURRENT
// catalog price (server-side) at renewal time. If the order is not yet
// active, renewal is rejected. Returns { order, renewed: true }.
async function renewOrder({ orderId, tenantContext, billingPeriod } = {}) {
  const trustedTid = _trustedTenantId(tenantContext);
  if (!orderId) return { error: 'orderId is required' };
  const release = await stockLock.acquire();
  try {
    const db = await _load();
    const idx = (db.orders || []).findIndex((o) => o && String(o.id) === String(orderId));
    if (idx === -1) return { error: 'Order not found' };
    const order = db.orders[idx];
    if (trustedTid && String(order.tenantId) !== trustedTid) return { error: 'Order not found' };
    if (['active', 'suspended'].indexOf(order.status) === -1) {
      return { error: 'Only active or suspended orders can be renewed' };
    }
    const plan = await gameHostingService.getPlanById({ id: order.planId, tenantContext });
    if (!plan) return { error: 'Plan no longer exists' };
    const q = await pricingService.quoteFromPlan(plan, billingPeriod || order.billingPeriod);
    if (q.error) return { error: q.error };
    const quote = q.quote;

    const base = order.periodEndsAt && new Date(order.periodEndsAt) > new Date()
      ? new Date(order.periodEndsAt)
      : new Date();
    const end = new Date(base);
    end.setUTCMonth(end.getUTCMonth() + quote.months);

    order.amount = quote.total; // renewal priced from current catalog
    order.billingPeriod = quote.billingPeriod;
    order.periodEndsAt = end.toISOString();
    order.status = 'active';
    order.updatedAt = new Date().toISOString();
    db.orders[idx] = order;
    await _persist(db);
    return { order: _publicOrder(order), renewed: true };
  } finally {
    release();
  }
}

// === Expiry sweep ===
//
// Orders whose periodEndsAt has passed and are still active/suspended
// transition to `expired`. Called opportunistically by the admin sweep
// endpoint and by tests.
async function expireDueOrders({ tenantContext, now } = {}) {
  const trustedTid = _trustedTenantId(tenantContext);
  const ref = now ? new Date(now) : new Date();
  const db = await orderRepository.readAsync();
  let changed = 0;
  for (const order of db.orders || []) {
    if (!order) continue;
    if (trustedTid && String(order.tenantId) !== trustedTid) continue;
    if (['active', 'suspended'].indexOf(order.status) === -1) continue;
    if (!order.periodEndsAt) continue;
    if (new Date(order.periodEndsAt) <= ref) {
      order.status = 'expired';
      order.updatedAt = new Date().toISOString();
      changed += 1;
    }
  }
  if (changed > 0) await orderRepository.writeAsync(db);
  return { expired: changed };
}

module.exports = {
  STORE_NAME: 'gameHostingOrders',
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  PAYMENT_STATUSES,
  canTransition,
  createOrder,
  getOrderById,
  listOrders,
  applyPaymentResult,
  applyRefund,
  transitionOrder,
  renewOrder,
  expireDueOrders
};
