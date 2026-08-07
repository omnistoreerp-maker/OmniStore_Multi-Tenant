(function (root) {
  'use strict';
  const ns = root.OmniClientHandoff = root.OmniClientHandoff || {};
  const AGENDA = Object.freeze([
    { minutes: 10, title: 'مقدمة وحدود نسخة UAT/Beta' },
    { minutes: 15, title: 'لوحة التحكم والمنتجات والتنقل' },
    { minutes: 20, title: 'المبيعات والمشتريات ونقطة البيع' },
    { minutes: 15, title: 'المخزون والتقارير' },
    { minutes: 15, title: 'مراكز المعاينة والجاهزية' },
    { minutes: 10, title: 'ملاحظات العميل والأسئلة' },
    { minutes: 5, title: 'الخطوات التالية والاعتماد' }
  ]);
  function build(input = {}) {
    return Object.freeze({
      sessionTitle: input.sessionTitle || 'جلسة تجربة واعتماد OmniStore ERP',
      customer: input.customer || 'عميل تجريبي',
      mode: 'UAT/Beta',
      totalMinutes: AGENDA.reduce((sum, item) => sum + item.minutes, 0),
      agenda: AGENDA,
      feedbackAfterDemo: true,
      persisted: false
    });
  }
  ns.UATSessionPlanner = Object.freeze({ version: '1.0.0', AGENDA, build });
})(typeof globalThis !== 'undefined' ? globalThis : window);
