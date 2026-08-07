(function (root) {
  'use strict';
  const ns = root.OmniConfiguration = root.OmniConfiguration || {};
  const clone = value => JSON.parse(JSON.stringify(value));
  function defaults() {
    const config = {};
    Object.values(ns.sections || {}).forEach(section => {
      config[section.id] = {};
      section.fields.forEach(field => { config[section.id][field.key] = field.default; });
    });
    return config;
  }
  function merge(base, input = {}) {
    const next = clone(base);
    Object.keys(next).forEach(section => {
      if (input[section] && typeof input[section] === 'object') Object.assign(next[section], clone(input[section]));
    });
    return next;
  }
  function createEngine(initial = {}) {
    const baseDefaults = defaults();
    let memoryConfig = merge(baseDefaults, initial);
    function getConfiguration() { return clone(memoryConfig); }
    function setValue(sectionId, key, value) {
      const section = ns.sections[sectionId];
      const field = section && section.fields.find(item => item.key === key);
      if (!field) throw new Error(`Unknown setting: ${sectionId}.${key}`);
      if (field.locked) throw new Error(`${field.label} is locked in Preview Mode.`);
      memoryConfig = { ...memoryConfig, [sectionId]: { ...memoryConfig[sectionId], [key]: value } };
      return Object.freeze({ appliedToMemory: true, persisted: false, section: sectionId, key, value });
    }
    function resetInMemory() {
      memoryConfig = defaults();
      return Object.freeze({ resetInMemory: true, persisted: false, configuration: getConfiguration() });
    }
    return Object.freeze({
      mode: 'preview-memory-only',
      persisted: false,
      getConfiguration,
      getDefaults: () => clone(baseDefaults),
      getSections: () => Object.values(ns.sections),
      setValue,
      resetInMemory,
      validate: () => ns.ConfigurationValidator.validate(memoryConfig),
      exportPreview: options => ns.ConfigurationExporter.stringify(memoryConfig, options),
      importPreview: input => ns.ConfigurationImporter.preview(input, memoryConfig)
    });
  }
  ns.ConfigurationEngine = Object.freeze({ version: '1.0.0', defaults, createEngine });
})(typeof globalThis !== 'undefined' ? globalThis : window);
