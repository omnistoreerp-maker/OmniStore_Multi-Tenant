(function (root) {
  'use strict';
  const ns = root.OmniRuntimeValidation = root.OmniRuntimeValidation || {};
  function validate(context = {}) {
    const { list, number, issue, result } = ns.RuntimeValidationUtils;
    const issues = [];
    const previews = list(context.previews);
    const documents = list(context.documents);
    if (documents.length && previews.length !== documents.length) {
      issues.push(issue('PREVIEW_COUNT_MISMATCH', 'Every runtime document must have exactly one preview.', { severity: 'critical', blocking: true, source: 'posting' }));
    }
    previews.forEach((preview, index) => {
      if (preview.valid === false || list(preview.validationErrors || preview.errors).length) {
        issues.push(issue('PREVIEW_VALIDATION_FAILED', 'Preview contains validation errors.', { severity: 'critical', blocking: true, source: 'posting', reference: String(index + 1) }));
      }
      const inventory = preview.inventoryEffect || {};
      const accounting = preview.accountingEffect || {};
      const inventoryCost = number(inventory.costImpact != null ? inventory.costImpact : preview.costImpact);
      const accountingCost = number(accounting.costImpact != null ? accounting.costImpact : preview.costImpact);
      if (inventoryCost && accountingCost && Math.abs(inventoryCost - accountingCost) > 0.01) {
        issues.push(issue('CROSS_MODULE_COST_MISMATCH', 'Inventory and accounting cost effects do not match.', { severity: 'critical', blocking: true, source: 'posting', reference: String(index + 1) }));
      }
      if (preview.readOnly === false || preview.persisted === true || preview.posted === true) {
        issues.push(issue('PREVIEW_NOT_READ_ONLY', 'Runtime preview is not marked read-only.', { severity: 'critical', blocking: true, source: 'posting', reference: String(index + 1) }));
      }
    });
    const reconciliation = context.reconciliation || {};
    if (reconciliation.inventoryBalanced === false) issues.push(issue('INVENTORY_RECONCILIATION_FAILED', 'Inventory reconciliation has a mismatch.', { severity: 'critical', blocking: true, source: 'posting' }));
    if (reconciliation.accountingBalanced === false) issues.push(issue('ACCOUNTING_RECONCILIATION_FAILED', 'Accounting reconciliation has a mismatch.', { severity: 'critical', blocking: true, source: 'posting' }));
    return result('posting', 'Posting Eligibility', issues, [
      { id: 'preview_consistency', passed: !issues.some(i => /PREVIEW/.test(i.code)) },
      { id: 'cross_module_consistency', passed: !issues.some(i => i.code === 'CROSS_MODULE_COST_MISMATCH') },
      { id: 'inventory_reconciliation', passed: !issues.some(i => i.code === 'INVENTORY_RECONCILIATION_FAILED') },
      { id: 'accounting_reconciliation', passed: !issues.some(i => i.code === 'ACCOUNTING_RECONCILIATION_FAILED') }
    ]);
  }
  ns.PostingRuntimeValidator = Object.freeze({ version: '1.0.0', validate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
