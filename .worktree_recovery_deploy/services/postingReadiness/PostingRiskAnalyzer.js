(function (root) {
  'use strict';
  const ns = root.OmniPostingReadiness = root.OmniPostingReadiness || {};
  const v = () => ns.PostingReadinessValidator;

  function analyze(summary) {
    const critical = v().list(summary.critical).length;
    const warnings = v().list(summary.warnings).length;
    const score = v().number(summary.score);
    let riskLevel = 'low';
    if (critical > 0 || score < 60) riskLevel = 'high';
    else if (warnings > 3 || score < 85) riskLevel = 'medium';
    const recommendedNextActions = [];
    if (critical) recommendedNextActions.push('Resolve all critical errors before enabling real posting.');
    if (warnings) recommendedNextActions.push('Review warnings and complete missing mappings/configuration.');
    if (!critical && !warnings) recommendedNextActions.push('Proceed to manual DBA/business review before any write-enabled phase.');
    return Object.freeze({ riskLevel, recommendedNextActions: Object.freeze(recommendedNextActions) });
  }

  ns.PostingRiskAnalyzer = Object.freeze({ version: '1.0.0', analyze });
})(typeof globalThis !== 'undefined' ? globalThis : window);
