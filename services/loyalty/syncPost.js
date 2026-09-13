'use strict';

// Loyalty backend sync functions.
// - Called AFTER local sale/return persistence succeeds.
// - Fire-and-forget: never blocks sale/return completion.
// - Uses retry queue for failed operations.

const backendApi = window.backendApi || {};
const loyaltySyncQueue = window.loyaltySyncQueue || {};

function getDB() {
  try { return window.DB || {}; } catch (e) { return {}; }
}

function getCustomers() {
  const db = getDB();
  return Array.isArray(db.customers) ? db.customers : [];
}

function findCustomer(customerId) {
  return getCustomers().find(c => String(c.id) === String(customerId)) || null;
}

async function syncLoyaltyForSale(invoice) {
  if (!invoice || !invoice.id || !backendApi.loyalty) return;

  const customerId = extractCustomerId(invoice);
  if (!customerId) return;

  try {
    const cfg = typeof getLoyaltyConfig === 'function' ? getLoyaltyConfig() : { enabled: true, earnPerAmount: 100, pointsPerUnit: 1 };
    if (!cfg.enabled) return;

    if (invoice.loyaltyUsedPoints > 0) {
      const redeemPayload = {
        customerId,
        points: invoice.loyaltyUsedPoints,
        amount: invoice.loyaltyUsedAmount || 0,
        ref: invoice.id,
        refType: 'sale',
        note: 'استبدال نقاط - فاتورة ' + invoice.id,
        source: 'pos'
      };

      const existing = loyaltySyncQueue.findPending('redeem', customerId, invoice.id);
      if (!existing) {
        const op = loyaltySyncQueue.createOperation({
          operationType: 'redeem',
          customerId,
          reference: invoice.id,
          refType: 'sale',
          payload: redeemPayload
        });
        loyaltySyncQueue.enqueue(op);
      }
    }

    const earnBase = Math.max(0, invoice.total || 0);
    const earnedPoints = Math.floor((earnBase / (cfg.earnPerAmount || 100)) * (cfg.pointsPerUnit || 1));
    if (earnedPoints > 0) {
      const earnPayload = {
        customerId,
        points: earnedPoints,
        amount: earnBase,
        ref: invoice.id,
        refType: 'sale',
        note: 'اكتساب نقاط من فاتورة',
        source: 'pos'
      };

      const existing = loyaltySyncQueue.findPending('earn', customerId, invoice.id);
      if (!existing) {
        const op = loyaltySyncQueue.createOperation({
          operationType: 'earn',
          customerId,
          reference: invoice.id,
          refType: 'sale',
          payload: earnPayload
        });
        loyaltySyncQueue.enqueue(op);
      }
    }
  } catch (e) {
    console.warn('Loyalty sync enqueue failed:', e.message);
  }
}

async function syncLoyaltyForReturn(returnRecord, originalInvoice) {
  if (!returnRecord || !returnRecord.id || !backendApi.loyalty) return;

  const customerId = extractCustomerId(originalInvoice);
  if (!customerId) return;

  try {
    const refundAmount = Math.max(0, returnRecord.refund || 0);
    if (refundAmount <= 0) return;

    const cfg = typeof getLoyaltyConfig === 'function' ? getLoyaltyConfig() : { enabled: true, earnPerAmount: 100, pointsPerUnit: 1 };
    if (!cfg.enabled) return;

    const points = Math.floor((refundAmount / (cfg.earnPerAmount || 100)) * (cfg.pointsPerUnit || 1));
    if (points <= 0) return;

    const reversePayload = {
      customerId,
      originalSaleId: originalInvoice ? originalInvoice.id : '',
      returnId: returnRecord.id,
      refundAmount,
      note: 'خصم نقاط بسبب مرتجع - ' + returnRecord.id,
      source: 'return'
    };

    const existing = loyaltySyncQueue.findPending('reverse', customerId, returnRecord.id);
    if (!existing) {
      const op = loyaltySyncQueue.createOperation({
        operationType: 'reverse',
        customerId,
        reference: returnRecord.id,
        refType: 'return',
        payload: reversePayload
      });
      loyaltySyncQueue.enqueue(op);
    }
  } catch (e) {
    console.warn('Loyalty reverse sync enqueue failed:', e.message);
  }
}

function extractCustomerId(invoice) {
  if (!invoice) return null;
  if (invoice.customerId) return String(invoice.customerId);
  const customer = typeof getCustomerByNameOrPhone === 'function'
    ? getCustomerByNameOrPhone(invoice.customer || '', invoice.customerPhone || '')
    : null;
  return customer ? String(customer.id) : null;
}

async function processSyncQueue() {
  if (!backendApi.loyalty) return;

  const pending = loyaltySyncQueue.getPendingOperations();
  if (!pending.length) return;

  for (const op of pending) {
    try {
      let result;
      switch (op.operationType) {
        case 'earn':
          result = await backendApi.loyalty.earn(op.payload);
          break;
        case 'redeem':
          result = await backendApi.loyalty.redeem(op.payload);
          break;
        case 'reverse':
          result = await backendApi.loyalty.reverse(op.payload);
          break;
        default:
          continue;
      }

      if (result && result.success) {
        if (result.data && result.data.duplicate) {
          loyaltySyncQueue.markDuplicate(op.id, result.data.transaction ? result.data.transaction.id : null);
        } else {
          loyaltySyncQueue.markConfirmed(op.id);
          updateCustomerPointsProjection(op.payload.customerId, result.data);
        }
      } else if (result && result.statusCode === 404) {
        loyaltySyncQueue.markConflict(op.id, 'Customer not found');
      } else if (result && result.statusCode === 400) {
        loyaltySyncQueue.markConflict(op.id, result.message || 'Validation failed');
      } else {
        const error = (result && result.message) || 'Unknown error';
        loyaltySyncQueue.updateRetrySchedule(op.id, error);
      }
    } catch (e) {
      const error = (e && e.message) || 'Network error';
      loyaltySyncQueue.updateRetrySchedule(op.id, error);
    }
  }

  loyaltySyncQueue.clearConfirmed();
}

function updateCustomerPointsProjection(customerId, backendData) {
  if (!customerId || !backendData || backendData.points === undefined) return;
  const customer = findCustomer(customerId);
  if (customer) {
    customer.points = Math.max(0, Number(backendData.points) || 0);
  }
}

const loyaltySync = {
  syncLoyaltyForSale,
  syncLoyaltyForReturn,
  processSyncQueue,
  updateCustomerPointsProjection
};

window.loyaltySync = window.loyaltySync || {};
Object.assign(window.loyaltySync, loyaltySync);
