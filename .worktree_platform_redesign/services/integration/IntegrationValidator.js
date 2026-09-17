(function (root) {
  'use strict';

  const ns = root.OmniERPIntegration = root.OmniERPIntegration || {};
  const list = value => Array.isArray(value) ? value : [];
  const text = value => String(value == null ? '' : value).trim();
  const number = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const money = value => Math.round((number(value) + Number.EPSILON) * 100) / 100;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  function detectType(document = {}) {
    const explicit = text(document.operation || document.type || document.docType || document.kind).toLowerCase();
    if (explicit) return explicit;
    if (document.pos === true || document.posSale === true) return 'pos_sale';
    if (document.manufacturingType === 'consumption') return 'manufacturing_consumption';
    if (document.manufacturingType === 'production') return 'manufacturing_production';
    if (document.fromWarehouseId && document.toWarehouseId) return 'inventory_transfer';
    if (document.targetQty != null || document.adjustment === true) return 'inventory_adjustment';
    if (document.customerId && document.amount && !list(document.items).length) return 'customer_payment';
    if (document.supplierId && document.amount && !list(document.items).length) return 'supplier_payment';
    return 'unknown';
  }

  function validatePreviewRequest(type, document = {}) {
    const errors = [];
    const warnings = [];
    if (!type || type === 'unknown') errors.push({ code: 'UNKNOWN_DOCUMENT_TYPE', message: 'Could not detect ERP document type.' });
    if (['sales_invoice', 'purchase_invoice', 'sales_return', 'purchase_return', 'pos_sale'].includes(type) && !list(document.items).length) {
      errors.push({ code: 'ITEMS_REQUIRED', message: 'Document requires items for preview.' });
    }
    if (['customer_payment', 'supplier_payment'].includes(type) && !(number(document.amount) > 0)) {
      errors.push({ code: 'AMOUNT_REQUIRED', message: 'Payment amount is required.' });
    }
    if (['inventory_transfer'].includes(type) && (!document.fromWarehouseId || !document.toWarehouseId)) {
      errors.push({ code: 'TRANSFER_WAREHOUSES_REQUIRED', message: 'Transfer requires from/to warehouses.' });
    }
    if (['manufacturing_consumption', 'manufacturing_production'].includes(type) && !list(document.items || document.components || document.outputs).length) {
      warnings.push({ code: 'MANUFACTURING_LINES_EMPTY', message: 'Manufacturing preview has no item lines.' });
    }
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), warnings: Object.freeze(warnings) });
  }

  ns.IntegrationValidator = Object.freeze({ version: '1.0.0', list, text, number, money, clone, detectType, validatePreviewRequest });
})(typeof globalThis !== 'undefined' ? globalThis : window);
