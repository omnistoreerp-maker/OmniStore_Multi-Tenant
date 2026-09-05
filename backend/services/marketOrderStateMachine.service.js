'use strict';

// marketOrderStateMachine.service — Phase M2 Order State Machine.
//
// The Market's order lifecycle is a state machine with a single
// customer-actionable transition. The repository evidence is:
//
//   M0 audit / M1 implementation: orders are created at checkout
//     with status: 'received' and paymentStatus: 'pending'. Status
//     is never modified by any existing endpoint.
//
// The Market currently has NO update/cancel/transition endpoint.
// M2 adds the minimum viable state machine:
//
//   - INITIAL_STATE = 'received' (the value used at order creation;
//     preserving the existing data model).
//   - TERMINAL_STATES = ['cancelled'] (no further transitions).
//   - Allowed customer transition: received -> cancelled.
//   - Allowed admin/system transition: none in V1 (the admin
//     surface is out of scope for M2).
//
// Any state, transition, or feature not supported by repository
// evidence (e.g., 'processing', 'shipped', 'delivered', 'paid',
// 'failed', 'confirmed') is EXPLICITLY not added. The Market has
// no fulfillment engine, no shipping module, and no online payment
// provider; those states would be aspirational without an engine
// to drive them.
//
// SECURITY:
//   - The state machine is the ONLY authoritative source for order
//     status transitions. A client CANNOT set status by sending it
//     in a request body.
//   - The cancel endpoint enforces tenant + customer ownership from
//     the trusted server context (req.marketTenant, req.customer.id).
//     Foreign order ids return null (not 403) so existence is not
//     leaked.
//   - The state machine performs no network I/O and no storage
//     directly. It owns the cancel flow (load, validate, mutate,
//     save) and delegates the actual store read/write to the
//     existing marketOrders BaseRepository, matching the pattern
//     of every other Market service.

const BaseRepository = require('../repositories/BaseRepository');
const { v4: uuidv4 } = require('uuid');
const orderRepository = new BaseRepository('marketOrders');
const productsRepository = new BaseRepository('products');
const inventoryTxRepository = new BaseRepository('inventoryTransactions');

// === States ===
// V1 supports exactly two order states and two payment states.
// Anything not in this list is rejected as an unknown state.

const ORDER_STATES = Object.freeze(['received', 'cancelled']);
const INITIAL_ORDER_STATE = 'received';
const TERMINAL_ORDER_STATES = Object.freeze(['cancelled']);

const PAYMENT_STATES = Object.freeze(['pending', 'cancelled']);
const INITIAL_PAYMENT_STATE = 'pending';

// === Transition matrix (V1) ===
//
// Map of allowed transitions from -> [to]. Any (from, to) not in
// this map is rejected. The customer-initiated cancel is the only
// V1 transition. Admin/system transitions are not added because
// no admin surface exists in the Market.

const ALLOWED_TRANSITIONS = Object.freeze({
  received: Object.freeze(['cancelled']),
  cancelled: Object.freeze([])
});

// === Pure helpers ===

function isValidOrderState(s) {
  return ORDER_STATES.indexOf(s) !== -1;
}

function isTerminalOrderState(s) {
  return TERMINAL_ORDER_STATES.indexOf(s) !== -1;
}

function isValidPaymentState(s) {
  return PAYMENT_STATES.indexOf(s) !== -1;
}

function getAllowedTransitions(from) {
  if (!isValidOrderState(from)) return [];
  return ALLOWED_TRANSITIONS[from].slice();
}

function canTransition(from, to) {
  if (!isValidOrderState(from) || !isValidOrderState(to)) return false;
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.indexOf(to) !== -1;
}

function validateTransition(from, to) {
  if (from == null || to == null) {
    return { error: 'from and to are required' };
  }
  if (typeof from !== 'string' || typeof to !== 'string') {
    return { error: 'from and to must be strings' };
  }
  if (!isValidOrderState(from)) {
    return { error: 'Unknown source state: ' + from };
  }
  if (!isValidOrderState(to)) {
    return { error: 'Unknown target state: ' + to };
  }
  if (isTerminalOrderState(from)) {
    return { error: 'Cannot transition from terminal state: ' + from };
  }
  if (!canTransition(from, to)) {
    return {
      error: 'Invalid transition: ' + from + ' -> ' + to,
      allowed: getAllowedTransitions(from)
    };
  }
  return { ok: true };
}

// === Storage helpers (private to the state machine) ===

async function _loadOrder(orderId) {
  if (orderId == null || orderId === '') return null;
  const target = String(orderId).trim();
  const db = await orderRepository._rawStoreAsync();
  if (!db || !Array.isArray(db.orders)) return null;
  return db.orders.find((o) => o && String(o.id) === target) || null;
}

async function _saveOrder(updated) {
  if (!updated || !updated.id) return false;
  const db = await orderRepository._rawStoreAsync();
  if (!db || !Array.isArray(db.orders)) return false;
  const idx = db.orders.findIndex((o) => o && String(o.id) === String(updated.id));
  if (idx === -1) return false;
  db.orders[idx] = updated;
  return orderRepository.writeAsync(db);
}

// M3 — Inventory restoration on cancellation.
//
// When an order is cancelled, the items that were decremented from stock
// at checkout must be returned. This is the P0 inventory-consistency
// requirement. The flow is:
//
//   1. For each item in the order, increment products.stockQty by item.qty.
//   2. Append an inventory transaction of type 'in' with reason
//      'market-cancel' so the inventory ledger reflects the restoration.
//
// Both writes go to the same products store and the same
// inventoryTransactions store. We read both once, mutate both, write both.
// If either write fails, we return persist_failed and the caller leaves
// the order in its previous state (the order save is the LAST step).
//
// The `tenantId` is stamped on the inventory transaction from the
// trusted server context (the order's own tenantId, which was already
// verified to match the caller's tenantId in the ownership check above).
async function _restoreInventory(order) {
  if (!order || !Array.isArray(order.items) || order.items.length === 0) {
    return { ok: true, txIds: [], stockDelta: {} };
  }
  const pdb = await productsRepository._rawStoreAsync();
  const tdb = await inventoryTxRepository._rawStoreAsync();
  if (!pdb.products) pdb.products = [];
  if (!tdb.transactions) tdb.transactions = [];

  const stockDelta = {};
  const txIds = [];
  const now = new Date().toISOString();
  for (const item of order.items) {
    if (!item || !item.productId || !item.qty) continue;
    const product = pdb.products.find((p) => String(p.id) === String(item.productId));
    if (!product) {
      // The product was deleted from the global store after the order
      // was placed. We cannot restore stock to a missing product. Skip
      // the stock increment for this item but still record the
      // transaction so the audit trail is complete.
      stockDelta[item.productId] = 0;
    } else {
      const currentStock = Number(product.stockQty) || 0;
      product.stockQty = currentStock + Number(item.qty);
      stockDelta[item.productId] = Number(item.qty);
    }
    const txId = uuidv4();
    txIds.push(txId);
    tdb.transactions.push({
      id: txId,
      productId: String(item.productId),
      type: 'in',
      qty: Number(item.qty),
      stockAfter: product ? Number(product.stockQty) || 0 : null,
      user: 'market',
      reason: 'market-cancel',
      tenantId: String(order.tenantId),
      orderId: order.id,
      createdAt: now,
      updatedAt: now
    });
  }
  const pOk = await productsRepository.writeAsync(pdb);
  if (!pOk) return { ok: false, error: 'products_write_failed' };
  const tOk = await inventoryTxRepository.writeAsync(tdb);
  if (!tOk) return { ok: false, error: 'transactions_write_failed' };
  return { ok: true, txIds, stockDelta };
}

// === Public service API ===

// cancelOrder — the V1 customer-initiated cancellation transition.
//
// Inputs:
//   orderId:    the order id (URL :id param, server-validated)
//   customerId: the authenticated customer's id (from req.customer.id)
//   tenantId:   the trusted tenant (from req.marketTenant)
//   reason:     optional human-readable reason string (stored as-is)
//
// Trust boundary:
//   - customerId comes from req.customer.id (set by the customer JWT
//     middleware). NEVER from the body.
//   - tenantId comes from req.marketTenant (set by the requireMarketTenant
//     middleware). NEVER from the body or the order record.
//
// Failure modes (all return a structured result, never throw):
//   - { error: 'not_found' }       — order does not exist OR does
//     not belong to the (customerId, tenantId) pair. Same response
//     for both cases to prevent cross-tenant/cross-customer
//     existence leaks.
//   - { error: 'invalid_state', current: <state> } — the order is
//     already terminal or otherwise cannot be cancelled.
//   - { error: 'persist_failed' }  — the storage write failed.
async function cancelOrder({ orderId, customerId, tenantId, reason } = {}) {
  if (orderId == null || orderId === '') {
    return { error: 'orderId is required' };
  }
  if (customerId == null || customerId === '') {
    return { error: 'customerId is required' };
  }
  if (tenantId == null || tenantId === '') {
    return { error: 'tenantId is required' };
  }

  const order = await _loadOrder(orderId);
  if (!order) return { error: 'not_found' };
  if (String(order.tenantId) !== String(tenantId)) return { error: 'not_found' };
  if (String(order.customerId) !== String(customerId)) return { error: 'not_found' };

  // Re-validate state at the storage boundary (defense-in-depth: the
  // owner check is independent of the state check).
  const check = validateTransition(order.status, 'cancelled');
  if (check.error) {
    return { error: 'invalid_state', current: order.status, detail: check.error };
  }

  // M3 — Restore inventory BEFORE saving the order as cancelled.
  // If this fails, the order stays in 'received' state and no
  // cancellation is recorded. If it succeeds but the order save fails,
  // we compensate by re-decrementing the stock and removing the
  // 'in' transactions.
  const restore = await _restoreInventory(order);
  if (!restore.ok) {
    return { error: 'inventory_restore_failed', detail: restore.error };
  }

  // Build the updated record. EVERY field is server-computed. The
  // client's `reason` is stored as metadata only; it cannot
  // influence the state.
  const now = new Date().toISOString();
  const updated = Object.assign({}, order, {
    status: 'cancelled',
    paymentStatus: 'cancelled',
    cancelledAt: now,
    cancellationReason: typeof reason === 'string' ? reason.slice(0, 500) : null,
    restoredTxIds: restore.txIds,
    updatedAt: now
  });

  const ok = await _saveOrder(updated);
  if (!ok) {
    // M3 — Compensate the inventory restoration. Re-decrement stock
    // and remove the 'in' transactions we just appended.
    try {
      const pdb = await productsRepository._rawStoreAsync();
      if (pdb.products) {
        for (const [productId, qty] of Object.entries(restore.stockDelta)) {
          if (!qty) continue;
          const product = pdb.products.find((p) => String(p.id) === String(productId));
          if (product) {
            product.stockQty = (Number(product.stockQty) || 0) - Number(qty);
          }
        }
        await productsRepository.writeAsync(pdb);
      }
      const tdb = await inventoryTxRepository._rawStoreAsync();
      if (tdb.transactions) {
        const ids = new Set(restore.txIds);
        tdb.transactions = tdb.transactions.filter((t) => !ids.has(t.id));
        await inventoryTxRepository.writeAsync(tdb);
      }
    } catch (compErr) {
      // Log the compensation failure but still report the original error.
      // The system is now in a recovery-required state.
      return {
        error: 'persist_failed',
        detail: 'order_save_failed_and_inventory_compensation_failed: ' + compErr.message
      };
    }
    return { error: 'persist_failed' };
  }
  return { order: updated };
}

module.exports = {
  // States
  ORDER_STATES,
  INITIAL_ORDER_STATE,
  TERMINAL_ORDER_STATES,
  PAYMENT_STATES,
  INITIAL_PAYMENT_STATE,
  // Pure helpers
  isValidOrderState,
  isTerminalOrderState,
  isValidPaymentState,
  getAllowedTransitions,
  canTransition,
  validateTransition,
  // Side-effecting
  cancelOrder
};
