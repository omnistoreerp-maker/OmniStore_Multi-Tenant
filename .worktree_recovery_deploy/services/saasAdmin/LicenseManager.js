(function (root) {
  'use strict';
  const ns = root.OmniSaaSAdmin = root.OmniSaaSAdmin || {};
  const FORMAT = /^OMNI-[A-F0-9]{6}-[A-F0-9]{6}-[A-F0-9]{6}-[A-F0-9]{6}$/;
  function validateFormat(key) { return Object.freeze({ valid: FORMAT.test(String(key || '').trim().toUpperCase()), normalized: String(key || '').trim().toUpperCase() }); }
  function status(license, now) {
    if (!license) return 'not_found';
    if (license.status === 'revoked') return 'revoked';
    if (license.expiresAt && new Date(license.expiresAt) < new Date(now || Date.now())) return 'expired';
    return license.status || 'active';
  }
  function daysRemaining(expiresAt, now) {
    if (!expiresAt) return null;
    return Math.max(0, Math.ceil((new Date(expiresAt) - new Date(now || Date.now())) / 86400000));
  }
  ns.LicenseManager = Object.freeze({ version: '1.0.0', FORMAT, validateFormat, status, daysRemaining });
})(typeof globalThis !== 'undefined' ? globalThis : window);
