(function (root) {
  'use strict';
  const ns = root.OmniClientHandoff = root.OmniClientHandoff || {};
  const REQUIRED_SCENARIOS = Object.freeze(['add_product','purchase_invoice','sales_invoice','pos_sale','inventory_review','reports_review','erp_preview','posting_readiness','runtime_validation','customer_feedback']);
  const REQUIRED_MESSAGES = Object.freeze(['UAT/Beta', 'محاكاة فقط', 'قيود محاسبية فعلية', 'حركات مخزون فعلية', 'القوائم المالية الرسمية', 'ملاحظات العميل']);
  function validate(packageData = {}) {
    const errors = [];
    const warnings = [];
    const scenarioIds = (packageData.scenarios || []).map(item => item.id);
    REQUIRED_SCENARIOS.filter(id => !scenarioIds.includes(id)).forEach(id => errors.push({ code: 'SCENARIO_MISSING', reference: id, message: `Required scenario is missing: ${id}` }));
    const limitationsText = (packageData.limitations || []).join(' ');
    REQUIRED_MESSAGES.filter(message => !limitationsText.includes(message)).forEach(message => errors.push({ code: 'SAFETY_MESSAGE_MISSING', reference: message, message: `Required client message is missing: ${message}` }));
    if (!(packageData.trainingChecklist || []).length) errors.push({ code: 'TRAINING_CHECKLIST_MISSING', message: 'Training checklist is required.' });
    if (!(packageData.customerQuestions || []).length) warnings.push({ code: 'CUSTOMER_QUESTIONS_MISSING', message: 'Customer questions are recommended.' });
    if (!packageData.sessionPlan || packageData.sessionPlan.feedbackAfterDemo !== true) errors.push({ code: 'FEEDBACK_STEP_MISSING', message: 'Customer feedback after demo is required.' });
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), warnings: Object.freeze(warnings) });
  }
  ns.ClientHandoffValidator = Object.freeze({ version: '1.0.0', REQUIRED_SCENARIOS, REQUIRED_MESSAGES, validate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
