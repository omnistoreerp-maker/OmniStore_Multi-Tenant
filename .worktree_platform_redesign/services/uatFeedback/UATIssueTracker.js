(function (root) {
  'use strict';
  const ns = root.OmniUATFeedback = root.OmniUATFeedback || {};
  const clone = value => JSON.parse(JSON.stringify(value));
  function createTracker() {
    let notes = [];
    function add(input, options) {
      const note = ns.CustomerNoteBuilder.build(input, options);
      notes = [...notes, note];
      return clone(note);
    }
    function list(filters = {}) {
      return clone(notes.filter(note =>
        (!filters.category || note.category === filters.category) &&
        (!filters.status || note.status === filters.status) &&
        (!filters.severity || note.severity === filters.severity) &&
        (!filters.categories || filters.categories.includes(note.category))
      ));
    }
    function updateStatus(id, status) {
      if (!ns.UATFeedbackValidator.STATUSES.includes(status)) throw new Error('Invalid status.');
      let found = false;
      notes = notes.map(note => {
        if (note.id !== id) return note;
        found = true;
        return Object.freeze({ ...note, status, temporary: true, persisted: false });
      });
      return found ? clone(notes.find(note => note.id === id)) : null;
    }
    return Object.freeze({ add, list, updateStatus, count: () => notes.length, storage: 'memory-only' });
  }
  ns.UATIssueTracker = Object.freeze({ version: '1.0.0', createTracker });
})(typeof globalThis !== 'undefined' ? globalThis : window);
