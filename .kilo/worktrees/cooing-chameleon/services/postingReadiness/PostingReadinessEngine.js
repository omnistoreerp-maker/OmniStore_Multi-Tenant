(function (root) {
  'use strict';

  const ns = root.OmniPostingReadiness = root.OmniPostingReadiness || {};

  function run(context = {}) {
    const checks = [
      ns.AccountingReadinessChecker.check(context),
      ns.InventoryReadinessChecker.check(context),
      ns.SalesReadinessChecker.check(context),
      ns.PurchaseReadinessChecker.check(context),
      ns.POSReadinessChecker.check(context),
      ns.DataCompletenessChecker.check(context),
      ns.ReconciliationEngine.reconcile(context)
    ];
    const summary = ns.PostingReadinessValidator.summarize(checks);
    const risk = ns.PostingRiskAnalyzer.analyze(summary);
    const report = ns.ReconciliationReportBuilder.build(summary, risk);
    return Object.freeze({ readOnly: true, persisted: false, posted: false, checks: Object.freeze(checks), summary, risk, report });
  }

  function createEngine(context = {}) {
    const safeContext = Object.freeze({ ...context });
    return Object.freeze({ run: extra => run({ ...safeContext, ...(extra || {}) }) });
  }

  ns.PostingReadinessEngine = Object.freeze({ version: '1.0.0', run, createEngine });
})(typeof globalThis !== 'undefined' ? globalThis : window);
