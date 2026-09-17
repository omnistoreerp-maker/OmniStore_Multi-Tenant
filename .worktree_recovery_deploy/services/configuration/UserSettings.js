(function (root) {
  'use strict';
  const ns = root.OmniConfiguration = root.OmniConfiguration || {};
  ns.UserSettings = ns.registerSettings('user', 'User Preferences', [
    { key: 'language', label: 'لغة المستخدم', type: 'select', required: true, default: 'ar', options: ['ar','en'] },
    { key: 'tableDensity', label: 'كثافة الجداول', type: 'select', required: true, default: 'comfortable', options: ['compact','comfortable','spacious'] },
    { key: 'keyboardShortcuts', label: 'اختصارات لوحة المفاتيح', type: 'checkbox', required: true, default: true },
    { key: 'confirmBeforeActions', label: 'التأكيد قبل العمليات المهمة', type: 'checkbox', required: true, default: true },
    { key: 'notificationsPreview', label: 'إظهار تنبيهات المعاينة', type: 'checkbox', required: true, default: true }
  ]);
})(typeof globalThis !== 'undefined' ? globalThis : window);
