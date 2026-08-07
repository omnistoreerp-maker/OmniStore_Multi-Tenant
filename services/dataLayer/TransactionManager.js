(function (root) {
  'use strict';
  const ns = root.OmniDataLayer = root.OmniDataLayer || {};
  function preview(operations = [], options = {}) {
    const safeOperations = ns.DataLayerUtils.clone(operations);
    const errors = [];
    if (!Array.isArray(operations) || !operations.length) errors.push({ code: 'TRANSACTION_EMPTY', message: 'At least one preview operation is required.' });
    safeOperations.forEach((operation, index) => {
      if (!operation || !operation.operation || !operation.collection) errors.push({ code: 'TRANSACTION_OPERATION_INVALID', index, message: 'Operation and collection are required.' });
    });
    return Object.freeze({
      id: options.id || 'TX-PREVIEW',
      operations: Object.freeze(safeOperations),
      valid: errors.length === 0,
      errors: Object.freeze(errors),
      previewOnly: true,
      begun: false,
      committed: false,
      rolledBack: false,
      dataChanged: false
    });
  }
  ns.TransactionManager = Object.freeze({ version: '1.0.0', preview });
})(typeof globalThis !== 'undefined' ? globalThis : window);
