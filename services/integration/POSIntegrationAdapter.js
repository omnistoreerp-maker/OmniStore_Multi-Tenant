(function (root) {
  'use strict';
  const ns = root.OmniERPIntegration = root.OmniERPIntegration || {};

  function preview(document = {}, context = {}) {
    const saleDocument = { ...document, paymentType: document.paymentType || 'cash', source: 'pos' };
    return ns.SalesIntegrationAdapter.preview(saleDocument, context);
  }

  ns.POSIntegrationAdapter = Object.freeze({ version: '1.0.0', preview });
})(typeof globalThis !== 'undefined' ? globalThis : window);
