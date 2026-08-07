(function (root) {
  'use strict';

  const ns = root.OmniAutoPosting = root.OmniAutoPosting || {};

  function createEngine(context = {}) {
    const safeContext = Object.freeze({ accountingEngine: context.accountingEngine || null, inventoryEngine: context.inventoryEngine || null });
    return Object.freeze({
      previewCashSale: invoice => ns.SalesPostingPreviewEngine.preview({ ...invoice, paymentType: 'cash' }, safeContext),
      previewCreditSale: invoice => ns.SalesPostingPreviewEngine.preview({ ...invoice, paymentType: 'credit' }, safeContext),
      previewSale: invoice => ns.SalesPostingPreviewEngine.preview(invoice, safeContext),
      previewCashPurchase: invoice => ns.PurchasePostingPreviewEngine.preview({ ...invoice, paymentType: 'cash' }, safeContext),
      previewCreditPurchase: invoice => ns.PurchasePostingPreviewEngine.preview({ ...invoice, paymentType: 'credit' }, safeContext),
      previewPurchase: invoice => ns.PurchasePostingPreviewEngine.preview(invoice, safeContext),
      previewSalesReturn: returnDoc => ns.ReturnPostingPreviewEngine.salesReturn(returnDoc, safeContext),
      previewPurchaseReturn: returnDoc => ns.ReturnPostingPreviewEngine.purchaseReturn(returnDoc, safeContext),
      previewCustomerPayment: payment => ns.PaymentPostingPreviewEngine.customerPayment(payment, safeContext),
      previewSupplierPayment: payment => ns.PaymentPostingPreviewEngine.supplierPayment(payment, safeContext),
      validateJournal: lines => ns.AutoPostingValidator.validateJournal(lines),
      reconcile: preview => ns.AccountingInventoryReconciler.reconcile(preview)
    });
  }

  ns.AutoPostingEngine = Object.freeze({ version: '1.0.0', createEngine });
})(typeof globalThis !== 'undefined' ? globalThis : window);
