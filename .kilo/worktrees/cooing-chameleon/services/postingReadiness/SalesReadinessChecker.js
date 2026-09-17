(function (root) {
  'use strict';
  const ns = root.OmniPostingReadiness = root.OmniPostingReadiness || {};
  const v = () => ns.PostingReadinessValidator;

  function items(invoice) {
    return v().list(invoice && invoice.items);
  }

  function check(context = {}) {
    const issues = [];
    const safeItems = [];
    const invoices = v().list(context.salesInvoices || context.snapshot && (context.snapshot.salesInvoices || context.snapshot.saleInvoices));
    const productIds = new Set(v().list(context.products || context.snapshot && context.snapshot.products).map(product => v().text(product.id || product.productId || product.code)));
    const customerIds = new Set(v().list(context.customers || context.snapshot && context.snapshot.customers).map(customer => v().text(customer.id || customer.customerId || customer.phone)));
    const references = new Set();
    invoices.forEach(invoice => {
      const ref = v().text(invoice.id || invoice.invoiceNo || invoice.number);
      if (ref && references.has(ref)) issues.push(v().issue('warning', 'DUPLICATE_DOCUMENT_REFERENCE', `Duplicate sales reference: ${ref}`, 'sales', ref, 'Deduplicate document references before posting.'));
      if (ref) references.add(ref);
      if (!items(invoice).length) issues.push(v().issue('critical', 'INVOICE_WITHOUT_ITEMS', `Sales invoice has no items: ${ref}`, 'sales', ref, 'Ensure invoice items are linked.'));
      items(invoice).forEach(item => {
        const productId = v().text(item.productId || item.itemId || item.product_id);
        if (productId && productIds.size && !productIds.has(productId)) issues.push(v().issue('critical', 'INVOICE_PRODUCT_LINK_MISSING', `Sales invoice item is not linked to product: ${ref}`, 'sales', productId, 'Link invoice item to a product.'));
      });
      const customerId = v().text(invoice.customerId || invoice.customer_id);
      if (customerId && customerIds.size && !customerIds.has(customerId)) issues.push(v().issue('warning', 'MISSING_CUSTOMER', `Sales invoice customer missing: ${customerId}`, 'sales', ref, 'Create/link customer before receivable posting.'));
    });
    if (invoices.length) safeItems.push(v().safe('SALES_DOCUMENTS_SCANNED', `${invoices.length} sales invoice(s) scanned.`, 'sales'));
    return Object.freeze({ id: 'sales', issues: Object.freeze(issues), safeItems: Object.freeze(safeItems) });
  }

  ns.SalesReadinessChecker = Object.freeze({ version: '1.0.0', check });
})(typeof globalThis !== 'undefined' ? globalThis : window);
