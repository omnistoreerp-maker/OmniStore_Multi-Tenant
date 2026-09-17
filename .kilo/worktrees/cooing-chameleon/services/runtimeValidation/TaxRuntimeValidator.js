(function (root) {
  'use strict';
  const ns = root.OmniRuntimeValidation = root.OmniRuntimeValidation || {};
  function validate(context = {}) {
    const { list, number, issue, result, accountId } = ns.RuntimeValidationUtils;
    const issues = [];
    const state = context.accountingState || (context.accountingEngine && context.accountingEngine.getState ? context.accountingEngine.getState() : {});
    const chart = list(context.chartOfAccounts || state.chartOfAccounts);
    const taxable = list(context.documents).some(doc => number(doc.tax != null ? doc.tax : doc.taxAmount) > 0 || number(doc.taxRate) > 0);
    const tax = context.taxConfiguration || {};
    if (taxable && !Object.keys(tax).length) issues.push(issue('TAX_CONFIGURATION_MISSING', 'Taxable documents require tax configuration.', { severity: 'critical', blocking: true, source: 'tax' }));
    if (taxable && !chart.some(account => /tax/i.test(accountId(account)) || /tax/i.test(account.category || ''))) issues.push(issue('TAX_ACCOUNT_MISSING', 'Tax account is required for taxable documents.', { severity: 'critical', blocking: true, source: 'tax' }));
    list(context.documents).forEach(doc => {
      const rate = number(doc.taxRate);
      if (rate < 0 || rate > 100) issues.push(issue('TAX_RATE_INVALID', 'Tax rate must be between 0 and 100.', { severity: 'critical', blocking: true, source: 'tax', reference: String(doc.id || '') }));
    });
    return result('tax', 'Tax Readiness', issues, [{ id: 'tax_configuration', passed: !issues.length }]);
  }
  ns.TaxRuntimeValidator = Object.freeze({ version: '1.0.0', validate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
