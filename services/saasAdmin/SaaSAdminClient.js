(function (root) {
  'use strict';
  const ns = root.OmniSaaSAdmin = root.OmniSaaSAdmin || {};
  function create(options) {
    options = options || {};
    let config = null;
    let session = null;
    async function connect(input) {
      const validation = ns.SaaSAdminConfiguration.validate(input);
      if (!validation.valid) return Object.freeze({ valid: false, errors: validation.errors });
      const current = typeof options.sessionProvider === 'function' ? await options.sessionProvider(validation.config) : null;
      if (!current || !current.accessToken || current.platformRole !== 'erp_owner') return Object.freeze({ valid: false, errors: Object.freeze([{ code: 'ERP_OWNER_SESSION_REQUIRED' }]) });
      config = validation.config;
      session = current;
      try {
        const health = await invoke('health');
        return Object.freeze({ valid: Boolean(health.healthy && health.platformOwner), errors: Object.freeze([]), health, config: ns.SaaSAdminConfiguration.publicView(config) });
      } catch (error) {
        config = session = null;
        return Object.freeze({ valid: false, errors: Object.freeze([{ code: String(error && error.message || error) }]) });
      }
    }
    async function invoke(action, payload) {
      if (!config || !session) throw new Error('SAAS_ADMIN_CONNECTION_REQUIRED');
      const transport = options.fetchImpl || root.fetch;
      const response = await transport(config.edgeFunctionUrl, {
        method: 'POST',
        headers: { apikey: config.anonKey, Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, projectName: config.projectName, ...(payload || {}) })
      });
      let body = {};
      try { body = await response.json(); } catch (_) {}
      if (!response.ok) throw new Error(body.error || `SAAS_ADMIN_${response.status}`);
      return body;
    }
    function status() { return Object.freeze({ connected: Boolean(config && session), platformOwner: Boolean(session && session.platformRole === 'erp_owner'), config: config ? ns.SaaSAdminConfiguration.publicView(config) : null, persisted: false }); }
    function clear() { config = session = null; return status(); }
    return Object.freeze({ connect, invoke, status, clear });
  }
  ns.SaaSAdminClient = Object.freeze({ version: '1.0.0', create });
})(typeof globalThis !== 'undefined' ? globalThis : window);
