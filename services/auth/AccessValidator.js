(function (root) {
  'use strict';
  const ns = root.OmniAuthPreview = root.OmniAuthPreview || {};
  function validate(input = {}) {
    const errors = [];
    const user = input.user;
    if (!user) errors.push({ code: 'USER_REQUIRED', message: 'Mock user is required.' });
    if (user && user.enabled !== true) errors.push({ code: 'USER_DISABLED', message: 'Mock user is disabled.' });
    if (user && !ns.RoleManager.find(user.role)) errors.push({ code: 'ROLE_NOT_FOUND', message: 'Mock role does not exist.' });
    if (input.permission && user && !ns.PermissionEngine.can(user.role, input.permission)) errors.push({ code: 'PERMISSION_DENIED', message: 'Role does not include the requested permission.' });
    if (input.session && input.checkedAt && ns.SessionManager.expirationPreview(input.session, input.checkedAt).expired) errors.push({ code: 'SESSION_EXPIRED_PREVIEW', message: 'Mock session would be expired.' });
    return Object.freeze({ allowed: errors.length === 0, errors: Object.freeze(errors), previewOnly: true, accessGrantedInReality: false });
  }
  ns.AccessValidator = Object.freeze({ version: '1.0.0', validate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
