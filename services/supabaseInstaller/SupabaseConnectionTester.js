(function (root) {
  'use strict';
  const ns = root.OmniSupabaseInstaller = root.OmniSupabaseInstaller || {};
  async function probe(fetchImpl, name, url, options) {
    const started = Date.now();
    try {
      const response = await fetchImpl(url, options);
      let body = null;
      try { body = await response.json(); } catch (_) {}
      return Object.freeze({ name, ok: response.ok, status: response.status, latencyMs: Date.now() - started, body });
    } catch (error) {
      return Object.freeze({ name, ok: false, status: 0, latencyMs: Date.now() - started, error: String(error && error.message || error) });
    }
  }
  async function test(config, session, fetchImpl) {
    const validation = ns.InstallerConfiguration.validate(config);
    if (!validation.valid) return Object.freeze({ valid: false, errors: validation.errors, probes: Object.freeze([]), latencyMs: 0, connectionAttempted: false });
    const cfg = validation.config;
    const transport = fetchImpl || root.fetch;
    if (typeof transport !== 'function') return Object.freeze({ valid: false, errors: Object.freeze([{ code: 'FETCH_UNAVAILABLE' }]), probes: Object.freeze([]), latencyMs: 0, connectionAttempted: false });
    const headers = { apikey: cfg.anonKey, Authorization: `Bearer ${session && session.accessToken || cfg.anonKey}`, 'Content-Type': 'application/json' };
    const probes = await Promise.all([
      probe(transport, 'api', `${cfg.supabaseUrl}/rest/v1/`, { method: 'GET', headers }),
      probe(transport, 'auth', `${cfg.supabaseUrl}/auth/v1/health`, { method: 'GET', headers: { apikey: cfg.anonKey } }),
      probe(transport, 'storage', `${cfg.supabaseUrl}/storage/v1/status`, { method: 'GET', headers }),
      probe(transport, 'edge', cfg.edgeFunctionUrl, { method: 'POST', headers, body: JSON.stringify({ action: 'health', projectName: cfg.projectName }) })
    ]);
    const edge = probes.find(item => item.name === 'edge');
    const adminAuthenticated = Boolean(session && session.accessToken && ['owner','admin'].includes(session.role));
    const requiredHealthy = probes.filter(item => ['api','auth','edge'].includes(item.name)).every(item => item.ok);
    return Object.freeze({
      valid: validation.valid && adminAuthenticated && requiredHealthy,
      errors: Object.freeze(adminAuthenticated ? [] : [{ code: 'AUTHENTICATED_SUPABASE_ADMIN_REQUIRED' }]),
      probes: Object.freeze(probes),
      edgeHealth: edge && edge.body || null,
      latencyMs: Math.max(...probes.map(item => item.latencyMs), 0),
      adminAuthenticated,
      connectionAttempted: true
    });
  }
  ns.SupabaseConnectionTester = Object.freeze({ version: '1.0.0', test });
})(typeof globalThis !== 'undefined' ? globalThis : window);
