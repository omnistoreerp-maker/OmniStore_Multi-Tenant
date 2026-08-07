(function (root) {
  'use strict';
  const ns = root.OmniPostingReadiness = root.OmniPostingReadiness || {};
  const v = () => ns.PostingReadinessValidator;

  function productId(product) {
    return v().text(product.id || product.productId || product.code || product.sku);
  }

  function costOf(product) {
    return v().number(product.cost ?? product.buyPrice ?? product.purchasePrice ?? product.unitCost, 0);
  }

  function stockOf(product) {
    return v().number(product.stock ?? product.qty ?? product.quantity ?? product.currentStock, 0);
  }

  function check(context = {}) {
    const issues = [];
    const safeItems = [];
    const products = v().list(context.products || context.snapshot && context.snapshot.products);
    if (!products.length) issues.push(v().issue('warning', 'NO_PRODUCTS_FOR_INVENTORY_CHECK', 'No products found for inventory readiness check.', 'inventory', '', 'Verify product master data.'));
    products.forEach(product => {
      const id = productId(product);
      if (!(costOf(product) > 0)) issues.push(v().issue('critical', 'MISSING_PRODUCT_COST', `Product has no cost: ${product.name || id}`, 'inventory', id, 'Set product cost before posting COGS.'));
      if (!product.accountId && !product.inventoryAccount && !product.accountingAccount) issues.push(v().issue('warning', 'PRODUCT_WITHOUT_ACCOUNT', `Product has no accounting account mapping: ${product.name || id}`, 'inventory', id, 'Map product/category to inventory account.'));
      if (stockOf(product) < 0) issues.push(v().issue('critical', 'NEGATIVE_STOCK_RISK', `Product stock is negative: ${product.name || id}`, 'inventory', id, 'Resolve stock before real posting.'));
    });
    if (products.length && !issues.some(issue => issue.code === 'MISSING_PRODUCT_COST')) safeItems.push(v().safe('PRODUCT_COSTS_PRESENT', 'Product costs are present for checked products.', 'inventory'));
    return Object.freeze({ id: 'inventory', issues: Object.freeze(issues), safeItems: Object.freeze(safeItems) });
  }

  ns.InventoryReadinessChecker = Object.freeze({ version: '1.0.0', check, productId, costOf, stockOf });
})(typeof globalThis !== 'undefined' ? globalThis : window);
