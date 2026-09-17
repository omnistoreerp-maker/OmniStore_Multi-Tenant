(function (root) {
  'use strict';
  const ns = root.OmniUAT = root.OmniUAT || {};
  function validate(context = {}) {
    const { list, check, group, issue } = ns.UATUtils;
    const demo = context.demoData || {};
    const checks = [
      check('demo_products', 'Demo products available', list(demo.products).length > 0),
      check('demo_customers', 'Demo customers available', list(demo.customers).length > 0),
      check('demo_suppliers', 'Demo suppliers available', list(demo.suppliers).length > 0),
      check('demo_isolated', 'Demo data marked isolated', demo.isolated === true)
    ];
    const issues = checks.filter(item => !item.passed).map(item => issue('DEMO_DATA_INCOMPLETE', `${item.label} is incomplete.`, { area: 'demo', reference: item.id }));
    return group('demoData', 'Demo Data Validation', checks, issues);
  }
  ns.DemoDataValidator = Object.freeze({ version: '1.0.0', validate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
