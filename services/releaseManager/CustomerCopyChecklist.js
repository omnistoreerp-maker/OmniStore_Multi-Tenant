(function (root) {
  'use strict';
  const ns = root.OmniReleaseManager = root.OmniReleaseManager || {};
  const ITEMS = Object.freeze([
    ['new_directory', 'تم تحديد مجلد جديد وفارغ للعميل.'],
    ['master_untouched', 'تم التأكد أن المشروع الرئيسي لن يتغير.'],
    ['company_profile', 'تم إعداد اسم الشركة والهاتف والعنوان والرقم الضريبي.'],
    ['branding', 'تم إعداد الشعار والألوان واسم النسخة.'],
    ['business_type', 'تم اعتماد نوع النشاط والحقول والوحدات.'],
    ['currency_localization', 'تم اعتماد العملة واللغة والتنسيقات.'],
    ['uat_labels', 'شارات UAT/Beta والمعاينة الآمنة ظاهرة.'],
    ['regression', 'نجحت اختبارات الانحدار في نسخة العميل.'],
    ['demo_package', 'تم تجهيز سيناريوهات العرض والتدريب والحدود.'],
    ['rollback', 'تم توثيق نسخة الرجوع ومسؤول الاستعادة.'],
    ['handoff', 'تم اعتماد دليل التسليم ونموذج توقيع العميل.']
  ]);
  function build() {
    return Object.freeze(ITEMS.map(([id, label], index) => Object.freeze({ id, order: index + 1, label, required: true, status: 'pending' })));
  }
  ns.CustomerCopyChecklist = Object.freeze({ version: '1.0.0', ITEMS, build });
})(typeof globalThis !== 'undefined' ? globalThis : window);
