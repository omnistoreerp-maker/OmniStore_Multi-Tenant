(function (root) {
  'use strict';
  const ns = root.OmniClientHandoff = root.OmniClientHandoff || {};
  const LIMITATIONS = Object.freeze([
    'هذه نسخة UAT/Beta مخصصة للتجربة وقبول العميل.',
    'مراكز المعاينة تعرض محاكاة فقط ولا تنفذ العمليات.',
    'لا يتم ترحيل أو حفظ قيود محاسبية فعلية.',
    'لا يتم ترحيل أو حفظ حركات مخزون فعلية من مراكز المعاينة.',
    'القوائم المالية الرسمية غير مفعلة بعد.',
    'ملاحظات UAT مؤقتة وتختفي عند إعادة تحميل الصفحة.',
    'يجب اختبار الشاشات ومسارات العمل والتقارير والتنقل وسهولة الاستخدام.',
    'يجب جمع ملاحظات العميل بعد انتهاء العرض ومراجعتها قبل الاعتماد.'
  ]);
  ns.DemoLimitationsBuilder = Object.freeze({ version: '1.0.0', LIMITATIONS, build: () => LIMITATIONS });
})(typeof globalThis !== 'undefined' ? globalThis : window);
