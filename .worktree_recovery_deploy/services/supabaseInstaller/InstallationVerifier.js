(function (root) {
  'use strict';
  const ns = root.OmniSupabaseInstaller = root.OmniSupabaseInstaller || {};
  function summarize(response) {
    const verification = response && response.body && response.body.verification || {};
    const groups = ['tables','indexes','policies','triggers','functions','defaultAdmin','defaultRoles','defaultSettings'];
    const checks = Object.freeze(Object.fromEntries(groups.map(group => [group, Boolean(verification[group] && verification[group].valid)])));
    return Object.freeze({
      valid: groups.every(group => checks[group]),
      checks,
      details: verification,
      verifiedAt: response && response.body && response.body.completedAt || null
    });
  }
  ns.InstallationVerifier = Object.freeze({ version: '1.0.0', summarize });
})(typeof globalThis !== 'undefined' ? globalThis : window);
