(function (root) {
  'use strict';

  const ns = root.OmniAutoPosting = root.OmniAutoPosting || {};
  const v = () => ns.AutoPostingValidator;
  const line = (account, debit, credit, notes) => Object.freeze({ account, debit: v().money(debit), credit: v().money(credit), notes: notes || '' });

  function customerPayment(payment = {}) {
    const amount = v().money(payment.amount);
    const journalLines = [
      line(payment.cashAccount || 'cash_on_hand', amount, 0, 'Customer payment received'),
      line('accounts_receivable', 0, amount, 'Reduce customer receivable')
    ];
    const journal = ns.AutoPostingValidator.validateJournal(journalLines);
    return Object.freeze({
      operation: 'customer_payment',
      sourceType: 'customer_payment',
      sourceId: payment.id || '',
      journalLines,
      debitLines: journalLines.filter(row => row.debit > 0),
      creditLines: journalLines.filter(row => row.credit > 0),
      inventoryImpact: Object.freeze([]),
      costImpact: 0,
      profitImpact: null,
      cashImpact: amount,
      customerSupplierImpact: -amount,
      validationErrors: Object.freeze(journal.errors),
      warnings: Object.freeze(journal.warnings),
      journalTotals: journal.totals,
      valid: journal.valid
    });
  }

  function supplierPayment(payment = {}) {
    const amount = v().money(payment.amount);
    const journalLines = [
      line('accounts_payable', amount, 0, 'Reduce supplier payable'),
      line(payment.cashAccount || 'cash_on_hand', 0, amount, 'Supplier payment made')
    ];
    const journal = ns.AutoPostingValidator.validateJournal(journalLines);
    return Object.freeze({
      operation: 'supplier_payment',
      sourceType: 'supplier_payment',
      sourceId: payment.id || '',
      journalLines,
      debitLines: journalLines.filter(row => row.debit > 0),
      creditLines: journalLines.filter(row => row.credit > 0),
      inventoryImpact: Object.freeze([]),
      costImpact: 0,
      profitImpact: null,
      cashImpact: -amount,
      customerSupplierImpact: -amount,
      validationErrors: Object.freeze(journal.errors),
      warnings: Object.freeze(journal.warnings),
      journalTotals: journal.totals,
      valid: journal.valid
    });
  }

  ns.PaymentPostingPreviewEngine = Object.freeze({ version: '1.0.0', customerPayment, supplierPayment });
})(typeof globalThis !== 'undefined' ? globalThis : window);
