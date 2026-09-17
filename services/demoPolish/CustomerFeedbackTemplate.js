(function (root) {
  'use strict';
  const ns = root.OmniDemoPolish = root.OmniDemoPolish || {};
  const FIELDS = Object.freeze([
    { id: 'liked', label: 'أكثر شيء أعجبك', placeholder: 'اكتب الوظائف أو الشاشات التي كانت واضحة ومفيدة...' },
    { id: 'unclear', label: 'أشياء تحتاج توضيحًا', placeholder: 'اكتب أي مصطلح أو خطوة لم تكن واضحة...' },
    { id: 'missing', label: 'احتياجات أو تقارير إضافية', placeholder: 'اكتب ما تحتاجه في الاستخدام اليومي...' },
    { id: 'priority', label: 'أهم تعديل قبل الاعتماد', placeholder: 'ما التعديل الأعلى أولوية بالنسبة لك؟' }
  ]);
  function create() {
    return Object.freeze({ createdAt: new Date().toISOString(), persisted: false, fields: Object.freeze(FIELDS.map(field => Object.freeze({ ...field, value: '' }))) });
  }
  ns.CustomerFeedbackTemplate = Object.freeze({ version: '1.0.0', FIELDS, create });
})(typeof globalThis !== 'undefined' ? globalThis : window);
