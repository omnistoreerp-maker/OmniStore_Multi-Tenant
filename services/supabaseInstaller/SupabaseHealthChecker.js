(function (root) {
  'use strict';
  const ns = root.OmniSupabaseInstaller = root.OmniSupabaseInstaller || {};
  function build(connection) {
    const probe = name => connection.probes.find(item => item.name === name) || { ok: false, status: 0, latencyMs: 0 };
    const server = connection.edgeHealth && connection.edgeHealth.health || {};
    const checks = Object.freeze({
      api: probe('api').ok,
      auth: probe('auth').ok,
      edgeFunction: probe('edge').ok,
      storage: probe('storage').ok,
      rls: Boolean(server.rls),
      realtime: Boolean(server.realtime),
      database: Boolean(server.database),
      authenticatedAdmin: connection.adminAuthenticated
    });
    const score = Math.round(Object.values(checks).filter(Boolean).length / Object.keys(checks).length * 100);
    return Object.freeze({
      healthy: connection.valid && score >= 75,
      score,
      checks,
      latencyMs: connection.latencyMs,
      databaseVersion: server.databaseVersion || 'unknown',
      migrationVersion: server.migrationVersion || 'not-installed',
      projectStatus: server.projectStatus || (connection.valid ? 'reachable' : 'unavailable')
    });
  }
  ns.SupabaseHealthChecker = Object.freeze({ version: '1.0.0', build });
})(typeof globalThis !== 'undefined' ? globalThis : window);
