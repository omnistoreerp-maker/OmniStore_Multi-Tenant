(function (root) {
  'use strict';
  const ns = root.OmniConfiguration = root.OmniConfiguration || {};
  ns.SecuritySettings = ns.registerSettings('security', 'Security Configuration', [
    { key: 'sessionTimeoutMinutes', label: 'مهلة الجلسة بالدقائق', type: 'number', required: true, default: 30, min: 5 },
    { key: 'minimumPasswordLength', label: 'الحد الأدنى لطول كلمة المرور', type: 'number', required: true, default: 8, min: 6 },
    { key: 'requireStrongPassword', label: 'طلب كلمة مرور قوية', type: 'checkbox', required: true, default: true },
    { key: 'twoFactorPreview', label: 'معاينة المصادقة الثنائية', type: 'checkbox', required: true, default: false },
    { key: 'auditTrailEnabled', label: 'إظهار سجل المراجعة', type: 'checkbox', required: true, default: true },
    { key: 'lockAfterAttempts', label: 'عدد المحاولات قبل القفل', type: 'number', required: true, default: 5, min: 1 }
  ]);
})(typeof globalThis !== 'undefined' ? globalThis : window);
