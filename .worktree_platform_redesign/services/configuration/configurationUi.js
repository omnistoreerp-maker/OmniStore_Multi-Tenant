(function (root) {
  'use strict';
  const ns = root.OmniConfiguration;
  const engine = ns.ConfigurationEngine.createEngine();
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const ROUTES = Object.freeze({
    'configuration-center': 'center',
    'config-business-profile': 'businessProfile',
    'config-pos': 'pos',
    'config-inventory': 'inventory',
    'config-accounting': 'accounting',
    'config-print': 'print',
    'config-theme': 'theme',
    'config-security': 'security',
    'config-backup': 'backup',
    'config-export': 'export',
    'config-import': 'import'
  });
  function inputFor(sectionId, field, value) {
    const disabled = field.locked ? ' disabled' : '';
    const change = field.locked ? '' : ` onchange="previewConfigurationValue('${sectionId}','${field.key}',this,'${field.type}')"`;
    if (field.type === 'checkbox') return `<input type="checkbox"${value ? ' checked' : ''}${disabled}${change}>`;
    if (field.type === 'select') return `<select${disabled}${change}>${field.options.map(option => `<option value="${esc(option)}"${option === value ? ' selected' : ''}>${esc(option)}</option>`).join('')}</select>`;
    if (field.type === 'textarea') return `<textarea rows="2"${disabled}${change}>${esc(value)}</textarea>`;
    return `<input type="${field.type === 'color' ? 'color' : field.type === 'number' ? 'number' : 'text'}" value="${esc(value)}"${field.min != null ? ` min="${field.min}"` : ''}${field.max != null ? ` max="${field.max}"` : ''}${disabled}${change}>`;
  }
  function sectionForm(sectionId) {
    const section = ns.sections[sectionId];
    const config = engine.getConfiguration()[sectionId];
    return `<div class="config-preview-grid">${section.fields.map(field => `<div class="report-card config-field-card">
      <div class="form-group"><label>${esc(field.label)}${field.required ? ' *' : ''}${field.locked ? ' 🔒' : ''}</label>${inputFor(sectionId, field, config[field.key])}</div>
      <div class="config-default">Default: <code>${esc(JSON.stringify(field.default))}</code>${field.locked ? ' — مقفل في Preview Mode' : ''}</div>
    </div>`).join('')}</div>`;
  }
  function validationPanel() {
    const validation = engine.validate();
    return `<div class="stats-grid" style="margin-bottom:12px">
      <div class="stat-card ${validation.valid ? 'green' : 'red'}"><div class="stat-value">${validation.healthScore}%</div><div class="stat-label">Configuration Health</div></div>
      <div class="stat-card blue"><div class="stat-value">${validation.fieldCount}</div><div class="stat-label">الخيارات المتاحة</div></div>
      <div class="stat-card red"><div class="stat-value">${validation.errors.length}</div><div class="stat-label">Validation Errors</div></div>
      <div class="stat-card yellow"><div class="stat-value">${validation.missingValues.length}</div><div class="stat-label">Missing Values</div></div>
    </div>
    <div id="configurationValidationDetails">${validation.errors.length ? validation.errors.map(item => `<div class="alert alert-danger">${esc(item.reference)} — ${esc(item.message)}</div>`).join('') : '<div class="alert alert-info">جميع القيم المطلوبة موجودة وصحيحة.</div>'}</div>`;
  }
  function centerView() {
    const config = engine.getConfiguration();
    const summaries = Object.values(ns.sections).map(section => {
      const values = config[section.id] || {};
      return `<div class="report-card"><div class="table-title">${esc(section.title)}</div><div class="config-default">${section.fields.length} options · ${Object.keys(values).length} values</div></div>`;
    }).join('');
    return `${validationPanel()}<div class="alert alert-warning">جميع التعديلات مؤقتة في الذاكرة وتختفي عند إعادة تحميل الصفحة. لا يوجد زر حفظ دائم.</div><div class="config-preview-grid">${summaries}</div><div class="table-container" style="margin-top:14px"><div class="table-header"><div class="table-title">User Preferences</div></div><div style="padding:12px">${sectionForm('user')}</div></div>`;
  }
  function exportView() {
    const json = engine.exportPreview();
    return `<div class="alert alert-info">يتم إنشاء ملف JSON للمعاينة فقط ولا يتم حفظ الإعدادات داخل التطبيق.</div>
      <div class="table-actions" style="justify-content:flex-start;margin-bottom:12px"><button type="button" class="btn btn-outline btn-sm" onclick="exportConfigurationPreview()">تصدير Configuration JSON Preview</button></div>
      <textarea id="configurationExportPreview" rows="22" readonly style="width:100%;direction:ltr">${esc(json)}</textarea>`;
  }
  function importView() {
    return `<div class="alert alert-warning">الاستيراد هنا Preview فقط: يتم تحليل الملف وعرض الفروق دون تطبيق أي قيمة.</div>
      <textarea id="configurationImportInput" rows="14" style="width:100%;direction:ltr" placeholder="Paste configuration JSON here"></textarea>
      <div class="table-actions" style="justify-content:flex-start;margin:10px 0"><button type="button" class="btn btn-outline btn-sm" onclick="previewConfigurationImport()">معاينة ملف JSON</button></div>
      <div id="configurationImportResult"><div class="alert alert-info">ألصق JSON ثم اختر المعاينة لعرض الأخطاء والقيم المفقودة والفروق.</div></div>`;
  }
  function renderConfigurationPage(route) {
    const target = document.getElementById(`configuration-${route}`);
    if (!target) return;
    const sectionId = ROUTES[route];
    let content;
    if (sectionId === 'center') content = centerView();
    else if (sectionId === 'export') content = exportView();
    else if (sectionId === 'import') content = importView();
    else content = `${validationPanel()}${sectionForm(sectionId)}`;
    target.innerHTML = `<div class="alert alert-info"><strong>Preview Mode:</strong> يمكنك تعديل القيم في الذاكرة فقط. لا SQL، لا Supabase، لا database، لا localStorage، ولا ترحيل.</div>${content}`;
  }
  function typedValue(element, type) {
    if (type === 'checkbox') return element.checked;
    if (type === 'number') return Number(element.value);
    return element.value;
  }
  function previewConfigurationValue(section, key, element, type) {
    const result = engine.setValue(section, key, typedValue(element, type));
    const status = document.getElementById('configurationMemoryStatus');
    if (status) status.textContent = `${section}.${key} changed in memory only`;
    return result;
  }
  function resetConfigurationMemory(route) {
    engine.resetInMemory();
    renderConfigurationPage(route);
  }
  function exportConfigurationPreview() {
    const json = engine.exportPreview();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'omnistore-configuration-preview.json';
    link.click();
    URL.revokeObjectURL(url);
  }
  function previewConfigurationImport() {
    const input = document.getElementById('configurationImportInput');
    const target = document.getElementById('configurationImportResult');
    if (!input || !target) return;
    const result = engine.importPreview(input.value);
    if (!result.validJson) {
      target.innerHTML = result.errors.map(item => `<div class="alert alert-danger">${esc(item.message)}</div>`).join('');
      return;
    }
    target.innerHTML = `<div class="stats-grid"><div class="stat-card ${result.validConfiguration ? 'green' : 'red'}"><div class="stat-value">${result.validConfiguration ? 'Valid' : 'Review'}</div><div class="stat-label">Import Preview</div></div><div class="stat-card blue"><div class="stat-value">${result.differences.length}</div><div class="stat-label">Differences</div></div><div class="stat-card red"><div class="stat-value">${result.errors.length}</div><div class="stat-label">Errors</div></div><div class="stat-card yellow"><div class="stat-value">${result.missingValues.length}</div><div class="stat-label">Missing</div></div></div>
      <div class="alert alert-warning" style="margin-top:12px">Preview complete. Nothing was applied.</div>
      ${result.errors.map(item => `<div class="alert alert-danger">${esc(item.reference || '')} — ${esc(item.message)}</div>`).join('')}
      ${result.differences.slice(0, 50).map(item => `<div class="config-diff"><strong>${esc(item.section)}.${esc(item.key)}</strong><span>${esc(JSON.stringify(item.before))} → ${esc(JSON.stringify(item.after))}</span></div>`).join('')}`;
  }
  root.renderConfigurationPage = renderConfigurationPage;
  root.previewConfigurationValue = previewConfigurationValue;
  root.resetConfigurationMemory = resetConfigurationMemory;
  root.exportConfigurationPreview = exportConfigurationPreview;
  root.previewConfigurationImport = previewConfigurationImport;
  root.OmniConfigurationUi = Object.freeze({ version: '1.0.0', engine, renderConfigurationPage });
})(typeof globalThis !== 'undefined' ? globalThis : window);
