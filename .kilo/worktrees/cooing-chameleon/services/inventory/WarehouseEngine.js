(function (root) {
  'use strict';
  const ns = root.OmniInventoryEngine = root.OmniInventoryEngine || {};
  const u = () => ns.InventoryUtils;

  function createWarehouse(input = {}) {
    return Object.freeze({
      id: u().text(input.id) || u().id('wh'),
      name: u().text(input.name),
      branch: u().text(input.branch),
      location: u().text(input.location),
      active: input.active !== false,
      allowSales: input.allowSales !== false,
      metadata: Object.freeze(u().clone(input.metadata || {}))
    });
  }

  function upsert(state = {}, warehouse, options = {}) {
    const next = u().clone(state);
    const record = createWarehouse(warehouse);
    next.warehouses = u().list(next.warehouses).some(row => row.id === record.id)
      ? next.warehouses.map(row => row.id === record.id ? record : row)
      : [...u().list(next.warehouses), record];
    return u().audit(next, 'warehouse.upsert', { warehouseId: record.id }, options.user);
  }

  function get(state = {}, warehouseId) {
    return u().list(state.warehouses).find(warehouse => warehouse.id === warehouseId) || null;
  }

  ns.WarehouseEngine = Object.freeze({ version: '1.0.0', createWarehouse, upsert, get });
})(typeof globalThis !== 'undefined' ? globalThis : window);
