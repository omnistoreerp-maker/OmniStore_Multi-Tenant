(function (root) {
  'use strict';
  const ns = root.OmniAuthPreview = root.OmniAuthPreview || {};
  function preview(input = {}) {
    const errors = [];
    if (Object.prototype.hasOwnProperty.call(input, 'password')) errors.push({ code: 'PASSWORD_INPUT_NOT_ACCEPTED', message: 'Preview login does not accept passwords.' });
    const user = ns.UserManager.find(input.userId);
    if (!user) errors.push({ code: 'MOCK_USER_NOT_FOUND', message: 'Mock user was not found.' });
    if (user && user.enabled !== true) errors.push({ code: 'MOCK_USER_DISABLED', message: 'Mock user is disabled.' });
    const session = errors.length ? null : ns.SessionManager.preview(user, input.sessionOptions || {});
    return Object.freeze({
      valid: errors.length === 0,
      errors: Object.freeze(errors),
      user,
      mockSession: session,
      wouldAuthenticate: errors.length === 0,
      authenticatedInReality: false,
      backendContacted: false,
      credentialsStored: false,
      previewOnly: true
    });
  }
  ns.LoginPreview = Object.freeze({ version: '1.0.0', preview });
})(typeof globalThis !== 'undefined' ? globalThis : window);
