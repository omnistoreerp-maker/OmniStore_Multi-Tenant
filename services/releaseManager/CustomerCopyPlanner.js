(function (root) {
  'use strict';
  const ns = root.OmniReleaseManager = root.OmniReleaseManager || {};
  const SAFE_STEPS = Object.freeze([
    'أنشئ مجلد عميل جديد خارج مجلد المشروع الرئيسي.',
    'انسخ ملفات الإصدار المعتمدة فقط إلى مجلد العميل الجديد.',
    'املأ قوالب الشركة والهوية وبيانات العميل داخل النسخة الجديدة فقط.',
    'احتفظ بنوع النشاط الافتراضي computer_shop ما لم يعتمد العميل غير ذلك.',
    'شغّل اختبارات النسخة الجديدة قبل العرض.',
    'راجع شارات UAT/Beta وحدود المعاينة مع العميل.',
    'سجّل مسار النسخة ورقم الإصدار وتاريخ الإنشاء في وثيقة التسليم.',
    'لا تربط قاعدة بيانات أو Supabase دون مرحلة اعتماد منفصلة.'
  ]);
  const MASTER_PROTECTIONS = Object.freeze([
    'لا تغيّر بيانات العميل أو الهوية داخل المشروع الرئيسي.',
    'لا تحذف اختبارات أو تقارير أو ملفات Rollback من المشروع الرئيسي.',
    'لا تنفذ SQL أو Migration من عملية إنشاء النسخة.',
    'لا تضف مفاتيح أو بيانات اتصال خاصة بعميل إلى المشروع الرئيسي.',
    'لا تستخدم مجلد عميل قائم كهدف للنسخ أو الاستبدال.',
    'لا تعدّل منطق POS أو Sales أو Purchases أو Inventory أو Reports أثناء التخصيص.'
  ]);
  function plan(input = {}) {
    return Object.freeze({
      mode: 'planning_only',
      executesCopy: false,
      customerCode: String(input.customerCode || '{{CUSTOMER_CODE}}'),
      targetPlaceholder: '{{NEW_CUSTOMER_COPY_DIRECTORY}}',
      source: 'MASTER_RELEASE_SNAPSHOT',
      steps: SAFE_STEPS,
      masterProtections: MASTER_PROTECTIONS,
      requiresExplicitTargetApproval: true,
      persisted: false
    });
  }
  ns.CustomerCopyPlanner = Object.freeze({ version: '1.0.0', SAFE_STEPS, MASTER_PROTECTIONS, plan });
})(typeof globalThis !== 'undefined' ? globalThis : window);
