(function (root) {
  'use strict';
  const ns = root.OmniClientHandoff = root.OmniClientHandoff || {};
  const ITEMS = Object.freeze([
    'تسجيل الدخول وفهم القائمة الرئيسية.',
    'الوصول إلى لوحة التحكم وقراءة المؤشرات.',
    'البحث عن المنتجات واستخدام الفلاتر.',
    'فهم مسار المبيعات ونقطة البيع دون تنفيذ أثناء التدريب.',
    'فهم مسار المشتريات والموردين.',
    'مراجعة الكميات وحركات المخزون.',
    'قراءة التقارير واستخدام معاينة الطباعة والتصدير.',
    'استخدام مراكز المعاينة والجاهزية بأمان.',
    'تسجيل ملاحظات UAT المؤقتة وتصنيفها.',
    'فهم حدود نسخة Beta وخطوات الاعتماد التالية.'
  ]);
  function build() {
    return Object.freeze(ITEMS.map((title, index) => Object.freeze({ id: `training-${index + 1}`, order: index + 1, title, status: 'pending_customer_review' })));
  }
  ns.ClientTrainingChecklist = Object.freeze({ version: '1.0.0', ITEMS, build });
})(typeof globalThis !== 'undefined' ? globalThis : window);
