(function (root) {
  'use strict';
  const ns = root.OmniPostingReadiness = root.OmniPostingReadiness || {};
  const v = () => ns.PostingReadinessValidator;

  function build(summary, risk) {
    return Object.freeze({
      title: 'Posting Readiness & Reconciliation Report',
      generatedAt: new Date().toISOString(),
      readinessScore: summary.score,
      riskLevel: risk.riskLevel,
      criticalErrors: Object.freeze(v().list(summary.critical)),
      warnings: Object.freeze(v().list(summary.warnings)),
      safeItems: Object.freeze(v().list(summary.safeItems)),
      requiredFixesBeforePosting: Object.freeze(v().list(summary.critical).map(issue => issue.requiredFix).filter(Boolean)),
      reconciliationSummary: Object.freeze({
        unbalancedPreviewJournals: v().list(summary.issues).filter(issue => issue.code === 'UNBALANCED_PREVIEW_JOURNAL').length,
        negativeStockRisks: v().list(summary.issues).filter(issue => issue.code === 'NEGATIVE_STOCK_RISK').length,
        duplicateReferences: v().list(summary.issues).filter(issue => issue.code === 'DUPLICATE_DOCUMENT_REFERENCE').length
      }),
      recommendedNextActions: risk.recommendedNextActions
    });
  }

  ns.ReconciliationReportBuilder = Object.freeze({ version: '1.0.0', build });
})(typeof globalThis !== 'undefined' ? globalThis : window);
