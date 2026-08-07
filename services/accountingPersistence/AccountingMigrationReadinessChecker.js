(function (root) {
  'use strict';

  const ns = root.OmniAccountingPersistence = root.OmniAccountingPersistence || {};

  function check(fileMap = {}) {
    const sql = Object.values(fileMap).join('\n').toLowerCase();
    const missingFiles = ns.AccountingSchemaValidator.validateFiles(fileMap);
    const missingTables = ns.AccountingSchemaValidator.validateTables(sql);
    const missingColumns = ns.AccountingSchemaValidator.validateColumns(sql);
    const rls = ns.AccountingSchemaValidator.validateRls(fileMap['007_permissions_rls.sql'] || '');
    const rollback = ns.AccountingSchemaValidator.validateRollback(fileMap['rollback_accounting_schema.sql'] || '');
    const forbiddenRuntime = ['create' + 'client', 'supa' + 'base.', 'fet' + 'ch(', 'ex' + 'ec(', 'que' + 'ry(', 'local' + 'storage'].filter(token => sql.includes(token));
    return Object.freeze({
      readyForManualReview: missingFiles.length === 0 && missingTables.length === 0 && Object.keys(missingColumns).length === 0 && rls.missingEnable.length === 0 && rollback.missingTables.length === 0 && forbiddenRuntime.length === 0,
      missingFiles,
      missingTables,
      missingColumns,
      rls,
      rollback,
      forbiddenRuntime,
      notes: Object.freeze([
        'Readiness means ready for human review, not safe for automatic execution.',
        'This checker never connects to Supabase and never executes SQL.'
      ])
    });
  }

  ns.AccountingMigrationReadinessChecker = Object.freeze({ version: '1.0.0', check });
})(typeof globalThis !== 'undefined' ? globalThis : window);
