'use strict';

const BaseRepository = require('../repositories/BaseRepository');
const storageAdapter = require('../repositories/storageAdapter');
const logger = require('../utils/logger');

const feeRepository = new BaseRepository('tenantTransactionFees');
const DEFAULT_FEE_PERCENTAGE = 0.0050;

function _trustedTenantId(tenantContext) {
  if (!tenantContext) return null;
  const t = tenantContext.tenantId;
  if (t == null || t === '') return null;
  return String(t);
}

function _normalizeFeePercentage(feePercentage) {
  if (feePercentage === undefined || feePercentage === null || feePercentage === '') return DEFAULT_FEE_PERCENTAGE;
  const num = Number(feePercentage);
  if (Number.isNaN(num)) return DEFAULT_FEE_PERCENTAGE;
  return num;
}

function _calculateFee(amount, feePercentage) {
  const safeAmount = Number(amount);
  if (Number.isNaN(safeAmount) || safeAmount < 0) return 0;
  const safeRate = _normalizeFeePercentage(feePercentage);
  const fee = safeAmount * safeRate;
  return Math.round(fee * 100) / 100;
}

async function logTransactionFee({ tenantContext, invoiceId, amount, feePercentage } = {}) {
  const trustedTid = _trustedTenantId(tenantContext);
  if (!trustedTid) return null;
  if (!invoiceId) return null;

  const safeAmount = Number(amount);
  if (Number.isNaN(safeAmount) || safeAmount <= 0) return null;

  const feePercentageValue = _normalizeFeePercentage(feePercentage);
  const feeAmount = _calculateFee(safeAmount, feePercentageValue);

  try {
    const db = await feeRepository.readAsync();
    const fees = Array.isArray(db.tenantTransactionFees) ? db.tenantTransactionFees : [];

    const record = {
      tenantId: trustedTid,
      invoiceId: String(invoiceId),
      transactionAmount: safeAmount,
      feePercentage: feePercentageValue,
      feeAmount: feeAmount,
      status: 'unbilled',
      createdAt: new Date().toISOString()
    };

    fees.push(record);
    db.tenantTransactionFees = fees;
    await feeRepository.writeAsync(db);
    return record;
  } catch (err) {
    logger.error('tenantTransactionFees.service: logTransactionFee failed', err.message);
    return null;
  }
}

async function listFees({ tenantContext } = {}) {
  const trustedTid = _trustedTenantId(tenantContext);
  const db = await feeRepository.readAsync();
  let fees = Array.isArray(db.tenantTransactionFees) ? db.tenantTransactionFees : [];
  if (trustedTid) fees = fees.filter((f) => f && String(f.tenantId) === trustedTid);
  return fees;
}

// ---------------- platform admin helpers ----------------

function _parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function listFeesForAdmin({ tenantId, status, startDate, endDate } = {}) {
  const db = await feeRepository.readAsync();
  let fees = Array.isArray(db.tenantTransactionFees) ? db.tenantTransactionFees : [];

  if (tenantId != null && String(tenantId).trim() !== '') {
    const tid = String(tenantId).trim();
    fees = fees.filter((f) => f && String(f.tenantId) === tid);
  }

  if (status) {
    const s = String(status).toLowerCase();
    fees = fees.filter((f) => f && String(f.status || '').toLowerCase() === s);
  }

  const start = _parseDate(startDate);
  const end = _parseDate(endDate);
  if (start) fees = fees.filter((f) => f && f.createdAt && new Date(f.createdAt).getTime() >= start.getTime());
  if (end) fees = fees.filter((f) => f && f.createdAt && new Date(f.createdAt).getTime() <= end.getTime());

  return fees.map((f) => ({
    id: f.id,
    tenantId: f.tenantId,
    invoiceId: f.invoiceId,
    transactionAmount: f.transactionAmount,
    feePercentage: f.feePercentage,
    feeAmount: f.feeAmount,
    status: f.status || 'unbilled',
    createdAt: f.createdAt || null
  }));
}

async function markFeesBilled({ feeIds, tenantId } = {}) {
  const db = await feeRepository.readAsync();
  let fees = Array.isArray(db.tenantTransactionFees) ? db.tenantTransactionFees : [];

  let touched = 0;
  const targetIds = new Set((Array.isArray(feeIds) ? feeIds : []).map((id) => String(id)).filter(Boolean));

  fees = fees.map((f) => {
    if (!f) return f;
    const idMatch = targetIds.size > 0 && targetIds.has(String(f.id));
    const tenantMatch = tenantId != null && String(tenantId).trim() !== '' && String(f.tenantId) === String(tenantId).trim();
    if (!idMatch && !tenantMatch) return f;
    if (f.status === 'billed') return f;
    touched += 1;
    return Object.assign({}, f, { status: 'billed' });
  });

  if (touched === 0) return { updated: 0 };

  db.tenantTransactionFees = fees;
  await feeRepository.writeAsync(db);
  return { updated: touched };
}

module.exports = {
  logTransactionFee,
  listFees,
  listFeesForAdmin,
  markFeesBilled
};
