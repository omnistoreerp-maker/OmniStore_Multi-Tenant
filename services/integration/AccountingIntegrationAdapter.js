(function (root) {
  'use strict';
  const ns = root.OmniERPIntegration = root.OmniERPIntegration || {};
  const v = () => ns.IntegrationValidator;

  function fromAutoPosting(preview = {}) {
    return Object.freeze({
      source: 'autoPosting',
      journalPreview: Object.freeze(v().list(preview.journalLines)),
      debitLines: Object.freeze(v().list(preview.debitLines)),
      creditLines: Object.freeze(v().list(preview.creditLines)),
      totals: preview.journalTotals || { debit: 0, credit: 0, difference: 0 },
      validationErrors: Object.freeze(v().list(preview.validationErrors)),
      warnings: Object.freeze(v().list(preview.warnings))
    });
  }

  function manual(lines = [], errors = [], warnings = []) {
    const totals = v().list(lines).reduce((sum, line) => ({
      debit: v().money(sum.debit + v().number(line.debit)),
      credit: v().money(sum.credit + v().number(line.credit))
    }), { debit: 0, credit: 0 });
    totals.difference = v().money(totals.debit - totals.credit);
    return Object.freeze({
      source: 'integration-manual-preview',
      journalPreview: Object.freeze(v().list(lines)),
      debitLines: Object.freeze(v().list(lines).filter(line => v().number(line.debit) > 0)),
      creditLines: Object.freeze(v().list(lines).filter(line => v().number(line.credit) > 0)),
      totals: Object.freeze(totals),
      validationErrors: Object.freeze(errors),
      warnings: Object.freeze(warnings)
    });
  }

  ns.AccountingIntegrationAdapter = Object.freeze({ version: '1.0.0', fromAutoPosting, manual });
})(typeof globalThis !== 'undefined' ? globalThis : window);
