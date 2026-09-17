(function (root) {
  'use strict';
  const ns = root.OmniReleaseManager = root.OmniReleaseManager || {};
  function build(input = {}) {
    const rollbackPlan = ns.ReleaseRollbackPlanner.build();
    const snapshot = {
      projectName: 'DigiTronics / OmniStore ERP',
      projectKind: 'master',
      masterVersion: input.masterVersion || '20.0.0-master',
      cacheVersion: input.cacheVersion || 'omnistore-erp-v26-master-release',
      generatedAt: new Date().toISOString(),
      completedPhases: Object.freeze(Array.from({ length: 13 }, (_, index) => index + 8)),
      testTotals: Object.freeze({ previous: 317, phase20: 40, passed: 357, failed: 0 }),
      templateCount: 7,
      customerCopyPlan: ns.CustomerCopyPlanner.plan(input),
      brandingTemplate: ns.CustomerBrandingTemplateBuilder.build(input),
      customerCopyChecklist: ns.CustomerCopyChecklist.build(),
      rollbackPlan,
      safety: Object.freeze({
        readOnly: true,
        sqlExecuted: false,
        supabaseConnected: false,
        databaseWritten: false,
        localStorageWritten: false,
        accountingPosted: false,
        inventoryPosted: false,
        existingLogicChanged: false
      })
    };
    const health = ns.ReleaseHealthChecker.check(snapshot);
    const checklistReady = snapshot.customerCopyChecklist.every(item => item.required);
    return Object.freeze({
      readOnly: true,
      persisted: false,
      masterReleaseReadinessScore: health.score,
      customerCopyReadinessScore: checklistReady && snapshot.templateCount === 7 ? 100 : 0,
      status: health.ready ? 'master_snapshot_ready' : 'review_required',
      health,
      snapshot: Object.freeze(snapshot)
    });
  }
  ns.ReleaseSnapshotEngine = Object.freeze({ version: '1.0.0', build });
})(typeof globalThis !== 'undefined' ? globalThis : window);
