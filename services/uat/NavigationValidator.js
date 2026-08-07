(function (root) {
  'use strict';
  const ns = root.OmniUAT = root.OmniUAT || {};
  function validate(context = {}) {
    const { list, issue, check, group } = ns.UATUtils;
    const routes = list(context.navigation && context.navigation.routes);
    const pages = list(context.navigation && context.navigation.pages);
    const menus = list(context.navigation && context.navigation.menus);
    const duplicateRoutes = routes.filter((route, index) => routes.indexOf(route) !== index);
    const missingPages = [...new Set(routes)].filter(route => !pages.includes(route));
    const checks = [
      check('menus_present', 'Menus are present', menus.length > 0, `${menus.length} menu entries`),
      check('routes_present', 'Routes are present', routes.length > 0, `${routes.length} routes`),
      check('route_targets', 'Every route targets a page', missingPages.length === 0, `${missingPages.length} missing targets`),
      check('route_uniqueness', 'No duplicate routes', duplicateRoutes.length === 0, `${duplicateRoutes.length} duplicates`)
    ];
    const issues = [];
    if (missingPages.length) issues.push(issue('NAVIGATION_TARGET_MISSING', 'One or more navigation routes have no page target.', { severity: 'critical', blocking: true, area: 'navigation', reference: missingPages.join(',') }));
    if (duplicateRoutes.length) issues.push(issue('DUPLICATE_NAVIGATION_ROUTE', 'Duplicate navigation routes were detected.', { area: 'navigation', reference: [...new Set(duplicateRoutes)].join(',') }));
    return group('navigation', 'Navigation and Menus', checks, issues);
  }
  ns.NavigationValidator = Object.freeze({ version: '1.0.0', validate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
