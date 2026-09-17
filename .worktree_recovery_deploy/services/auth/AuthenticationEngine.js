(function (root) {
  'use strict';
  const ns = root.OmniAuthPreview = root.OmniAuthPreview || {};
  function createEngine() {
    return Object.freeze({
      mode: 'mock-preview-only',
      persisted: false,
      backend: 'none',
      previewLogin: input => ns.LoginPreview.preview(input),
      previewLogout: session => ns.LogoutPreview.preview(session),
      previewRouteAccess: (route, userId, session, checkedAt) => ns.RouteGuard.preview(route, ns.UserManager.find(userId), session, checkedAt),
      previewPasswordPolicy: candidate => ns.PasswordPolicy.validateCandidate(candidate),
      previewAudit: events => ns.SecurityAudit.preview(events),
      users: () => ns.UserManager.list(),
      roles: () => ns.RoleManager.list(),
      permissionMatrix: () => ns.PermissionEngine.matrix(),
      validate: () => ns.AuthenticationValidator.validateArchitecture()
    });
  }
  ns.AuthenticationEngine = Object.freeze({ version: '1.0.0', createEngine });
})(typeof globalThis !== 'undefined' ? globalThis : window);
