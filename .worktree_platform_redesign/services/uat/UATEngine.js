(function (root) {
  'use strict';
  const ns = root.OmniUAT = root.OmniUAT || {};
  const RUNNERS = Object.freeze([
    ['FeatureCoverageChecker', 'validate'],
    ['NavigationValidator', 'validate'],
    ['WorkflowValidator', 'validate'],
    ['PerformanceChecklist', 'validate'],
    ['PermissionScenarioTester', 'validate'],
    ['DemoDataValidator', 'validate'],
    ['SmokeTestRunner', 'run']
  ]);
  function run(context = {}) {
    const safeContext = { ...context };
    const results = RUNNERS.map(([name, method]) => {
      if (!ns[name] || typeof ns[name][method] !== 'function') throw new Error(`${name} is not loaded.`);
      return ns[name][method](safeContext);
    });
    const regression = ns.RegressionSummaryBuilder.build(safeContext);
    const report = ns.UATReportBuilder.build(results, regression);
    return Object.freeze({
      readOnly: true,
      persisted: false,
      posted: false,
      databaseTouched: false,
      localStorageWritten: false,
      results: Object.freeze(results),
      report
    });
  }
  function createEngine(baseContext = {}) {
    const initial = Object.freeze({ ...baseContext });
    return Object.freeze({ run: extra => run({ ...initial, ...(extra || {}) }) });
  }
  ns.UATEngine = Object.freeze({ version: '1.0.0', RUNNERS, run, createEngine });
})(typeof globalThis !== 'undefined' ? globalThis : window);
