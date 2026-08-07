(function (root) {
  'use strict';

  const ns = root.OmniAccountingPersistence = root.OmniAccountingPersistence || {};

  function plan() {
    return Object.freeze({
      mode: 'draft-only',
      destructiveIfExecuted: true,
      requiresBackupBeforeExecution: true,
      steps: Object.freeze([
        'Confirm no production accounting entries exist or export a backup.',
        'Disable future accounting posting integrations.',
        'Run rollback_accounting_schema.sql manually in a reviewed database session only if approved.',
        'Verify accounting_* tables and RLS policies are removed.',
        'Keep application code unchanged because Phase 11 is not imported into the UI.'
      ]),
      files: Object.freeze(['database/accounting/rollback_accounting_schema.sql'])
    });
  }

  ns.AccountingRollbackPlanner = Object.freeze({ version: '1.0.0', plan });
})(typeof globalThis !== 'undefined' ? globalThis : window);
