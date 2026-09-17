(function (root) {
  'use strict';
  const ns = root.OmniConfiguration = root.OmniConfiguration || {};
  const list = value => Array.isArray(value) ? value : [];
  function validate(config = {}) {
    const errors = [];
    const warnings = [];
    const missingValues = [];
    Object.values(ns.sections || {}).forEach(section => {
      const values = config[section.id] || {};
      section.fields.forEach(field => {
        const value = values[field.key];
        const ref = `${section.id}.${field.key}`;
        if (value === undefined || value === null || (field.required && field.type !== 'checkbox' && String(value).trim() === '')) {
          if (field.required) {
            missingValues.push(ref);
            errors.push({ code: 'REQUIRED_VALUE_MISSING', reference: ref, message: `${field.label} is required.` });
          }
          return;
        }
        if (field.type === 'number' && !Number.isFinite(Number(value))) errors.push({ code: 'NUMBER_INVALID', reference: ref, message: `${field.label} must be numeric.` });
        if (field.type === 'checkbox' && typeof value !== 'boolean') errors.push({ code: 'BOOLEAN_INVALID', reference: ref, message: `${field.label} must be true or false.` });
        if (field.options && !list(field.options).includes(value)) errors.push({ code: 'OPTION_INVALID', reference: ref, message: `${field.label} has an unsupported value.` });
        if (field.min != null && Number(value) < field.min) errors.push({ code: 'MIN_VALUE', reference: ref, message: `${field.label} is below the minimum.` });
        if (field.max != null && Number(value) > field.max) errors.push({ code: 'MAX_VALUE', reference: ref, message: `${field.label} exceeds the maximum.` });
        if (field.locked && value !== field.default) errors.push({ code: 'LOCKED_SETTING_CHANGED', reference: ref, message: `${field.label} is locked in Preview Mode.` });
      });
    });
    Object.keys(config).filter(id => !ns.sections[id] && id !== '_meta').forEach(id => warnings.push({ code: 'UNKNOWN_SECTION', reference: id, message: `Unknown configuration section: ${id}` }));
    const fieldCount = Object.values(ns.sections || {}).reduce((sum, section) => sum + section.fields.length, 0);
    const penalty = (errors.length * 10) + (warnings.length * 2);
    return Object.freeze({
      valid: errors.length === 0,
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings),
      missingValues: Object.freeze(missingValues),
      fieldCount,
      healthScore: Math.max(0, 100 - penalty)
    });
  }
  ns.ConfigurationValidator = Object.freeze({ version: '1.0.0', validate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
