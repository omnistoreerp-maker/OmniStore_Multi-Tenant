(function (root) {
  'use strict';
  const ns = root.OmniClientHandoff = root.OmniClientHandoff || {};
  const ITEMS = Object.freeze([
    'تمت مراجعة الشاشات الرئيسية.',
    'تمت مراجعة مسارات البيع والشراء ونقطة البيع.',
    'تمت مراجعة المخزون والتقارير.',
    'تم شرح أن مراكز المعاينة محاكاة فقط.',
    'تم شرح عدم وجود ترحيل محاسبي أو مخزني فعلي.',
    'تم شرح أن القوائم المالية الرسمية غير مفعلة بعد.',
    'تم جمع ملاحظات العميل بعد العرض.',
    'تم الاتفاق على الخطوات والتعديلات التالية.'
  ]);
  function build(input = {}) {
    return Object.freeze({
      customerName: input.customerName || '',
      representative: input.representative || '',
      sessionDate: input.sessionDate || '',
      items: Object.freeze(ITEMS.map((label, index) => Object.freeze({ id: `signoff-${index + 1}`, label, accepted: false }))),
      decision: 'pending',
      signatureRequired: true,
      persisted: false
    });
  }
  ns.ClientSignoffBuilder = Object.freeze({ version: '1.0.0', ITEMS, build });
})(typeof globalThis !== 'undefined' ? globalThis : window);
