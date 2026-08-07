(function (root) {
  'use strict';
  const ns = root.OmniRuntimeValidation = root.OmniRuntimeValidation || {};
  const DEFAULT_ALLOWED = Object.freeze(['Owner', 'Admin', 'Accountant']);
  function validate(context = {}) {
    const { list, issue, result } = ns.RuntimeValidationUtils;
    const issues = [];
    const role = context.role || context.currentRole || 'Owner';
    const permissions = list(context.permissions);
    const allowed = permissions.includes('accounting.post') || permissions.includes('post') || DEFAULT_ALLOWED.includes(role);
    if (!allowed) issues.push(issue('POSTING_PERMISSION_DENIED', `${role} does not have posting permission.`, { severity: 'critical', blocking: true, source: 'permission' }));
    return result('permission', 'Permission Readiness', issues, [{ id: 'posting_permissions', passed: allowed }]);
  }
  ns.PermissionRuntimeValidator = Object.freeze({ version: '1.0.0', DEFAULT_ALLOWED, validate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
