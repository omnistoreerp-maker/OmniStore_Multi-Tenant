'use strict';

const tenantTransactionFees = require('../services/tenantTransactionFees.service');

function recordFeeAsync(tenantContext, invoiceId, amount, feePercentage) {
  if (!invoiceId || !amount) return;
  const safeTenantContext = tenantContext || null;
  const safeAmount = Number(amount);
  if (Number.isNaN(safeAmount) || safeAmount <= 0) return;

  if (typeof setImmediate !== 'undefined') {
    setImmediate(async () => {
      await tenantTransactionFees.logTransactionFee({
        tenantContext: safeTenantContext,
        invoiceId: String(invoiceId),
        amount: safeAmount,
        feePercentage: feePercentage
      });
    });
  } else {
    process.nextTick(async () => {
      await tenantTransactionFees.logTransactionFee({
        tenantContext: safeTenantContext,
        invoiceId: String(invoiceId),
        amount: safeAmount,
        feePercentage: feePercentage
      });
    });
  }
}

module.exports = {
  recordFeeAsync
};
