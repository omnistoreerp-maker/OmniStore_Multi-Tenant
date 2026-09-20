'use strict';

const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const paymentService = require('../services/tenantPayments.service');

function _trustedTenantId(req) {
  const ctx = req.tenantContext;
  if (ctx && ctx.tenantId) return String(ctx.tenantId);
  const user = req.user;
  if (user && user.tenantId) return String(user.tenantId);
  return null;
}

async function createPaymentIntent(req, res) {
  try {
    const tenantId = _trustedTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const { addonKey, amount, currency, gateway, metadata } = req.body || {};
    const record = await paymentService.createPaymentIntent({
      tenantId,
      addonKey,
      amount,
      currency,
      gateway,
      metadata
    });
    success(res, record, 'Payment intent created');
  } catch (err) {
    logger.error('tenantPayments.createPaymentIntent error:', err.message);
    error(res, err.message || 'Failed to create payment intent', 400);
  }
}

async function getPaymentStatus(req, res) {
  try {
    const tenantId = _trustedTenantId(req);
    const { ref } = req.params || {};
    const record = await paymentService.getPaymentByRef(ref);
    if (!record) return error(res, 'Payment not found', 404);
    // Tenant isolation: a tenant must never learn that another tenant's
    // transaction ref exists — respond with the same 404 as a missing ref.
    if (tenantId && String(record.tenantId) !== tenantId) return error(res, 'Payment not found', 404);
    success(res, record, 'Payment retrieved');
  } catch (err) {
    logger.error('tenantPayments.getPaymentStatus error:', err.message);
    error(res, 'Failed to retrieve payment', 500);
  }
}

async function listPayments(req, res) {
  try {
    const tenantId = _trustedTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const records = await paymentService.listPaymentsForTenant(tenantId);
    success(res, { payments: records }, 'Payments retrieved');
  } catch (err) {
    logger.error('tenantPayments.listPayments error:', err.message);
    error(res, 'Failed to retrieve payments', 500);
  }
}

async function handlePaymentWebhook(req, res) {
  try {
    const { transactionRef, status, payload } = req.body || {};
    if (!transactionRef || !status) {
      return error(res, 'transactionRef and status are required', 400);
    }
    const result = await paymentService.updatePaymentStatus({
      transactionRef,
      status,
      payload: payload || {}
    });
    if (!result) return error(res, 'Payment not found', 404);
    success(res, result, 'Payment status updated');
  } catch (err) {
    logger.error('tenantPayments.handlePaymentWebhook error:', err.message);
    error(res, err.message || 'Failed to process payment webhook', 400);
  }
}

module.exports = {
  createPaymentIntent,
  getPaymentStatus,
  listPayments,
  handlePaymentWebhook
};
