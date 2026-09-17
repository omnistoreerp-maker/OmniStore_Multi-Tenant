(function (root) {
  'use strict';
  const ns = root.OmniERPIntegration = root.OmniERPIntegration || {};

  function preview(document = {}, context = {}) {
    const auto = context.autoPostingEngine;
    if (auto) return document.paymentType === 'credit' ? auto.previewCreditSale(document) : auto.previewCashSale(document);
    return { operation: 'sales_invoice', journalLines: [], inventoryImpact: [], validationErrors: [{ code: 'AUTO_POSTING_ENGINE_MISSING' }], warnings: [] };
  }

  function previewReturn(document = {}, context = {}) {
    const auto = context.autoPostingEngine;
    if (auto) return auto.previewSalesReturn(document);
    return { operation: 'sales_return', journalLines: [], inventoryImpact: [], validationErrors: [{ code: 'AUTO_POSTING_ENGINE_MISSING' }], warnings: [] };
  }

  ns.SalesIntegrationAdapter = Object.freeze({ version: '1.0.0', preview, previewReturn });
})(typeof globalThis !== 'undefined' ? globalThis : window);
