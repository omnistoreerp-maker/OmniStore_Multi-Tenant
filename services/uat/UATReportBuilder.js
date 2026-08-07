(function (root) {
  'use strict';
  const ns = root.OmniUAT = root.OmniUAT || {};
  function score(checks) {
    const all = checks.flatMap(result => result.checks || []);
    return all.length ? Math.round((all.filter(item => item.passed).length / all.length) * 100) : 0;
  }
  function build(results = [], regression = {}) {
    const issues = results.flatMap(result => result.issues || []);
    const blockingErrors = issues.filter(item => item.blocking);
    const warnings = issues.filter(item => !item.blocking);
    const byId = id => results.filter(result => id.includes(result.id));
    const customerReadinessScore = score(byId(['features', 'workflows', 'permissions', 'demoData']));
    const deploymentReadinessScore = score(byId(['performance', 'navigation', 'smoke']));
    const regressionScore = regression.passRate || 0;
    const productionReadinessScore = Math.round((customerReadinessScore * 0.4) + (deploymentReadinessScore * 0.4) + (regressionScore * 0.2));
    return Object.freeze({
      generatedAt: new Date().toISOString(),
      readOnly: true,
      customerReadinessScore,
      deploymentReadinessScore,
      productionReadinessScore,
      status: blockingErrors.length === 0 && productionReadinessScore >= 85 ? 'ready_for_uat' : 'review_required',
      blockingErrors: Object.freeze(blockingErrors),
      warnings: Object.freeze(warnings),
      checks: Object.freeze(results.flatMap(result => result.checks || [])),
      areas: Object.freeze(results),
      regression,
      customerAcceptanceChecklist: ns.CustomerAcceptanceChecklist.build(results),
      knownLimitations: Object.freeze([
        'Accounting and inventory posting remain simulation-only.',
        'Phase 11 SQL files remain unexecuted design drafts.',
        'Customer training and formal sign-off require human completion.',
        'Performance figures are checklist budgets, not laboratory benchmarks.'
      ]),
      deploymentChecklist: Object.freeze([
        'Confirm HTTPS and target hosting path.',
        'Verify cache update and service-worker activation.',
        'Validate manifest and icons on target devices.',
        'Complete supported-browser smoke tests.',
        'Record backup and rollback owner.',
        'Obtain customer UAT sign-off before production activation.'
      ])
    });
  }
  ns.UATReportBuilder = Object.freeze({ version: '1.0.0', build });
})(typeof globalThis !== 'undefined' ? globalThis : window);
