(function (root) {
  'use strict';
  const ns = root.OmniERPIntegration = root.OmniERPIntegration || {};
  const v = () => ns.IntegrationValidator;

  function dispatch(document = {}, context = {}) {
    const type = v().detectType(document);
    const normalized = {
      sale: 'sales_invoice',
      sales: 'sales_invoice',
      sales_invoice: 'sales_invoice',
      purchase: 'purchase_invoice',
      purchases: 'purchase_invoice',
      purchase_invoice: 'purchase_invoice',
      sales_return: 'sales_return',
      sale_return: 'sales_return',
      purchase_return: 'purchase_return',
      pos: 'pos_sale',
      pos_sale: 'pos_sale',
      manufacturing_consumption: 'manufacturing_consumption',
      manufacturing_production: 'manufacturing_production',
      inventory_transfer: 'inventory_transfer',
      inventory_adjustment: 'inventory_adjustment',
      customer_payment: 'customer_payment',
      supplier_payment: 'supplier_payment'
    }[type] || type;
    const validation = v().validatePreviewRequest(normalized, document);
    let raw;
    if (normalized === 'sales_invoice') raw = ns.SalesIntegrationAdapter.preview(document, context);
    else if (normalized === 'purchase_invoice') raw = ns.PurchaseIntegrationAdapter.preview(document, context);
    else if (normalized === 'sales_return') raw = ns.SalesIntegrationAdapter.previewReturn(document, context);
    else if (normalized === 'purchase_return') raw = ns.PurchaseIntegrationAdapter.previewReturn(document, context);
    else if (normalized === 'pos_sale') raw = ns.POSIntegrationAdapter.preview(document, context);
    else if (normalized === 'manufacturing_consumption') raw = ns.ManufacturingIntegrationAdapter.consumption(document, context);
    else if (normalized === 'manufacturing_production') raw = ns.ManufacturingIntegrationAdapter.production(document, context);
    else if (normalized === 'inventory_transfer') raw = { operation: normalized, inventoryImpact: ns.InventoryIntegrationAdapter.transfer(document, context.inventoryEngine), journalLines: [], validationErrors: [], warnings: [], cashImpact: 0, profitImpact: null };
    else if (normalized === 'inventory_adjustment') raw = { operation: normalized, inventoryImpact: ns.InventoryIntegrationAdapter.effect([document], v().number(document.targetQty) >= v().number(document.currentQty) ? 'in' : 'out', context.inventoryEngine), journalLines: [], validationErrors: [], warnings: [], cashImpact: 0, profitImpact: null };
    else if (normalized === 'customer_payment') raw = context.autoPostingEngine ? context.autoPostingEngine.previewCustomerPayment(document) : { operation: normalized, validationErrors: [{ code: 'AUTO_POSTING_ENGINE_MISSING' }] };
    else if (normalized === 'supplier_payment') raw = context.autoPostingEngine ? context.autoPostingEngine.previewSupplierPayment(document) : { operation: normalized, validationErrors: [{ code: 'AUTO_POSTING_ENGINE_MISSING' }] };
    else raw = { operation: normalized, validationErrors: validation.errors, warnings: validation.warnings, inventoryImpact: [], journalLines: [] };
    return ns.PreviewAggregator.aggregate({ ...raw, operation: normalized }, document, { ...validation, operation: normalized });
  }

  ns.PreviewDispatcher = Object.freeze({ version: '1.0.0', dispatch });
})(typeof globalThis !== 'undefined' ? globalThis : window);
