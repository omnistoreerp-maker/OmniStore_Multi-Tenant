(function (root) {
  'use strict';
  const ns = root.OmniSaaSAdmin = root.OmniSaaSAdmin || {};
  const PLAN_CODES = Object.freeze(['trial','monthly','quarterly','yearly','lifetime','custom']);
  function normalize(plans) {
    return Object.freeze((plans || []).filter(plan => PLAN_CODES.includes(plan.code)).map(plan => Object.freeze({ ...plan, limits: Object.freeze({ ...(plan.limits || {}) }) })));
  }
  ns.SubscriptionPlanManager = Object.freeze({ version: '1.0.0', PLAN_CODES, normalize });
})(typeof globalThis !== 'undefined' ? globalThis : window);
