(function (root) {
  'use strict';
  const ns = root.OmniSaaSAdmin = root.OmniSaaSAdmin || {};
  function normalize(value) {
    value = value || {};
    return Object.freeze({
      invoices: Object.freeze(value.invoices || []),
      payments: Object.freeze(value.payments || []),
      renewals: Object.freeze(value.renewals || []),
      subscriptionHistory: Object.freeze(value.subscriptionHistory || []),
      revenuePreview: Number(value.revenuePreview || 0),
      realGatewayConnected: false,
      previewOnly: true
    });
  }
  ns.BillingPreviewEngine = Object.freeze({ version: '1.0.0', normalize });
})(typeof globalThis !== 'undefined' ? globalThis : window);
