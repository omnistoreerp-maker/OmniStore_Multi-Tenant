(function (root) {
  'use strict';
  const ns = root.OmniRuntimeValidation = root.OmniRuntimeValidation || {};
  const u = () => ns.RuntimeValidationUtils;

  function validate(context = {}) {
    const { list, number, issue, result } = u();
    const issues = [];
    const products = list(context.products || (context.snapshot && context.snapshot.products));
    const requested = new Map();
    list(context.documents).forEach(doc => list(doc.items).forEach(line => {
      const id = String(line.productId || line.itemId || line.id || '');
      requested.set(id, (requested.get(id) || 0) + number(line.quantity != null ? line.quantity : line.qty));
    }));
    products.forEach((product, index) => {
      const id = String(product.id || product.productId || product.code || index);
      if (!product.id && !product.productId && !product.code) issues.push(issue('PRODUCT_ID_MISSING', 'Product has no stable identifier.', { severity: 'critical', blocking: true, source: 'inventory', reference: id }));
      if (!product.name && !product.productName) issues.push(issue('PRODUCT_NAME_MISSING', 'Product name is missing.', { source: 'inventory', reference: id }));
      const cost = number(product.cost != null ? product.cost : (product.buyPrice != null ? product.buyPrice : product.purchasePrice));
      if (!(cost > 0)) issues.push(issue('ITEM_COST_MISSING', 'Product cost must be greater than zero.', { severity: 'critical', blocking: true, source: 'inventory', reference: id }));
      const stock = number(product.onHandQty != null ? product.onHandQty : (product.stock != null ? product.stock : product.quantity));
      if (stock < 0) issues.push(issue('NEGATIVE_INVENTORY', 'Product currently has negative inventory.', { severity: 'critical', blocking: context.allowNegativeStock !== true, source: 'inventory', reference: id }));
      if ((requested.get(id) || 0) > stock && context.allowNegativeStock !== true) {
        issues.push(issue('INSUFFICIENT_INVENTORY', 'Requested quantity exceeds on-hand quantity.', { severity: 'critical', blocking: true, source: 'inventory', reference: id }));
      }
      const conversion = product.unitConversion != null ? product.unitConversion : product.conversionFactor;
      if (conversion != null && !(number(conversion) > 0)) issues.push(issue('INVALID_UNIT_CONVERSION', 'Unit conversion factor must be greater than zero.', { severity: 'critical', blocking: true, source: 'inventory', reference: id }));
    });
    return result('inventory', 'Inventory Readiness', issues, [
      { id: 'product_validity', passed: !issues.some(i => i.code === 'PRODUCT_ID_MISSING' || i.code === 'PRODUCT_NAME_MISSING') },
      { id: 'inventory_availability', passed: !issues.some(i => i.code === 'INSUFFICIENT_INVENTORY') },
      { id: 'item_costing', passed: !issues.some(i => i.code === 'ITEM_COST_MISSING') },
      { id: 'unit_conversions', passed: !issues.some(i => i.code === 'INVALID_UNIT_CONVERSION') }
    ]);
  }
  ns.InventoryRuntimeValidator = Object.freeze({ version: '1.0.0', validate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
