(function (root) {
  'use strict';

  const ns = root.OmniAutoPosting = root.OmniAutoPosting || {};
  const v = () => ns.AutoPostingValidator;

  function reconcile(preview) {
    const warnings = [];
    const errors = [];
    const costFromInventory = v().money(v().list(preview.inventoryImpact).reduce((sum, row) => sum + v().number(row.costImpact), 0));
    if (preview.costImpact != null && Math.abs(v().money(preview.costImpact - costFromInventory)) > 0.01) {
      warnings.push({ code: 'COST_INVENTORY_MISMATCH', costImpact: preview.costImpact, inventoryCost: costFromInventory, message: 'Cost impact differs from inventory impact.' });
    }
    if (v().list(preview.inventoryImpact).some(row => row.onHandAfter != null && row.onHandAfter < 0)) {
      warnings.push({ code: 'NEGATIVE_STOCK_PREVIEW', message: 'Inventory preview would result in negative stock.' });
    }
    const journal = ns.AutoPostingValidator.validateJournal(preview.journalLines || [], { cost: preview.costImpact, requireCost: preview.requiresCost });
    return Object.freeze({
      valid: errors.length === 0 && journal.valid,
      errors: Object.freeze([...errors, ...journal.errors]),
      warnings: Object.freeze([...warnings, ...journal.warnings]),
      journalTotals: journal.totals
    });
  }

  ns.AccountingInventoryReconciler = Object.freeze({ version: '1.0.0', reconcile });
})(typeof globalThis !== 'undefined' ? globalThis : window);
