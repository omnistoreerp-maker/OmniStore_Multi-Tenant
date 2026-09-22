'use strict';

// gameHostingOrder.controller — HTTP layer for the Game Hosting
// subscription/order pipeline.
//
// Trust boundaries:
//   - tenantId: ONLY from req.marketTenant (never the body)
//   - customerId: ONLY from req.customer (never the body)
//   - amount: NEVER from the body — resolved by gameHostingPricing
//   - operator endpoints: requireOperator (role !== operator → 403)
//   - cross-tenant / cross-customer reads: 404 (no existence leak)

const { success, error } = require('../utils/apiResponse');
const orderService = require('../services/gameHostingOrder.service');
const provisioningService = require('../services/gameHostingProvisioning.service');
const pricingService = require('../services/gameHostingPricing.service');
const providerRegistry = require('../services/gameHosting/providerRegistry');
const providerFacade = require('../services/gameHosting/provider');

function _tenantContext(req) {
  return { tenantId: req.marketTenant || null };
}

function _customerId(req) {
  return req.customer ? req.customer.id : null;
}

function _isOperator(req) {
  return Boolean(req.customer && req.customer.role === 'operator');
}

// Ownership guard for order actions: a customer may only act on their
// own orders; operators may act tenant-wide. Foreign orders → 404.
async function _ownedOrder(req, res) {
  const order = await orderService.getOrderById({ id: req.params.id, tenantContext: _tenantContext(req) });
  if (!order) {
    error(res, 'Order not found', 404);
    return null;
  }
  if (!_isOperator(req) && order.customerId && String(order.customerId) !== String(_customerId(req))) {
    error(res, 'Order not found', 404);
    return null;
  }
  return order;
}

// === Quote (storefront shows the price before ordering) ===
async function quoteOrder(req, res) {
  try {
    const q = await pricingService.quote({
      planId: req.query.planId,
      billingPeriod: req.query.billingPeriod,
      tenantContext: _tenantContext(req)
    });
    if (q.error) return error(res, q.error, q.error === 'Plan not found' ? 404 : 400);
    return success(res, q.quote, 'Quote retrieved');
  } catch (err) {
    return error(res, 'Failed to build quote', 500);
  }
}

// === Customer orders ===
async function createOrder(req, res) {
  try {
    const data = Object.assign({}, req.body || {});
    data.customerId = _customerId(req); // trusted — body customerId ignored
    const result = await orderService.createOrder({ data, tenantContext: _tenantContext(req) });
    if (result.error) {
      const status = ['Plan not found', 'Plan is not available for ordering', 'Plan has no valid price configured'].indexOf(result.error) !== -1 ? 404 : 400;
      return error(res, result.error, status);
    }
    return success(res, result.order, result.idempotent ? 'Order retrieved (idempotent)' : 'Order created', result.idempotent ? 200 : 201);
  } catch (err) {
    return error(res, 'Failed to create order', 500);
  }
}

async function listMyOrders(req, res) {
  try {
    const customerId = _isOperator(req) ? (req.query.customerId || null) : _customerId(req);
    const status = req.query.status || null;
    const orders = await orderService.listOrders({ tenantContext: _tenantContext(req), customerId, status });
    return success(res, { orders }, 'Orders retrieved');
  } catch (err) {
    return error(res, 'Failed to list orders', 500);
  }
}

async function getMyOrder(req, res) {
  try {
    const order = await orderService.getOrderById({ id: req.params.id, tenantContext: _tenantContext(req) });
    if (!order) return error(res, 'Order not found', 404);
    if (!_isOperator(req) && order.customerId && String(order.customerId) !== String(_customerId(req))) {
      return error(res, 'Order not found', 404);
    }
    return success(res, order, 'Order retrieved');
  } catch (err) {
    return error(res, 'Failed to get order', 500);
  }
}

// === Payment ===
//
// Simulated payment confirmation endpoint (records the same ledger a
// real gateway webhook would). A REAL gateway integration calls the
// webhook endpoint instead; both paths converge on applyPaymentResult.
async function payOrder(req, res) {
  try {
    const order = await orderService.getOrderById({ id: req.params.id, tenantContext: _tenantContext(req) });
    if (!order) return error(res, 'Order not found', 404);
    if (order.customerId && String(order.customerId) !== String(_customerId(req)) && !_isOperator(req)) {
      return error(res, 'Order not found', 404);
    }
    if (order.status !== 'pending') return error(res, 'Order is not awaiting payment (current: ' + order.status + ')', 409);
    const paymentRef = 'GH-PAY-' + order.id.slice(0, 8) + '-' + Date.now().toString(36);
    const result = await orderService.applyPaymentResult({
      orderId: order.id,
      tenantContext: _tenantContext(req),
      paymentRef,
      amount: order.amount, // server-side amount only
      status: 'paid',
      meta: { channel: 'storefront', simulatedGateway: true }
    });
    if (result.error) return error(res, result.error, 400);
    return success(res, result.order, 'Payment recorded');
  } catch (err) {
    return error(res, 'Failed to record payment', 500);
  }
}

// Gateway webhook (unauthenticated by signature in this build —
// real gateways must verify HMAC before calling; recorded as an
// integration dependency). Idempotent by paymentRef.
async function paymentWebhook(req, res) {
  try {
    const { orderId, paymentRef, status, amount } = req.body || {};
    if (!orderId || !paymentRef || !status) return error(res, 'orderId, paymentRef and status are required', 400);
    const result = await orderService.applyPaymentResult({
      orderId: String(orderId),
      tenantContext: null, // webhooks are cross-tenant by ref; amount integrity still enforced
      paymentRef: String(paymentRef),
      amount,
      status: String(status),
      meta: { channel: 'webhook' }
    });
    if (result.error) return error(res, result.error, 400);
    return success(res, { orderId: result.order.id, status: result.order.status, alreadyProcessed: Boolean(result.alreadyProcessed) }, 'Webhook processed');
  } catch (err) {
    return error(res, 'Failed to process payment webhook', 500);
  }
}

// === Provisioning ===
async function provisionOrder(req, res) {
  try {
    const order = await _ownedOrder(req, res);
    if (!order) return;
    const result = await provisioningService.provisionOrder({ orderId: order.id, tenantContext: _tenantContext(req) });
    if (result.error) {
      const status = result.error === 'Order not found' ? 404 : (String(result.error).indexOf('must be paid') !== -1 ? 409 : 400);
      return error(res, result.error, status);
    }
    if (result.provisioningFailed) {
      return res.status(502).json({
        success: false,
        message: 'Provisioning failed: ' + (result.providerFailure && result.providerFailure.message || 'provider error'),
        statusCode: 502,
        details: { orderId: result.order.id, providerFailure: result.providerFailure },
        time: new Date().toISOString()
      });
    }
    return success(res, result.order, result.noop ? 'Order already ' + result.order.status : 'Order provisioned');
  } catch (err) {
    return error(res, 'Failed to provision order', 500);
  }
}

// === Lifecycle (customer + operator) ===
async function suspendOrder(req, res) {
  try {
    const order = await _ownedOrder(req, res);
    if (!order) return;
    const result = await provisioningService.suspendOrder({ orderId: order.id, tenantContext: _tenantContext(req), reason: req.body && req.body.reason });
    if (result.error) {
      const status = result.error === 'Order not found' ? 404 : 409;
      return error(res, result.error, status);
    }
    return success(res, result.order, 'Order suspended');
  } catch (err) {
    return error(res, 'Failed to suspend order', 500);
  }
}

async function resumeOrder(req, res) {
  try {
    const order = await _ownedOrder(req, res);
    if (!order) return;
    const result = await provisioningService.resumeOrder({ orderId: order.id, tenantContext: _tenantContext(req) });
    if (result.error) {
      const status = result.error === 'Order not found' ? 404 : 409;
      return error(res, result.error, status);
    }
    return success(res, result.order, 'Order resumed');
  } catch (err) {
    return error(res, 'Failed to resume order', 500);
  }
}

async function terminateOrder(req, res) {
  try {
    const order = await _ownedOrder(req, res);
    if (!order) return;
    const result = await provisioningService.terminateOrder({ orderId: order.id, tenantContext: _tenantContext(req), reason: req.body && req.body.reason });
    if (result.error) {
      const status = result.error === 'Order not found' ? 404 : 409;
      return error(res, result.error, status);
    }
    return success(res, result.order, 'Order terminated');
  } catch (err) {
    return error(res, 'Failed to terminate order', 500);
  }
}

async function orderProviderStatus(req, res) {
  try {
    const order = await _ownedOrder(req, res);
    if (!order) return;
    const result = await provisioningService.getProviderStatus({ orderId: order.id, tenantContext: _tenantContext(req) });
    if (result.error) return error(res, result.error, result.error === 'Order not found' ? 404 : 400);
    return success(res, result, 'Provider status retrieved');
  } catch (err) {
    return error(res, 'Failed to get provider status', 500);
  }
}

// === Renewal ===
async function renewOrder(req, res) {
  try {
    const order = await _ownedOrder(req, res);
    if (!order) return;
    const result = await orderService.renewOrder({ orderId: order.id, tenantContext: _tenantContext(req), billingPeriod: req.body && req.body.billingPeriod });
    if (result.error) return error(res, result.error, 409);
    return success(res, result.order, 'Order renewed');
  } catch (err) {
    return error(res, 'Failed to renew order', 500);
  }
}

// === Operator admin ===
async function adminOverview(req, res) {
  try {
    const ctx = _tenantContext(req);
    const statusFilter = req.query.status || null;
    const customerId = req.query.customerId || null;
    const orders = await orderService.listOrders({ tenantContext: ctx, customerId, status: statusFilter });
    const counts = {};
    for (const o of orders) counts[o.status] = (counts[o.status] || 0) + 1;
    return success(res, {
      provider: providerFacade.getStatus(),
      counts,
      total: orders.length,
      orders
    }, 'Game hosting admin overview');
  } catch (err) {
    return error(res, 'Failed to build admin overview', 500);
  }
}

async function adminRetryProvisioning(req, res) {
  try {
    const order = await _ownedOrder(req, res);
    if (!order) return;
    const result = await provisioningService.provisionOrder({ orderId: order.id, tenantContext: _tenantContext(req) });
    if (result.error) {
      const status = result.error === 'Order not found' ? 404 : 409;
      return error(res, result.error, status);
    }
    if (result.provisioningFailed) {
      return res.status(502).json({
        success: false,
        message: 'Provisioning still failing: ' + (result.providerFailure && result.providerFailure.message || 'provider error'),
        statusCode: 502,
        details: { orderId: result.order.id, providerFailure: result.providerFailure },
        time: new Date().toISOString()
      });
    }
    return success(res, result.order, 'Provisioning completed');
  } catch (err) {
    return error(res, 'Failed to retry provisioning', 500);
  }
}

async function adminExpireSweep(req, res) {
  try {
    const result = await orderService.expireDueOrders({ tenantContext: _tenantContext(req) });
    return success(res, result, 'Expiry sweep complete');
  } catch (err) {
    return error(res, 'Failed to run expiry sweep', 500);
  }
}

async function adminRefund(req, res) {
  try {
    const order = await _ownedOrder(req, res);
    if (!order) return;
    const result = await orderService.applyRefund({
      orderId: order.id,
      tenantContext: _tenantContext(req),
      paymentRef: req.body && req.body.paymentRef,
      reason: req.body && req.body.reason
    });
    if (result.error) {
      const status = result.error === 'Order not found' ? 404 : 409;
      return error(res, result.error, status);
    }
    return success(res, result.order, 'Order refunded');
  } catch (err) {
    return error(res, 'Failed to refund order', 500);
  }
}

async function providerStatus(req, res) {
  return success(res, providerFacade.getStatus(), 'Provider status');
}

module.exports = {
  quoteOrder,
  createOrder,
  listMyOrders,
  getMyOrder,
  payOrder,
  paymentWebhook,
  provisionOrder,
  suspendOrder,
  resumeOrder,
  terminateOrder,
  orderProviderStatus,
  renewOrder,
  adminOverview,
  adminRetryProvisioning,
  adminExpireSweep,
  adminRefund,
  providerStatus
};
