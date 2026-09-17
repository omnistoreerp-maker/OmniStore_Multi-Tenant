(function (root) {
  'use strict';
  const ns = root.OmniAuthPreview = root.OmniAuthPreview || {};
  const REQUIRED_COMPONENTS = Object.freeze(['SessionManager','UserManager','RoleManager','PermissionEngine','RouteGuard','LoginPreview','LogoutPreview','PasswordPolicy','AccessValidator','SecurityAudit']);
  function validateArchitecture() {
    const errors = [];
    REQUIRED_COMPONENTS.forEach(name => {
      if (!ns[name]) errors.push({ code: 'AUTH_COMPONENT_MISSING', reference: name, message: `Authentication component is missing: ${name}` });
    });
    ns.UserManager.list().forEach(user => {
      ['password','passwordHash','secret','accessToken','refreshToken'].forEach(key => {
        if (Object.prototype.hasOwnProperty.call(user, key)) errors.push({ code: 'SENSITIVE_FIELD_PRESENT', reference: `${user.id}.${key}`, message: 'Mock user contains a prohibited sensitive field.' });
      });
    });
    const rolesValid = ns.RoleManager.list().every(role => Array.isArray(role.permissions));
    if (!rolesValid) errors.push({ code: 'ROLE_PERMISSIONS_INVALID', message: 'Every role must define permissions.' });
    const checks = Object.freeze({
      components: errors.filter(error => error.code === 'AUTH_COMPONENT_MISSING').length === 0,
      mockUsersSafe: errors.filter(error => error.code === 'SENSITIVE_FIELD_PRESENT').length === 0,
      rolesValid,
      backendDisabled: true,
      persistenceDisabled: true
    });
    const readinessScore = Math.max(0, 100 - errors.length * 20);
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), checks, readinessScore, previewOnly: true });
  }
  ns.AuthenticationValidator = Object.freeze({ version: '1.0.0', REQUIRED_COMPONENTS, validateArchitecture });
})(typeof globalThis !== 'undefined' ? globalThis : window);
