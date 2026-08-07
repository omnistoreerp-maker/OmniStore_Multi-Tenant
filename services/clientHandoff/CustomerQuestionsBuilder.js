(function (root) {
  'use strict';
  const ns = root.OmniClientHandoff = root.OmniClientHandoff || {};
  const QUESTIONS = Object.freeze([
    'هل أسماء القوائم والخطوات واضحة؟',
    'هل يمكنك الوصول إلى المنتج أو الفاتورة بسرعة؟',
    'هل مسارات البيع والشراء مناسبة لطريقة عملك؟',
    'هل معلومات المخزون واضحة وكافية؟',
    'ما التقارير التي تستخدمها يوميًا؟',
    'هل الطباعة والتصدير بالشكل المتوقع؟',
    'هل توجد مصطلحات تحتاج إلى تبسيط؟',
    'ما أهم تعديل قبل اعتماد النسخة؟',
    'من سيستخدم النظام وما التدريب المطلوب لكل دور؟',
    'هل فهمت حدود نسخة UAT/Beta والخطوات التالية؟'
  ]);
  ns.CustomerQuestionsBuilder = Object.freeze({ version: '1.0.0', QUESTIONS, build: () => QUESTIONS });
})(typeof globalThis !== 'undefined' ? globalThis : window);
