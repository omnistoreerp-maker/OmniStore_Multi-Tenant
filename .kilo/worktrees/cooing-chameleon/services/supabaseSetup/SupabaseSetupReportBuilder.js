(function (root) {
  'use strict';
  const ns = root.OmniSupabaseSetupPreview = root.OmniSupabaseSetupPreview || {};
  function build(plan) {
    return Object.freeze({
      title: 'Supabase Setup Preview',
      readinessScore: plan.validation.score,
      sharedProject: true,
      plannedTables: plan.schema.tables.length,
      plannedPolicies: plan.rls.policies.length,
      warnings: Object.freeze([
        'Preview Only — SQL is not executed from the browser.',
        'Never put Supabase service_role key inside frontend code.'
      ]),
      connectionMade: false,
      apiCalled: false,
      sqlExecuted: false
    });
  }
  ns.SupabaseSetupReportBuilder = Object.freeze({ version: '1.0.0', build });
})(typeof globalThis !== 'undefined' ? globalThis : window);
