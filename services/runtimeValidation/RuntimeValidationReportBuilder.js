(function (root) {
  'use strict';
  const ns = root.OmniRuntimeValidation = root.OmniRuntimeValidation || {};
  function build(results = []) {
    const issues = results.flatMap(item => Array.isArray(item.issues) ? item.issues : []);
    const blockingErrors = issues.filter(item => item.blocking);
    const criticalErrors = issues.filter(item => item.severity === 'critical');
    const warnings = issues.filter(item => item.severity !== 'critical');
    const penalty = issues.reduce((sum, item) => sum + (item.blocking ? 15 : item.severity === 'critical' ? 10 : 3), 0);
    const overallRuntimeScore = Math.max(0, Math.min(100, 100 - penalty));
    const runtimeChecklist = results.flatMap(group => (group.checks || []).map(check => Object.freeze({ ...check, group: group.id })));
    const readiness = id => {
      const group = results.find(item => item.id === id);
      return Object.freeze({ ready: Boolean(group && group.ready), score: group ? Math.max(0, 100 - group.issues.reduce((n, i) => n + (i.blocking ? 20 : 5), 0)) : 0 });
    };
    return Object.freeze({
      generatedAt: new Date().toISOString(),
      readOnly: true,
      overallRuntimeScore,
      criticalErrors: Object.freeze(criticalErrors),
      warnings: Object.freeze(warnings),
      blockingErrors: Object.freeze(blockingErrors),
      runtimeChecklist: Object.freeze(runtimeChecklist),
      postingEligibility: Object.freeze({
        eligible: blockingErrors.length === 0 && overallRuntimeScore >= 80,
        status: blockingErrors.length === 0 && overallRuntimeScore >= 80 ? 'eligible' : 'blocked',
        reason: blockingErrors.length ? `${blockingErrors.length} blocking error(s)` : (overallRuntimeScore < 80 ? 'Runtime score is below 80' : 'All runtime gates passed')
      }),
      businessReadiness: readiness('business'),
      inventoryReadiness: readiness('inventory'),
      accountingReadiness: readiness('accounting'),
      permissionReadiness: readiness('permission')
    });
  }
  ns.RuntimeValidationReportBuilder = Object.freeze({ version: '1.0.0', build });
})(typeof globalThis !== 'undefined' ? globalThis : window);
