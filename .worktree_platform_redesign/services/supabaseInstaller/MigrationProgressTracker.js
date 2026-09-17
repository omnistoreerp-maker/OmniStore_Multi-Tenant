(function (root) {
  'use strict';
  const ns = root.OmniSupabaseInstaller = root.OmniSupabaseInstaller || {};
  function fromResponse(response) {
    const stages = response && response.body && Array.isArray(response.body.stages) ? response.body.stages : [];
    return Object.freeze({
      stages: Object.freeze(stages.map(stage => Object.freeze({ id: stage.id, status: stage.status, message: stage.message || '' }))),
      completed: stages.length > 0 && stages.every(stage => stage.status === 'completed' || stage.status === 'skipped'),
      persistedInBrowser: false
    });
  }
  ns.MigrationProgressTracker = Object.freeze({ version: '1.0.0', fromResponse });
})(typeof globalThis !== 'undefined' ? globalThis : window);
