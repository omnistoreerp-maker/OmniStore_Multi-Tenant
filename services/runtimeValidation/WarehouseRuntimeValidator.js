(function (root) {
  'use strict';
  const ns = root.OmniRuntimeValidation = root.OmniRuntimeValidation || {};
  function validate(context = {}) {
    const { list, issue, result } = ns.RuntimeValidationUtils;
    const issues = [];
    const warehouses = list(context.warehouses || (context.snapshot && context.snapshot.warehouses));
    const documents = list(context.documents);
    if (!warehouses.length) issues.push(issue('WAREHOUSE_UNAVAILABLE', 'No warehouse is available.', { severity: 'critical', blocking: true, source: 'warehouse' }));
    if (warehouses.length && !warehouses.some(w => w.active !== false && w.enabled !== false)) issues.push(issue('ACTIVE_WAREHOUSE_UNAVAILABLE', 'No active warehouse is available.', { severity: 'critical', blocking: true, source: 'warehouse' }));
    documents.forEach(doc => {
      const id = doc.warehouseId || doc.fromWarehouseId || doc.warehouse;
      if (id && !warehouses.some(w => String(w.id || w.code) === String(id))) issues.push(issue('DOCUMENT_WAREHOUSE_MISSING', 'Referenced warehouse does not exist.', { severity: 'critical', blocking: true, source: 'warehouse', reference: String(id) }));
    });
    return result('warehouse', 'Warehouse Readiness', issues, [{ id: 'warehouse_availability', passed: !issues.length }]);
  }
  ns.WarehouseRuntimeValidator = Object.freeze({ version: '1.0.0', validate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
