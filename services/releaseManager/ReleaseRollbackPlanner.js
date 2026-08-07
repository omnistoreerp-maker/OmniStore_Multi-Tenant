(function (root) {
  'use strict';
  const ns = root.OmniReleaseManager = root.OmniReleaseManager || {};
  const STEPS = Object.freeze([
    'أوقف استخدام نسخة العميل المتأثرة دون تعديل المشروع الرئيسي.',
    'احتفظ بنسخة من ملفات العميل الحالية للتحليل.',
    'استبدل نسخة العميل فقط بآخر Snapshot معتمد.',
    'أعد تطبيق بيانات الهوية من القوالب الموثقة داخل نسخة العميل.',
    'شغّل اختبارات الانحدار والسلامة.',
    'وثّق سبب الرجوع والنسخة المستخدمة ونتيجة الاختبارات.',
    'لا تشغّل SQL أو Migration أو تغيّر بيانات أثناء Rollback التخطيطي.'
  ]);
  function build() {
    return Object.freeze({ mode: 'instructions_only', destructive: false, steps: STEPS, databaseRollbackRequired: false, persisted: false });
  }
  ns.ReleaseRollbackPlanner = Object.freeze({ version: '1.0.0', STEPS, build });
})(typeof globalThis !== 'undefined' ? globalThis : window);
