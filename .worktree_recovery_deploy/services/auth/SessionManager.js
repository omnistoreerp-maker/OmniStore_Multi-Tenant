(function (root) {
  'use strict';
  const ns = root.OmniAuthPreview = root.OmniAuthPreview || {};
  function preview(user, options = {}) {
    if (!user) throw new Error('Mock user is required.');
    const now = new Date(options.now || new Date().toISOString());
    const durationMinutes = Number(options.durationMinutes) || 30;
    const expiresAt = new Date(now.getTime() + durationMinutes * 60000).toISOString();
    return Object.freeze({
      id: options.id || 'MOCK-SESSION-PREVIEW',
      userId: user.id,
      role: user.role,
      issuedAt: now.toISOString(),
      expiresAt,
      durationMinutes,
      mock: true,
      realSession: false,
      active: false,
      persisted: false,
      stored: false
    });
  }
  function expirationPreview(session, at) {
    const checkedAt = new Date(at || new Date().toISOString());
    const expired = checkedAt.getTime() >= new Date(session.expiresAt).getTime();
    return Object.freeze({ checkedAt: checkedAt.toISOString(), expiresAt: session.expiresAt, expired, sessionChanged: false, previewOnly: true });
  }
  ns.SessionManager = Object.freeze({ version: '1.0.0', preview, expirationPreview, storage: 'none' });
})(typeof globalThis !== 'undefined' ? globalThis : window);
