'use strict';

// gameHostingProvisioning.service — the ONLY place where business
// logic meets the provider. Guarantees:
//
//  1. An order never becomes ACTIVE before the provider confirms a
//     real provisioned instance (ok: true envelope).
//  2. Provisioning retries are IDEMPOTENT: every order has a stable
//     providerKey; the provider contract requires the same key to
//     resolve to the same instance (no duplicate infrastructure).
//  3. Failures never lose the order: state + last error + attempt
//     count are persisted atomically (single store write per step).
//  4. Tenant isolation: every call requires a trusted tenantContext
//     and verifies the order belongs to it before touching anything.

const orderService = require('./gameHostingOrder.service');
const serverService = require('./gameHosting.service');
const providerRegistry = require('./gameHosting/providerRegistry');

async function _provider() {
  // Indirect resolution (registry module property) so tests and future
  // plugin loaders can override the active adapter via injection.
  return providerRegistry.getActiveProvider();
}

function _tenantContext(t) {
  return t && t.tenantId ? { tenantId: t.tenantId } : t || null;
}

// Trigger provisioning for a PAID order. Safe to call repeatedly
// (button retry, webhook retry, admin retry): in-flight/terminal
// states are rejected, failed orders re-enter provisioning.
async function provisionOrder({ orderId, tenantContext } = {}) {
  const ctx = _tenantContext(tenantContext);
  const order = await orderService.getOrderById({ id: orderId, tenantContext: ctx });
  if (!order) return { error: 'Order not found' };

  if (order.status === 'active' || order.status === 'provisioning') {
    return { order, noop: true, reason: 'Order is already ' + order.status };
  }
  if (['pending', 'cancelled', 'expired', 'terminated'].indexOf(order.status) !== -1) {
    return { error: 'Order must be paid before provisioning (current: ' + order.status + ')' };
  }

  // paid | provisioning_failed → (re)enter provisioning
  const t = await orderService.transitionOrder({
    orderId: order.id,
    to: 'provisioning',
    tenantContext: ctx
  });
  if (t.error) return { error: t.error };
  const inFlight = t.order;

  const provider = await _provider();
  const attempt = (inFlight.provisioningAttempts || 0) + 1;

  const result = await provider.provisionServer({
    orderRef: inFlight.id,
    orderKey: inFlight.providerKey,     // idempotency key at the provider
    planId: inFlight.planId,
    planName: inFlight.planName,
    serverName: inFlight.serverName,
    region: inFlight.region,
    customerId: inFlight.customerId,
    tenantId: inFlight.tenantId
  }).catch((err) => ({ ok: false, code: 'PROVIDER_THROW', message: err.message, retryable: true }));

  // Contract enforcement: ok:true MUST carry a server envelope with an
  // externalId. A malformed success response is a provider bug — treat it
  // as a NON-retryable failure (retrying the same call will produce the
  // same malformed answer; needs operator/provider investigation).
  const contractBreach = result && result.ok && !(result.server && result.server.externalId);

  if (result && result.ok && !contractBreach) {
    // Success path — single transition, provider info persisted.
    const done = await orderService.transitionOrder({
      orderId: inFlight.id,
      to: 'active',
      tenantContext: ctx,
      meta: {
        providerInfo: {
          provider: result.provider || null,
          externalId: result.server && result.server.externalId || null,
          endpoint: result.server && result.server.endpoint || null,
          details: result.server && result.server.details || null,
          provisionedAt: new Date().toISOString(),
          attempts: attempt
        },
        provisioningAttempts: attempt,
        lastProvisionError: null
      }
    });
    if (done.error) {
      // Should not happen (provisioning → active is legal), but never
      // lose the provider result: persist the failure envelope.
      await orderService.transitionOrder({
        orderId: inFlight.id,
        to: 'provisioning_failed',
        tenantContext: ctx,
        meta: { lastProvisionError: { code: 'PERSIST_FAILED', message: done.error, retryable: true } }
      }).catch(() => {});
      return { error: done.error };
    }
    await _upsertProvisionedServer(inFlight, done.order, result, ctx);
    return { order: done.order, provisioned: true, provider: result.provider || null };
  }

  // Failure path — persist error + attempts; order → provisioning_failed.
  const failure = contractBreach
    ? {
        code: 'PROVIDER_CONTRACT_BREACH',
        message: 'Provider returned ok:true without a server envelope (missing externalId). Provider adapter violates the contract.',
        retryable: false,
        provider: (result && result.provider) || null,
        raw: result,
        at: new Date().toISOString(),
        attempt
      }
    : {
        code: (result && result.code) || 'PROVIDER_ERROR',
        message: (result && result.message) || 'Provider provisioning failed',
        retryable: Boolean(result && result.retryable),
        provider: (result && result.provider) || null,
        at: new Date().toISOString(),
        attempt
      };
  const fail = await orderService.transitionOrder({
    orderId: inFlight.id,
    to: 'provisioning_failed',
    tenantContext: ctx,
    meta: { lastProvisionError: failure, provisioningAttempts: attempt }
  });
  if (fail.error) return { error: fail.error, providerFailure: failure };
  return { order: fail.order, provisioningFailed: true, providerFailure: failure };
}

// Create/refresh the tenant-scoped server record that mirrors the
// provisioned instance (customer-facing visibility + lifecycle ops).
async function _upsertProvisionedServer(order, updatedOrder, providerResult, ctx) {
  const existing = await serverService.listServers({ query: { orderId: order.id }, tenantContext: ctx });
  const serverInput = {
    planId: order.planId,
    serverName: order.serverName,
    region: order.region,
    customerId: order.customerId,
    orderId: order.id,
    providerInfo: {
      provider: providerResult.provider || null,
      externalId: providerResult.server && providerResult.server.externalId || null,
      endpoint: providerResult.server && providerResult.server.endpoint || null
    },
    status: 'running'
  };
  if (existing && existing.length) {
    await serverService.updateServer({ id: existing[0].id, data: serverInput, tenantContext: ctx });
    return existing[0].id;
  }
  const created = await serverService.createServer({ data: serverInput, tenantContext: ctx });
  return created.server ? created.server.id : null;
}

// Suspend via provider + order/server state. Used for failed payment
// dunning and admin suspension.
async function suspendOrder({ orderId, tenantContext, reason } = {}) {
  const ctx = _tenantContext(tenantContext);
  const order = await orderService.getOrderById({ id: orderId, tenantContext: ctx });
  if (!order) return { error: 'Order not found' };
  if (order.status !== 'active') return { error: 'Only active orders can be suspended' };
  const provider = await _provider();
  const result = await provider.suspendServer({ orderRef: order.id, orderKey: order.providerKey, tenantId: order.tenantId }).catch((err) => ({ ok: false, code: 'PROVIDER_THROW', message: err.message, retryable: true }));
  if (!result || !result.ok) {
    return { error: (result && result.message) || 'Provider suspend failed', providerFailure: result || null };
  }
  const t = await orderService.transitionOrder({
    orderId: order.id, to: 'suspended', tenantContext: ctx,
    meta: { terminatedReason: reason ? String(reason) : null }
  });
  if (t.error) return { error: t.error };
  await _mirrorServerStatus(order.id, 'suspended', ctx);
  return { order: t.order, suspended: true };
}

// Resume a suspended order (payment recovered / admin action).
async function resumeOrder({ orderId, tenantContext } = {}) {
  const ctx = _tenantContext(tenantContext);
  const order = await orderService.getOrderById({ id: orderId, tenantContext: ctx });
  if (!order) return { error: 'Order not found' };
  if (order.status !== 'suspended') return { error: 'Only suspended orders can be resumed' };
  const provider = await _provider();
  const result = await provider.resumeServer({ orderRef: order.id, orderKey: order.providerKey, tenantId: order.tenantId }).catch((err) => ({ ok: false, code: 'PROVIDER_THROW', message: err.message, retryable: true }));
  if (!result || !result.ok) {
    return { error: (result && result.message) || 'Provider resume failed', providerFailure: result || null };
  }
  const t = await orderService.transitionOrder({ orderId: order.id, to: 'active', tenantContext: ctx });
  if (t.error) return { error: t.error };
  await _mirrorServerStatus(order.id, 'running', ctx);
  return { order: t.order, resumed: true };
}

// Terminate: provider destroy + terminal order state.
async function terminateOrder({ orderId, tenantContext, reason } = {}) {
  const ctx = _tenantContext(tenantContext);
  const order = await orderService.getOrderById({ id: orderId, tenantContext: ctx });
  if (!order) return { error: 'Order not found' };
  if (['terminated', 'cancelled'].indexOf(order.status) !== -1) {
    return { error: 'Order already ' + order.status };
  }
  const provider = await _provider();
  // Best-effort destroy: even if the provider call fails we still
  // terminate the order locally and record the provider failure
  // (termination must be idempotent and never block offboarding).
  const result = await provider.terminateServer({ orderRef: order.id, orderKey: order.providerKey, tenantId: order.tenantId }).catch((err) => ({ ok: false, code: 'PROVIDER_THROW', message: err.message, retryable: true }));
  const t = await orderService.transitionOrder({
    orderId: order.id, to: 'terminated', tenantContext: ctx,
    meta: {
      terminatedReason: reason ? String(reason) : 'terminated',
      lastProvisionError: result && result.ok ? null : {
        code: (result && result.code) || 'TERMINATE_FAILED',
        message: (result && result.message) || 'Provider termination failed (order terminated locally)',
        retryable: true, at: new Date().toISOString()
      }
    }
  });
  if (t.error) return { error: t.error };
  await _mirrorServerStatus(order.id, 'terminated', ctx);
  return { order: t.order, terminated: true, providerConfirmed: Boolean(result && result.ok) };
}

async function _mirrorServerStatus(orderId, status, ctx) {
  try {
    const existing = await serverService.listServers({ query: { orderId }, tenantContext: ctx });
    if (existing && existing.length) {
      await serverService.updateServer({ id: existing[0].id, data: { status }, tenantContext: ctx });
    }
  } catch (_) { /* mirror is best-effort; order remains source of truth */ }
}

// Pull provider status for an order (operational visibility).
async function getProviderStatus({ orderId, tenantContext } = {}) {
  const ctx = _tenantContext(tenantContext);
  const order = await orderService.getOrderById({ id: orderId, tenantContext: ctx });
  if (!order) return { error: 'Order not found' };
  const provider = await _provider();
  const result = await provider.getServerStatus({ orderRef: order.id, orderKey: order.providerKey, tenantId: order.tenantId });
  return { order: { id: order.id, status: order.status, providerInfo: order.providerInfo }, provider: result };
}

module.exports = {
  provisionOrder,
  suspendOrder,
  resumeOrder,
  terminateOrder,
  getProviderStatus
};
