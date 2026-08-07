(function (root) {
  'use strict';
  const ns = root.OmniPostingReadiness = root.OmniPostingReadiness || {};
  const v = () => ns.PostingReadinessValidator;

  function check(context = {}) {
    const issues = [];
    const safeItems = [];
    const purchases = v().list(context.purchaseInvoices || context.snapshot && (context.snapshot.purchaseInvoices || context.snapshot.purchases));
    const supplierIds = new Set(v().list(context.suppliers || context.snapshot && context.snapshot.suppliers).map(supplier => v().text(supplier.id || supplier.supplierId || supplier.phone)));
    const refs = new Set();
    purchases.forEach(invoice => {
      const ref = v().text(invoice.id || invoice.invoiceNo || invoice.number);
      if (ref && refs.has(ref)) issues.push(v().issue('warning', 'DUPLICATE_DOCUMENT_REFERENCE', `Duplicate purchase reference: ${ref}`, 'purchase', ref, 'Deduplicate purchase references before posting.'));
      if (ref) refs.add(ref);
      if (!v().list(invoice.items).length) issues.push(v().issue('critical', 'PURCHASE_WITHOUT_ITEMS', `Purchase invoice has no items: ${ref}`, 'purchase', ref, 'Ensure purchase invoice has linked items.'));
      const supplierId = v().text(invoice.supplierId || invoice.supplier_id);
      if (supplierId && supplierIds.size && !supplierIds.has(supplierId)) issues.push(v().issue('warning', 'MISSING_SUPPLIER', `Purchase invoice supplier missing: ${supplierId}`, 'purchase', ref, 'Create/link supplier before payable posting.'));
    });
    if (purchases.length) safeItems.push(v().safe('PURCHASE_DOCUMENTS_SCANNED', `${purchases.length} purchase invoice(s) scanned.`, 'purchase'));
    return Object.freeze({ id: 'purchase', issues: Object.freeze(issues), safeItems: Object.freeze(safeItems) });
  }

  ns.PurchaseReadinessChecker = Object.freeze({ version: '1.0.0', check });
})(typeof globalThis !== 'undefined' ? globalThis : window);
