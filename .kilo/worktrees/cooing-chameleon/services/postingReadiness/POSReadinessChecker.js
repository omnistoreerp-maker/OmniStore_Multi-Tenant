(function (root) {
  'use strict';
  const ns = root.OmniPostingReadiness = root.OmniPostingReadiness || {};
  const v = () => ns.PostingReadinessValidator;

  function check(context = {}) {
    const issues = [];
    const safeItems = [];
    const posDocs = v().list(context.posSales || context.snapshot && context.snapshot.posSales);
    posDocs.forEach(doc => {
      const ref = v().text(doc.id || doc.invoiceNo);
      if (!v().list(doc.items).length) issues.push(v().issue('critical', 'POS_SALE_WITHOUT_ITEMS', `POS sale has no items: ${ref}`, 'pos', ref, 'Ensure POS sale items are linked.'));
      if (doc.paymentType === 'cash' && !(v().number(doc.total || doc.amount) >= 0)) issues.push(v().issue('warning', 'POS_CASH_AMOUNT_MISSING', `POS cash sale amount missing: ${ref}`, 'pos', ref, 'Verify POS total.'));
    });
    safeItems.push(v().safe('POS_CHECK_READ_ONLY', 'POS readiness check completed without modifying POS.', 'pos'));
    return Object.freeze({ id: 'pos', issues: Object.freeze(issues), safeItems: Object.freeze(safeItems) });
  }

  ns.POSReadinessChecker = Object.freeze({ version: '1.0.0', check });
})(typeof globalThis !== 'undefined' ? globalThis : window);
