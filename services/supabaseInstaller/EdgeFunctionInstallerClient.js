(function (root) {
  'use strict';
  const ns = root.OmniSupabaseInstaller = root.OmniSupabaseInstaller || {};
  async function invoke(config, session, action, payload, fetchImpl) {
    if (!session || !session.accessToken || !['owner','admin'].includes(session.role)) throw new Error('AUTHENTICATED_SUPABASE_ADMIN_REQUIRED');
    const transport = fetchImpl || root.fetch;
    if (typeof transport !== 'function') throw new Error('FETCH_UNAVAILABLE');
    const response = await transport(config.edgeFunctionUrl, {
      method: 'POST',
      headers: { apikey: config.anonKey, Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, projectName: config.projectName, ...payload })
    });
    let body = {};
    try { body = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(body.error || `EDGE_FUNCTION_${response.status}`);
    return Object.freeze({ ok: true, status: response.status, body, serviceCredentialExposed: false });
  }
  ns.EdgeFunctionInstallerClient = Object.freeze({ version: '1.0.0', invoke });
})(typeof globalThis !== 'undefined' ? globalThis : window);
