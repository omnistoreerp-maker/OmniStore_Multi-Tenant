(function (root) {
  'use strict';
  const ns = root.OmniUAT = root.OmniUAT || {};
  function build(context = {}) {
    const suites = ns.UATUtils.list(context.regressionSuites);
    const total = suites.reduce((sum, suite) => sum + (Number(suite.tests) || 0), 0);
    const passed = suites.reduce((sum, suite) => sum + (Number(suite.passed) || 0), 0);
    const failed = Math.max(0, total - passed);
    return Object.freeze({
      suites: Object.freeze(suites),
      total,
      passed,
      failed,
      passRate: total ? Math.round((passed / total) * 100) : 0,
      ready: total > 0 && failed === 0
    });
  }
  ns.RegressionSummaryBuilder = Object.freeze({ version: '1.0.0', build });
})(typeof globalThis !== 'undefined' ? globalThis : window);
