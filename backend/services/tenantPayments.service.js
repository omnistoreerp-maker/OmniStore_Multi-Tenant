'use strict';

const BaseRepository = require('../repositories/BaseRepository');
const storageAdapter = require('../repositories/storageAdapter');
const logger = require('../utils/logger');
const addonService = require('./tenantAddons.service');
const { eventBus } = require('./eventBus');

const paymentRepository = new BaseRepository('tenantPaymentTransactions');

function _normalizeStatus(status) {
  if (!status) return 'pending';
  return String(status).toLowerCase();
}

// Statuses a gateway webhook is allowed to set. Anything else is rejected
// rather than silently persisted.
const ALLOWED_STATUSES = new Set(['pending', 'paid', 'failed', 'cancelled']);

function _generateTransactionRef(tenantId, addonKey) {
  const ts = Date.now().toString(36).toUpperCase();
  const tenant = String(tenantId || 'TENANT').slice(0, 4).toUpperCase();
  const addon = String(addonKey || 'ADDON').slice(0, 4).toUpperCase();
  return `PAY-${tenant}-${addon}-${ts}`;
}

async function createPaymentIntent({ tenantId, addonKey, amount, currency = 'EGP', gateway = 'paymob', metadata = {} }) {
  const tid = tenantId ? String(tenantId).trim() : null;
  const key = String(addonKey || '').trim();
  const amt = Number(amount);
  if (!key) throw new Error('addonKey is required');
  if (Number.isNaN(amt) || amt <= 0) throw new Error('amount must be a positive number');

  const transactionRef = _generateTransactionRef(tid, key);
  const db = await paymentRepository.readAsync();
  const transactions = Array.isArray(db.tenantPaymentTransactions) ? db.tenantPaymentTransactions : [];

  const existing = transactions.find((t) => String(t.transaction_ref || t.transactionRef) === transactionRef);
  if (existing) {
    return {
      transactionRef: existing.transaction_ref || existing.transactionRef,
      status: existing.status || 'pending',
      gateway: existing.gateway || gateway,
      amount: existing.amount,
      currency: existing.currency || currency
    };
  }

  const record = {
    transaction_ref: transactionRef,
    tenant_id: tid,
    addon_key: key,
    amount: amt,
    currency: String(currency || 'EGP').toUpperCase(),
    gateway: String(gateway || 'paymob').toLowerCase(),
    status: 'pending',
    payload: metadata || {},
    created_at: new Date().toISOString()
  };

  transactions.push(record);
  db.tenantPaymentTransactions = transactions;
  await paymentRepository.writeAsync(db);

  return {
    transactionRef: record.transaction_ref,
    tenantId: record.tenant_id,
    addonKey: record.addon_key,
    amount: record.amount,
    currency: record.currency,
    gateway: record.gateway,
    status: record.status,
    createdAt: record.created_at
  };
}

async function updatePaymentStatus({ transactionRef, status, payload = {} }) {
  const ref = String(transactionRef || '').trim();
  if (!ref) return null;

  const nextStatus = _normalizeStatus(status);
  if (!ALLOWED_STATUSES.has(nextStatus)) {
    throw new Error(`Invalid payment status: ${nextStatus}`);
  }

  const db = await paymentRepository.readAsync();
  const transactions = Array.isArray(db.tenantPaymentTransactions) ? db.tenantPaymentTransactions : [];
  const record = transactions.find((t) => String(t.transaction_ref || t.transactionRef) === ref);
  if (!record) return null;

  const previousStatus = _normalizeStatus(record.status);
  // 'paid' is terminal: a webhook may never downgrade or replay it.
  if (previousStatus === 'paid' && nextStatus !== 'paid') {
    throw new Error('Payment is already paid and cannot change status');
  }

  record.status = nextStatus;
  if (payload && Object.keys(payload).length > 0) {
    record.payload = Object.assign({}, record.payload || {}, payload);
  }

  db.tenantPaymentTransactions = transactions;
  await paymentRepository.writeAsync(db);

  if (previousStatus !== 'paid' && record.status === 'paid') {
    try {
      await _activateAddonOnPayment(record);
    } catch (err) {
      logger.error('tenantPayments.service: auto-activation failed', err.message);
    }
  }

  return {
    transactionRef: record.transaction_ref || record.transactionRef,
    status: record.status,
    gateway: record.gateway,
    payload: record.payload
  };
}

async function _activateAddonOnPayment(record) {
  const tenantId = String(record.tenant_id || '').trim();
  const addonKey = String(record.addon_key || '').trim();
  if (!tenantId || !addonKey) return;

  const addonRecord = await addonService.upsertAddonForTenant(tenantId, addonKey, 'active', null);
  if (!addonRecord) {
    logger.warn(`tenantPayments.service: addon activation returned no record for ${tenantId}/${addonKey}`);
    return;
  }

  try {
    eventBus.publish('addon.activated', {
      tenantId,
      addonKey,
      transactionRef: record.transaction_ref || record.transactionRef,
      amount: record.amount,
      currency: record.currency,
      gateway: record.gateway,
      activatedAt: new Date().toISOString()
    });
  } catch (_) {}

  logger.info(`tenantPayments.service: auto-activated addon ${addonKey} for tenant ${tenantId}`);
}

async function getPaymentByRef(transactionRef) {
  const ref = String(transactionRef || '').trim();
  if (!ref) return null;
  const db = await paymentRepository.readAsync();
  const transactions = Array.isArray(db.tenantPaymentTransactions) ? db.tenantPaymentTransactions : [];
  const record = transactions.find((t) => String(t.transaction_ref || t.transactionRef) === ref);
  if (!record) return null;
  return {
    transactionRef: record.transaction_ref || record.transactionRef,
    tenantId: record.tenant_id,
    addonKey: record.addon_key,
    amount: record.amount,
    currency: record.currency,
    gateway: record.gateway,
    status: record.status || 'pending',
    payload: record.payload || {},
    createdAt: record.created_at || null
  };
}

async function listPaymentsForTenant(tenantId) {
  const tid = String(tenantId || '').trim();
  if (!tid) return [];
  const db = await paymentRepository.readAsync();
  const transactions = Array.isArray(db.tenantPaymentTransactions) ? db.tenantPaymentTransactions : [];
  return transactions
    .filter((t) => String(t.tenant_id) === tid)
    .map((t) => ({
      transactionRef: t.transaction_ref || t.transactionRef,
      addonKey: t.addon_key,
      amount: t.amount,
      currency: t.currency,
      gateway: t.gateway,
      status: t.status || 'pending',
      payload: t.payload || {},
      createdAt: t.created_at || null
    }))
    .sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db2 = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return db2 - da;
    });
}

module.exports = {
  createPaymentIntent,
  updatePaymentStatus,
  getPaymentByRef,
  listPaymentsForTenant
};
