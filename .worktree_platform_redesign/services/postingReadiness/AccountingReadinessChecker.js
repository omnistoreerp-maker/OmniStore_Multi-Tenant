(function (root) {
  'use strict';

  const ns = root.OmniPostingReadiness = root.OmniPostingReadiness || {};
  const v = () => ns.PostingReadinessValidator;

  const REQUIRED_ACCOUNTS = Object.freeze(['cash_on_hand', 'bank_main', 'inventory_asset', 'sales_revenue', 'cost_of_sales', 'accounts_receivable', 'accounts_payable']);
  const TAX_ACCOUNTS = Object.freeze(['tax_payable', 'tax_receivable']);

  function check(context = {}) {
    const issues = [];
    const safeItems = [];
    const accountingEngine = context.accountingEngine;
    const state = accountingEngine && accountingEngine.getState ? accountingEngine.getState() : context.accountingState || {};
    const accounts = v().list(state.chartOfAccounts);
    const ids = new Set(accounts.map(account => account.id || account.account || account.account_code));
    if (!accounts.length) issues.push(v().issue('critical', 'MISSING_CHART_OF_ACCOUNTS', 'Chart of Accounts is missing.', 'accounting', '', 'Create/review Chart of Accounts before posting.'));
    else safeItems.push(v().safe('CHART_OF_ACCOUNTS_PRESENT', `${accounts.length} accounts available.`, 'accounting'));
    REQUIRED_ACCOUNTS.forEach(account => {
      if (!ids.has(account)) issues.push(v().issue('critical', 'MISSING_REQUIRED_ACCOUNT', `Required account missing: ${account}`, 'accounting', account, 'Map required accounting accounts.'));
    });
    TAX_ACCOUNTS.forEach(account => {
      if (!ids.has(account)) issues.push(v().issue('warning', 'MISSING_TAX_ACCOUNT', `Tax account missing: ${account}`, 'accounting', account, 'Configure tax accounts before enabling tax posting.'));
    });
    const fiscalYears = v().list(state.fiscalYears);
    if (!fiscalYears.length) issues.push(v().issue('critical', 'MISSING_FISCAL_YEAR', 'Fiscal year is missing.', 'accounting', '', 'Create an open fiscal year.'));
    else safeItems.push(v().safe('FISCAL_YEAR_PRESENT', `${fiscalYears.length} fiscal year(s) available.`, 'accounting'));
    return Object.freeze({ id: 'accounting', issues: Object.freeze(issues), safeItems: Object.freeze(safeItems) });
  }

  ns.AccountingReadinessChecker = Object.freeze({ version: '1.0.0', check });
})(typeof globalThis !== 'undefined' ? globalThis : window);
