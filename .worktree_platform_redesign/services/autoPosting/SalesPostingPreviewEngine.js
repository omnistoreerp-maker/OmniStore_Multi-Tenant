(function (root) {
  'use strict';

  const ns = root.OmniAutoPosting = root.OmniAutoPosting || {};
  const v = () => ns.AutoPostingValidator;
  const b = () => ns.InventoryAccountingBridge;

  function line(account, debit, credit, notes) {
    return Object.freeze({ account, debit: v().money(debit), credit: v().money(credit), notes: notes || '' });
  }

  function preview(invoice = {}, context = {}) {
    const items = v().list(invoice.items);
    const amount = v().money(invoice.amount ?? invoice.total ?? b().invoiceAmount(items));
    const tax = v().money(invoice.tax);
    const discount = v().money(invoice.discount);
    const netRevenue = v().money(amount - discount);
    const totalDebit = v().money(netRevenue + tax);
    const cost = b().salesCostImpact(items, context.inventoryEngine);
    const paymentType = invoice.paymentType || invoice.payment || (invoice.cash ? 'cash' : 'credit');
    const debitAccount = paymentType === 'credit' ? 'accounts_receivable' : 'cash_on_hand';
    const journalLines = [
      line(debitAccount, totalDebit, 0, paymentType === 'credit' ? 'Customer receivable' : 'Cash sale'),
      line('sales_revenue', 0, netRevenue, 'Sales revenue')
    ];
    if (tax) journalLines.push(line('tax_payable', 0, tax, 'Output tax'));
    if (discount) journalLines.push(line('sales_discount', discount, 0, 'Sales discount'));
    if (cost) {
      journalLines.push(line('cost_of_sales', cost, 0, 'Cost of goods sold'));
      journalLines.push(line('inventory_asset', 0, cost, 'Inventory issue'));
    }
    const inventoryImpact = b().buildInventoryImpact(items, 'out', context.inventoryEngine);
    const base = {
      operation: paymentType === 'credit' ? 'credit_sale' : 'cash_sale',
      sourceType: 'sales_invoice',
      sourceId: invoice.id || invoice.invoiceNo || '',
      journalLines,
      debitLines: journalLines.filter(row => row.debit > 0),
      creditLines: journalLines.filter(row => row.credit > 0),
      inventoryImpact,
      costImpact: cost,
      profitImpact: cost ? v().money(netRevenue - cost) : null,
      cashImpact: paymentType === 'credit' ? 0 : totalDebit,
      customerSupplierImpact: paymentType === 'credit' ? totalDebit : 0,
      requiresCost: true
    };
    const reconciliation = ns.AccountingInventoryReconciler.reconcile(base);
    return Object.freeze({ ...base, validationErrors: Object.freeze(reconciliation.errors), warnings: Object.freeze(reconciliation.warnings), journalTotals: reconciliation.journalTotals, valid: reconciliation.valid });
  }

  ns.SalesPostingPreviewEngine = Object.freeze({ version: '1.0.0', preview });
})(typeof globalThis !== 'undefined' ? globalThis : window);
