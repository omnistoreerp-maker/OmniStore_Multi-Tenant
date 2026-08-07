(function (root) {
  'use strict';
  const ns = root.OmniUAT = root.OmniUAT || {};
  const SCENARIOS = Object.freeze({
    Owner: ['dashboard', 'settings', 'reports'],
    Admin: ['dashboard', 'products', 'reports'],
    Manager: ['dashboard', 'reports'],
    Cashier: ['pos'],
    Auditor: ['reports']
  });
  function validate(context = {}) {
    const { list, check, group, issue } = ns.UATUtils;
    const matrix = context.permissionMatrix || {};
    const checks = Object.entries(SCENARIOS).map(([role, required]) => {
      const actual = list(matrix[role]);
      return check(`permission_${role.toLowerCase()}`, `${role} permission scenario`, required.every(permission => actual.includes(permission)), required.join(', '));
    });
    const issues = checks.filter(item => !item.passed).map(item => issue('PERMISSION_SCENARIO_FAILED', `${item.label} did not satisfy its read-only scenario.`, { severity: 'critical', blocking: true, area: 'permissions', reference: item.id }));
    return group('permissions', 'Permission Scenarios', checks, issues);
  }
  ns.PermissionScenarioTester = Object.freeze({ version: '1.0.0', SCENARIOS, validate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
