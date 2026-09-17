(function (root) {
  'use strict';
  const ns = root.OmniERPIntegration = root.OmniERPIntegration || {};

  function preview(document = {}, context = {}) {
    const auto = context.autoPostingEngine;
    if (auto) return document.paymentType === 'cash' ? auto.previewCashPurchase(document) : auto.previewCreditPurchase(document);
    return { operation: 'purchase_invoice', journalLines: [], inventoryImpact: [], validationErrors: [{ code: 'AUTO_POSTING_ENGINE_MISSING' }], warnings: [] };
  }

  function previewReturn(document = {}, context = {}) {
    const auto = context.autoPostingEngine;
    if (auto) return auto.previewPurchaseReturn(document);
    return { operation: 'purchase_return', journalLines: [], inventoryImpact: [], validationErrors: [{ code: 'AUTO_POSTING_ENGINE_MISSING' }], warnings: [] };
  }

  ns.PurchaseIntegrationAdapter = Object.freeze({ version: '1.0.0', preview, previewReturn });
})(typeof globalThis !== 'undefined' ? globalThis : window);
