(function (root) {
  'use strict';

  const ns = root.OmniAutoPosting = root.OmniAutoPosting || {};
  const v = () => ns.AutoPostingValidator;
  const b = () => ns.InventoryAccountingBridge;
  const line = (account, debit, credit, notes) => Object.freeze({ account, debit: v().money(debit), credit: v().money(credit), notes: notes || '' });

  function preview(invoice = {}, context = {}) {
    const items = v().list(invoice.items);
    const amount = v().money(invoice.amount ?? invoice.total ?? b().invoiceAmount(items));
    const tax = v().money(invoice.tax);
    const discount = v().money(invoice.discount);
    const inventoryValue = v().money(amount - discount);
    const totalCredit = v().money(inventoryValue + tax);
    const paymentType = invoice.paymentType || invoice.payment || (invoice.cash ? 'cash' : 'credit');
    const creditAccount = paymentType === 'credit' ? 'accounts_payable' : 'cash_on_hand';
    const journalLines = [line('inventory_asset', inventoryValue, 0, 'Inventory purchase')];
    if (tax) journalLines.push(line('tax_receivable', tax, 0, 'Input tax'));
    if (discount) journalLines.push(line('purchase_discount', 0, discount, 'Purchase discount'));
    journalLines.push(line(creditAccount, 0, totalCredit, paymentType === 'credit' ? 'Supplier payable' : 'Cash purchase'));
    const inventoryImpact = b().buildInventoryImpact(items, 'in', context.inventoryEngine);
    const base = {
      operation: paymentType === 'credit' ? 'credit_purchase' : 'cash_purchase',
      sourceType: 'purchase_invoice',
      sourceId: invoice.id || invoice.invoiceNo || '',
      journalLines,
      debitLines: journalLines.filter(row => row.debit > 0),
      creditLines: journalLines.filter(row => row.credit > 0),
      inventoryImpact,
      costImpact: inventoryValue,
      profitImpact: null,
      cashImpact: paymentType === 'credit' ? 0 : -totalCredit,
      customerSupplierImpact: paymentType === 'credit' ? totalCredit : 0,
      requiresCost: false
    };
    const reconciliation = ns.AccountingInventoryReconciler.reconcile(base);
    return Object.freeze({ ...base, validationErrors: Object.freeze(reconciliation.errors), warnings: Object.freeze(reconciliation.warnings), journalTotals: reconciliation.journalTotals, valid: reconciliation.valid });
  }

  ns.PurchasePostingPreviewEngine = Object.freeze({ version: '1.0.0', preview });
})(typeof globalThis !== 'undefined' ? globalThis : window);
