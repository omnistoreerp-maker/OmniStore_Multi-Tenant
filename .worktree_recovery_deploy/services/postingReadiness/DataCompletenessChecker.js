(function (root) {
  'use strict';
  const ns = root.OmniPostingReadiness = root.OmniPostingReadiness || {};
  const v = () => ns.PostingReadinessValidator;

  function check(context = {}) {
    const issues = [];
    const safeItems = [];
    const profile = context.businessProfile || context.snapshot && context.snapshot.businessProfile || {};
    const type = v().text(profile.type || profile.businessType || profile.id || 'computer_shop');
    if (!type) issues.push(v().issue('warning', 'BUSINESS_PROFILE_MISSING', 'Business profile is missing.', 'businessProfile', '', 'Configure business profile accounting defaults.'));
    const accountingSettings = profile.accounting || context.accountingSettings || {};
    ['defaultSalesAccount', 'defaultInventoryAccount', 'defaultCashAccount'].forEach(key => {
      if (profile && Object.keys(profile).length && !accountingSettings[key]) {
        issues.push(v().issue('warning', 'INCOMPLETE_BUSINESS_PROFILE_ACCOUNTING', `Business profile accounting setting missing: ${key}`, 'businessProfile', type, 'Complete accounting configuration before posting.'));
      }
    });
    safeItems.push(v().safe('DATA_COMPLETENESS_SCAN_DONE', 'Data completeness scan finished in read-only mode.', 'data'));
    return Object.freeze({ id: 'dataCompleteness', issues: Object.freeze(issues), safeItems: Object.freeze(safeItems) });
  }

  ns.DataCompletenessChecker = Object.freeze({ version: '1.0.0', check });
})(typeof globalThis !== 'undefined' ? globalThis : window);
