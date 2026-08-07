(function (root) {
  'use strict';
  const ns = root.OmniPostingReadiness = root.OmniPostingReadiness || {};
  const v = () => ns.PostingReadinessValidator;

  function checkPreview(preview, source) {
    const issues = [];
    const totals = preview && preview.accountingEffect && preview.accountingEffect.totals || {};
    if (Math.abs(v().money(totals.difference)) > 0.01) issues.push(v().issue('critical', 'UNBALANCED_PREVIEW_JOURNAL', `Preview journal is unbalanced for ${source}.`, 'reconciliation', source, 'Fix accounting rule mapping before posting.'));
    v().list(preview && preview.inventoryEffect).forEach(row => {
      if (row.onHandAfter != null && row.onHandAfter < 0) issues.push(v().issue('critical', 'NEGATIVE_STOCK_RISK', `Preview may create negative stock for ${row.itemId}.`, 'reconciliation', row.itemId, 'Resolve stock or disable posting.'));
    });
    return issues;
  }

  function reconcile(context = {}) {
    const issues = [];
    const safeItems = [];
    const engine = context.integrationEngine;
    const documents = v().list(context.previewDocuments);
    if (engine && documents.length) {
      documents.forEach(doc => {
        const preview = engine.preview(doc);
        issues.push(...checkPreview(preview, doc.id || doc.docType));
      });
      safeItems.push(v().safe('PREVIEW_RECONCILIATION_DONE', `${documents.length} preview document(s) reconciled.`, 'reconciliation'));
    } else {
      safeItems.push(v().safe('RECONCILIATION_NO_DOCUMENTS', 'No preview documents supplied; reconciliation skipped safely.', 'reconciliation'));
    }
    return Object.freeze({ id: 'reconciliation', issues: Object.freeze(issues), safeItems: Object.freeze(safeItems) });
  }

  ns.ReconciliationEngine = Object.freeze({ version: '1.0.0', reconcile, checkPreview });
})(typeof globalThis !== 'undefined' ? globalThis : window);
