(function (root) {
  'use strict';

  const supportedTypes = ['text', 'number', 'select', 'checkbox', 'textarea', 'date', 'serial', 'barcode', 'currency'];
  const registry = root.OmniBusinessSchemaRegistry || {};
  const aliases = root.OmniBusinessSchemaAliases || {};
  const customSchemas = {};

  const escapeHtml = value => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  function normalizeType(type) {
    const normalized = aliases[type] || type;
    return registry[normalized] || customSchemas[normalized] ? normalized : 'computer_shop';
  }

  function getSchema(type) {
    const normalized = normalizeType(type || 'computer_shop');
    return customSchemas[normalized] || registry[normalized] || registry.computer_shop;
  }

  function getFields(entity, type) {
    return [...(getSchema(type).entities?.[entity] || [])];
  }

  function getMasterData(type) {
    const data = getSchema(type).masterData || {};
    return {
      categories: [...(data.categories || [])],
      brands: [...(data.brands || [])],
      units: [...(data.units || [])],
      tags: [...(data.tags || [])]
    };
  }

  function resolveValue(source, field) {
    if (!source) return '';
    const legacyKey = field.legacyKey;
    if (field.storage === 'direct') return source[field.key] ?? (legacyKey ? source[legacyKey] : undefined) ?? source.customFields?.[field.key] ?? (legacyKey ? source.customFields?.[legacyKey] : undefined) ?? '';
    return source.customFields?.[field.key] ?? (legacyKey ? source.customFields?.[legacyKey] : undefined) ?? source[field.key] ?? (legacyKey ? source[legacyKey] : undefined) ?? '';
  }

  function renderControl(field, value, options = {}) {
    const prefix = options.prefix || 'dyn';
    const id = `${prefix}_${field.key}`;
    const common = `id="${escapeHtml(id)}" data-schema-key="${escapeHtml(field.key)}" data-schema-type="${escapeHtml(field.type)}" data-schema-storage="${escapeHtml(field.storage || 'custom')}"`;
    if (field.type === 'select') {
      const choices = (field.options || []).map(option => {
        const raw = typeof option === 'object' ? option.value : option;
        const label = typeof option === 'object' ? option.label : option;
        return `<option value="${escapeHtml(raw)}" ${String(value) === String(raw) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
      }).join('');
      return `<select ${common}><option value="">اختر...</option>${choices}</select>`;
    }
    if (field.type === 'checkbox') {
      return `<label style="display:flex;align-items:center;gap:7px"><input ${common} type="checkbox" ${value ? 'checked' : ''}> ${escapeHtml(field.label)}</label>`;
    }
    if (field.type === 'textarea' || field.type === 'serial') {
      return `<textarea ${common} rows="${field.type === 'serial' ? 3 : 2}" style="${field.type === 'serial' ? 'direction:ltr;font-family:monospace' : ''}">${escapeHtml(value)}</textarea>`;
    }
    const inputType = field.type === 'date' ? 'date' : field.type === 'number' || field.type === 'currency' ? 'number' : 'text';
    const step = field.type === 'currency' ? ' step="0.01"' : '';
    const dir = field.type === 'barcode' ? ' style="direction:ltr;font-family:monospace"' : '';
    return `<input ${common} type="${inputType}" value="${escapeHtml(value)}"${step}${dir}>`;
  }

  function renderFields(entity, type, values = {}, options = {}) {
    const fields = getFields(entity, type);
    const html = fields.map(field => {
      if (!supportedTypes.includes(field.type)) return '';
      const value = resolveValue(values, field);
      const required = field.required ? ' <span style="color:var(--red)">*</span>' : '';
      const label = field.type === 'checkbox' ? '' : `<label>${escapeHtml(field.label)}${required}</label>`;
      return `<div class="form-group" data-dynamic-schema-field="${escapeHtml(field.key)}">${label}${renderControl(field, value, options)}</div>`;
    }).join('');
    if (options.mount && typeof options.mount.innerHTML === 'string') options.mount.innerHTML = html;
    return html;
  }

  function collectValues(container) {
    const direct = {};
    const customFields = {};
    if (!container?.querySelectorAll) return { direct, customFields, all: {} };
    container.querySelectorAll('[data-schema-key]').forEach(input => {
      const key = input.getAttribute('data-schema-key');
      const storage = input.getAttribute('data-schema-storage');
      const type = input.getAttribute('data-schema-type');
      let value = type === 'checkbox' ? !!input.checked : String(input.value || '').trim();
      if ((type === 'number' || type === 'currency') && value !== '') value = Number(value);
      (storage === 'direct' ? direct : customFields)[key] = value;
    });
    return { direct, customFields, all: { ...customFields, ...direct } };
  }

  function validate(entity, values, type) {
    const errors = [];
    getFields(entity, type).forEach(field => {
      const value = resolveValue(values, field);
      if (field.required && (value === undefined || value === null || value === '' || value === false)) {
        errors.push({ key: field.key, label: field.label, code: 'required', message: `${field.label} مطلوب` });
      }
      if (value !== '' && value != null && field.type === 'number' && Number.isNaN(Number(value))) {
        errors.push({ key: field.key, label: field.label, code: 'number', message: `${field.label} يجب أن يكون رقماً` });
      }
      if (value !== '' && value != null && field.type === 'select' && field.options?.length) {
        const allowed = field.options.map(option => String(typeof option === 'object' ? option.value : option));
        if (!allowed.includes(String(value))) errors.push({ key: field.key, label: field.label, code: 'option', message: `قيمة ${field.label} غير صالحة` });
      }
    });
    return { valid: errors.length === 0, errors };
  }

  function getTableFields(type, limit = 3) {
    return getFields('product', type).filter(field => field.table).slice(0, limit);
  }

  function renderTableHeaders(type, limit = 3) {
    return getTableFields(type, limit).map(field => `<th data-dynamic-column="${escapeHtml(field.key)}">${escapeHtml(field.label)}</th>`).join('');
  }

  function renderTableCells(product, type, limit = 3) {
    return getTableFields(type, limit).map(field => `<td data-dynamic-column="${escapeHtml(field.key)}">${escapeHtml(resolveValue(product, field) || '-')}</td>`).join('');
  }

  function renderDetails(product, type) {
    const rows = getFields('product', type)
      .map(field => [field.label, resolveValue(product, field)])
      .filter(row => row[1] !== '' && row[1] !== null && row[1] !== undefined && row[1] !== false);
    return rows.map(row => `<div style="border:1px solid var(--border);border-radius:8px;padding:9px;background:var(--surface2)"><div style="font-size:.7rem;color:var(--text2)">${escapeHtml(row[0])}</div><strong>${escapeHtml(row[1])}</strong></div>`).join('');
  }

  function registerSchema(type, schema) {
    if (!type || !schema || typeof schema !== 'object') throw new Error('A type and schema object are required');
    const entities = schema.entities || {};
    ['product', 'customer', 'supplier', 'invoice', 'purchase', 'sale'].forEach(entity => {
      if (!Array.isArray(entities[entity])) throw new Error(`Schema entity ${entity} must be an array`);
      entities[entity].forEach(item => {
        if (!item.key || !supportedTypes.includes(item.type)) throw new Error(`Invalid ${entity} field`);
      });
    });
    customSchemas[type] = { ...schema, id: type, entities };
    return customSchemas[type];
  }

  function unregisterSchema(type) {
    if (!type || !customSchemas[type]) return false;
    delete customSchemas[type];
    return true;
  }

  root.OmniBusinessEngine = Object.freeze({
    supportedTypes: [...supportedTypes],
    listBusinessTypes: () => [...new Set([...Object.keys(registry), ...Object.keys(customSchemas)])],
    normalizeType,
    getSchema,
    getFields,
    getMasterData,
    renderFields,
    collectValues,
    validate,
    getTableFields,
    renderTableHeaders,
    renderTableCells,
    renderDetails,
    registerSchema,
    unregisterSchema
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
