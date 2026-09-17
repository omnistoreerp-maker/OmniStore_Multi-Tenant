(function (root) {
  'use strict';
  const ns = root.OmniUATFeedback = root.OmniUATFeedback || {};
  const CATEGORIES = Object.freeze([
    { id: 'bug', label: 'Bug', labelAr: 'مشكلة أو خطأ' },
    { id: 'ui_improvement', label: 'UI Improvement', labelAr: 'تحسين الواجهة' },
    { id: 'accounting_concern', label: 'Accounting Concern', labelAr: 'ملاحظة محاسبية' },
    { id: 'inventory_concern', label: 'Inventory Concern', labelAr: 'ملاحظة مخزون' },
    { id: 'sales_pos_concern', label: 'Sales/POS Concern', labelAr: 'ملاحظة بيع أو نقطة بيع' },
    { id: 'report_request', label: 'Report Request', labelAr: 'طلب تقرير' },
    { id: 'feature_request', label: 'Feature Request', labelAr: 'طلب ميزة' },
    { id: 'training_question', label: 'Training Question', labelAr: 'سؤال تدريب' }
  ]);
  const byId = id => CATEGORIES.find(item => item.id === id) || null;
  ns.FeedbackCategoryRegistry = Object.freeze({ version: '1.0.0', CATEGORIES, byId, has: id => Boolean(byId(id)) });
})(typeof globalThis !== 'undefined' ? globalThis : window);
