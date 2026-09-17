(function (root) {
  'use strict';
  const ns = root.OmniDemoPolish = root.OmniDemoPolish || {};
  const STEPS = Object.freeze([
    { id: 'welcome', title: 'التعرف على لوحة التحكم', description: 'راجع ملخص المبيعات والمخزون والتنبيهات الرئيسية.' },
    { id: 'products', title: 'تجربة البحث عن منتج', description: 'جرّب البحث والفلاتر وراجع السعر والكمية دون تعديل البيانات.' },
    { id: 'pos', title: 'معاينة نقطة البيع', description: 'راجع سهولة اختيار الأصناف وحساب الإجمالي دون إتمام بيع فعلي.' },
    { id: 'sales', title: 'مراجعة المبيعات', description: 'افتح أرشيف الفواتير وتقارير المبيعات وراجع وضوح المعلومات.' },
    { id: 'purchases', title: 'مراجعة المشتريات', description: 'راجع فواتير الموردين وتأثيرها المتوقع على التكلفة والمخزون.' },
    { id: 'inventory', title: 'مراجعة المخزون', description: 'راجع الكميات والحركات والتحويلات والتنبيهات.' },
    { id: 'previews', title: 'تجربة المعاينات الآمنة', description: 'شاهد التأثير المحاسبي والمخزني المتوقع دون حفظ أو ترحيل.' },
    { id: 'reports', title: 'تجربة التقارير', description: 'راجع البحث والفلاتر والطباعة والتصدير التجريبي.' },
    { id: 'acceptance', title: 'تسجيل الملاحظات', description: 'دوّن ما أعجبك وما يحتاج تحسينًا قبل اعتماد النسخة.' }
  ]);
  const WHAT_TO_TEST = Object.freeze([
    'وضوح أسماء القوائم وسهولة الوصول للصفحات.',
    'سرعة العثور على المنتج أو الفاتورة المطلوبة.',
    'وضوح الأسعار والكميات والإجماليات.',
    'سهولة قراءة التقارير على الكمبيوتر والموبايل.',
    'وضوح رسائل التحذير وحالات البيانات الناقصة.',
    'ملاءمة الطباعة والتصدير لاحتياجات النشاط.'
  ]);
  ns.CustomerDemoChecklist = Object.freeze({ version: '1.0.0', STEPS, WHAT_TO_TEST });
})(typeof globalThis !== 'undefined' ? globalThis : window);
