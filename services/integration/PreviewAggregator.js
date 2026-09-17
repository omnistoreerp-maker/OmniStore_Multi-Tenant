(function (root) {
  'use strict';
  const ns = root.OmniERPIntegration = root.OmniERPIntegration || {};
  const v = () => ns.IntegrationValidator;

  function relatedDocuments(document = {}) {
    return Object.freeze([
      document.id && { type: 'document', id: document.id },
      document.invoiceNo && { type: 'invoice', id: document.invoiceNo },
      document.customerId && { type: 'customer', id: document.customerId },
      document.supplierId && { type: 'supplier', id: document.supplierId },
      document.productionOrderId && { type: 'production_order', id: document.productionOrderId },
      document.reference && { type: 'reference', id: document.reference }
    ].filter(Boolean));
  }

  function aggregate(raw = {}, document = {}, validation = { errors: [], warnings: [] }) {
    const accountingEffect = raw.accountingEffect || ns.AccountingIntegrationAdapter.fromAutoPosting(raw);
    const inventoryEffect = Object.freeze(v().list(raw.inventoryImpact || raw.inventoryEffect));
    const costEffect = v().money(raw.costImpact ?? inventoryEffect.reduce((sum, row) => sum + v().number(row.costEffect ?? row.costImpact), 0));
    const errors = Object.freeze([...v().list(validation.errors), ...v().list(raw.validationErrors), ...v().list(accountingEffect.validationErrors)]);
    const warnings = Object.freeze([...v().list(validation.warnings), ...v().list(raw.warnings), ...v().list(accountingEffect.warnings)]);
    return Object.freeze({
      operation: raw.operation || validation.operation || 'unknown',
      sourceId: document.id || document.invoiceNo || document.reference || '',
      inventoryEffect,
      accountingEffect,
      costEffect,
      profitEffect: raw.profitImpact == null ? null : v().money(raw.profitImpact),
      cashEffect: v().money(raw.cashImpact),
      customerSupplierEffect: v().money(raw.customerSupplierImpact),
      validationErrors: errors,
      warnings,
      relatedDocuments: relatedDocuments(document),
      readOnly: true,
      persisted: false,
      posted: false
    });
  }

  ns.PreviewAggregator = Object.freeze({ version: '1.0.0', aggregate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
