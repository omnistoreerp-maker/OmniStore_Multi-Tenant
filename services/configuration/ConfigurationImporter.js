(function (root) {
  'use strict';
  const ns = root.OmniConfiguration = root.OmniConfiguration || {};
  const clone = value => JSON.parse(JSON.stringify(value));
  function preview(input, current = {}) {
    let parsed;
    try {
      parsed = typeof input === 'string' ? JSON.parse(input) : clone(input);
    } catch (error) {
      return Object.freeze({ validJson: false, applied: false, errors: Object.freeze([{ code: 'JSON_INVALID', message: error.message }]), differences: Object.freeze([]), candidate: null });
    }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      return Object.freeze({ validJson: false, applied: false, errors: Object.freeze([{ code: 'CONFIG_OBJECT_REQUIRED', message: 'Configuration must be a JSON object.' }]), differences: Object.freeze([]), candidate: null });
    }
    const candidate = clone(parsed);
    delete candidate._meta;
    const validation = ns.ConfigurationValidator.validate(candidate);
    const differences = [];
    Object.values(ns.sections || {}).forEach(section => section.fields.forEach(field => {
      const before = current[section.id] && current[section.id][field.key];
      const after = candidate[section.id] && candidate[section.id][field.key];
      if (after !== undefined && JSON.stringify(before) !== JSON.stringify(after)) differences.push(Object.freeze({ section: section.id, key: field.key, before, after }));
    }));
    return Object.freeze({
      validJson: true,
      validConfiguration: validation.valid,
      applied: false,
      errors: validation.errors,
      warnings: validation.warnings,
      missingValues: validation.missingValues,
      differences: Object.freeze(differences),
      candidate: Object.freeze(candidate)
    });
  }
  ns.ConfigurationImporter = Object.freeze({ version: '1.0.0', preview });
})(typeof globalThis !== 'undefined' ? globalThis : window);
