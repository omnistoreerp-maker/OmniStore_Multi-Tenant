(function (root) {
  'use strict';
  const ns = root.OmniERPIntegration = root.OmniERPIntegration || {};

  function createEngine(context = {}) {
    const safeContext = Object.freeze({
      accountingEngine: context.accountingEngine || null,
      inventoryEngine: context.inventoryEngine || null,
      autoPostingEngine: context.autoPostingEngine || null
    });
    return Object.freeze({
      preview: document => ns.PreviewDispatcher.dispatch(document, safeContext),
      previewMany: documents => Object.freeze((Array.isArray(documents) ? documents : []).map(document => ns.PreviewDispatcher.dispatch(document, safeContext))),
      detectType: document => ns.IntegrationValidator.detectType(document),
      validate: document => ns.IntegrationValidator.validatePreviewRequest(ns.IntegrationValidator.detectType(document), document),
      contextStatus: () => Object.freeze({
        hasAccountingEngine: !!safeContext.accountingEngine,
        hasInventoryEngine: !!safeContext.inventoryEngine,
        hasAutoPostingEngine: !!safeContext.autoPostingEngine,
        readOnly: true
      })
    });
  }

  ns.ERPIntegrationEngine = Object.freeze({ version: '1.0.0', createEngine });
})(typeof globalThis !== 'undefined' ? globalThis : window);
