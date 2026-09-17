(function (root) {
  'use strict';
  const ns = root.OmniRuntimeValidation = root.OmniRuntimeValidation || {};
  function validate(context = {}) {
    const { list, number, issue, result } = ns.RuntimeValidationUtils;
    const issues = [];
    const state = context.accountingState || (context.accountingEngine && context.accountingEngine.getState ? context.accountingEngine.getState() : {});
    const baseCurrency = context.baseCurrency || (context.currencySettings && context.currencySettings.baseCurrency) || (state.settings && state.settings.baseCurrency);
    if (!baseCurrency) issues.push(issue('BASE_CURRENCY_MISSING', 'Base currency is not configured.', { severity: 'critical', blocking: true, source: 'currency' }));
    list(context.documents).forEach(doc => {
      const currency = doc.currency || baseCurrency;
      const rate = doc.exchangeRate == null ? 1 : number(doc.exchangeRate);
      if (!currency) issues.push(issue('DOCUMENT_CURRENCY_MISSING', 'Document currency is missing.', { severity: 'critical', blocking: true, source: 'currency' }));
      if (!(rate > 0)) issues.push(issue('EXCHANGE_RATE_INVALID', 'Exchange rate must be greater than zero.', { severity: 'critical', blocking: true, source: 'currency', reference: String(doc.id || '') }));
    });
    return result('currency', 'Currency Readiness', issues, [
      { id: 'currency_configuration', passed: Boolean(baseCurrency) },
      { id: 'exchange_rates', passed: !issues.some(i => i.code === 'EXCHANGE_RATE_INVALID') }
    ]);
  }
  ns.CurrencyRuntimeValidator = Object.freeze({ version: '1.0.0', validate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
