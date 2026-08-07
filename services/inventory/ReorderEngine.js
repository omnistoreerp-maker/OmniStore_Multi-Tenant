(function (root) {
  'use strict';
  const ns = root.OmniInventoryEngine = root.OmniInventoryEngine || {};
  const u = () => ns.InventoryUtils;

  function suggestions(state = {}, filters = {}) {
    return Object.freeze(u().list(state.items).flatMap(item => {
      const warehouses = filters.warehouseId ? [{ id: filters.warehouseId }] : u().list(state.warehouses);
      return warehouses.map(warehouse => {
        const available = ns.InventoryTransactionEngine.availableQty(state, item.id, warehouse.id);
        if (available > item.reorderPoint) return null;
        return Object.freeze({
          itemId: item.id,
          sku: item.sku,
          name: item.name,
          warehouseId: warehouse.id,
          availableQty: available,
          reorderPoint: item.reorderPoint,
          suggestedQty: Math.max(item.reorderQty, u().qty(item.reorderPoint - available + item.reorderQty))
        });
      }).filter(Boolean);
    }));
  }

  ns.ReorderEngine = Object.freeze({ version: '1.0.0', suggestions });
})(typeof globalThis !== 'undefined' ? globalThis : window);
