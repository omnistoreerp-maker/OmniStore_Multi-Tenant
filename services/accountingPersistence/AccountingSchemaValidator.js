(function (root) {
  'use strict';

  const ns = root.OmniAccountingPersistence = root.OmniAccountingPersistence || {};
  const REQUIRED_FILES = Object.freeze([
    '001_chart_of_accounts.sql',
    '002_fiscal_years_periods.sql',
    '003_journal_vouchers.sql',
    '004_journal_lines.sql',
    '005_account_balances.sql',
    '006_audit_log.sql',
    '007_permissions_rls.sql',
    'rollback_accounting_schema.sql'
  ]);

  const REQUIRED_TABLES = Object.freeze([
    'accounting_chart_of_accounts',
    'accounting_fiscal_years',
    'accounting_fiscal_periods',
    'accounting_journal_vouchers',
    'accounting_journal_lines',
    'accounting_account_balances',
    'accounting_audit_log'
  ]);

  const REQUIRED_COLUMNS = Object.freeze({
    accounting_chart_of_accounts: ['account_code', 'account_name', 'account_type', 'normal_side', 'currency', 'branch_id', 'cost_center_id', 'project_id'],
    accounting_fiscal_years: ['fiscal_year_code', 'start_date', 'end_date', 'status'],
    accounting_fiscal_periods: ['fiscal_year_id', 'period_code', 'start_date', 'end_date', 'status'],
    accounting_journal_vouchers: ['voucher_number', 'voucher_type', 'posting_date', 'posting_status', 'currency', 'exchange_rate', 'reversed_from_voucher_id', 'reversal_voucher_id', 'customer_reference', 'supplier_reference', 'inventory_transaction_reference', 'sales_invoice_reference', 'purchase_invoice_reference'],
    accounting_journal_lines: ['voucher_id', 'line_number', 'account_id', 'debit', 'credit', 'currency', 'exchange_rate', 'branch_id', 'cost_center_id', 'project_id', 'customer_reference', 'supplier_reference', 'inventory_transaction_reference', 'sales_invoice_reference', 'purchase_invoice_reference'],
    accounting_account_balances: ['account_id', 'fiscal_year_id', 'fiscal_period_id', 'opening_balance', 'debit_total', 'credit_total', 'closing_balance'],
    accounting_audit_log: ['action', 'entity_type', 'entity_id', 'voucher_id', 'actor_id', 'before_snapshot', 'after_snapshot']
  });

  function includesAll(source, required) {
    const lower = String(source || '').toLowerCase();
    return required.filter(item => !lower.includes(String(item).toLowerCase()));
  }

  function validateFiles(fileMap = {}) {
    return REQUIRED_FILES.filter(file => !Object.prototype.hasOwnProperty.call(fileMap, file));
  }

  function validateTables(sqlText = '') {
    return includesAll(sqlText, REQUIRED_TABLES);
  }

  function validateColumns(sqlText = '') {
    const missing = {};
    Object.entries(REQUIRED_COLUMNS).forEach(([table, columns]) => {
      const absent = includesAll(sqlText, columns);
      if (absent.length) missing[table] = absent;
    });
    return missing;
  }

  function validateRls(sqlText = '') {
    const lower = String(sqlText || '').toLowerCase();
    const missingEnable = REQUIRED_TABLES.filter(table => !lower.includes(`alter table ${table} enable row level security`));
    const missingPolicy = REQUIRED_TABLES.filter(table => !lower.includes(` on ${table}`));
    return { missingEnable, missingPolicy };
  }

  function validateRollback(sqlText = '') {
    const missingTables = REQUIRED_TABLES.filter(table => !String(sqlText || '').toLowerCase().includes(`drop table if exists ${table}`));
    const policyKeywordMissing = !String(sqlText || '').toLowerCase().includes('drop policy if exists');
    return { missingTables, policyKeywordMissing };
  }

  ns.AccountingSchemaValidator = Object.freeze({
    version: '1.0.0',
    REQUIRED_FILES,
    REQUIRED_TABLES,
    REQUIRED_COLUMNS,
    validateFiles,
    validateTables,
    validateColumns,
    validateRls,
    validateRollback
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
