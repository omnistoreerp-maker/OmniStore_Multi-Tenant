(function (root) {
  'use strict';
  const ns = root.OmniUAT = root.OmniUAT || {};
  function validate(context = {}) {
    const { check, group, issue } = ns.UATUtils;
    const metrics = context.performance || {};
    const checks = [
      check('startup_budget', 'Startup budget documented', metrics.startupBudgetMs > 0, `${metrics.startupBudgetMs || 0}ms`),
      check('responsive_ui', 'Responsive UI detected', metrics.responsiveUi === true),
      check('offline_shell', 'Offline application shell configured', metrics.offlineShell === true),
      check('asset_budget', 'Asset budget documented', metrics.assetBudgetKb > 0, `${metrics.assetBudgetKb || 0}KB`)
    ];
    const issues = checks.filter(item => !item.passed).map(item => issue('PERFORMANCE_CHECK_INCOMPLETE', `${item.label} is incomplete.`, { area: 'performance', reference: item.id }));
    return group('performance', 'Performance Checklist', checks, issues);
  }
  ns.PerformanceChecklist = Object.freeze({ version: '1.0.0', validate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
