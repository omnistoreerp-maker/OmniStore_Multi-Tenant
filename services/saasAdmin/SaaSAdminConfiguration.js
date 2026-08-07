(function (root) {
  'use strict';
  const ns = root.OmniSaaSAdmin = root.OmniSaaSAdmin || {};
  function validate(input) {
    input = input || {};
    const config = Object.freeze({
      supabaseUrl: String(input.supabaseUrl || '').trim().replace(/\/+$/, ''),
      anonKey: String(input.anonKey || '').trim(),
      edgeFunctionUrl: String(input.edgeFunctionUrl || '').trim(),
      projectName: String(input.projectName || '').trim()
    });
    const errors = [];
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.supabaseUrl)) errors.push({ field: 'supabaseUrl', code: 'INVALID_URL' });
    if (config.anonKey.length < 20) errors.push({ field: 'anonKey', code: 'INVALID_ANON_KEY' });
    if (!/^https:\/\/.+/i.test(config.edgeFunctionUrl)) errors.push({ field: 'edgeFunctionUrl', code: 'INVALID_EDGE_URL' });
    if (!config.projectName) errors.push({ field: 'projectName', code: 'PROJECT_NAME_REQUIRED' });
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), config });
  }
  function publicView(config) {
    return Object.freeze({ supabaseUrl: config.supabaseUrl, anonKey: config.anonKey ? `${config.anonKey.slice(0, 4)}…${config.anonKey.slice(-4)}` : '', edgeFunctionUrl: config.edgeFunctionUrl, projectName: config.projectName, persisted: false });
  }
  ns.SaaSAdminConfiguration = Object.freeze({ version: '1.0.0', validate, publicView });
})(typeof globalThis !== 'undefined' ? globalThis : window);
