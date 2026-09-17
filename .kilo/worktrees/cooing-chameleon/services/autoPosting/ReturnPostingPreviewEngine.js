(function (root) {
  'use strict';

  const ns = root.OmniAutoPosting = root.OmniAutoPosting || {};
  const v = () => ns.AutoPostingValidator;
  const b = () => ns.InventoryAccountingBridge;
  const line = (account, debit, credit, notes) => Object.freeze({ account, debit: v().money(debit), credit: v().money(credit), notes: notes || '' });

  function salesReturn(returnDoc = {}, context = {}) {
    const items = v().list(returnDoc.items);
    const amount = v().money(returnDoc.amount ?? returnDoc.total ?? b().invoiceAmount(items));
    const cost = b().salesCostImpact(items, context.inventoryEngine);
    const settlement = returnDoc.paymentType === 'credit' ? 'accounts_receivable' : 'cash_on_hand';
    const journalLines = [
      line('sales_revenue', amount, 0, 'Reverse sales revenue'),
      line(settlement, 0, amount, 'Refund or reduce customer balance')
    ];
    if (cost) {
      journalLines.push(line('inventory_asset', cost, 0, 'Return inventory'));
      journalLines.push(line('cost_of_sales', 0, cost, 'Reverse COGS'));
    }
    const base = {
      operation: 'sales_return',
      sourceType: 'sales_return',
      sourceId: returnDoc.id || '',
      journalLines,
      debitLines: journalLines.filter(row => row.debit > 0),
      creditLines: journalLines.filter(row => row.credit > 0),
      inventoryImpact: b().buildInventoryImpact(items, 'in', context.inventoryEngine),
      costImpact: v().money(-cost),
      profitImpact: cost ? v().money(-(amount - cost)) : null,
      cashImpact: returnDoc.paymentType === 'credit' ? 0 : -amount,
      customerSupplierImpact: returnDoc.paymentType === 'credit' ? -amount : 0,
      requiresCost: true
    };
    const reconciliation = ns.AccountingInventoryReconciler.reconcile(base);
    return Object.freeze({ ...base, validationErrors: Object.freeze(reconciliation.errors), warnings: Object.freeze(reconciliation.warnings), journalTotals: reconciliation.journalTotals, valid: reconciliation.valid });
  }

  function purchaseReturn(returnDoc = {}, context = {}) {
    const items = v().list(returnDoc.items);
    const amount = v().money(returnDoc.amount ?? returnDoc.total ?? b().invoiceAmount(items));
    const settlement = returnDoc.paymentType === 'credit' ? 'accounts_payable' : 'cash_on_hand';
    const journalLines = [
      line(settlement, amount, 0, 'Cash refund or reduce supplier payable'),
      line('inventory_asset', 0, amount, 'Return inventory to supplier')
    ];
    const base = {
      operation: 'purchase_return',
      sourceType: 'purchase_return',
      sourceId: returnDoc.id || '',
      journalLines,
      debitLines: journalLines.filter(row => row.debit > 0),
      creditLines: journalLines.filter(row => row.credit > 0),
      inventoryImpact: b().buildInventoryImpact(items, 'out', context.inventoryEngine),
      costImpact: v().money(-amount),
      profitImpact: null,
      cashImpact: returnDoc.paymentType === 'credit' ? 0 : amount,
      customerSupplierImpact: returnDoc.paymentType === 'credit' ? -amount : 0,
      requiresCost: false
    };
    const reconciliation = ns.AccountingInventoryReconciler.reconcile(base);
    return Object.freeze({ ...base, validationErrors: Object.freeze(reconciliation.errors), warnings: Object.freeze(reconciliation.warnings), journalTotals: reconciliation.journalTotals, valid: reconciliation.valid });
  }

  ns.ReturnPostingPreviewEngine = Object.freeze({ version: '1.0.0', salesReturn, purchaseReturn });
})(typeof globalThis !== 'undefined' ? globalThis : window);
