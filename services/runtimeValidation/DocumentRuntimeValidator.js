(function (root) {
  'use strict';
  const ns = root.OmniRuntimeValidation = root.OmniRuntimeValidation || {};
  const SUPPORTED = Object.freeze(['sales_invoice','purchase_invoice','sales_return','purchase_return','pos_sale','manufacturing_consumption','manufacturing_production','inventory_transfer','inventory_adjustment','customer_payment','supplier_payment']);
  function validate(context = {}) {
    const { list, issue, result, documentRef } = ns.RuntimeValidationUtils;
    const issues = [];
    const refs = new Set();
    list(context.documents).forEach((doc, index) => {
      const ref = documentRef(doc);
      const type = String(doc.type || doc.docType || doc.operation || '').toLowerCase();
      if (!ref) issues.push(issue('DOCUMENT_REFERENCE_MISSING', 'Document reference is required.', { severity: 'critical', blocking: true, source: 'document', reference: String(index + 1) }));
      if (ref && refs.has(ref)) issues.push(issue('DUPLICATE_REFERENCE', 'Duplicate document reference detected.', { severity: 'critical', blocking: true, source: 'document', reference: ref }));
      refs.add(ref);
      if (!SUPPORTED.includes(type)) issues.push(issue('UNSUPPORTED_OPERATION', 'Document operation is not supported by runtime validation.', { severity: 'critical', blocking: true, source: 'document', reference: ref || String(index + 1) }));
      if (!['customer_payment','supplier_payment'].includes(type) && !list(doc.items).length) issues.push(issue('DOCUMENT_ITEMS_MISSING', 'Document has no item lines.', { severity: 'critical', blocking: true, source: 'document', reference: ref }));
      list(doc.items).forEach(line => {
        if (!line.productId && !line.itemId && !line.id) issues.push(issue('DOCUMENT_PRODUCT_LINK_MISSING', 'Document line is not linked to a product.', { severity: 'critical', blocking: true, source: 'document', reference: ref }));
      });
      if (/sales|pos|customer/.test(type) && type !== 'pos_sale' && !doc.customerId && !doc.customer) issues.push(issue('CUSTOMER_MISSING', 'Customer reference is missing.', { severity: 'critical', blocking: true, source: 'document', reference: ref }));
      if (/purchase|supplier/.test(type) && !doc.supplierId && !doc.supplier) issues.push(issue('SUPPLIER_MISSING', 'Supplier reference is missing.', { severity: 'critical', blocking: true, source: 'document', reference: ref }));
    });
    return result('document', 'Document Integrity', issues, [
      { id: 'document_integrity', passed: !issues.length },
      { id: 'duplicate_references', passed: !issues.some(i => i.code === 'DUPLICATE_REFERENCE') }
    ]);
  }
  ns.DocumentRuntimeValidator = Object.freeze({ version: '1.0.0', SUPPORTED, validate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
