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
const orderRepository = new BaseRepository('marketOrders');

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

  // Build the updated record. EVERY field is server-computed. The
  // client's `reason` is stored as metadata only; it cannot
  // influence the state.
  const now = new Date().toISOString();
  const updated = Object.assign({}, order, {
    status: 'cancelled',
    paymentStatus: 'cancelled',
    cancelledAt: now,
    cancellationReason: typeof reason === 'string' ? reason.slice(0, 500) : null,
    updatedAt: now
  });

  const ok = await _saveOrder(updated);
  if (!ok) return { error: 'persist_failed' };
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
