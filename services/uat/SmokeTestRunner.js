(function (root) {
  'use strict';
  const ns = root.OmniUAT = root.OmniUAT || {};
  function run(context = {}) {
    const { check, group, issue } = ns.UATUtils;
    const pwa = context.pwa || {};
    const ui = context.ui || {};
    const checks = [
      check('app_shell', 'Application shell detected', ui.appShell === true),
      check('search', 'Search capability detected', ui.search === true),
      check('filters', 'Filter capability detected', ui.filters === true),
      check('print_preview', 'Print preview detected', ui.printPreview === true),
      check('export_preview', 'Export preview detected', ui.exportPreview === true),
      check('keyboard_shortcuts', 'Keyboard shortcuts detected', ui.keyboardShortcuts === true),
      check('manifest', 'Manifest linked', pwa.manifest === true),
      check('service_worker', 'Service worker registered by application', pwa.serviceWorker === true),
      check('icons', 'PWA icons declared', Number(pwa.iconCount) >= 2),
      check('cache_version', 'Cache version identified', Boolean(pwa.cacheVersion)),
      check('offline_readiness', 'Offline readiness detected', pwa.offlineReady === true)
    ];
    const issues = checks.filter(item => !item.passed).map(item => issue('SMOKE_CHECK_FAILED', `${item.label} failed.`, { severity: item.id === 'manifest' || item.id === 'service_worker' ? 'critical' : 'warning', blocking: item.id === 'manifest' || item.id === 'service_worker', area: 'smoke', reference: item.id }));
    return group('smoke', 'Smoke Tests', checks, issues);
  }
  ns.SmokeTestRunner = Object.freeze({ version: '1.0.0', run });
})(typeof globalThis !== 'undefined' ? globalThis : window);
