(function (root) {
  'use strict';
  const ns = root.OmniRuntimeValidation = root.OmniRuntimeValidation || {};
  const REQUIRED = Object.freeze({
    cash: ['cash_on_hand', 'Cash Accounts'],
    bank: ['bank_main', 'Bank Accounts'],
    revenue: ['sales_revenue', 'Revenue'],
    expense: ['operating_expense', 'Expenses'],
    cogs: ['cost_of_sales', 'Cost Of Sales'],
    customer: ['accounts_receivable', 'Customer Accounts'],
    supplier: ['accounts_payable', 'Supplier Accounts']
  });

  function resolveState(context) {
    if (context.accountingState) return context.accountingState;
    if (context.accountingEngine && typeof context.accountingEngine.getState === 'function') return context.accountingEngine.getState();
    return {};
  }

  function validate(context = {}) {
    const { list, number, issue, result, accountId } = ns.RuntimeValidationUtils;
    const issues = [];
    const state = resolveState(context);
    const chart = list(context.chartOfAccounts || state.chartOfAccounts);
    const now = String(context.validationDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const year = list(context.fiscalYears || state.fiscalYears).find(item => now >= item.startDate && now <= item.endDate);
    if (!year) issues.push(issue('CURRENT_FISCAL_YEAR_MISSING', 'No fiscal year covers the validation date.', { severity: 'critical', blocking: true, source: 'accounting' }));
    if (year && year.status === 'closed') issues.push(issue('CURRENT_FISCAL_YEAR_CLOSED', 'Current fiscal year is closed.', { severity: 'critical', blocking: true, source: 'accounting' }));
    const period = year && list(year.periods).find(item => now >= item.startDate && now <= item.endDate);
    if (year && !period) issues.push(issue('CURRENT_FISCAL_PERIOD_MISSING', 'No fiscal period covers the validation date.', { severity: 'critical', blocking: true, source: 'accounting' }));
    if (period && period.status === 'closed') issues.push(issue('CURRENT_FISCAL_PERIOD_CLOSED', 'Current fiscal period is closed.', { severity: 'critical', blocking: true, source: 'accounting' }));
    if (!chart.length) issues.push(issue('CHART_OF_ACCOUNTS_MISSING', 'Chart of accounts is unavailable.', { severity: 'critical', blocking: true, source: 'accounting' }));
    Object.entries(REQUIRED).forEach(([kind, candidates]) => {
      const found = chart.some(account => candidates.includes(accountId(account)) || candidates.includes(account.category) || candidates.includes(account.group));
      if (!found) issues.push(issue(`${kind.toUpperCase()}_ACCOUNT_MISSING`, `Required ${kind} account is missing.`, { severity: 'critical', blocking: true, source: 'accounting' }));
    });
    list(context.previews).forEach((preview, index) => {
      const totals = (preview.accountingEffect && preview.accountingEffect.totals) || preview.totals || {};
      const debit = number(totals.debit);
      const credit = number(totals.credit);
      const difference = totals.difference != null ? number(totals.difference) : debit - credit;
      if (Math.abs(difference) > 0.01) issues.push(issue('JOURNAL_UNBALANCED', 'Preview journal debit and credit are not balanced.', { severity: 'critical', blocking: true, source: 'accounting', reference: String(index + 1) }));
    });
    return result('accounting', 'Accounting Readiness', issues, [
      { id: 'current_fiscal_year', passed: Boolean(year && year.status !== 'closed') },
      { id: 'current_fiscal_period', passed: Boolean(period && period.status !== 'closed') },
      { id: 'required_accounts', passed: !issues.some(i => /_ACCOUNT_MISSING$/.test(i.code)) },
      { id: 'journal_balancing', passed: !issues.some(i => i.code === 'JOURNAL_UNBALANCED') }
    ]);
  }
  ns.AccountingRuntimeValidator = Object.freeze({ version: '1.0.0', REQUIRED, validate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
